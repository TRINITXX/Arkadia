/**
 * One requestAnimationFrame loop for every live WebGPU terminal renderer.
 *
 * Each pane's wasm renderer only *marks* itself dirty when its screen, hover
 * or selection changes; the swap-chain acquire and submit happen here, once
 * per animation frame per canvas at most. That is the WebGPU canvas model
 * (one presented texture per frame) — presenting from arbitrary tasks lets
 * the page run ahead of the compositor, and with several panes streaming at
 * 60 Hz that is the prime suspect for the renderer wedging on the GPU
 * channel. A hidden window gets no animation frames, so nothing is presented
 * while there is nobody to see it.
 */

/** The subset of the wasm `Renderer` this loop drives — kept minimal so tests need no GPU. */
export interface Presentable {
  needs_present(): boolean;
  present(): void;
  is_lost(): boolean;
}

interface Entry {
  renderer: Presentable;
  /** Called once when the GPU device is gone; the owner rebuilds the renderer. */
  onLost: () => void;
}

const live = new Map<Presentable, Entry>();

type RafLike = {
  requestAnimationFrame(cb: () => void): number;
  cancelAnimationFrame(id: number): void;
};

let scheduler: RafLike = globalThis as unknown as RafLike;
let rafId: number | null = null;

function pump(): void {
  rafId = null;
  for (const [renderer, entry] of live) {
    if (renderer.is_lost()) {
      live.delete(renderer);
      entry.onLost();
      continue;
    }
    try {
      if (renderer.needs_present()) renderer.present();
    } catch (e) {
      console.error("[arkadia] present failed:", e);
    }
  }
  if (live.size > 0) rafId = scheduler.requestAnimationFrame(pump);
}

/** Starts presenting `renderer` every frame it is dirty, until `unregister`. */
export function registerPresenter(
  renderer: Presentable,
  onLost: () => void,
): void {
  live.set(renderer, { renderer, onLost });
  if (rafId === null) rafId = scheduler.requestAnimationFrame(pump);
}

export function unregisterPresenter(renderer: Presentable): void {
  live.delete(renderer);
  if (live.size === 0 && rafId !== null) {
    scheduler.cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/** Test hook: swap the frame scheduler and reset the registry. */
export function _resetPresenterForTests(s: RafLike): void {
  live.clear();
  rafId = null;
  scheduler = s;
}

// ─── Renderer creation, one at a time ─────────────────────────────────────
//
// All panes share one GPU device (see `shared_gpu` in the wasm crate). The
// first `Renderer.new` creates it; the others must wait for that rather than
// each request their own. Serialising also spreads a burst of mounts (project
// switch, window rebuild) over successive frames instead of one big one.
let createChain: Promise<unknown> = Promise.resolve();

/** Runs `create` after every previously queued creation has settled. */
export function queueRendererCreate<T>(create: () => Promise<T>): Promise<T> {
  const run = createChain.then(create, create);
  createChain = run.catch(() => undefined);
  return run;
}
