import { describe, expect, it } from "vitest";
import { coalescedRunner } from "./coalescedRunner";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("coalescedRunner", () => {
  it("never overlaps runs and folds triggers made meanwhile into one", async () => {
    const pending: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    let started = 0;
    const trigger = coalescedRunner(() => {
      started++;
      active++;
      maxActive = Math.max(maxActive, active);
      const d = deferred();
      pending.push(() => {
        active--;
        d.resolve();
      });
      return d.promise;
    });

    trigger();
    trigger();
    trigger();
    expect(started).toBe(1);

    pending.shift()!();
    await settle();
    expect(started).toBe(2);

    pending.shift()!();
    await settle();
    expect(started).toBe(2);
    expect(maxActive).toBe(1);
  });

  it("keeps running after a failed task", async () => {
    let started = 0;
    const trigger = coalescedRunner(async () => {
      started++;
      throw new Error("read failed");
    });
    trigger();
    await settle();
    trigger();
    await settle();
    expect(started).toBe(2);
  });
});
