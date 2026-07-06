import { describe, it, expect } from "vitest";
import { makeToast, toastTtl } from "./toast";

describe("makeToast", () => {
  it("creates a toast with the given level and message", () => {
    const t = makeToast("info", "hello");
    expect(t.message).toBe("hello");
    expect(t.level).toBe("info");
    expect(t.id).toBeTruthy();
  });

  it("assigns a unique id per call", () => {
    const a = makeToast("info", "a");
    const b = makeToast("error", "b");
    expect(a.id).not.toBe(b.id);
  });
});

describe("toastTtl", () => {
  it("errors linger longer than infos", () => {
    expect(toastTtl("error")).toBeGreaterThan(toastTtl("info"));
  });
});
