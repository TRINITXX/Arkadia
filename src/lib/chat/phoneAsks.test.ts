import { describe, expect, it } from "vitest";
import {
  roundSheetBorn,
  PERMISSION_DIFF_ROWS,
  permissionView,
  phoneAsk,
  roundSheetFor,
  withDictatedText,
  withRoundAnswer,
} from "@/lib/chat/phoneAsks";
import { EMPTY_CHAT, type PendingRequest } from "@/lib/chat/chatState";
import type { ChatItem } from "@/lib/chat/chatState";
import { startTurn } from "@/lib/chat/chatTurn";

const request = (toolName: string, input = {}): PendingRequest => ({
  requestId: `r-${toolName}`,
  toolName,
  input,
  toolUseId: `t-${toolName}`,
});

const elicitation = {
  requestId: "e1",
  serverName: "github",
  message: "Ton jeton ?",
};

const ROUND: ChatItem[] = [
  { kind: "user", id: "u1", text: "go" } as ChatItem,
  {
    kind: "text",
    id: "m1",
    streaming: false,
    text: "❓ **Q1** - **Couleur** : laquelle ?\n\na) Violet\nb) Vert\n\n➡️ b) Vert : plus calme.",
  },
];

describe("phoneAsk", () => {
  it("shows the desktop's first: a request, then an MCP server's", () => {
    const sdk = { ...EMPTY_CHAT.sdk, elicitations: [elicitation] };
    const state = {
      ...EMPTY_CHAT,
      sdk,
      requests: [request("ExitPlanMode"), request("Bash")],
    };
    expect(phoneAsk(state)?.kind).toBe("plan");
    expect(
      phoneAsk({ ...state, requests: [request("AskUserQuestion")] })?.kind,
    ).toBe("question");
    expect(phoneAsk({ ...state, requests: [request("Edit")] })?.kind).toBe(
      "permission",
    );
    expect(phoneAsk({ ...state, requests: [] })).toMatchObject({
      kind: "elicitation",
      request: { requestId: "e1" },
    });
  });

  it("shows Claude's round, kept while he works again, nothing in a closed chat", () => {
    const idle = { ...EMPTY_CHAT, items: ROUND };
    expect(phoneAsk(idle)).toMatchObject({
      kind: "round",
      round: { id: "m1", questions: [{ id: "Q1", recommendedKey: "b" }] },
    });
    // 02/11/2026: a subagent's report woke Claude, the sheet vanished. The
    // round up when the turn starts stays, whoever shows the chat...
    expect(phoneAsk(startTurn(idle, 1))?.kind).toBe("round");
    // ...one born mid-turn waits for the turn's end.
    const born = { ...startTurn(EMPTY_CHAT, 1), items: ROUND };
    expect(phoneAsk(born)).toBeNull();
    expect(
      phoneAsk({ ...idle, closed: {}, requests: [request("Bash")] }),
    ).toBeNull();
  });
});

describe("permissionView", () => {
  it("shows a command whole, a file change as its lines", () => {
    expect(
      permissionView(request("Bash", { command: "pnpm test\npnpm lint" })),
    ).toEqual({ kind: "command", text: "pnpm test\npnpm lint" });
    expect(
      permissionView(
        request("Edit", {
          file_path: "C:/p/a.ts",
          old_string: "a",
          new_string: "b\nc",
        }),
      ),
    ).toEqual({
      kind: "diff",
      file: "C:/p/a.ts",
      rows: [
        { kind: "del", text: "a" },
        { kind: "add", text: "b" },
        { kind: "add", text: "c" },
      ],
      added: 2,
      removed: 1,
      hidden: 0,
    });
  });

  it("counts the lines of a long write left out", () => {
    const content = Array.from(
      { length: PERMISSION_DIFF_ROWS + 5 },
      (_, i) => `l${i}`,
    ).join("\n");
    const view = permissionView(
      request("Write", { file_path: "x.md", content }),
    );
    expect(view).toMatchObject({
      kind: "diff",
      hidden: 5,
      added: PERMISSION_DIFF_ROWS + 5,
    });
    if (view.kind === "diff")
      expect(view.rows).toHaveLength(PERMISSION_DIFF_ROWS);
  });

  it("falls back to the desktop's line, then the raw input", () => {
    expect(
      permissionView(request("WebFetch", { url: "https://x.dev" })),
    ).toEqual({
      kind: "text",
      text: "https://x.dev",
    });
    expect(permissionView(request("mcp__a__b", { n: 1 }))).toEqual({
      kind: "text",
      text: '{\n  "n": 1\n}',
    });
  });
});

describe("round sheet", () => {
  it("keeps a round's answers, and starts a new round empty", () => {
    const sheet = withRoundAnswer(roundSheetFor(undefined, "m1"), "m1#1", {
      option: "b",
    });
    expect(roundSheetFor(sheet, "m1")).toBe(sheet);
    expect(roundSheetFor(sheet, "m2")).toEqual({
      replyId: "m2",
      answers: {},
      closed: false,
      folded: false,
    });
  });

  it("adds dictated words after the field's, the pick kept", () => {
    let sheet = withRoundAnswer(roundSheetFor(undefined, "m1"), "m1#1", {
      option: "a",
      text: "plutôt ",
    });
    sheet = withDictatedText(sheet, "m1#1", "le vert");
    expect(sheet.answers["m1#1"]).toEqual({
      option: "a",
      text: "plutôt le vert",
    });
    expect(withDictatedText(sheet, "m1#2", "oui").answers["m1#2"]).toEqual({
      text: "oui",
    });
  });
});

describe("roundSheetBorn", () => {
  it("folds the round a rewind brings back, not the one shown at the ask", () => {
    const born = { at: 0, except: "R2" };
    const r2 = { replyId: "R2", answers: {}, closed: false, folded: false };
    // Read again before the rewind lands: R2 keeps its sheet, the ask waits.
    expect(roundSheetBorn(r2, born, "R2", 1)).toEqual({
      sheet: r2,
      consumed: false,
    });
    // Even if its sheet went meanwhile.
    expect(roundSheetBorn(undefined, born, "R2", 1).consumed).toBe(false);
    // The rewind lands: R1 comes back folded, the ask is spent.
    const r1 = roundSheetBorn(r2, born, "R1", 1);
    expect(r1.sheet).toMatchObject({ replyId: "R1", folded: true });
    expect(r1.consumed).toBe(true);
  });

  it("opens unfolded once the ask is too old", () => {
    const late = roundSheetBorn(
      undefined,
      { at: 0, except: null },
      "R1",
      31_000,
    );
    expect(late.sheet.folded).toBe(false);
  });
});
