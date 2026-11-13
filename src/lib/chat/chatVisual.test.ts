import { describe, expect, it } from "vitest";
import {
  groupChatItems,
  messagesOnly,
  type ToolItem,
} from "@/lib/chat/chatGroups";
import type { ChatEvent } from "@/lib/chat/chatProtocol";
import { EMPTY_CHAT, reduceChat } from "@/lib/chat/chatState";
import {
  clampVisualHeight,
  frameFocusOk,
  frameGestureOk,
  INERT_FRAME_TAG,
  INERT_FRAME_TAGS,
  INERT_SHADOW_ROOT,
  INERT_SHADOW_ROOTS,
  inertFrames,
  mergeProbeReports,
  readFrameMessage,
  VISUAL_BOOTSTRAP,
  VISUAL_CSP,
  VISUAL_MAX_HEIGHT,
  VISUAL_PAGE_CSP,
  VISUAL_SHELL,
  visualBootstrap,
  firstFrameGrowth,
  nextFrameHeight,
  refitFrameGrowth,
  usableRoom,
  visualVerified,
  VISUAL_MIN_ROOM,
  VISUAL_THEME_CSS,
  VISUAL_TOOL_NAME,
  visualDocument,
  visualHtml,
  visualPhase,
  withChoice,
  type VisualReport,
} from "@/lib/chat/chatVisual";
import { createVisualProbe, type VisualCheck } from "@/lib/chat/chatVisualDom";
import { visualResult } from "@chat-server/visualHtml";

const tool = (patch: Partial<ToolItem> = {}): ToolItem => ({
  kind: "tool",
  id: "toolu_1",
  name: VISUAL_TOOL_NAME,
  input: { html: "<p>page</p>", title: "Essai" },
  ...patch,
});

describe("visualDocument", () => {
  it("puts the CSP, theme and bootstrap before anything of the page, after its doctype", () => {
    const doc = visualDocument(
      '<!DOCTYPE html><html lang="fr"><head><script>evil()</script><style>p{}</style></head><body></body></html>',
    );
    expect(doc.startsWith("<!DOCTYPE html><meta charset")).toBe(true);
    const csp = doc.indexOf("Content-Security-Policy");
    const theme = doc.indexOf('id="arkadia-theme"');
    const page = doc.indexOf("evil()");
    expect(csp).toBeGreaterThan(0);
    expect(theme).toBeGreaterThan(csp);
    expect(page).toBeGreaterThan(doc.indexOf("window.parent"));
  });

  it("gives a page without a doctype one, so it never renders in quirks mode", () => {
    expect(visualDocument("<p>x</p>")).toMatch(/^<!doctype html><meta charset/);
    // In the column's card, never a sideways scroll; « Agrandir » as written.
    expect(visualDocument("<p>x</p>", "t", 400, true)).toContain(
      "html{overflow-x:hidden}",
    );
    expect(visualDocument("<p>x</p>", "t", 400)).not.toContain(
      "overflow-x:hidden",
    );
  });

  it("closes what the CSP can't: DNS prefetch, WebRTC, frames in a closed shadow root", () => {
    const doc = visualDocument(
      '<div><template shadowrootmode="closed"><iframe srcdoc="x"></iframe></template></div>',
    );
    expect(doc).toContain('http-equiv="x-dns-prefetch-control" content="off"');
    expect(doc).toContain('data-shadowrootmode="closed"');
    expect(doc).not.toMatch(/\sshadowrootmode=/);
    // The guard runs before anything else of the bootstrap or the page.
    expect(VISUAL_BOOTSTRAP.indexOf("RTC")).toBeLessThan(
      VISUAL_BOOTSTRAP.indexOf('addEventListener("error"'),
    );
  });

  it("leaves links plain in the copy opened in the browser (not framed)", () => {
    const framed = VISUAL_BOOTSTRAP.indexOf("if(framed){");
    expect(framed).toBeGreaterThan(0);
    expect(
      VISUAL_BOOTSTRAP.indexOf('addEventListener("click"'),
    ).toBeGreaterThan(framed);
  });
});

