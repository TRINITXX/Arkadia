import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { describeLongFrame } from "./longFrameLog";

describe("describeLongFrame", () => {
  it("names the longest scripts first, with their place in the bundle", () => {
    const script = (duration: number, invoker: string) => ({
      duration,
      invoker,
      invokerType: "event-listener",
      sourceURL: "tauri://localhost/assets/app-CG8t1dux.js",
      sourceFunctionName: "",
      sourceCharPosition: 1234,
    });
    const line = describeLongFrame({
      duration: 1520.4,
      blockingDuration: 1460,
      scripts: [script(80, "DIV.onclick"), script(1400, "BUTTON.onclick")],
    } as unknown as Parameters<typeof describeLongFrame>[0]);
    expect(line).toBe(
      "[longframe] 1520ms (blocking 1460ms) " +
        "1400ms event-listener BUTTON.onclick @ app-CG8t1dux.js:1234 | " +
        "80ms event-listener DIV.onclick @ app-CG8t1dux.js:1234",
    );
  });
});
