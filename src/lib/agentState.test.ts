import { describe, it, expect } from "vitest";
import {
  stateFromTitle,
  isStatusGlyph,
  aggregate,
  withBackgroundShells,
  withBackgroundTasks,
  withOpenArtifact,
  type AgentStateValue,
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

  it("keeps the shell ring whichever waiting pane comes first", () => {
    const plain = { kind: "waiting", session_id: "a" } as const;
    const ringed = { kind: "waiting", session_id: "b", shellRunning: true };
    expect(aggregate([plain, ringed])).toBe(ringed);
    expect(aggregate([ringed, plain])).toBe(ringed);
  });

  it("keeps the pane carrying both rings over one carrying a single ring", () => {
    const shell = { kind: "waiting", session_id: "a", shellRunning: true };
    const both = {
      kind: "waiting",
      session_id: "b",
      shellRunning: true,
      artifactOpen: true,
    };
    expect(aggregate([shell, both] as AgentStateValue[])).toBe(both);
  });

  it("carries a shell ring and an artifact ring found on different panes", () => {
    const artifact = { kind: "waiting", session_id: "a", artifactOpen: true };
    const shell = { kind: "waiting", session_id: "b", shellRunning: true };
    expect(aggregate([artifact, shell] as AgentStateValue[])).toEqual({
      ...artifact,
      shellRunning: true,
    });
  });

  it("keeps a plain waiting pane over a busy pane with an artifact", () => {
    const waiting = { kind: "waiting", session_id: "a" } as const;
    expect(aggregate([{ kind: "busy", artifactOpen: true }, waiting])).toBe(
      waiting,
    );
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

describe("withBackgroundShells", () => {
  const waiting = { kind: "waiting", session_id: "" } as const;

  it("rings a waiting pane while a background shell runs", () => {
    expect(withBackgroundShells(waiting, 1)).toEqual({
      ...waiting,
      shellRunning: true,
    });
  });

  it("leaves a waiting pane plain once no shell runs", () => {
    expect(withBackgroundShells(waiting, 0)).toBe(waiting);
  });

  it("never rings a busy pane", () => {
    const busy = { kind: "busy" } as const;
    expect(withBackgroundShells(busy, 2)).toBe(busy);
  });
});

describe("withOpenArtifact", () => {
  it("rings a waiting or busy pane whose tab shows an artifact", () => {
    const waiting = { kind: "waiting", session_id: "", shellRunning: true };
    expect(withOpenArtifact(waiting as AgentStateValue, true)).toEqual({
      ...waiting,
      artifactOpen: true,
    });
    expect(withOpenArtifact({ kind: "busy" }, true)).toEqual({
      kind: "busy",
      artifactOpen: true,
    });
  });

  it("leaves the pane plain without an artifact, and idle panes alone", () => {
    const busy = { kind: "busy" } as const;
    expect(withOpenArtifact(busy, false)).toBe(busy);
    const idle = { kind: "idle", session_id: "" } as const;
    expect(withOpenArtifact(idle, true)).toBe(idle);
  });
});
