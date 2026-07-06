import { describe, expect, it } from "vitest";
import { subscribePopupState } from "./popupState";

/** Manually-resolvable promise, to control when listen registration completes. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function flushMicrotasks() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

describe("subscribePopupState", () => {
  it("requests the state only AFTER the listener is registered", async () => {
    // The whole point of this module: invoking popup_request_state before the
    // popup-state listener is registered loses the response event, freezing the
    // window on "Conversation introuvable".
    const registration = deferred<() => void>();
    const calls: string[] = [];

    subscribePopupState<string>({
      listen: () => {
        calls.push("listen");
        return registration.promise;
      },
      requestState: () => {
        calls.push("request");
        return Promise.resolve();
      },
      onItems: () => {},
    });
    await flushMicrotasks();
    expect(calls).toEqual(["listen"]); // not yet registered → no request

    registration.resolve(() => {});
    await flushMicrotasks();
    expect(calls).toEqual(["listen", "request"]);
  });

  it("delivers items to onItems", async () => {
    let emit: ((items: string[]) => void) | undefined;
    const seen: string[][] = [];

    subscribePopupState<string>({
      listen: (handler) => {
        emit = handler;
        return Promise.resolve(() => {});
      },
      requestState: () => Promise.resolve(),
      onItems: (items) => seen.push(items),
    });
    await flushMicrotasks();

    emit?.(["a", "b"]);
    expect(seen).toEqual([["a", "b"]]);
  });

  it("stops delivering and unlistens after dispose", async () => {
    let emit: ((items: string[]) => void) | undefined;
    let unlistened = false;
    const seen: string[][] = [];

    const dispose = subscribePopupState<string>({
      listen: (handler) => {
        emit = handler;
        return Promise.resolve(() => {
          unlistened = true;
        });
      },
      requestState: () => Promise.resolve(),
      onItems: (items) => seen.push(items),
    });
    await flushMicrotasks();

    dispose();
    expect(unlistened).toBe(true);
    emit?.(["late"]);
    expect(seen).toEqual([]);
  });

  it("disposing before registration completes unlistens and never requests", async () => {
    const registration = deferred<() => void>();
    let unlistened = false;
    let requested = false;

    const dispose = subscribePopupState<string>({
      listen: () => registration.promise,
      requestState: () => {
        requested = true;
        return Promise.resolve();
      },
      onItems: () => {},
    });

    dispose(); // component unmounted before listen resolved
    registration.resolve(() => {
      unlistened = true;
    });
    await flushMicrotasks();

    expect(unlistened).toBe(true);
    expect(requested).toBe(false);
  });

  it("swallows a rejected requestState (popup keeps working on live events)", async () => {
    let emit: ((items: string[]) => void) | undefined;
    const seen: string[][] = [];

    subscribePopupState<string>({
      listen: (handler) => {
        emit = handler;
        return Promise.resolve(() => {});
      },
      requestState: () => Promise.reject(new Error("ipc down")),
      onItems: (items) => seen.push(items),
    });
    await flushMicrotasks();

    emit?.(["still alive"]);
    expect(seen).toEqual([["still alive"]]);
  });
});
