import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  blockedFor,
  modelBlockKey,
  modelFamily,
  paneAccountId,
  type AccountsState,
  type BlockedUntil,
} from "@/lib/accounts";
import {
  chatActivity,
  chatCommand,
  chatReplaying,
  subscribeChatActivity,
  subscribeEveryChat,
} from "@/lib/chat/chatEvents";
import {
  chatLimitHit,
  chatLimitStep,
  creditsFailure,
  modelLimitUntil,
  modelName,
  planChatLimitSwitch,
  type ChatLimitHit,
} from "@/lib/chat/chatLimit";
import { setLimitNotice } from "@/lib/chat/chatLimitNotice";
import { resetClock } from "@/lib/chat/chatQuota";
import {
  attachLiveChat,
  liveChatState,
  startLiveChat,
} from "@/lib/chat/chatLive";
import { chatTurnHolds } from "@/lib/chat/usePaneChats";
import {
  CREDITS_ACCOUNT_ID,
  CREDITS_LABEL,
  CREDITS_MODEL,
} from "@/lib/credits";
import type { PaneChat, PaneState, Tab } from "@/types";

/**
 * A turn the limit refuses ends at once: past this, the chat moves anyway,
 * its turn or question cut (the quota is gone either way).
 */
const TURN_WAIT_MS = 60_000;
/** The hit comes mid-turn: a wait is said only when it lasts past this. */
const SLOW_REST_MS = 5_000;
/** A long wait looks this often whether its pane still holds the chat. */
const PANE_CHECK_MS = 60_000;
/** After an account's reset, a margin before it takes a turn. */
const RESET_MARGIN_MS = 5_000;
/** After a restart, saved waits look for their chat's pane at these times. */
const REARM_AT_MS = [15_000, 60_000];
/** At most this many automatic moves of one conversation per window. */
const MAX_SWITCHES = 3;
const SWITCH_WINDOW_MS = 30 * 60_000;
/** Events older than this come from a replay, not from now. */
const FRESH_MS = 60_000;
/** A chat on the API credits looks this often whether an account is back. */
const RETURN_CHECK_MS = 60_000;

/** The chats' saved waits (`LimitState.chatWaits`): session id → next look. */
interface ChatWaits {
  loaded: () => Promise<void>;
  list: () => Record<string, number>;
  set: (sessionId: string, at: number | null) => void;
}

type Relaunch = (
  tabId: string,
  old: PaneState,
  chat: PaneChat,
  accountId: string,
  stillThere: () => boolean,
  opts?: RelaunchOptions,
) => Promise<"done" | "skipped" | "failed">;

export interface RelaunchOptions {
  /** The new pane and its chat (the limit switch starts it at once). */
  onStarted?: (paneId: string, chat: PaneChat, accountId?: string) => void;
  /** Moves even a chat at work: its turn, requests and tasks stop. */
  force?: boolean;
}

/** Each decision in the Lab's log: a chat left on a limited account says why. */
function logSwitch(message: string): void {
  void invoke("popup_log_ui", { msg: `[limit-switch] ${message}` }).catch(
    () => {},
  );
}

/** The ids keeping a chat busy, for the log: a stuck task has a name there. */
function activityLine(chatId: string): string {
  const a = chatActivity(chatId);
  return `busy=${a.busy} pending=${a.pending} tasks=[${a.tasks}] shells=[${a.shells}] bangs=[${a.bangs}] held=[${a.held}]`;
}

/** « à 07:20 » for a time in ms. */
const clock = (at: number) => resetClock(Math.round(at / 1000), Date.now());

/** How `move` takes a chat to another account. */
interface MoveOptions {
  /**
   * The model it starts on: its own (the live one) by default; `null`, the
   * account's default (back from the credits with no model known).
   */
  model?: string | null;
  /** « continue » in its input (its turn was refused). */
  goOn?: boolean;
  /** Counted in the 3 moves per 30 min (the limit's own moves). */
  counted?: boolean;
  /** Its turn and what runs behind stop (no quota left). */
  force?: boolean;
}

