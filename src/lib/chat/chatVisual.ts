import shell from "@/lib/chat/visual-frame.html?raw";
import { CHAT_FONTS, CHAT_TOKENS as T } from "@/lib/chat/chatTheme";
import type { ToolItem } from "@/lib/chat/chatGroups";
import {
  VISUAL_CHECKED_CLEAN,
  VISUAL_FIT_FLOOR,
  VISUAL_TOOL_NAME,
  type VisualReport,
} from "@chat-server/visualHtml";

/**
 * The chat's visuals (`show_visual`, `chat-server/visual.ts`): Claude's HTML
 * page shown in a card of the column. Pure: the document the frame gets
 * (CSP, theme, bootstrap), what the frame says back, and the card's state.
 * Ideas from T3 Code's `html_render` (MIT, © 2026 T3 Tools Inc.).
 */

export { VISUAL_TOOL_NAME };
export type { VisualReport };

/** The shell's CSP (`visual-frame.html`), the one source of it. */
export const VISUAL_CSP = (() => {
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
    shell,
  );
  if (!m) throw new Error("visual-frame.html states no CSP");
  return m[1];
})();

export const VISUAL_SHELL = shell;

/**
 * The CSP the page itself states: the shell's without Trusted Types. In the
 * frame the shell's policy holds them already (its CSP stays through
 * `document.open`); the copy opened in the browser has no policy, and
 * requiring one there would refuse every `innerHTML`.
 */
export const VISUAL_PAGE_CSP = VISUAL_CSP.split(";")
  .map((d) => d.trim())
  .filter((d) => d && !/^(require-trusted-types-for|trusted-types)\b/.test(d))
  .join("; ");

/** What a media's fitted height leaves for the rest: the gutter and a caption under it. */
export const VISUAL_FIT_ROOM = 88;

/**
 * The least room a visual fits to: a pane whose input grows (it can take
 * 40% of the window) leaves less, and fitting to that would make images of a
 * few dozen pixels; not fitting at all would make a fitted image jump to its
 * full height and back as the input grows and shrinks. So the room never
 * counts under this: the visual stays fitted, the conversation scrolls. The
 * page side (`usableRoom`) and the frame's boot script read the same rule.
 */
export const VISUAL_MIN_ROOM = 240;

/** The room fitting uses, never under `VISUAL_MIN_ROOM`; null: unknown (a hidden tab). */
export function usableRoom(room: number | null | undefined): number | null {
  return room != null && Number.isFinite(room)
    ? Math.max(VISUAL_MIN_ROOM, Math.round(room))
    : null;
}

/** The media the room caps: images and videos the page didn't size itself. */
const FIT_MEDIA = ["img", "video"]
  .map((tag) => `${tag}:not([width]):not([height]):not([style])`)
  .join(",");

/** The visuals' theme: the chat's colours as CSS variables (the tool lists them). */
export const VISUAL_THEME: Record<string, string> = {
  "--bg": T.bg,
  "--text": T.ink,
  "--muted": T.dim,
  "--faint": T.mute,
  "--card": T.raised,
  "--card-2": T.raisedHover,
  "--border": T.line,
  "--border-strong": T.lineStrong,
  "--accent": T.accent,
  "--accent-text": T.accentInk,
  "--accent-soft": "rgba(226, 134, 95, 0.14)",
  "--ok": "#4ade80",
  "--warn": "#fcd34d",
  "--bad": "#f87171",
  "--info": "#60a5fa",
  "--chart-1": T.accent,
  "--chart-2": "#60a5fa",
  "--chart-3": "#4ade80",
  "--chart-4": "#c084fc",
  "--chart-5": "#fbbf24",
  "--chart-6": "#2dd4bf",
  "--radius": "12px",
  "--radius-sm": "8px",
  "--font-sans": CHAT_FONTS.sans,
  "--font-serif": CHAT_FONTS.serif,
  "--font-mono": CHAT_FONTS.mono,
};

