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
  modelLimitUntil,
  modelName,
  nextFreeAccountAt,
  planChatLimitSwitch,
  type ChatLimitHit,
} from "@/lib/chat/chatLimit";
import { resetClock } from "@/lib/chat/chatQuota";
import {
  attachLiveChat,
  liveChatState,
  startLiveChat,
} from "@/lib/chat/chatLive";
import { chatTurnHolds } from "@/lib/chat/usePaneChats";
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
      accountsRef.current?.accounts.find((a) => a.id === id)?.label ?? id;
    const find = (chatId: string) => {
      const tab = (tabsRef.current ?? []).find((t) => t.panes[chatId]);
      const pane = tab?.panes[chatId];
      return tab && pane?.chat ? { tab, pane, chat: pane.chat } : null;
    };

    /** Waits until `at`; false as soon as its pane no longer holds the chat. */
    const sleepUntil = (chatId: string, at: number) =>
      new Promise<boolean>((resolve) => {
        const tick = () => {
          if (!find(chatId)) return resolve(false);
          const left = at - Date.now();
          if (left <= 0) return resolve(true);
          window.setTimeout(tick, Math.min(left, PANE_CHECK_MS));
        };
        tick();
      });

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
        onToast("error", `limite atteinte sur ${label(from)} · chat laissé là`);
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
     * Each wait is saved (`chatWaits`), so a restart picks it up again.
     * `firstLook`: a wait picked up after a restart.
     */
    const settle = async (
      chatId: string,
      from: string,
      until: number,
      key: string,
      recent: number[],
      firstLook?: number,
    ) => {
      // Only a real session id survives a restart; a bare chat id does not.
      const sid = find(chatId)?.chat.resume;
      const save = (at: number | null) => {
        if (sid) deps.current.chatWaits.set(sid, at);
      };
      let told = false;
      // Time went by since the limit (a wait, a restart): Alexis may be at
      // work in the chat again, its own account back.
      let waited = firstLook !== undefined;
      if (firstLook !== undefined && firstLook > Date.now()) {
        save(firstLook);
        if (!(await sleepUntil(chatId, firstLook))) return save(null);
      }
      for (;;) {
        // The setting may have been turned off during a wait.
        if (!enabledRef.current) {
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
        // side) for a chat not started again since a restart.
        const family = modelFamily(liveChatState(chatId).model);
        const plan = planChatLimitSwitch(
          accounts,
          blocked,
          from,
          Date.now(),
          family,
        );
        if (plan.kind === "switch") {
          if (waited && blockedFor(blocked, from, family) <= Date.now()) {
            // Its account came back meanwhile: it stays, goes on if at rest.
            save(null);
            logSwitch(`${chatId} on ${from}: account back, no move`);
            await continueHere(chatId, from);
            return;
          }
          // Still limited, a turn under way after a wait: the user's (some
          // quota is left, another model's): moved at its end, never cut.
          if (
            waited &&
            chatTurnHolds(chatActivity(chatId), chatReplaying(chatId))
          ) {
            await waitForTurnEnd(chatId, PANE_CHECK_MS);
            continue;
          }
          save(null);
          await move(
            chatId,
            again,
            from,
            plan.accountId,
            key,
            recent,
            plan.model,
          );
          return;
        }
        const state = `model ${family ?? "?"}, blocked ${JSON.stringify(blocked)}, ${accounts
          .map(
            (a) =>
              `${a.id}${a.loggedIn ? "" : " logged out"} 5h ${a.usage?.fiveHour?.pct ?? "?"}% reset ${a.usage?.fiveHour?.resetsAt ?? "?"}`,
          )
          .join(", ")}`;
        // None free now: the first account back takes the chat (the user's
        // report of 01/11/2026: one came back at 07:20, the chat never
        // moved), else its own account at its reset, as the terminal does.
        const next = nextFreeAccountAt(
          accounts,
          blocked,
          from,
          Date.now(),
          family,
        );
        if (next === null || next >= until) {
          logSwitch(
            `${chatId} on ${from}: no free account, continues here at ${new Date(until).toISOString()} (${state})`,
          );
          deps.current.onToast(
            "info",
            `⏸ limite atteinte sur ${label(from)} · aucun autre compte libre, reprise ici ${clock(until)}`,
          );
          save(until + RESET_MARGIN_MS);
          if (!(await sleepUntil(chatId, until + RESET_MARGIN_MS)))
            return save(null);
          save(null);
          await continueHere(chatId, from);
          return;
        }
        if (!told) {
          told = true;
          logSwitch(
            `${chatId} on ${from}: no free account, waits for one at ${new Date(next).toISOString()} (${state})`,
          );
          deps.current.onToast(
            "info",
            `⏸ limite atteinte sur ${label(from)} · aucun autre compte libre, bascule ${clock(next)}`,
          );
        }
        save(next + RESET_MARGIN_MS);
        if (!(await sleepUntil(chatId, next + RESET_MARGIN_MS)))
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
     * The chat to `to`, « continue » in its input. `model`: started on it,
     * its own being out (Fable's limit); `to` may then be its own account,
     * relaunched rather than switched in place, where the model's change
     * could reach Claude Code after « continue ».
     */
    const move = async (
      chatId: string,
      at: NonNullable<ReturnType<typeof find>>,
      from: string,
      to: string,
      key: string,
      recent: number[],
      model?: string,
    ) => {
      const { relaunch, onSwitched, onToast } = deps.current;
      // The model it runs goes with it (Opus after Fable's limit): the plan
      // checked the account for it, the default would be Fable again. Read
      // now, the relaunch drops this chat.
      const startOn = model ?? liveChatState(chatId).model ?? undefined;
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
          force: true,
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
          `limite atteinte sur ${label(from)} · bascule impossible`,
        );
        return;
      }
      moves.current.set(key, [...recent, Date.now()]);
      // Started here, its pane shown or not: « continue » waits in its input.
      await startLiveChat(
        next.id,
        next.account,
        startOn ? { ...next.chat, model: startOn } : next.chat,
      );
      await chatCommand(
        next.account,
        { type: "send", chatId: next.id, text: "continue", images: [] },
        "auto",
      ).catch(() => {});
      if (to !== from) onSwitched(to);
      logSwitch(
        `${chatId} on ${from}: moved to ${to}${model ? ` on ${model}` : ""}`,
      );
      const on = model ? ` en ${modelName(model)}` : "";
      onToast(
        "info",
        to === from
          ? `⟳ limite du modèle atteinte sur ${label(from)} · reprise${on}`
          : `⟳ limite atteinte sur ${label(from)} · reprise sur ${label(to)}${on}`,
      );
    };

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
      if (!hit) return;
      // A reattach replays the chat's past: an old refusal is no news.
      const at = (event as { at?: unknown }).at;
      if (chatReplaying(event.chatId)) return;
      if (typeof at === "number" && Date.now() - at > FRESH_MS) return;
      if (handling.current.has(event.chatId)) return;
      handling.current.add(event.chatId);
      void handle(event.chatId, hit).finally(() =>
        handling.current.delete(event.chatId),
      );
    });
    return () => {
      off();
      rearmTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [accountsRef, enabledRef, tabsRef]);
}
