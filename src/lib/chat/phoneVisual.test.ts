import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ACTIVATION_MS } from "@/lib/chat/chatVisual";
import {
  phoneVisualBridge,
  phoneVisualMayLoad,
  readPhoneVisualMessage,
} from "@/lib/chat/phoneVisual";

/** A top-level page in a WKWebView, the bridge run in it first. */
function page() {
  const sent: string[] = [];
  const listeners: ((e: { isTrusted: boolean }) => void)[] = [];
  const clock = { now: 0 };
  const window: Record<string, unknown> = {
    webkit: {
      messageHandlers: {
        ReactNativeWebView: { postMessage: (s: string) => sent.push(s) },
      },
    },
    addEventListener: (
      _type: string,
      cb: (e: { isTrusted: boolean }) => void,
    ) => listeners.push(cb),
  };
  window.parent = window;
  const context = vm.createContext({ window, Date: { now: () => clock.now } });
  vm.runInContext(phoneVisualBridge(false), context);
  return {
    sent,
    clock,
    tap: (isTrusted: boolean) => listeners.forEach((cb) => cb({ isTrusted })),
    run: (code: string) => vm.runInContext(code, context) as unknown,
  };
}

const post = (kind: string, v: unknown) =>
  `window.parent.postMessage(${JSON.stringify({ arkadiaVisual: 1, k: "tok", kind, v })}, "*")`;

describe("phoneVisualBridge", () => {
  it("gives the bootstrap a parent that hands its height to the app", () => {
    const p = page();
    expect(p.run("window.parent !== window")).toBe(true);
    p.run(post("size", 420));
    expect(p.sent).toHaveLength(1);
    expect(readPhoneVisualMessage(p.sent[0], "tok")).toEqual({
      kind: "size",
      height: 420,
    });
    expect(readPhoneVisualMessage(p.sent[0], "other")).toBeNull();
  });

  it("passes a link or a choice only just after the user's tap", () => {
    const p = page();
    p.run(post("choose", "Option A"));
    p.tap(false);
    p.run(post("link", "https://example.com/"));
    expect(p.sent).toEqual([]);
    p.tap(true);
    p.run(post("choose", "Option A"));
    expect(readPhoneVisualMessage(p.sent[0], "tok")).toEqual({
      kind: "choose",
      text: "Option A",
    });
    p.clock.now += ACTIVATION_MS + 1;
    p.run(post("link", "https://example.com/"));
    expect(p.sent).toHaveLength(1);
  });

  it("never lets the page take the token, whatever it patches later", () => {
    const p = page();
    p.run(`var stolen=[];
      Object.prototype.toJSON=function(){stolen.push(this);return this;};
      JSON.stringify=function(v){stolen.push(v);return "";};
      window.webkit={messageHandlers:{ReactNativeWebView:{postMessage:function(s){stolen.push(s);}}}};
      try{window.parent={postMessage:function(m){stolen.push(m);}};}catch(e){}
      try{window.parent.postMessage=function(m){stolen.push(m);};}catch(e){}`);
    p.run(post("size", 300));
    expect(p.run("stolen.length")).toBe(0);
    expect(readPhoneVisualMessage(p.sent[0], "tok")).toEqual({
      kind: "size",
      height: 300,
    });
  });
});

describe("phoneVisualMayLoad", () => {
  it("lets the page load itself and its anchors, nothing else", () => {
    expect(phoneVisualMayLoad("about:blank")).toBe(true);
    expect(phoneVisualMayLoad("about:blank#part-2")).toBe(true);
    for (const url of [
      "https://example.com/",
      "about:srcdoc",
      "data:text/html,<p>x</p>",
      "blob:null/1234",
      "tel:0600000000",
    ])
      expect(phoneVisualMayLoad(url)).toBe(false);
  });
});

describe("readPhoneVisualMessage", () => {
  it("drops what isn't the bridge's JSON", () => {
    expect(readPhoneVisualMessage("not json", "tok")).toBeNull();
    expect(readPhoneVisualMessage('"size"', "tok")).toBeNull();
  });
});