/** Variables first, then a base sheet the page's own styles come after. */
export const VISUAL_THEME_CSS =
  `:root{color-scheme:dark;${Object.entries(VISUAL_THEME)
    .map(([k, v]) => `${k}:${v};`)
    .join("")}}` +
  "html{background:var(--bg);color:var(--text);font-family:var(--font-sans);font-size:14.5px;line-height:1.6;padding:16px;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:thin;scrollbar-color:#31353b transparent}" +
  "body{margin:0}*,*::before,*::after{box-sizing:border-box}a{color:var(--accent)}" +
  "code,kbd,pre,samp{font-family:var(--font-mono)}::selection{background:var(--accent-soft)}" +
  // Images and videos fit the room the card has (`--ark-fit-h`, its frame's
  // height without scrolling), room kept for a caption under them. Only
  // those without a width, height or style attribute, at no specificity: a
  // max-width or max-height the page's own CSS gives wins, but a width or
  // height it sets from a class keeps the cap on the other side (contained,
  // not distorted). Never an svg or a canvas: capped, an svg without viewBox
  // is cut and a canvas squashed, and the probe no longer sees it overflow.
  // Without a usable room (the copy opened in the browser, a small pane) the
  // calc is invalid and nothing is capped.
  `:root{--ark-fit-media:calc(var(--ark-fit-h) - ${VISUAL_FIT_ROOM}px)}` +
  `:where(${FIT_MEDIA}){max-width:100%;max-height:var(--ark-fit-media);object-fit:contain}`;

/**
 * A cheap extra behind the shell's Trusted Types (`visual-frame.html`, the
 * real wall): WebRTC removed for good from the page's own realm (it escapes
 * the CSP), and a frame that still got into the page removed before its
 * document loads. Its originals are kept here: a page that patches them
 * later changes nothing.
 */
const VISUAL_GUARD = `var dp=Object.defineProperty,rmc=Node.prototype.removeChild,qsa=Element.prototype.querySelectorAll,mt=Element.prototype.matches,NEST="iframe,frame,frameset,object,embed,fencedframe,portal";
Object.getOwnPropertyNames(window).forEach(function(k){if(/^(webkit|moz)?RTC/.test(k)){try{dp(window,k,{value:undefined,writable:false,configurable:false});}catch(x){}}});
function cut(n){if(n.parentNode){rmc.call(n.parentNode,n);push(blocked,"<"+n.tagName.toLowerCase()+"> removed: no frame inside a visual");}}
function sweep(n){if(!n||n.nodeType!==1)return;if(mt.call(n,NEST)){cut(n);return;}var l=qsa.call(n,NEST);for(var i=0;i<l.length;i++)cut(l[i]);}
new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var a=ms[i].addedNodes;for(var j=0;j<a.length;j++)sweep(a[j]);}}).observe(document,{childList:true,subtree:true});`;

/**
 * The page's side of the frame, its first script: the guard above, then
 * catches errors, failed loads and `console.error`, says its height, sends
 * links and choices up (the Lab decides: a click only, `frameGestureOk`),
 * and answers the probe. Top-level (the copy opened in the browser) its
 * links stay plain links and `arkadia.choose` does nothing.
 */