/**
 * Resolves true once the chat's turn ended (`chatTurnHolds`: its background
 * tasks and shells don't count), false at the timeout.
 */
function waitForTurnEnd(chatId: string, timeoutMs: number): Promise<boolean> {
  const resting = () =>
    !chatTurnHolds(chatActivity(chatId), chatReplaying(chatId));
  return new Promise((resolve) => {
    if (resting()) return resolve(true);
    const done = (ok: boolean) => {
      off();
      window.clearTimeout(timer);
      resolve(ok);
    };
    const off = subscribeChatActivity((id) => {
      if (id === chatId && resting()) done(true);
    });
    const timer = window.setTimeout(() => done(resting()), timeoutMs);
  });
}

/**
 * The terminal's « Reprise automatique à la limite », for chats: a chat
 * whose turn the usage limit refuses moves, once its turn ended (a minute at
 * most), to the free account whose quota resets soonest
 * (`planChatLimitSwitch`), and goes on with « continue ». What runs behind
 * (shells, subagents, workflows) ends with the move; its subagents stay
 * resumable, Claude takes them up again there (`stopAndCloseChat`). The
 * account is marked blocked until its reset either way; with the setting
 * off, nothing moves. Bounded: blocked accounts are never chosen, and one
 * conversation moves at most 3 times in 30 min.
 *
 * No account free: a banner above its input says the wait, and offers the
 * API credits (`toCredits`, pseudo-account `api`, Opus 5.5). A chat on the
 * credits goes back to a subscription account as soon as one is free, at
 * the end of its turn (`tryReturn`), and at once when the API refuses it (a
 * balance used up, a bad key): the credits' account is never blocked.
 */
