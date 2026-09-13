import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetPresenterForTests,
  registerPresenter,
  unregisterPresenter,
  type Presentable,
} from "./gpuPresenter";

/** A manual requestAnimationFrame: frames only advance when the test says so. */
function fakeRaf() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    requestAnimationFrame(cb: () => void) {
      const id = next++;
      pending.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id: number) {
      pending.delete(id);
    },
    tick() {
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb();
    },
    get scheduled() {
      return pending.size;
    },
  };
}

function renderer(opts: { dirty?: boolean; lost?: boolean } = {}) {
  const r = {
    dirty: opts.dirty ?? true,
    lost: opts.lost ?? false,
    presents: 0,
    needs_present() {
      return this.dirty && !this.lost;
    },
    present() {
      this.presents += 1;
      this.dirty = false;
    },
    is_lost() {
      return this.lost;
    },
  };
  return r as typeof r & Presentable;
}

describe("gpuPresenter", () => {
  let raf: ReturnType<typeof fakeRaf>;
  beforeEach(() => {
    raf = fakeRaf();
    _resetPresenterForTests(raf);
  });

  it("presents a dirty renderer once per frame, not per mutation", () => {
    const r = renderer();
    registerPresenter(r, () => {});
    // Several "mutations" before the frame: still one present.
    r.dirty = true;
    r.dirty = true;
    raf.tick();
    expect(r.presents).toBe(1);
    // Nothing changed: the next frame presents nothing.
    raf.tick();
    expect(r.presents).toBe(1);
  });

  it("runs a single loop for all renderers and stops when the last one leaves", () => {
    const a = renderer();
    const b = renderer();
    registerPresenter(a, () => {});
    registerPresenter(b, () => {});
    expect(raf.scheduled).toBe(1);
    raf.tick();
    expect(a.presents).toBe(1);
    expect(b.presents).toBe(1);
    unregisterPresenter(a);
    expect(raf.scheduled).toBe(1);
    unregisterPresenter(b);
    expect(raf.scheduled).toBe(0);
  });

  it("reports a lost device once and drops the renderer", () => {
    const r = renderer({ lost: true });
    let lost = 0;
    registerPresenter(r, () => {
      lost += 1;
    });
    raf.tick();
    raf.tick();
    expect(lost).toBe(1);
    expect(r.presents).toBe(0);
    expect(raf.scheduled).toBe(0);
  });
});