export function visualBootstrap(token: string): string {
  return `(function(){
var me=document.currentScript;if(me&&me.parentNode)me.parentNode.removeChild(me);
var K=${JSON.stringify(token)},P=window.parent,framed=P!==window,errors=[],consoleErrors=[],blocked=[],loaded=false,last=-1;
function post(kind,v){if(framed)P.postMessage({arkadiaVisual:1,k:K,kind:kind,v:v},"*");}
function push(l,s){s=String(s).slice(0,300);if(l.length<20&&l.indexOf(s)<0)l.push(s);}
${VISUAL_GUARD}
window.addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&t.tagName){push(blocked,t.tagName.toLowerCase()+" "+String(t.currentSrc||t.src||t.href||"").slice(0,160));return;}push(errors,(e.message||"Error")+(e.lineno?" (line "+e.lineno+")":""));},true);
window.addEventListener("unhandledrejection",function(e){var r=e.reason;push(errors,"Unhandled rejection: "+(r&&r.message?r.message:r));});
document.addEventListener("securitypolicyviolation",function(e){if(e.effectiveDirective==="trusted-types")return;push(blocked,String(e.blockedURI||"inline").slice(0,160)+" (refused by the CSP: "+e.effectiveDirective+")");});
var ce=console.error;console.error=function(){try{push(consoleErrors,Array.prototype.map.call(arguments,function(a){return a&&a.message?a.message:typeof a==="object"?JSON.stringify(a):String(a);}).join(" "));}catch(x){}return ce.apply(console,arguments);};
function height(){var r=document.documentElement,b=Math.ceil(r.getBoundingClientRect().height);return r.scrollHeight>r.clientHeight?Math.max(r.scrollHeight,b):b;}
function size(){var h=height();if(h!==last){last=h;post("size",h);}}
function shows(el){var q=el.getBoundingClientRect();return q.width>1&&q.height>1;}
function visible(){var b=document.body;if(!b)return false;if((b.innerText||"").trim())return true;
var m=b.querySelectorAll("img,svg,canvas,video,picture,input,button,select,textarea");for(var i=0;i<m.length;i++)if(shows(m[i]))return true;
var all=b.querySelectorAll("*");for(var j=0;j<all.length&&j<3000;j++){var s=getComputedStyle(all[j]);if((s.backgroundColor!=="rgba(0, 0, 0, 0)"||s.backgroundImage!=="none"||parseFloat(s.borderTopWidth)>0)&&shows(all[j]))return true;}return false;}
function report(){var r=document.documentElement,im=document.images;for(var i=0;i<im.length;i++){var src=im[i].getAttribute("src");if(src&&im[i].complete&&im[i].naturalWidth===0)push(blocked,"img "+src.slice(0,160));}
return{errors:errors,consoleErrors:consoleErrors,blocked:blocked,height:height(),width:r.clientWidth,scrollWidth:r.scrollWidth,empty:!visible(),followsFrame:false,unfinished:!loaded};}
try{dp(window,"arkadia",{value:Object.freeze({choose:function(t){post("choose",String(t==null?"":t).slice(0,4000));}})});}catch(x){}
if(framed){
window.addEventListener("message",function(e){var d=e.data;if(e.source!==P||!d)return;if(d.arkadiaVisualProbe===1)post("report",report());
if(d.arkadiaVisualFit===1&&typeof d.height==="number"){if(isFinite(d.height))document.documentElement.style.setProperty("--ark-fit-h",Math.max(${VISUAL_MIN_ROOM},Math.round(d.height))+"px");}});
document.addEventListener("click",function(e){if(!e.isTrusted||e.defaultPrevented||e.button!==0)return;var a=e.target&&e.target.closest?e.target.closest("a[href]"):null,u;if(!a)return;
try{u=new URL(a.getAttribute("href"),document.baseURI);}catch(x){return;}if(u.href.split("#")[0]===location.href.split("#")[0])return;e.preventDefault();if(/^https?:$/.test(u.protocol))post("link",u.href);});
window.addEventListener("focus",function(){post("focus");});
function ov(n,y){var s=getComputedStyle(n);return y?s.overflowY:s.overflowX;}
function room(n,d,y){var r=document.documentElement,b=document.body;
if(n===r){if(/hidden|clip/.test(ov(r,y))||(b&&/hidden|clip/.test(ov(b,y))))return false;}else if(!/(auto|scroll)/.test(ov(n,y)))return false;
var p=y?n.scrollTop:n.scrollLeft,m=y?n.scrollHeight-n.clientHeight:n.scrollWidth-n.clientWidth;return m>1&&(d<0?p>0:p<m-1);}
function wheel(e){if(!e.isTrusted||e.defaultPrevented||e.ctrlKey)return;
var path=e.composedPath?e.composedPath():[e.target];for(var i=0;i<path.length;i++){var n=path[i];if(!n||n.nodeType!==1)continue;if((e.deltaY&&room(n,e.deltaY,true))||(e.deltaX&&room(n,e.deltaX,false)))return;}
e.preventDefault();post("wheel",{dx:e.deltaX,dy:e.deltaY,m:e.deltaMode});}
window.addEventListener("wheel",wheel,{passive:false});
window.addEventListener("load",function(){window.removeEventListener("wheel",wheel);window.addEventListener("wheel",wheel,{passive:false});});
window.addEventListener("pointerdown",function(e){if(e.isTrusted)post("down");},true);
var ro=window.ResizeObserver?new ResizeObserver(size):null;if(ro)ro.observe(document.documentElement);window.addEventListener("resize",size);
document.addEventListener("DOMContentLoaded",function(){if(ro&&document.body)ro.observe(document.body);size();});
window.addEventListener("load",function(){loaded=true;size();setTimeout(function(){post("loaded");},300);});}
})();`;
}

/** The bootstrap as a frame without a token gets it (the browser copy). */
export const VISUAL_BOOTSTRAP = visualBootstrap("");