export function useChatLimitSwitch({
  enabledRef,
  accountsRef,
  tabsRef,
  blocked,
  block,
  chatWaits,
  relaunch,
  onSwitched,
  onToast,
}: {
  enabledRef: React.RefObject<boolean>;
  accountsRef: React.RefObject<AccountsState | null>;
  tabsRef: React.RefObject<Tab[]>;
  /** Accounts a limit blocks now (shared with the terminal's switch). */
  blocked: () => BlockedUntil;
  block: (accountId: string, until: number) => void;
  /** Saved, so a restart or a watchdog reload keeps a chat's wait. */
  chatWaits: ChatWaits;
  relaunch: Relaunch;
  /** New tabs follow the account the chat moved to. */
  onSwitched: (accountId: string) => void;
  onToast: (level: "info" | "error", message: string) => void;
}) {
  const handling = useRef(new Set<string>());
  /** Session (or chat) → when it moved, for the cap. */
  const moves = useRef(new Map<string, number[]>());
  // Read when an event comes: the listener stays for the page's life.
  const deps = useRef({
    relaunch,
    onSwitched,
    onToast,
    blocked,
    block,
    chatWaits,
  });
  useEffect(() => {
    deps.current = { relaunch, onSwitched, onToast, blocked, block, chatWaits };
  });

  useEffect(() => {
    const label = (id: string) =>
      id === CREDITS_ACCOUNT_ID
        ? CREDITS_LABEL
        : (accountsRef.current?.accounts.find((a) => a.id === id)?.label ?? id);
    const find = (chatId: string) => {
      const tab = (tabsRef.current ?? []).find((t) => t.panes[chatId]);
      const pane = tab?.panes[chatId];
      return tab && pane?.chat ? { tab, pane, chat: pane.chat } : null;
    };

    /** A chat's wait, cut short when it moves to the credits (`wake`). */
    const wakers = new Map<string, () => void>();
    /**
     * Chats moving to the credits (the banner's button): the move's
     * outcome, true once moved. Their wait does nothing meanwhile.
     */
    const leaving = new Map<string, Promise<boolean>>();
    /** Chats the limit switch itself moves or continues now. */
    const moving = new Set<string>();
    /**
     * The loop's own move or « continue »: its banner goes first, and the
     * button can't start a second relaunch of the chat (`toCredits`).
     */
    const owned = async <T>(chatId: string, run: () => Promise<T>) => {
      setLimitNotice(chatId, null);
      moving.add(chatId);
      try {
        return await run();
      } finally {
        moving.delete(chatId);
      }
    };
    /** Chats going back from the credits now. */
    const returning = new Set<string>();
    /**
     * The model a conversation ran before the credits (session → model,
     * null: unknown), for its return. Lost on a restart: the return then
     * takes the account's default.
     */
    const modelBefore = new Map<string, string | null>();

    /**
     * Waits until `at`; false as soon as its pane no longer holds the chat,
     * or its wait is cut short (`wake`).
     */
    const sleepUntil = (chatId: string, at: number) =>
      new Promise<boolean>((resolve) => {
        let timer: number | undefined;
        const finish = (ok: boolean) => {
          window.clearTimeout(timer);
          if (wakers.get(chatId) === stop) wakers.delete(chatId);
          resolve(ok);
        };
        const stop = () => finish(false);
        wakers.set(chatId, stop);
        const tick = () => {
          if (!find(chatId)) return finish(false);
          const left = at - Date.now();
          if (left <= 0) return finish(true);
          timer = window.setTimeout(tick, Math.min(left, PANE_CHECK_MS));
        };
        tick();
      });
    const wake = (chatId: string) => wakers.get(chatId)?.();

    const handle = async (chatId: string, hit: ChatLimitHit) => {
      const { onToast, block } = deps.current;
      const found = find(chatId);
      if (!found) return;
      const from = paneAccountId(found.pane.accountId);
      const now = Date.now();
      const account = accountsRef.current?.accounts.find((a) => a.id === from);
      const known = account?.usage?.fiveHour?.resetsAt;
      const reset = (hit.resetsAt ?? known ?? 0) * 1000 + 60_000;
      // A reset already past (clock skew) must not let it retry at once.
      let until = reset > now ? reset : now + 5 * 60_000;
      // One model's limit (Fable's): that model alone is out, the account's
      // others stay free; a model not known blocks the whole account.
      // Its date is not trusted (`modelLimitUntil`), even for a model not
      // known yet (the init still being folded): never till Sunday.
      const family = hit.family ?? modelFamily(liveChatState(chatId).model);
      if (hit.scope === "model") {
        until = modelLimitUntil(hit.resetsAt, account, now);
        block(family ? modelBlockKey(from, family) : from, until);
      } else block(from, until);
      if (!enabledRef.current) {
        logSwitch(`${chatId} on ${from}: setting off`);
        return;
      }
      const key = found.chat.resume ?? chatId;
      const recent = (moves.current.get(key) ?? []).filter(
        (t) => now - t < SWITCH_WINDOW_MS,
      );
      if (recent.length >= MAX_SWITCHES) {
        logSwitch(`${chatId} on ${from}: ${recent.length} moves in 30 min`);
        const plan = planChatLimitSwitch(
          accountsRef.current?.accounts ?? [],
          deps.current.blocked(),
          from,
          now,
          family,
        );
        if (plan.kind === "switch") {
          onToast(
            "error",
            `limite atteinte sur ${label(from)} · chat laissé là`,
          );
          return;
        }
        // No account free either: the banner offers the credits (a move
        // there is not counted) till its reset, or till the cap lifts.
        setLimitNotice(chatId, {
          text: `Limite atteinte sur ${label(from)} · ${recent.length} bascules en 30 min, chat laissé là`,
          onCredits: () => toCredits(chatId),
        });
        await sleepUntil(
          chatId,
          Math.min(until, Math.min(...recent) + SWITCH_WINDOW_MS),
        );
        setLimitNotice(chatId, null);
        return;
      }
      // Its turn (or a question) first, a minute at most; never what runs
      // behind: a dev server would hold it until the reset (02/11/2026).
      // The hit comes mid-turn: the wait is said only when it lasts.
      const slow = window.setTimeout(() => {
        if (!chatTurnHolds(chatActivity(chatId), chatReplaying(chatId))) return;
        logSwitch(
          `${chatId} on ${from}: waits for its turn's end (${activityLine(chatId)})`,
        );
        deps.current.onToast(
          "info",
          `limite atteinte sur ${label(from)} · bascule à la fin de son tour`,
        );
      }, SLOW_REST_MS);
      const ended = await waitForTurnEnd(chatId, TURN_WAIT_MS);
      window.clearTimeout(slow);
      if (!ended)
        logSwitch(
          `${chatId} on ${from}: turn still on, moves anyway (${activityLine(chatId)})`,
        );
      if (!enabledRef.current) {
        logSwitch(`${chatId} on ${from}: setting turned off while it waited`);
        return;
      }
      await settle(chatId, from, until, key, recent);
    };

    /**
     * An at-rest chat whose account is limited: to the free account, else
     * to the first one back, else « continue » on its own at its reset.
     * Each wait is saved (`chatWaits`), so a restart picks it up again, and
     * shown in the chat's banner while it lasts (`setLimitNotice`).
     * `firstLook`: a wait picked up after a restart. `why`: a chat on the
     * credits, what the API said.
     */
    const settle = (
      chatId: string,
      from: string,
      until: number,
      key: string,
      recent: number[],
      firstLook?: number,
      why?: string,
    ) =>
      settleLoop(chatId, from, until, key, recent, firstLook, why).finally(() =>
        setLimitNotice(chatId, null),
      );

    const settleLoop = async (
      chatId: string,
      from: string,
      until: number,
      key: string,
      recent: number[],
      firstLook?: number,
      why?: string,
    ) => {
      // Only a real session id survives a restart; a bare chat id does not.
      const sid = find(chatId)?.chat.resume;
      const save = (at: number | null) => {
        if (sid) deps.current.chatWaits.set(sid, at);
      };
      // On the credits: Alexis's pick, whatever the setting; never back to
      // « its own » account, the credits that refused it.
      const onCredits = from === CREDITS_ACCOUNT_ID;
      let told = false;
      // Time went by since the limit (a wait, a restart): Alexis may be at
      // work in the chat again, its own account back.
      let waited = firstLook !== undefined;
      // The banner's move to the credits under way decides first: moved,
      // the wait ends; failed, it goes on (`toCredits`).
      const movedToCredits = async () =>
        (await leaving.get(chatId)?.catch(() => false)) === true;
      if (firstLook !== undefined && firstLook > Date.now()) {
        save(firstLook);
        // Picked up after a restart: the banner says the wait again.
        setLimitNotice(
          chatId,
          onCredits
            ? {
                text: `${CREDITS_LABEL} refusés · retour sur un abonnement ${clock(firstLook)}`,
              }
            : {
                text: `Limite atteinte sur ${label(from)} · aucun autre compte libre, reprise ${clock(firstLook)}`,
                onCredits: () => toCredits(chatId),
              },
        );
        if (!(await sleepUntil(chatId, firstLook))) return save(null);
      }
      for (;;) {
        if (await movedToCredits()) return save(null);
        // The setting may have been turned off during a wait.
        if (!onCredits && !enabledRef.current) {
          logSwitch(`${chatId} on ${from}: setting turned off, no move`);
          return save(null);
        }
        // The pane as it is now: a wait may have changed it.
        const again = find(chatId);
        if (!again) {
          logSwitch(`${chatId} on ${from}: pane gone, no move`);
          return save(null);
        }
        const accounts = accountsRef.current?.accounts ?? [];
        const blocked = deps.current.blocked();
        // Its model now: Opus after a move off Fable, unknown (the safe
        // side) for a chat not started again since a restart. On the
        // credits, the one it ran before them.
        const family = modelFamily(
          onCredits
            ? (modelBefore.get(key) ?? null)
            : liveChatState(chatId).model,
        );
        const step = chatLimitStep(
          accounts,
          blocked,
          from,
          until,
          Date.now(),
          family,
        );
        if (step.kind === "switch") {
          if (
            !onCredits &&
            waited &&
            blockedFor(blocked, from, family) <= Date.now()
          ) {
            // Its account came back meanwhile: it stays, goes on if at rest.
            save(null);
            logSwitch(`${chatId} on ${from}: account back, no move`);
            await owned(chatId, () => continueHere(chatId, from));
            return;
          }
          // Still limited, a turn under way after a wait: the user's (some
          // quota is left, another model's): moved at its end, never cut.
          // An account is free: the banner's wait is over.
          if (
            waited &&
            chatTurnHolds(chatActivity(chatId), chatReplaying(chatId))
          ) {
            setLimitNotice(chatId, null);
            await waitForTurnEnd(chatId, PANE_CHECK_MS);
            continue;
          }
          save(null);
          await owned(chatId, () =>
            move(chatId, again, from, step.accountId, key, recent, {
              model: onCredits
                ? (step.model ?? modelBefore.get(key) ?? null)
                : step.model,
            }),
          );
          return;
        }
        const state = `model ${family ?? "?"}, blocked ${JSON.stringify(blocked)}, ${accounts
          .map(
            (a) =>
              `${a.id}${a.loggedIn ? "" : " logged out"} 5h ${a.usage?.fiveHour?.pct ?? "?"}% reset ${a.usage?.fiveHour?.resetsAt ?? "?"}`,
          )
          .join(", ")}`;
        if (step.kind === "stuck") {
          logSwitch(
            `${chatId} on ${from}: refused, no account to go back to (${state})`,
          );
          deps.current.onToast(
            "error",
            `${CREDITS_LABEL} refusés${why ? ` (${why})` : ""} · aucun compte libre`,
          );
          return save(null);
        }
        // None free now: the first account back takes the chat (the user's
        // report of 01/11/2026: one came back at 07:20, the chat never
        // moved), else its own account at its reset, as the terminal does.
        // Meanwhile the banner offers the credits (not to a chat on them).
        const offer = step.credits ? () => toCredits(chatId) : undefined;
        if (onCredits) {
          if (!told)
            logSwitch(
              `${chatId} on ${from}: refused, back to a subscription at ${new Date(step.at).toISOString()} (${state})`,
            );
          setLimitNotice(chatId, {
            text: `${CREDITS_LABEL} refusés${why ? ` : ${why}` : ""} · retour sur un abonnement ${clock(step.at)}`,
          });
        } else if (step.here) {
          logSwitch(
            `${chatId} on ${from}: no free account, continues here at ${new Date(until).toISOString()} (${state})`,
          );
          setLimitNotice(chatId, {
            text: `Limite atteinte sur ${label(from)} · aucun autre compte libre, reprise ici ${clock(until)}`,
            onCredits: offer,
          });
          save(until + RESET_MARGIN_MS);
          if (!(await sleepUntil(chatId, until + RESET_MARGIN_MS)))
            return save(null);
          // Its reset came during a move to the credits: never « continue »
          // to the chat it closes.
          if (await movedToCredits()) return save(null);
          save(null);
          await owned(chatId, () => continueHere(chatId, from));
          return;
        } else {
          if (!told)
            logSwitch(
              `${chatId} on ${from}: no free account, waits for one at ${new Date(step.at).toISOString()} (${state})`,
            );
          setLimitNotice(chatId, {
            text: `Limite atteinte sur ${label(from)} · aucun autre compte libre, bascule ${clock(step.at)}`,
            onCredits: offer,
          });
        }
        told = true;
        save(step.at + RESET_MARGIN_MS);
        if (!(await sleepUntil(chatId, step.at + RESET_MARGIN_MS)))
          return save(null);
        waited = true;
      }
    };

    /** Its own account back: « continue » there, unless it works again. */
    const continueHere = async (chatId: string, from: string) => {
      if (!enabledRef.current) {
        logSwitch(`${chatId} on ${from}: setting turned off, no continue`);
        return;
      }
      // Working again (the user went on): nothing to add.
      if (chatTurnHolds(chatActivity(chatId), chatReplaying(chatId))) return;
      const here = find(chatId);
      if (!here) return;
      // A chat not on screen since a restart was never started: started
      // here on its pane's account, else « continue » reaches no server.
      const account = here.pane.accountId;
      if (attachLiveChat(chatId, account))
        await startLiveChat(chatId, account, here.chat);
      // Arkadia's own « continue »: not the user, the phone keeps its tab.
      await chatCommand(
        account,
        { type: "send", chatId, text: "continue", images: [] },
        "auto",
      ).catch(() => {});
      logSwitch(`${chatId} on ${from}: continued after its reset`);
    };

    /**
     * The chat to `to`, with « continue » in its input unless told not to
     * (`goOn`). `model`: started on it, its own being out (Fable's limit);
     * `to` may then be its own account, relaunched rather than switched in
     * place, where the model's change could reach Claude Code after
     * « continue ». True once it moved.
     */
    const move = async (
      chatId: string,
      at: NonNullable<ReturnType<typeof find>>,
      from: string,
      to: string,
      key: string,
      recent: number[],
      { model, goOn = true, counted = true, force = true }: MoveOptions = {},
    ): Promise<boolean> => {
      const { relaunch, onSwitched, onToast } = deps.current;
      // The model it runs goes with it (Opus after Fable's limit): the plan
      // checked the account for it, the default would be Fable again. Read
      // now, the relaunch drops this chat.
      const startOn =
        model === null
          ? undefined
          : (model ?? liveChatState(chatId).model ?? undefined);
      const stillThere = () =>
        (tabsRef.current ?? []).some(
          (t) => t.id === at.tab.id && t.panes[chatId] !== undefined,
        );
      const out: { next?: { id: string; chat: PaneChat; account?: string } } =
        {};
      // Forced: no quota left, whatever runs behind stops with the move
      // (a turn only once `handle` waited for it, or `settle` saw it end).
      const result = await relaunch(
        at.tab.id,
        at.pane,
        at.chat,
        to,
        stillThere,
        {
          force,
          onStarted: (id, chat, account) => {
            out.next = { id, chat, account };
          },
        },
      );
      const { next } = out;
      if (result !== "done" || !next) {
        logSwitch(`${chatId} on ${from}: move to ${to} ${result}`);
        onToast(
          "error",
          from === CREDITS_ACCOUNT_ID
            ? `retour des crédits API sur ${label(to)} impossible`
            : `limite atteinte sur ${label(from)} · bascule impossible`,
        );
        return false;
      }
      if (counted) moves.current.set(key, [...recent, Date.now()]);
      // Started here, its pane shown or not: « continue » waits in its input.
      await startLiveChat(
        next.id,
        next.account,
        startOn ? { ...next.chat, model: startOn } : next.chat,
      );
      if (goOn)
        await chatCommand(
          next.account,
          { type: "send", chatId: next.id, text: "continue", images: [] },
          "auto",
        ).catch(() => {});
      // New tabs never open on the credits.
      if (to !== from && to !== CREDITS_ACCOUNT_ID) onSwitched(to);
      logSwitch(
        `${chatId} on ${from}: moved to ${to}${startOn ? ` on ${startOn}` : ""}`,
      );
      const on = model ? ` en ${modelName(model)}` : "";
      onToast(
        "info",
        to === from
          ? `⟳ limite du modèle atteinte sur ${label(from)} · reprise${on}`
          : from === CREDITS_ACCOUNT_ID
            ? `⟳ retour des crédits API sur ${label(to)}${on}`
            : `⟳ limite atteinte sur ${label(from)} · reprise sur ${to === CREDITS_ACCOUNT_ID ? "les crédits API" : label(to)}${on}`,
      );
      return true;
    };

    /**
     * « Continuer sur les crédits » (the banner): the chat on the API
     * credits, Opus 5.5, its session resumed with « continue ». Its wait
     * ends with it; failed, the wait goes on.
     */
    const toCredits = (chatId: string): Promise<boolean> => {
      const found = find(chatId);
      if (!found || leaving.has(chatId)) return Promise.resolve(false);
      const from = paneAccountId(found.pane.accountId);
      // The limit switch moves it already: never two relaunches of a chat.
      if (moving.has(chatId)) {
        logSwitch(`${chatId} on ${from}: credits refused, already moving`);
        return Promise.resolve(false);
      }
      const key = found.chat.resume ?? chatId;
      const going = (async () => {
        // Read now, the relaunch drops this chat.
        modelBefore.set(key, liveChatState(chatId).model ?? null);
        // Forced: its turn and what runs behind stop.
        logSwitch(
          `${chatId} on ${from}: to the API credits (banner, ${activityLine(chatId)})`,
        );
        const moved = await move(
          chatId,
          found,
          from,
          CREDITS_ACCOUNT_ID,
          key,
          [],
          { model: CREDITS_MODEL, counted: false },
        );
        if (!moved) modelBefore.delete(key);
        else wake(chatId);
        return moved;
      })().finally(() => leaving.delete(chatId));
      leaving.set(chatId, going);
      return going;
    };

    /**
     * A chat on the credits the API refused (a balance used up, a bad
     * key): back to a subscription account, now or at the first one back.
     * The credits' account is never blocked (`block`).
     */
    const handleCredits = async (chatId: string, why: string) => {
      const found = find(chatId);
      if (!found) return;
      const key = found.chat.resume ?? chatId;
      logSwitch(`${chatId} on ${CREDITS_ACCOUNT_ID}: refused (${why})`);
      if (!(await waitForTurnEnd(chatId, TURN_WAIT_MS)))
        logSwitch(
          `${chatId} on ${CREDITS_ACCOUNT_ID}: turn still on, moves anyway (${activityLine(chatId)})`,
        );
      const recent = (moves.current.get(key) ?? []).filter(
        (t) => Date.now() - t < SWITCH_WINDOW_MS,
      );
      await settle(
        chatId,
        CREDITS_ACCOUNT_ID,
        Infinity,
        key,
        recent,
        undefined,
        why,
      );
    };

    /**
     * A chat on the credits, its turn and questions over: back to the
     * subscription account the limit switch would pick, as soon as one is
     * free. Forced, as for the limit (`chatTurnHolds`): what runs behind (a
     * dev server) never ends, and the credits pay meanwhile. Nothing sent:
     * no turn was refused.
     */
    const tryReturn = async (chatId: string) => {
      if (returning.has(chatId) || handling.current.has(chatId)) return;
      const found = find(chatId);
      if (!found || paneAccountId(found.pane.accountId) !== CREDITS_ACCOUNT_ID)
        return;
      const activity = chatActivity(chatId);
      // A `!` command costs no credits: the move, which would kill it, waits.
      if (
        chatTurnHolds(activity, chatReplaying(chatId)) ||
        activity.bangs.length
      )
        return;
      const key = found.chat.resume ?? chatId;
      const before = modelBefore.get(key) ?? null;
      const plan = planChatLimitSwitch(
        accountsRef.current?.accounts ?? [],
        deps.current.blocked(),
        CREDITS_ACCOUNT_ID,
        Date.now(),
        modelFamily(before),
      );
      if (plan.kind !== "switch") return;
      returning.add(chatId);
      try {
        logSwitch(
          `${chatId} on ${CREDITS_ACCOUNT_ID}: ${plan.accountId} free, goes back (${activityLine(chatId)})`,
        );
        const moved = await move(
          chatId,
          found,
          CREDITS_ACCOUNT_ID,
          plan.accountId,
          key,
          [],
          { model: plan.model ?? before, goOn: false, counted: false },
        );
        if (moved) modelBefore.delete(key);
      } finally {
        returning.delete(chatId);
      }
    };
    /** The chat panes on the credits now. */
    const creditsPanes = () =>
      (tabsRef.current ?? []).flatMap((t) =>
        Object.values(t.panes)
          .filter(
            (p) => p.chat && paneAccountId(p.accountId) === CREDITS_ACCOUNT_ID,
          )
          .map((p) => p.id),
      );
    const returnTimer = window.setInterval(() => {
      for (const id of creditsPanes()) void tryReturn(id);
    }, RETURN_CHECK_MS);
    // The end of its turn: back at once when an account is free.
    const offActivity = subscribeChatActivity((id) => {
      if (creditsPanes().includes(id)) void tryReturn(id);
    });

    let rearmTimers: number[] = [];
    void deps.current.chatWaits.loaded().then(() => {
      rearmTimers = REARM_AT_MS.map((delay, i) =>
        window.setTimeout(() => {
          const last = i === REARM_AT_MS.length - 1;
          for (const [sid, at] of Object.entries(
            deps.current.chatWaits.list(),
          )) {
            const tab = (tabsRef.current ?? []).find((t) =>
              Object.values(t.panes).some((p) => p.chat?.resume === sid),
            );
            const pane =
              tab &&
              Object.values(tab.panes).find((p) => p.chat?.resume === sid);
            if (!pane) {
              // Not restored by the last look: that chat is gone.
              if (last) {
                logSwitch(
                  `session ${sid}: no pane after restart, wait dropped`,
                );
                deps.current.chatWaits.set(sid, null);
              }
              continue;
            }
            if (handling.current.has(pane.id)) continue;
            const from = paneAccountId(pane.accountId);
            // Any of its blocks: a model's (Fable's) held the chat too.
            const until = Math.max(
              blockedFor(deps.current.blocked(), from, null),
              at,
            );
            logSwitch(`${pane.id} on ${from}: wait picked up after restart`);
            handling.current.add(pane.id);
            const recent = (moves.current.get(sid) ?? []).filter(
              (t) => Date.now() - t < SWITCH_WINDOW_MS,
            );
            void settle(pane.id, from, until, sid, recent, at).finally(() =>
              handling.current.delete(pane.id),
            );
          }
        }, delay),
      );
    });

    const off = subscribeEveryChat((event) => {
      if (event.type !== "sdk") return;
      const hit = chatLimitHit(event.message);
      const why = creditsFailure(event.message);
      if (!hit && !why) return;
      // On the credits, the API's own refusals; never a subscription limit
      // (it would block the credits' account).
      const onCredits =
        paneAccountId(find(event.chatId)?.pane.accountId) ===
        CREDITS_ACCOUNT_ID;
      if (onCredits ? !why : !hit) return;
      // A reattach replays the chat's past: an old refusal is no news.
      const at = (event as { at?: unknown }).at;
      if (chatReplaying(event.chatId)) return;
      if (typeof at === "number" && Date.now() - at > FRESH_MS) return;
      if (handling.current.has(event.chatId)) return;
      handling.current.add(event.chatId);
      const done =
        onCredits && why
          ? handleCredits(event.chatId, why)
          : handle(event.chatId, hit ?? {});
      void done.finally(() => handling.current.delete(event.chatId));
    });
    return () => {
      off();
      offActivity();
      window.clearInterval(returnTimer);
      rearmTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [accountsRef, enabledRef, tabsRef]);
}
