import { describe, expect, it } from "vitest";
import type { Tab } from "@/types";
import type { AgentStateValue } from "./agentState";
import { visibleActiveProjectIds, waitingTransitions } from "./sidebarHidden";

function tab(id: string, projectId: string): Tab {
  return {
    id,
    projectId,
    tree: { kind: "leaf", paneId: `${id}-p` },
    activePaneId: `${id}-p`,
    panes: { [`${id}-p`]: { id: `${id}-p`, title: "pwsh", cwd: null } },
  };
}

const busy: AgentStateValue = { kind: "busy" };
const waiting: AgentStateValue = { kind: "waiting", session_id: "s" };

describe("waitingTransitions", () => {
  it("reports the panes that start and stop waiting", () => {
    expect(
      waitingTransitions(
        { p1: busy, p2: waiting, p3: waiting },
        { p1: waiting, p2: busy, p3: waiting },
      ),
    ).toEqual({ entered: ["p1"], left: ["p2"] });
  });

  it("sees a split's second Claude finish while the first already waits", () => {
    // Tab-level aggregate stays "waiting" throughout; the pane view does not.
    expect(
      waitingTransitions({ a: waiting, b: busy }, { a: waiting, b: waiting })
        .entered,
    ).toEqual(["b"]);
  });

  it("counts a closed waiting pane as having stopped", () => {
    expect(waitingTransitions({ p1: waiting }, {}).left).toEqual(["p1"]);
  });
});

describe("visibleActiveProjectIds", () => {
  const active = new Set(["a", "b"]);

  it("sends a project back to Inactive once its last listed tab is hidden", () => {
    const tabs = [tab("t1", "a"), tab("t2", "a"), tab("t3", "b")];
    // t2 is a plain shell: never listed, so hiding t1 empties the group.
    const states = { t1: waiting, t3: busy };
    const visible = visibleActiveProjectIds(
      active,
      tabs,
      states,
      new Set(["t1"]),
    );
    expect([...visible]).toEqual(["b"]);
  });

  it("keeps the project while another of its tabs is listed", () => {
    const tabs = [tab("t1", "a"), tab("t2", "a"), tab("t3", "b")];
    const states = { t1: waiting, t2: busy, t3: busy };
    const visible = visibleActiveProjectIds(
      active,
      tabs,
      states,
      new Set(["t1"]),
    );
    expect([...visible]).toEqual(["a", "b"]);
  });

  it("leaves alone a project with no listed tab that was never hidden", () => {
    const tabs = [tab("t1", "a"), tab("t3", "b")];
    const visible = visibleActiveProjectIds(
      active,
      tabs,
      { t3: busy },
      new Set(["t3"]),
    );
    expect([...visible]).toEqual(["a"]);
  });
});