describe("the wall against a frame of the page's own", () => {
  it("is the shell's Trusted Types: one policy, made by the shell, strings through it", () => {
    expect(VISUAL_CSP).toContain("require-trusted-types-for 'script'");
    expect(VISUAL_CSP).toContain("trusted-types default");
    // The page's own meta leaves them out: the browser copy has no policy.
    expect(VISUAL_PAGE_CSP).not.toContain("trusted-types");
    expect(VISUAL_PAGE_CSP).toContain("connect-src 'none'");
  });

  it("has one rule for the markup and the shell's policy", () => {
    for (const piece of [
      `/${INERT_FRAME_TAGS.source}/${INERT_FRAME_TAGS.flags}`,
      JSON.stringify(INERT_FRAME_TAG),
      `/${INERT_SHADOW_ROOTS.source}/${INERT_SHADOW_ROOTS.flags}`,
      JSON.stringify(INERT_SHADOW_ROOT),
    ])
      expect(VISUAL_SHELL).toContain(piece);
  });

  it("makes frame tags and declarative shadow roots inert in the markup", () => {
    expect(
      inertFrames(
        '<IFRAME srcdoc="x"></iframe><object></object><template shadowrootmode="closed">',
      ),
    ).toBe(
      '<x-blocked-IFRAME srcdoc="x"></x-blocked-iframe><x-blocked-object></x-blocked-object><template data-shadowrootmode="closed">',
    );
  });
});

describe("fitting the pane's height", () => {
  it("never fits to less than 240 px: a small pane keeps the visual fitted, never unfitted", () => {
    expect(usableRoom(0)).toBe(VISUAL_MIN_ROOM);
    expect(usableRoom(213)).toBe(VISUAL_MIN_ROOM);
    expect(usableRoom(770)).toBe(770);
    // Unknown (a hidden tab): no fit at all.
    expect(usableRoom(null)).toBeNull();
    // The input grows to 7 lines: the screenshot stays fitted.
    expect(visualDocument("<img src=x>", "t", 150)).toContain(
      ":root{--ark-fit-h:240px}",
    );
    // The boot script reads the same floor for a room sent later.
    expect(visualBootstrap("t")).toContain(
      `Math.max(${VISUAL_MIN_ROOM},Math.round(d.height))`,
    );
  });

  it("caps media to the room the card has, a caption's room kept, at no specificity", () => {
    const doc = visualDocument("<img src=x>", "t", 770);
    expect(doc).toContain(":root{--ark-fit-h:770px}");
    // The copy opened in the browser: no room, nothing capped.
    expect(visualDocument("<img src=x>")).not.toContain("--ark-fit-h:");
  });

  it("caps only images and videos the page left unsized, never an svg or a canvas", () => {
    const rule =
      /:where\(([^)]*\)[^{]*)\)\{max-width:100%;max-height:var\(--ark-fit-media\)/.exec(
        VISUAL_THEME_CSS,
      );
    expect(rule?.[1]).toBe(
      "img:not([width]):not([height]):not([style]),video:not([width]):not([height]):not([style])",
    );
    expect(VISUAL_THEME_CSS).not.toMatch(/svg|canvas/);
  });

  it("stops an unverified page that answers each resize of its frame with its gutter more", () => {
    // body{min-height:100vh}: each height the Lab gives comes back 32 px taller, at once.
    let g = firstFrameGrowth(160);
    for (let i = 0; i < 10; i++)
      g = nextFrameHeight(g, g.height + 32, 30, true);
    expect(g).toMatchObject({ frozen: true, height: 256, ignored: 288 });
    // A page that shrinks still does.
    expect(nextFrameHeight(g, 200, 30, true).height).toBe(200);
  });

  it("never stops a page the probe checked clean, whatever pace it grows at", () => {
    // A list revealed every 80 ms: each growth lands right after the frame's resize.
    let p = firstFrameGrowth(160);
    for (let i = 0; i < 10; i++)
      p = nextFrameHeight(p, p.height + 22, 30, false);
    expect(p).toMatchObject({ height: 380, frozen: false });
    // Unverified, a slow reveal (no resize just before) never stops either.
    let q = firstFrameGrowth(160);
    for (let i = 0; i < 10; i++)
      q = nextFrameHeight(q, q.height + 22, 400, true);
    expect(q.frozen).toBe(false);
  });

  it("a growth right after a refit never freezes, and a lifted stop shows what it held back", () => {
    // The input loses three lines: three new rooms, the image grows each time.
    let g = firstFrameGrowth(500);
    for (const step of [22, 23, 22]) {
      g = refitFrameGrowth(g);
      g = nextFrameHeight(g, g.height + step, 10, true);
    }
    expect(g.frozen).toBe(false);
    // A stop already made is lifted by the Lab's own change, at the height held back.
    let f = firstFrameGrowth(160);
    for (let i = 0; i < 4; i++) f = nextFrameHeight(f, f.height + 32, 30, true);
    expect(f).toMatchObject({ frozen: true, height: 256, ignored: 288 });
    expect(refitFrameGrowth(f)).toMatchObject({
      frozen: false,
      height: 288,
      ignored: null,
    });
  });

  it("knows a page the probe checked clean from its result", () => {
    const shown = (text: string, isError = false) =>
      tool({ result: { text, isError } });
    const clean: VisualReport = {
      errors: [],
      consoleErrors: [],
      blocked: [],
      height: 400,
      width: 728,
      scrollWidth: 728,
      empty: false,
      followsFrame: false,
    };
    expect(visualVerified(shown(visualResult(clean, []).text))).toBe(true);
    expect(
      visualVerified(
        shown("Shown in the chat, not verified: Arkadia did not report"),
      ),
    ).toBe(false);
    expect(visualVerified(shown("- Script error", true))).toBe(false);
    expect(visualVerified(tool({ stale: true }))).toBe(false);
  });
});

