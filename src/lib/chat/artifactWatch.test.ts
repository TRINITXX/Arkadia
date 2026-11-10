import { describe, expect, it } from "vitest";
import {
  artifactLink,
  listensTo,
  replyRelayDue,
  replyRelayText,
  watchedAfter,
} from "../../../chat-server/artifactWatch.ts";

const LINK = "https://claude.ai/artifact/BZWo1gLDAUQTPzgsUjwbuC";

// As Claude Code 2.1.322 says them (probed live on 10/11/2026).
const watcher = {
  task_id: "w1",
  task_type: "monitor_ws",
  ambient: true,
  description: `live updates for artifact ${LINK} (auto-armed on publish)`,
};
const level = (tasks: unknown[]) => ({
  type: "system",
  subtype: "background_tasks_changed",
  tasks,
});

describe("an artifact's reply to a chat that no longer listens (chat-server/artifactWatch.ts)", () => {
  it("knows the artifacts its Claude Code listens to from its watchers", () => {
    const shell = {
      task_id: "s1",
      task_type: "local_bash",
      description: "pnpm dev",
    };
    expect(watchedAfter([], level([shell, watcher]))).toEqual([LINK]);
    // The watcher ended (or another process's set): none any more.
    expect(watchedAfter([LINK], level([shell]))).toEqual([]);
    // Any other frame leaves the set as it is.
    const set = [LINK];
    expect(watchedAfter(set, { type: "result" })).toBe(set);
    expect(
      watchedAfter(set, {
        type: "system",
        subtype: "task_started",
        ...watcher,
      }),
    ).toBe(set);
  });

  it("never takes another monitor's url for an artifact watched", () => {
    const monitor = {
      task_id: "m1",
      task_type: "monitor_ws",
      description: "wss://example.com/live",
    };
    const mention = {
      task_id: "a1",
      task_type: "local_agent",
      description: `Relire ${LINK}`,
    };
    expect(watchedAfter([], level([monitor, mention]))).toEqual([]);
  });

  it("says the reply itself when no Claude Code listens to that artifact", () => {
    // Asleep: its Claude Code, and the watcher with it, are gone.
    expect(replyRelayDue(LINK, false, [LINK])).toBe(true);
    // Woken since its publish: an SDK session never re-arms the watcher.
    expect(replyRelayDue(LINK, true, [])).toBe(true);
    expect(
      replyRelayDue(LINK, true, ["https://claude.ai/artifact/other"]),
    ).toBe(true);
    // Listening: Claude Code hands the comment over, a second word would double it.
    expect(replyRelayDue(`${LINK}?via=auto_preview`, true, [LINK])).toBe(false);
    // Not an artifact's link: nothing to say.
    expect(replyRelayDue("https://example.com/artifact/x", false, [])).toBe(
      false,
    );
  });

  it("leaves the reply to another chat whose Claude Code listens to it", () => {
    expect(listensTo(LINK, true, [LINK])).toBe(true);
    // Asleep, or listening to another artifact: not its.
    expect(listensTo(LINK, false, [LINK])).toBe(false);
    expect(listensTo(LINK, true, [])).toBe(false);
    // The same artifact under its other address isn't known for it: said again.
    const long =
      "https://claude.ai/code/artifact/331b1d92-3bb5-47f3-8c43-17ceb715f817";
    expect(listensTo(long, true, [LINK])).toBe(false);
    expect(replyRelayDue(long, true, [LINK])).toBe(true);
  });

  it("names the artifact by its bare link, nothing of the page's", () => {
    expect(artifactLink(`${LINK}?via=auto_preview#top`)).toBe(LINK);
    expect(artifactLink("https://claude.ai/code/artifact/0d1e-22")).toBe(
      "https://claude.ai/code/artifact/0d1e-22",
    );
    expect(replyRelayText(`${LINK}?x=1`)).toBe(
      `J'ai répondu dans l'artefact ${LINK}. Lis ma réponse et continue.`,
    );
    // The address itself is claude.ai's artifact, never one it quotes.
    for (const other of [
      "https://claude.ai/chat/abc",
      `https://example.com/?u=${LINK}`,
      `https://claude.ai/x?u=claude.ai/artifact/Y`,
      "https://claude.ai.example.com/artifact/abc",
      "http://claude.ai/artifact/abc",
      "https://claude.ai/artifact/abc/files/x",
      "pas un lien",
    ]) {
      expect(artifactLink(other)).toBeNull();
      expect(replyRelayText(other)).toBeNull();
      expect(replyRelayDue(other, false, [])).toBe(false);
    }
  });
});
