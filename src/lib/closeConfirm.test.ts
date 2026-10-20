import { describe, expect, it } from "vitest";
import type { Tab } from "@/types";
import type { AgentStateValue } from "./agentState";
import { closeConfirmMessage } from "./closeConfirm";

function tab(id: string, paneIds: string[]): Tab {
  return {
    id,
    projectId: "proj",
    tree: { kind: "leaf", paneId: paneIds[0] },
    activePaneId: paneIds[0],
    panes: Object.fromEntries(
      paneIds.map((p) => [p, { id: p, title: "pwsh", cwd: null }]),
    ),
  };
}

const busy: AgentStateValue = { kind: "busy" };
const waiting: AgentStateValue = { kind: "waiting", session_id: "s" };
const waitingWithShell: AgentStateValue = { ...waiting, shellRunning: true };

describe("closeConfirmMessage", () => {
  it("lets a waiting Claude or a plain shell close without asking", () => {
    expect(closeConfirmMessage([tab("t", ["p"])], { p: waiting })).toBeNull();
    expect(closeConfirmMessage([tab("t", ["p"])], {})).toBeNull();
  });

  it("asks when Claude is working", () => {
    expect(closeConfirmMessage([tab("t", ["p"])], { p: busy })).toContain(
      "Claude travaille encore dans cet onglet",
    );
  });

  it("asks when a background shell is open", () => {
    expect(
      closeConfirmMessage([tab("t", ["p"])], { p: waitingWithShell }),
    ).toContain("Un shell tourne encore");
  });

  it("sees a working Claude behind a waiting one in a split", () => {
    expect(
      closeConfirmMessage([tab("t", ["a", "b"])], { a: waiting, b: busy }),
    ).not.toBeNull();
  });

  it("speaks of the project when closing several tabs", () => {
    expect(
      closeConfirmMessage([tab("t1", ["a"]), tab("t2", ["b"])], { b: busy }),
    ).toContain("dans ce projet");
  });
});
