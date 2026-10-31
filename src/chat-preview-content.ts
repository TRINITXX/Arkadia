import type { ChatEvent, JsonObject } from "@/lib/chat/chatProtocol";

/**
 * The chat preview's events for Claude Code's content and errors
 * (`chat-preview.html?s=content|errors|retry|suggest`): shapes seen in live
 * runs of 31/10/2026, put together without a model.
 */

const sdk = (message: JsonObject): ChatEvent => ({
  type: "sdk",
  chatId: "preview",
  message,
});

const nowSeconds = () => Math.round(Date.now() / 1000);

/** After the recorded diffs and commands: a cut reply and Claude Code's notices. */
export function contentNotices(): ChatEvent[] {
  return [
    {
      type: "user_sent",
      chatId: "preview",
      text: "Écris un poème de 40 vers sur la mer.",
      images: 0,
    },
    sdk({
      type: "assistant",
      uuid: "cut-a1",
      aborted: true,
      message: {
        id: "cut-m1",
        content: [
          {
            type: "text",
            text: "**La Mer**\n\nLa mer s'éveille avant le jour,\nElle déroule ses",
          },
        ],
      },
    }),
    sdk({
      type: "result",
      uuid: "cut-r1",
      subtype: "error_during_execution",
      is_error: true,
      terminal_reason: "aborted_streaming",
      errors: ["[ede_diagnostic] result_type=user"],
    }),
    sdk({
      type: "system",
      subtype: "compact_boundary",
      uuid: "cmp-1",
      compact_metadata: {
        trigger: "auto",
        pre_tokens: 180_400,
        post_tokens: 32_100,
      },
    }),
    sdk({
      type: "system",
      subtype: "informational",
      uuid: "hook-1",
      level: "warning",
      prevent_continuation: true,
      content:
        "UserPromptSubmit operation blocked by hook:\nPas de déploiement le vendredi soir.",
      prompt_submit_outcome: {
        kind: "blocked_by_hook",
        prompt_kept: false,
        reason: "Pas de déploiement le vendredi soir.",
      },
    }),
    sdk({
      type: "system",
      subtype: "notification",
      key: "stop-hook-error",
      text: "Stop hook error occurred · ctrl+o to see",
      priority: "immediate",
    }),
  ];
}

/** Refusals, quota alerts and turns that end on an error. */
export function errorEvents(): ChatEvent[] {
  const reset = nowSeconds() + 2 * 3600;
  return [
    {
      type: "user_sent",
      chatId: "preview",
      text: "Crée le dossier build puis lance le déploiement.",
      images: 0,
    },
    sdk({
      type: "assistant",
      uuid: "err-a1",
      message: {
        id: "err-m1",
        content: [
          {
            type: "tool_use",
            id: "err-t1",
            name: "Bash",
            input: {
              command: "rm -rf build && mkdir build",
              description: "Recreate build",
            },
          },
        ],
      },
    }),
    sdk({
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      tool_use_id: "err-t1",
      decision_reason_type: "classifier",
      decision_reason: "Supprime un dossier entier sans que tu l'aies demandé",
      message: "Permission to use Bash has been denied.",
    }),
    sdk({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "err-t1",
            content: "Permission to use Bash has been denied.",
            is_error: true,
          },
        ],
      },
    }),
    sdk({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed_warning",
        rateLimitType: "five_hour",
        unifiedWindows: {
          five_hour: {
            utilization: 0.91,
            resetsAt: reset,
            status: "allowed_warning",
            surpassedThreshold: 0.9,
          },
        },
      },
    }),
    sdk({
      type: "assistant",
      uuid: "err-a2",
      error: "rate_limit",
      message: {
        id: "err-m2",
        content: [
          {
            type: "text",
            text: "API Error: 429 You've hit your session limit · resets 9pm",
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
          five_hour: { utilization: 1, resetsAt: reset, status: "rejected" },
        },
      },
    }),
    sdk({
      type: "result",
      uuid: "err-r1",
      subtype: "success",
      is_error: true,
      terminal_reason: "api_error",
      api_error_status: 429,
      result: "API Error: 429 You've hit your session limit",
    }),
    {
      type: "user_sent",
      chatId: "preview",
      text: "Résume tout ce qu'on a fait depuis ce matin.",
      images: 0,
    },
    sdk({
      type: "result",
      uuid: "err-r2",
      subtype: "success",
      is_error: true,
      terminal_reason: "prompt_too_long",
      result: "Prompt is too long",
    }),
  ];
}

/** Claude Code sending a failed request again: the live line says so. */
export function retryEvents(): ChatEvent[] {
  return [
    {
      type: "user_sent",
      chatId: "preview",
      text: "Relance les tests.",
      images: 0,
    },
    sdk({ type: "system", subtype: "status", status: "requesting" }),
    sdk({
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 10,
      retry_delay_ms: 5000,
      error_status: 529,
      error: "overloaded",
    }),
  ];
}

/** Claude Code's guess at the next message, after a turn. */
export const SUGGESTION: ChatEvent = sdk({
  type: "prompt_suggestion",
  suggestion: "Ajoute aussi un test pour le cas vide",
});