/** `<\/script>` inside the bootstrap would end its tag early. */
const bootstrapTag = (token: string) =>
  `<script>${visualBootstrap(token).replace(/<\/script/gi, "<\\/script")}</script>`;

const head = (token: string, fit?: number) =>
  '<meta charset="utf-8">' +
  `<meta http-equiv="Content-Security-Policy" content="${VISUAL_PAGE_CSP}">` +
  // No DNS lookups ahead of links: a name looked up can carry data out.
  '<meta http-equiv="x-dns-prefetch-control" content="off">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<style id="arkadia-theme">${VISUAL_THEME_CSS}</style>` +
  // The room the card has at first; the bootstrap takes its changes.
  (usableRoom(fit) ? `<style id="arkadia-fit">:root{--ark-fit-h:${usableRoom(fit)}px}</style>` : "") +
  bootstrapTag(token);

/**
 * The page's markup as the shell's policy leaves it (`visual-frame.html`):
 * frame tags inert, declarative shadow roots plain templates. Also done
 * here so the copy opened in the browser holds no frame either.
 */
export const INERT_FRAME_TAGS = /<(\/?)(iframe|frame|frameset|object|embed|fencedframe|portal)\b/gi;
export const INERT_FRAME_TAG = "<$1x-blocked-$2";
export const INERT_SHADOW_ROOTS = /\bshadowroot(mode)?(\s*=)/gi;
export const INERT_SHADOW_ROOT = "data-shadowroot$1$2";

export function inertFrames(html: string): string {
  return html
    .replace(INERT_FRAME_TAGS, INERT_FRAME_TAG)
    .replace(INERT_SHADOW_ROOTS, INERT_SHADOW_ROOT);
}

/**
 * The document the frame gets: the CSP, the theme and the bootstrap before
 * anything of the page (just after its doctype, which keeps it out of quirks
 * mode). The parser opens the head for them, the page's own `<html>` and
 * `<head>` merge in, so nothing of the page runs or styles before them.
 */
export function visualDocument(html: string, token = "", fit?: number): string {
  const page = inertFrames(html);
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(page);
  if (doctype) {
    const at = doctype[0].length;
    return `${page.slice(0, at)}${head(token, fit)}${page.slice(at)}`;
  }
  return `<!doctype html>${head(token, fit)}${page}`;
}

/**
 * The card's frame is the page's height (scaled, `visualFit`), never a
 * scrollbar inside; this only stops a page that grows without end.
 */
export const VISUAL_MAX_HEIGHT = 12_000;
export const VISUAL_MIN_HEIGHT = 48;

export function clampVisualHeight(height: number): number {
  if (!Number.isFinite(height)) return VISUAL_MIN_HEIGHT;
  return Math.min(
    VISUAL_MAX_HEIGHT,
    Math.max(VISUAL_MIN_HEIGHT, Math.ceil(height)),
  );
}

/**
 * The probe's two reports in one: the first at the frame's usual height,
 * the second taller (`growth` px more). The width and how wide the page
 * draws both come from the tall one, never one from each: a page under the
 * tall height has no scrollbar narrowing it there, as in its card. Lists
 * come from the tall one too (later, so complete), the height from the
 * first; it follows the frame when it grew about as much.
 */
export function mergeProbeReports(
  first: VisualReport,
  tall: VisualReport | null,
  growth: number,
): VisualReport {
  if (!tall) return first;
  return {
    ...tall,
    height: first.height,
    followsFrame: tall.height - first.height >= 0.8 * growth,
  };
}

/**
 * How the card shows a page `content` px tall in `room` px (the pane's
 * height less the card's band): whole if it fits, else scaled down to fit,
 * but never under `VISUAL_FIT_FLOOR` (smaller no longer reads well): past
 * that, at the floor, and the conversation scrolls. `height`: the card's.
 */
export function visualFit(
  content: number,
  room: number | null,
): { scale: number; height: number } {
  const usable = usableRoom(room);
  if (usable === null || content <= usable) return { scale: 1, height: content };
  const scale = Math.max(VISUAL_FIT_FLOOR, usable / content);
  return { scale, height: Math.ceil(content * scale) };
}

/** A frame's height as the page's reports move it (`nextFrameHeight`). */
export interface FrameGrowth {
  height: number;
  /** The last growth, and how many times in a row it came back the same. */
  step: number;
  streak: number;
  /** The page grows with its frame (`min-height: 100vh`): no more growth. */
  frozen: boolean;
  /** The last height held back while frozen: shown when the stop lifts. */
  ignored: number | null;
}

