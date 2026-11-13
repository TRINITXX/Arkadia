import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";
import { setLimitNotice } from "@/lib/chat/chatLimitNotice";
import { reduceChat, type ChatState } from "@/lib/chat/chatState";
import {
  CREDITS_ACCOUNT_ID,
  publishCredits,
  type CreditsState,
} from "@/lib/credits";

/**
 * Dev-only: the API credits fallback in the preview (`&credits=<case>`),
 * with the real components. `banner` and `exhausted` (with `?s=limit`): the
 * limit's banner above the input; `panel` and `off` (with `&accounts=1`,
 * the menu opened by a click): the credits' card in « Comptes »; `pill`:
 * a chat on the credits, its status bar.
 */
export const CREDITS_VARIANT = new URLSearchParams(window.location.search).get(
  "credits",
);

/** The pane's account: the credits' for `pill`. */
export const PREVIEW_ACCOUNT_ID =
  CREDITS_VARIANT === "pill" ? CREDITS_ACCOUNT_ID : "c";

/**
 * A chat on the API credits has no subscription quotas. At the limit
 * (`banner`, `exhausted`), its session ring is full.
 */
export const onCredits = (state: ChatState): ChatState => {
  if (CREDITS_VARIANT === "pill") return { ...state, limits: {} };
  const five = state.limits.fiveHour;
  if ((CREDITS_VARIANT === "banner" || CREDITS_VARIANT === "exhausted") && five)
    return {
      ...state,
      limits: { ...state.limits, fiveHour: { ...five, utilization: 1 } },
    };
  return state;
};

const sdk = (message: JsonObject): ChatEvent => ({
  type: "sdk",
  chatId: "preview",
  message,
});

/** `?s=limit`: the recorded turns, then a request the session limit refuses. */
export function creditsScenarios(
  tools: () => ChatState,
): Record<string, () => ChatState> {
  return {
    limit: () => {
      const reset = Math.round(Date.now() / 1000) + 2 * 3600;
      const events: ChatEvent[] = [
        {
          type: "user_sent",
          chatId: "preview",
          text: "Ajoute le bouton d'export PDF dans la fiche client.",
          images: 0,
        },
        sdk({
          type: "assistant",
          uuid: "lim-a1",
          error: "rate_limit",
          message: {
            id: "lim-m1",
            content: [
              {
                type: "text",
                text: "API Error: 429 You've hit your session limit · resets 2:35pm",
              },
            ],
          },
        }),
        sdk({
          type: "rate_limit_event",
          rate_limit_info: {
            status: "rejected",
            rateLimitType: "five_hour",
            resetsAt: reset,
            unifiedWindows: {
              five_hour: {
                utilization: 1,
                resetsAt: reset,
                status: "rejected",
              },
            },
          },
        }),
        sdk({
          type: "result",
          uuid: "lim-r1",
          subtype: "success",
          is_error: true,
          terminal_reason: "api_error",
          api_error_status: 429,
          result: "API Error: 429 You've hit your session limit",
        }),
      ];
      return events.reduce(
        (s, e, i) => reduceChat(s, e, Date.now() - 4_000 + i * 300),
        tools(),
      );
    },
  };
}

/** The credits as the Anthropic Console gave them on 13/11/2026. */
const READ: CreditsState = {
  keyPresent: true,
  console: "connected",
  tranches: [
    {
      kind: "team",
      remaining: 45_698,
      granted: 50_000,
      expiresAt: Date.UTC(2026, 11, 10),
    },
    {
      kind: "promo",
      remaining: 99_413,
      granted: 100_000,
      expiresAt: Date.UTC(2027, 3, 8),
    },
  ],
  total: 145_111,
  fetchedAt: Date.now() - 4 * 60_000,
  exhausted: false,
};

/** The case's credits, and the limit's banner for the preview's chat. */
export function setupCreditsPreview(): void {
  if (!CREDITS_VARIANT) return;
  if (CREDITS_VARIANT === "off") {
    publishCredits({ ...READ, console: "disconnected" });
    return;
  }
  const exhausted = CREDITS_VARIANT === "exhausted";
  publishCredits(
    exhausted
      ? {
          ...READ,
          tranches: READ.tranches.map((t) => ({ ...t, remaining: 0 })),
          total: 40,
          exhausted: true,
        }
      : READ,
  );
  if (CREDITS_VARIANT === "banner" || exhausted) {
    const at = new Date(Date.now() + 2 * 3600_000).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setLimitNotice("preview", {
      text: `Limite atteinte sur 3 Équipe · aucun autre compte libre, reprise ici à ${at}`,
      // Said in the console: no chat server to move it.
      onCredits: async () => {
        console.info("[aperçu] continuer sur les crédits");
        return false;
      },
    });
  }
}