describe("mergeProbeReports", () => {
  const r = (patch: Partial<VisualReport>): VisualReport => ({
    errors: [],
    consoleErrors: [],
    blocked: [],
    height: 600,
    width: 728,
    scrollWidth: 728,
    empty: false,
    followsFrame: false,
    ...patch,
  });
  it("never mixes widths across the two heights: a scrollbar at 420 px is no clipping", () => {
    // 600 px tall: a scrollbar narrows the first frame, not the tall one.
    const merged = mergeProbeReports(
      r({ width: 718, scrollWidth: 718 }),
      r({}),
      480,
    );
    expect(merged.scrollWidth).toBeLessThanOrEqual(merged.width);
    const wide = mergeProbeReports(
      r({ width: 718, scrollWidth: 718 }),
      r({ scrollWidth: 1200 }),
      480,
    );
    expect(wide).toMatchObject({ width: 728, scrollWidth: 1200 });
  });

  it("says the page follows the frame when it grew as much", () => {
    expect(
      mergeProbeReports(r({ height: 452 }), r({ height: 932 }), 480)
        .followsFrame,
    ).toBe(true);
    expect(mergeProbeReports(r({}), r({}), 480).followsFrame).toBe(false);
  });
});

describe("VISUAL_CSP", () => {
  it("comes from the shell and keeps the network, frames and workers out", () => {
    for (const d of [
      "default-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
    ])
      expect(VISUAL_CSP).toContain(d);
    expect(VISUAL_CSP).toContain("https://cdn.jsdelivr.net");
    expect(VISUAL_CSP).not.toMatch(/ipc|localhost|https:(?!\/\/)/);
  });
});

describe("readFrameMessage", () => {
  const msg = (kind: string, v?: unknown, k = "t0k") => ({
    arkadiaVisual: 1,
    k,
    kind,
    v,
  });
  it("takes only the frame's own kinds, an http(s) link and a non-empty choice", () => {
    expect(readFrameMessage(msg("size", 320), "t0k")).toEqual({
      kind: "size",
      height: 320,
    });
    expect(readFrameMessage(msg("link", "file:///C:/x"), "t0k")).toBeNull();
    expect(
      readFrameMessage(msg("link", "javascript:alert(1)"), "t0k"),
    ).toBeNull();
    expect(readFrameMessage(msg("choose", "  "), "t0k")).toBeNull();
    expect(readFrameMessage({ kind: "choose", v: "B" }, "t0k")).toBeNull();
  });

  it("passes a wheel the page left unused on, its deltas bounded", () => {
    expect(
      readFrameMessage(msg("wheel", { dx: 0, dy: 120, m: 0 }), "t0k"),
    ).toEqual({
      kind: "wheel",
      dx: 0,
      dy: 120,
      mode: 0,
    });
    expect(
      readFrameMessage(msg("wheel", { dx: 0, dy: 1e9, m: 9 }), "t0k"),
    ).toEqual({
      kind: "wheel",
      dx: 0,
      dy: 4000,
      mode: 0,
    });
    expect(readFrameMessage(msg("wheel", { dy: "x" }), "t0k")).toBeNull();
  });

  it("believes a press or a choice only with the frame's token, which its page never sees", () => {
    expect(readFrameMessage(msg("down"), "t0k")).toEqual({ kind: "down" });
    expect(readFrameMessage(msg("down", undefined, "guess"), "t0k")).toBeNull();
    expect(readFrameMessage(msg("choose", "B", ""), "")).toBeNull();
    // The shell speaks before the page exists, without a token.
    expect(
      readFrameMessage({ arkadiaVisual: 1, kind: "shell" }, "t0k"),
    ).toEqual({ kind: "shell" });
    // The bootstrap removes its own script, token and all, before the page runs.
    const boot = visualBootstrap("t0k");
    expect(boot).toContain('var K="t0k"');
    expect(boot.indexOf("removeChild(me)")).toBeLessThan(
      boot.indexOf('var K="t0k"'),
    );
  });
});