/**
 * A growth this small, the same three times in a row, each right after the
 * Lab set the frame's height, follows the frame.
 */
const FOLLOW_STEP = 64;
const FOLLOW_STREAK = 3;
/** « Right after »: the frame's resize and the page's answer, a round trip. */
const FOLLOW_MS = 120;

export const firstFrameGrowth = (height: number): FrameGrowth => ({
  height,
  step: 0,
  streak: 0,
  frozen: false,
  ignored: null,
});

/**
 * The frame's next height from the page's report. A page whose height
 * follows its frame (vh, height:100% on html or body) answers each height
 * the Lab gives the frame with that height plus its gutter: left alone it
 * would grow without end. The same small growth three times in a row, each
 * within `FOLLOW_MS` of the Lab resizing the frame (`sinceFrameResize`),
 * stops the growth (the height held back is kept, `ignored`); a page that
 * shrinks still does. Only a page the probe didn't check clean can stop
 * (`mayFreeze`: unverified, or shown anyway after its check failed): one
 * checked clean never follows its frame, whatever pace it grows at.
 */
export function nextFrameHeight(
  prev: FrameGrowth,
  reported: number,
  sinceFrameResize: number | null,
  mayFreeze: boolean,
): FrameGrowth {
  const delta = reported - prev.height;
  if (delta <= 0) return { ...prev, height: reported, step: 0, streak: 0, ignored: null };
  if (prev.frozen) return { ...prev, ignored: reported };
  const follows =
    mayFreeze &&
    delta <= FOLLOW_STEP &&
    sinceFrameResize !== null &&
    sinceFrameResize <= FOLLOW_MS;
  const streak = !follows ? 0 : Math.abs(delta - prev.step) <= 1 ? prev.streak + 1 : 1;
  return {
    height: reported,
    step: delta,
    streak,
    frozen: streak >= FOLLOW_STREAK,
    ignored: null,
  };
}

/**
 * The Lab changed the page's layout itself (a new room, the pane's width):
 * the growths that follow are its doing, never a page following its frame.
 * The count starts again and a stop is lifted.
 */
export function refitFrameGrowth(prev: FrameGrowth): FrameGrowth {
  if (prev.streak === 0 && !prev.frozen) return prev;
  return {
    height: prev.ignored ?? prev.height,
    step: 0,
    streak: 0,
    frozen: false,
    ignored: null,
  };
}

/** The probe checked the page clean: its height never follows its frame. */
export function visualVerified(tool: ToolItem): boolean {
  const result = tool.result;
  return !!result && !result.isError && result.text.startsWith(VISUAL_CHECKED_CLEAN);
}

/** What a visual's frame says to the Lab. */
export type FrameMessage =
  /** The shell is up: the page goes in (said before the page exists). */
  | { kind: "shell" }
  | { kind: "loaded" }
  /** Its window got the focus: the Lab checks it was the user's click. */
  | { kind: "focus" }
  /** The user pressed in it (a trusted `pointerdown`). */
  | { kind: "down" }
  | { kind: "size"; height: number }
  | { kind: "link"; url: string }
  | { kind: "choose"; text: string }
  /** A wheel the page doesn't use: the conversation scrolls by it. */
  | { kind: "wheel"; dx: number; dy: number; mode: number }
  | { kind: "report"; report: unknown };

/** A wheel delta as a frame may send it: a number, bounded. */
const delta = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(-4000, Math.min(4000, v))
    : null;

/**
 * A frame's message, its fields checked; null for anything else. Past the
 * shell's own, a message counts only with the frame's token, which only the
 * bootstrap holds (its script removes itself before the page runs): a page
 * can't say « down » for a press it never got.
 */
