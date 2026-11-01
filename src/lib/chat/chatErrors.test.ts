import { describe, expect, it } from "vitest";
import { resultNotice, retryLabel, retryOf } from "@/lib/chat/chatErrors";

const NOW = new Date(2026, 9, 31, 18, 0).getTime();
const ctx = { apiError: null, now: NOW };

describe("resultNotice", () => {
  it("says « Tour interrompu » for a real interrupt only", () => {
    // Esc mid-reply (live run of 31/10/2026).
    expect(
      resultNotice(
        {
          subtype: "error_during_execution",
          is_error: true,
          terminal_reason: "aborted_streaming",
          errors: ["[ede_diagnostic] result_type=user"],
        },
        ctx,
      ),
    ).toEqual({ text: "Tour interrompu", tone: "info" });
    // The same subtype on a real failure: its cause, never « interrompu ».
    const failed = resultNotice(
      {
        subtype: "error_during_execution",
        is_error: true,
        errors: ["[ede_diagnostic] x", "Tool execution crashed"],
      },
      ctx,
    );
    expect(failed?.text).not.toMatch(/interrompu/);
    expect(failed?.detail).toBe("Tool execution crashed");
  });

  it("gives the next step for a full context, a rate limit and a refused login", () => {
    expect(
      resultNotice(
        {
          subtype: "success",
          is_error: true,
          terminal_reason: "prompt_too_long",
        },
        ctx,
      )?.text,
    ).toMatch(/\/compact/);
    // The limit: Claude's red reply says it, no notice under it.
    expect(
      resultNotice(
        { subtype: "success", is_error: true, terminal_reason: "api_error" },
        { apiError: "rate_limit", now: NOW },
      ),
    ).toBeNull();
    expect(
      resultNotice(
        { subtype: "success", is_error: true, api_error_status: 401 },
        ctx,
      )?.text,
    ).toMatch(/reconnecte-toi/);
  });

  it("names a lost connection, without repeating the error reply's words", () => {
    // ANTHROPIC_BASE_URL on a closed port (live run of 31/10/2026).
    const notice = resultNotice(
      {
        subtype: "success",
        is_error: true,
        terminal_reason: "api_error",
        api_error: "connection_failed",
        result: "API Error: Connection refused",
      },
      { ...ctx, apiError: "server_error" },
    );
    expect(notice?.text).toMatch(/^Connexion à l'API impossible/);
    expect(notice?.detail).toBeUndefined();
  });

  it("explains a refused start and a turn that went well says nothing", () => {
    expect(
      resultNotice(
        {
          subtype: "error_during_execution",
          is_error: true,
          startup_failure_reason: "cli_version_too_old",
          errors: ["Claude Code 2.0.1 is below 2.1.0"],
        },
        ctx,
      ),
    ).toMatchObject({ text: expect.stringMatching(/mets-le à jour/) });
    expect(
      resultNotice(
        { subtype: "success", is_error: false, terminal_reason: "completed" },
        ctx,
      ),
    ).toBeNull();
  });
});

describe("retryLabel", () => {
  it("counts the wait down, then waits for the try", () => {
    const retry = retryOf(
      {
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 5000,
        error_status: 529,
        error: "overloaded",
      },
      NOW,
    );
    expect(retryLabel(retry, NOW)).toBe(
      "Claude réessaie (2/10) dans 5 s · surcharge",
    );
    expect(retryLabel(retry, NOW + 3200)).toBe(
      "Claude réessaie (2/10) dans 2 s · surcharge",
    );
    expect(retryLabel(retry, NOW + 6000)).toBe(
      "Claude réessaie (2/10)… · surcharge",
    );
    // No HTTP answer at all (live run): the connection.
    expect(
      retryOf({ attempt: 1, max_retries: 2, error_status: null }, NOW).cause,
    ).toBe("connexion");
  });
});