describe("frameFocusOk and frameGestureOk", () => {
  it("keeps the focus a click gave, even just after typing in the Lab; never for another frame", () => {
    expect(frameFocusOk({ activation: true, onFrame: true })).toBe(true);
    // Another card was clicked: this one wasn't pressed.
    expect(frameFocusOk({ activation: true, onFrame: false })).toBe(false);
    // Its page's own focus(): no gesture.
    expect(frameFocusOk({ activation: false, onFrame: true })).toBe(false);
  });

  const ok = {
    activation: true,
    frameFocused: true,
    onFrame: true,
    sinceHostInput: 60_000,
  };
  it("lets a link or choice act only on the user's click in that frame", () => {
    expect(frameGestureOk(ok)).toBe(true);
    // A page posting by itself: no activation.
    expect(frameGestureOk({ ...ok, activation: false })).toBe(false);
    // Another frame or the input holds the focus.
    expect(frameGestureOk({ ...ok, frameFocused: false })).toBe(false);
    // The click went to another card.
    expect(frameGestureOk({ ...ok, onFrame: false })).toBe(false);
    // The activation may be the user's typing in the Lab.
    expect(frameGestureOk({ ...ok, sinceHostInput: 1_200 })).toBe(false);
  });
});

describe("withChoice", () => {
  it("fills an empty input, changes the pick on a second click, keeps the user's words", () => {
    expect(withChoice("", "Maquette B", null)).toBe("Maquette B");
    expect(withChoice("Maquette B", "Maquette C", "Maquette B")).toBe(
      "Maquette C",
    );
    expect(withChoice("Je préfère", "Maquette B", null)).toBe(
      "Je préfère\nMaquette B",
    );
    expect(
      withChoice("Je préfère\nMaquette B", "Maquette C", "Maquette B"),
    ).toBe("Je préfère\nMaquette C");
  });
});

describe("the card's state", () => {
  it("checks, shows, or folds a page found broken; a past call without result shows", () => {
    expect(visualPhase(tool())).toBe("checking");
    expect(
      visualPhase(tool({ result: { text: "Shown", isError: false } })),
    ).toBe("shown");
    expect(
      visualPhase(tool({ result: { text: "- Script error", isError: true } })),
    ).toBe("broken");
    expect(visualPhase(tool({ stale: true }))).toBe("shown");
  });

  it("shows the page with its images in, else the call's own once none was kept", () => {
    expect(
      visualHtml(tool(), { html: "<p>inlined</p>", checking: false }),
    ).toBe("<p>inlined</p>");
    expect(visualHtml(tool(), { html: null, checking: false })).toBe(
      "<p>page</p>",
    );
    expect(visualHtml(tool(), undefined)).toBeUndefined();
  });

  it("caps the frame's height, past which the page scrolls inside", () => {
    expect(clampVisualHeight(12)).toBe(48);
    expect(clampVisualHeight(30_000)).toBe(VISUAL_MAX_HEIGHT);
  });

  it("is a card of its own, and « Messages seuls » keeps it unless broken", () => {
    const shown = tool({ result: { text: "Shown", isError: false } });
    const broken = tool({
      id: "toolu_0",
      result: { text: "x", isError: true },
    });
    const units = groupChatItems([broken, shown]);
    expect(units.map((u) => u.kind)).toEqual(["visual", "visual"]);
    expect(
      messagesOnly(units).map((u) => ("item" in u ? u.item.id : "")),
    ).toEqual(["toolu_1"]);
  });
});