export function readFrameMessage(data: unknown, token: string): FrameMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.arkadiaVisual !== 1) return null;
  if (d.kind === "shell") return { kind: "shell" };
  if (!token || d.k !== token) return null;
  const v = d.v;
  switch (d.kind) {
    case "loaded":
    case "focus":
    case "down":
      return { kind: d.kind };
    case "size":
      return typeof v === "number" && Number.isFinite(v) ? { kind: "size", height: v } : null;
    case "link":
      return typeof v === "string" && /^https?:\/\//i.test(v)
        ? { kind: "link", url: v.slice(0, 4000) }
        : null;
    case "choose":
      return typeof v === "string" && v.trim()
        ? { kind: "choose", text: v.trim().slice(0, 4000) }
        : null;
    case "report":
      return { kind: "report", report: v };
    case "wheel": {
      const w = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      const dx = delta(w.dx);
      const dy = delta(w.dy);
      const mode = w.m === 1 || w.m === 2 ? w.m : 0;
      return dx === null || dy === null ? null : { kind: "wheel", dx, dy, mode };
    }
    default:
      return null;
  }
}

/** Chromium's transient activation lasts this long. */
export const ACTIVATION_MS = 5_000;

/**
 * May a frame keep the focus it took? Only on the user's click in it: a
 * fresh user activation (a click in a frame activates its ancestors) with
 * the pointer in that frame, not another. Then always, even just after
 * typing in the Lab: the user's next keys are for what they clicked.
 */
export function frameFocusOk(o: { activation: boolean; onFrame: boolean }): boolean {
  return o.activation && o.onFrame;
}

/**
 * May a frame's link or choice act? Only on the user's click in that frame
 * (`frameFocusOk`, the frame holding the focus), and nothing in the Lab
 * itself clicked or typed within the activation's life, else the
 * activation could be that and the frame merely claiming it (T3 Code's rule).
 */
export function frameGestureOk(o: {
  activation: boolean;
  frameFocused: boolean;
  /** The pointer is in this frame (the Lab saw it enter, not leave). */
  onFrame: boolean;
  /** Since the last pointer or key event in the Lab's own document. */
  sinceHostInput: number;
}): boolean {
  return frameFocusOk(o) && o.frameFocused && o.sinceHostInput > ACTIVATION_MS;
}

/**
 * A choice into the input: in place of an empty draft or of the choice put
 * there before (a second click changes the pick), else on a line after what
 * the user wrote.
 */
export function withChoice(
  draft: string,
  choice: string,
  previous: string | null,
): string {
  const text = draft.trimEnd();
  if (!text || text === previous) return choice;
  if (previous && text.endsWith(`\n${previous}`))
    return `${text.slice(0, -previous.length)}${choice}`;
  return `${text}\n${choice}`;
}

/** A `show_visual` call's arguments, as far as they are there yet. */
export interface VisualInput {
  html: string;
  title: string;
  wide: boolean;
}

export function isVisualTool(name: string): boolean {
  return name === VISUAL_TOOL_NAME;
}

export function visualInput(tool: ToolItem): VisualInput {
  const { html, title, wide } = tool.input;
  return {
    html: typeof html === "string" ? html : "",
    title: typeof title === "string" && title.trim() ? title.trim() : "Visuel",
    wide: wide === true,
  };
}

/**
 * The card's state: checked by the Lab (its result came back fine, or
 * unverified), still being checked, or found broken (an error result: the
 * column keeps it folded, Claude sends a fixed one). A past call without a
 * result (`stale`) shows as it is.
 */
export type VisualPhase = "checking" | "shown" | "broken";

export function visualPhase(tool: ToolItem): VisualPhase {
  if (tool.result) return tool.result.isError ? "broken" : "shown";
  return tool.stale ? "shown" : "checking";
}

/** What the Lab knows of a visual beyond its call (`ChatState.visuals`). */
export interface VisualEntry {
  /** The page with its images in; null: none kept, the call's input is it. */
  html: string | null;
  /** The page's check under way (`visual_check` … `visual_checked`). */
  checking: boolean;
  /** A copy with its images in was kept: until it comes, ask for it. */
  stored?: boolean;
}

/**
 * The page to show: the one with its images in when known, the call's own
 * once none was kept; undefined while that is not known yet (a past call:
 * ask the server, `visual_html`).
 */
export function visualHtml(
  tool: ToolItem,
  entry: VisualEntry | undefined,
): string | undefined {
  if (entry?.html) return entry.html;
  if (!entry || entry.stored) return undefined;
  return visualInput(tool).html;
}

/** The first problem a broken visual's result names, for its folded line. */
export function visualProblem(tool: ToolItem): string {
  const text = tool.result?.text ?? "";
  const line = text.split("\n").find((l) => l.startsWith("- "));
  return (line ? line.slice(2) : (text.split("\n")[0] ?? "")).slice(0, 200);
}
