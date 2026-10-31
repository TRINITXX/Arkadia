import { useEffect, useRef } from "react";
import {
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
import { chatLimitHit, planChatLimitSwitch } from "@/lib/chat/chatLimit";
import { startLiveChat } from "@/lib/chat/chatLive";
import { chatBusyReason } from "@/lib/chat/usePaneChats";
import type { PaneChat, PaneState, Tab } from "@/types";

/** A chat still busy this long after its limit hit stays where it is. */
const REST_TIMEOUT_MS = 120_000;
/** At most this many automatic moves of one conversation per window. */
const MAX_SWITCHES = 3;
const SWITCH_WINDOW_MS = 30 * 60_000;
/** Events older than this come from a replay, not from now. */
const FRESH_MS = 60_000;

type Relaunch = (
  tabId: string,
  old: PaneState,
  chat: PaneChat,
  accountId: string,
  stillThere: () => boolean,
  onStarted?: (paneId: string, chat: PaneChat, accountId?: string) => void,
) => Promise<"done" | "skipped" | "failed">;

/** Resolves true once the chat rests (no turn, request nor task), false at the timeout. */
function waitForRest(chatId: string, timeoutMs: number): Promise<boolean> {
  const resting = () =>
    chatBusyReason(chatActivity(chatId), chatReplaying(chatId)) === null;
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
 * whose turn the usage limit refuses moves, once at rest (account switches
 * never cut a turn), to the free account whose quota resets soonest
 * (`planChatLimitSwitch`), and goes on with « continue ». The account is
 * marked blocked until its reset either way; with the setting off, nothing
 * moves. Bounded: blocked accounts are never chosen, and one conversation
 * moves at most 3 times in 30 min.
 */
export function useChatLimitSwitch({
  enabledRef,
  accountsRef,
  tabsRef,
  blocked,
  block,
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
  relaunch: Relaunch;
  /** New tabs follow the account the chat moved to. */
  onSwitched: (accountId: string) => void;
  onToast: (level: "info" | "error", message: string) => void;
}) {
  const handling = useRef(new Set<string>());
  /** Session (or chat) → when it moved, for the cap. */
  const moves = useRef(new Map<string, number[]>());
  // Read when an event comes: the listener stays for the page's life.
  const deps = useRef({ relaunch, onSwitched, onToast, blocked, block });
  useEffect(() => {
    deps.current = { relaunch, onSwitched, onToast, blocked, block };
  });

  useEffect(() => {
    const label = (id: string) =>
      accountsRef.current?.accounts.find((a) => a.id === id)?.label ?? id;
    const find = (chatId: string) => {
      const tab = (tabsRef.current ?? []).find((t) => t.panes[chatId]);
      const pane = tab?.panes[chatId];
      return tab && pane?.chat ? { tab, pane, chat: pane.chat } : null;
    };

    const handle = async (chatId: string, resetsAt?: number) => {
      const { relaunch, onSwitched, onToast, blocked, block } = deps.current;
      const found = find(chatId);
      if (!found) return;
      const from = paneAccountId(found.pane.accountId);
      const now = Date.now();
      const known = accountsRef.current?.accounts.find((a) => a.id === from)
        ?.usage?.fiveHour?.resetsAt;
      const reset = (resetsAt ?? known ?? 0) * 1000 + 60_000;
      // A reset already past (clock skew) must not let it retry at once.
      block(from, reset > now ? reset : now + 5 * 60_000);
      if (!enabledRef.current) return;
      const key = found.chat.resume ?? chatId;
      const recent = (moves.current.get(key) ?? []).filter(
        (t) => now - t < SWITCH_WINDOW_MS,
      );
      if (recent.length >= MAX_SWITCHES) {
        onToast("error", `limite atteinte sur ${label(from)} · chat laissé là`);
        return;
      }
      if (!(await waitForRest(chatId, REST_TIMEOUT_MS))) {
        onToast(
          "info",
          `limite atteinte sur ${label(from)} · le chat travaille encore, il reste sur ce compte`,
        );
        return;
      }
      const accounts = accountsRef.current?.accounts ?? [];
      const plan = planChatLimitSwitch(accounts, blocked(), from, Date.now());
      if (plan.kind === "none") {
        onToast(
          "error",
          `⏸ limite atteinte sur ${label(from)} · aucun autre compte libre`,
        );
        return;
      }
      // The pane as it is now: the wait may have changed it.
      const again = find(chatId);
      if (!again) return;
      const stillThere = () =>
        (tabsRef.current ?? []).some(
          (t) => t.id === again.tab.id && t.panes[chatId] !== undefined,
        );
      const out: { next?: { id: string; chat: PaneChat; account?: string } } =
        {};
      const result = await relaunch(
        again.tab.id,
        again.pane,
        again.chat,
        plan.accountId,
        stillThere,
        (id, chat, account) => {
          out.next = { id, chat, account };
        },
      );
      const { next } = out;
      if (result !== "done" || !next) {
        onToast(
          "error",
          `limite atteinte sur ${label(from)} · bascule impossible`,
        );
        return;
      }
      moves.current.set(key, [...recent, now]);
      // Started here, its pane shown or not: « continue » waits in its input.
      await startLiveChat(next.id, next.account, next.chat);
      await chatCommand(next.account, {
        type: "send",
        chatId: next.id,
        text: "continue",
        images: [],
      }).catch(() => {});
      onSwitched(plan.accountId);
      onToast(
        "info",
        `⟳ limite atteinte sur ${label(from)} · reprise sur ${label(plan.accountId)}`,
      );
    };

    return subscribeEveryChat((event) => {
      if (event.type !== "sdk") return;
      const hit = chatLimitHit(event.message);
      if (!hit) return;
      // A reattach replays the chat's past: an old refusal is no news.
      const at = (event as { at?: unknown }).at;
      if (chatReplaying(event.chatId)) return;
      if (typeof at === "number" && Date.now() - at > FRESH_MS) return;
      if (handling.current.has(event.chatId)) return;
      handling.current.add(event.chatId);
      void handle(event.chatId, hit.resetsAt).finally(() =>
        handling.current.delete(event.chatId),
      );
    });
  }, [accountsRef, enabledRef, tabsRef]);
}
