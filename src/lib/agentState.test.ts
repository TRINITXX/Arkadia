import { describe, it, expect } from "vitest";
import {
  stateFromTitle,
  isStatusGlyph,
  aggregate,
  withBackgroundTasks,
} from "@/lib/agentState";

describe("stateFromTitle", () => {
  it("maps a leading ✳ to waiting", () => {
    expect(stateFromTitle("✳ Claude Code")).toEqual({
      kind: "waiting",
      session_id: "",
    });
    expect(stateFromTitle("  ✳ payment-methods-invoice")).toEqual({
      kind: "waiting",
      session_id: "",
    });
  });

  it("maps a leading Braille spinner glyph to busy (the working dot)", () => {
    // Claude Code's working spinner is a single Braille dot that hops position
    // frame to frame (U+2800–U+28FF).
    for (const g of ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]) {
      expect(stateFromTitle(`${g} envoi_suivi`)).toEqual({ kind: "busy" });
    }
  });

  it("maps leading middot / bullet variants to busy", () => {
    for (const g of ["·", "∙", "•", "⋅"]) {
      expect(stateFromTitle(`${g} envoi_suivi`)).toEqual({ kind: "busy" });
    }
  });

  it("returns null for a plain shell/tool title (no badge)", () => {
    expect(stateFromTitle("C:\\WINDOWS\\system32\\cmd.exe")).toBeNull();
    expect(
      stateFromTitle("C:\\Users\\TRINITX\\Desktop\\VTC-Planner"),
    ).toBeNull();
    expect(stateFromTitle("Windows PowerShell")).toBeNull();
    expect(stateFromTitle("pwsh")).toBeNull();
    expect(stateFromTitle("")).toBeNull();
    expect(stateFromTitle("   ")).toBeNull();
  });
});

describe("isStatusGlyph", () => {
  it("is true for symbols, false for alphanumerics and empty", () => {
    expect(isStatusGlyph("✳")).toBe(true);
    expect(isStatusGlyph("⠙")).toBe(true);
    expect(isStatusGlyph("·")).toBe(true);
    expect(isStatusGlyph("C")).toBe(false);
    expect(isStatusGlyph("9")).toBe(false);
    expect(isStatusGlyph("")).toBe(false);
  });
});

describe("aggregate", () => {
  it("ranks waiting over busy over idle over none", () => {
    expect(
      aggregate([{ kind: "busy" }, { kind: "waiting", session_id: "s" }]).kind,
    ).toBe("waiting");
    expect(aggregate([{ kind: "none" }, { kind: "busy" }]).kind).toBe("busy");
    expect(aggregate([]).kind).toBe("none");
  });
});

describe("withBackgroundTasks", () => {
  const waiting = { kind: "waiting", session_id: "" } as const;

  it("shows a waiting pane as busy while background tasks run", () => {
    expect(withBackgroundTasks(waiting, 2)).toEqual({
      kind: "busy",
      tool: "tâche de fond",
    });
  });

  it("keeps waiting once nothing runs in the background", () => {
    expect(withBackgroundTasks(waiting, 0)).toBe(waiting);
  });

  it("leaves a busy pane alone", () => {
    const busy = { kind: "busy" } as const;
    expect(withBackgroundTasks(busy, 3)).toBe(busy);
  });
});