describe("visuals in the chat's state", () => {
  const check: ChatEvent = {
    type: "visual_check",
    chatId: "c",
    checkId: "toolu_1",
    toolUseId: "toolu_1",
    html: "<p>inlined</p>",
    title: "Essai",
    wide: false,
  };
  it("keeps the checked page by call; a server's past page never overrides a live one", () => {
    let s = reduceChat(EMPTY_CHAT, check, 1);
    expect(s.visuals.toolu_1).toEqual({
      html: "<p>inlined</p>",
      checking: true,
      stored: false,
    });
    s = reduceChat(
      s,
      { type: "visual_checked", chatId: "c", checkId: "toolu_1" },
      2,
    );
    expect(s.visuals.toolu_1.checking).toBe(false);
    s = reduceChat(
      s,
      { type: "visual_html", chatId: "c", toolUseId: "toolu_1", html: null },
      3,
    );
    expect(s.visuals.toolu_1.html).toBe("<p>inlined</p>");
  });

  it("replayed without its page: keeps a known one, asks for a kept copy", () => {
    const stub = { ...check, html: null, stored: true } as ChatEvent;
    // After a reload: no page yet, a copy was kept, so the card asks for it.
    let s = reduceChat(EMPTY_CHAT, stub, 1);
    expect(visualHtml(tool(), s.visuals.toolu_1)).toBeUndefined();
    s = reduceChat(
      s,
      {
        type: "visual_html",
        chatId: "c",
        toolUseId: "toolu_1",
        html: "<p>kept</p>",
      },
      2,
    );
    expect(visualHtml(tool(), s.visuals.toolu_1)).toBe("<p>kept</p>");
    // The page sent live, then its stub replayed: the page stays.
    s = reduceChat(reduceChat(EMPTY_CHAT, check, 1), stub, 2);
    expect(s.visuals.toolu_1.html).toBe("<p>inlined</p>");
  });
});

describe("createVisualProbe", () => {
  const report: VisualReport = {
    errors: [],
    consoleErrors: [],
    blocked: [],
    height: 200,
    width: 728,
    scrollWidth: 728,
    empty: false,
    followsFrame: false,
  };
  const setup = () => {
    const started: string[] = [];
    const cancelled: string[] = [];
    const onEvent = createVisualProbe(
      () => {},
      (c: VisualCheck) => {
        started.push(c.checkId);
        return {
          done: Promise.resolve(report),
          cancel: () => cancelled.push(c.checkId),
        };
      },
    );
    return { started, cancelled, onEvent };
  };
  const ev = (type: string, rest: object = {}) =>
    ({ type, chatId: "c", ...rest }) as ChatEvent;
  const check = (id: string) =>
    ev("visual_check", {
      checkId: id,
      toolUseId: id,
      html: "<p/>",
      title: "t",
      wide: false,
    });

  it("never checks a replayed check without its page", () => {
    const { started, onEvent } = setup();
    onEvent(
      ev("visual_check", {
        checkId: "s",
        toolUseId: "s",
        html: null,
        title: "t",
        wide: false,
      }),
      false,
    );
    expect(started).toEqual([]);
  });

  it("drops a chat's checks when it ends: no report to a server gone", () => {
    const { cancelled, onEvent } = setup();
    onEvent(check("a"), false);
    onEvent({ type: "closed", chatId: "other" } as ChatEvent, false);
    expect(cancelled).toEqual([]);
    onEvent(ev("closed"), false);
    expect(cancelled).toEqual(["a"]);
  });

  it("checks a live visual at once", () => {
    const { started, onEvent } = setup();
    onEvent(check("a"), false);
    expect(started).toEqual(["a"]);
  });

  it("after a reload, checks only the visuals whose check never ended", () => {
    const { started, onEvent } = setup();
    onEvent(ev("attached"), true);
    onEvent(check("done"), true);
    onEvent(ev("visual_checked", { checkId: "done" }), true);
    onEvent(check("open"), true);
    expect(started).toEqual([]);
    onEvent(ev("replayed"), false);
    expect(started).toEqual(["open"]);
  });
});
