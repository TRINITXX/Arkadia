// Styling for the modern conversation view, on top of `CONVERSATION_CSS`
// (typography). Ligatures off in tool bodies so code reads literally (`=>`
// stays `=>`, not `⇒`).
export const MODERN_CSS = `
.modern-msg { position: relative; padding: 7px 12px 8px; border: 1px solid; border-left-width: 2px; border-radius: 10px; }
.modern-msg-head { display: flex; align-items: center; gap: 6px; min-height: 18px; }
.modern-msg-head .role-ico { display: flex; flex-shrink: 0; }
.modern-msg-head .role-lbl { font-size: 10.5px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; }
.modern-msg-body { margin-top: 4px; }

.modern-tool { border: 1px solid rgba(56,189,248,0.35); border-radius: 9px; overflow: hidden; background: rgba(56,189,248,0.04); }
.modern-tool-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-family: ui-monospace, "JetBrains Mono", monospace; font-variant-ligatures: none; font-size: 12px; cursor: pointer; user-select: none; }
.modern-tool-head .ico { display: flex; color: #38bdf8; flex-shrink: 0; }
.modern-tool-head .name { color: #7dd3fc; font-weight: 600; }
.modern-tool-head .arg { color: #c9c9d2; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modern-tool-head .stat { color: #8a9099; font-size: 10.5px; flex-shrink: 0; }
.modern-tool-head .chev { display: flex; margin-left: auto; color: #6f6f78; flex-shrink: 0; transition: transform .14s ease-out; }
.modern-tool-head .chev.open { transform: rotate(90deg); }
/* Expand/collapse without JS measurement: grid rows 0fr -> 1fr animates to auto
   height. Deliberately layout-animating (§perf) — kept very short (140ms) and
   the body is text capped at 6k chars, so the cost is bounded. */
.modern-tool-bodywrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .14s ease-out; }
.modern-tool-bodywrap.open { grid-template-rows: 1fr; }
.modern-tool-bodywrap > .modern-tool-body { min-height: 0; overflow: hidden; }
.modern-tool-body { border-top: 1px solid rgba(56,189,248,0.18); padding: 8px 10px; font-family: ui-monospace, "JetBrains Mono", monospace; font-variant-ligatures: none; font-size: 11.5px; line-height: 1.55; background: rgba(0,0,0,0.25); overflow-x: auto; }
.modern-tool-body pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
.modern-code { margin: 0; white-space: pre-wrap; word-break: break-word; color: #c9c9d2; }
.modern-code .p { color: #7ee787; }
.modern-diff .dl, .modern-diff .al { white-space: pre-wrap; word-break: break-word; padding: 0 3px; border-radius: 2px; }
.modern-diff .dl { color: #fca5a5; background: rgba(248,113,113,0.10); }
.modern-diff .al { color: #86efac; background: rgba(134,239,172,0.10); }
.modern-diff .cl { color: #6b7280; white-space: pre-wrap; word-break: break-word; padding: 0 3px; }
.modern-params { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.modern-params .k { color: #7dd3fc; }
.modern-params .v { color: #c9c9d2; white-space: pre-wrap; word-break: break-word; }
.modern-tool-out { border-top: 1px solid rgba(255,255,255,0.08); }
.modern-tool-out .lbl { display: block; color: #6f6f78; font-size: 9px; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 4px; }
.modern-empty { display: flex; flex: 1; align-items: center; justify-content: center; padding: 0 1.5rem; text-align: center; font-size: 12px; color: #6b6b72; }
.modern-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
.modern-scroll::-webkit-scrollbar-track { background: transparent; }
.modern-scroll::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.14); border: 3px solid transparent; border-radius: 8px; background-clip: padding-box; }
.modern-scroll::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.26); }

/* Working indicator: conic ring spinner (linear — it's a spinner) + subtle
   gradient hairline on top. */
.modern-working { position: relative; flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 7px 14px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: #c9c9d2; }
.modern-working::before { content: ""; position: absolute; top: -1px; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(56,189,248,.35), transparent); }
.modern-working .spin { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; background: conic-gradient(from 0deg, transparent 40%, #38bdf8); -webkit-mask: radial-gradient(farthest-side, transparent 55%, #000 60%); mask: radial-gradient(farthest-side, transparent 55%, #000 60%); animation: modern-spin .9s linear infinite; }
.modern-working .tool-ico { display: flex; color: #38bdf8; }
.modern-working.waiting::before { background: linear-gradient(90deg, transparent, rgba(245,179,1,.35), transparent); }
.modern-working.waiting .dot { width: 8px; height: 8px; border-radius: 50%; background: #f5b301; flex-shrink: 0; }
@keyframes modern-spin { to { transform: rotate(360deg); } }

.modern-msg .modern-copy { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-left: auto; border-radius: 6px; color: #8a8a93; opacity: 0; transition: opacity .12s; cursor: pointer; flex-shrink: 0; }
.modern-msg:hover .modern-copy { opacity: 1; }
.modern-msg .modern-copy:hover { color: #e8e8ee; background: rgba(255,255,255,0.08); }
/* Fenced code blocks get their own copy button, bottom-right. The wrapper (not
   the <pre>) is the positioning context so the button doesn't ride along when
   the code scrolls horizontally. */
.modern-codeblock { position: relative; margin: 0 0 10px; }
.modern-codeblock pre { margin: 0; }
.modern-code-copy { position: absolute; bottom: 6px; right: 6px; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; color: #8a8a93; background: rgba(20,20,24,0.88); border: 1px solid rgba(255,255,255,0.1); opacity: 0; transition: opacity .12s; cursor: pointer; }
.modern-codeblock:hover .modern-code-copy { opacity: 1; }
.modern-code-copy:hover { color: #e8e8ee; background: rgba(0,0,0,0.6); }
.modern-code-copy.copied { opacity: 1; color: #86efac; border-color: rgba(134,239,172,0.4); }

/* Off-screen blocks skip layout/paint entirely (their height is estimated),
   so a huge conversation costs only what's visible. */
.modern-block { content-visibility: auto; contain-intrinsic-size: auto 90px; }
.modern-match { outline: 1.5px solid rgba(250,204,21,0.4); outline-offset: -1px; }
.modern-match-current { outline: 2px solid #facc15; outline-offset: -1px; }
.modern-search { position: absolute; top: 8px; left: 8px; right: 44px; z-index: 25; display: flex; align-items: center; gap: 3px; padding: 4px 6px; border-radius: 9px; background: #16161a; border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 6px 20px rgba(0,0,0,.5); }
.modern-search input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: #e8e8ee; font-size: 12.5px; }
.modern-search .count { font-size: 11px; color: #8a8a93; padding: 0 4px; white-space: nowrap; }
.modern-search button { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 5px; color: #a6a6ae; flex-shrink: 0; }
.modern-search button:hover { background: rgba(255,255,255,0.08); color: #e8e8ee; }

/* Image thumbnails: fixed-height placeholder so pinned-to-bottom autoscroll
   doesn't jump when the real image lands. */
.modern-thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.modern-thumb { max-height: 240px; max-width: 100%; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); cursor: zoom-in; display: block; }
.modern-thumb-ph { display: flex; align-items: center; justify-content: center; width: 160px; height: 120px; border: 1px dashed rgba(255,255,255,0.16); border-radius: 8px; color: #6f6f78; }

/* Lightbox (images + mermaid SVG zoom). */
.modern-lightbox { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); cursor: zoom-out; animation: modern-fade .16s ease-out both; }
.modern-lightbox img { max-width: 92vw; max-height: 92vh; border-radius: 10px; box-shadow: 0 12px 48px rgba(0,0,0,.6); animation: modern-pop .18s cubic-bezier(0.23, 1, 0.32, 1) both; }
.modern-lightbox .svgbox { max-width: 92vw; max-height: 92vh; overflow: auto; background: #16161a; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 18px; animation: modern-pop .18s cubic-bezier(0.23, 1, 0.32, 1) both; }
.modern-lightbox .svgbox svg { max-width: none; }
@keyframes modern-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes modern-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }

/* Entrance for blocks appended live (never on initial load). transform +
   opacity only. */
@keyframes modern-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.modern-enter { animation: modern-enter .18s cubic-bezier(0.23, 1, 0.32, 1) both; }

/* Mermaid diagrams: bounded height in the thread, click to zoom. */
.modern-mermaid { max-height: 320px; overflow: hidden; cursor: zoom-in; margin: 0 0 10px; padding: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; display: flex; justify-content: center; }
.modern-mermaid svg { max-width: 100%; height: auto; }
.modern-mermaid-err { font-size: 10.5px; color: #8a9099; font-style: italic; margin: -6px 0 10px; }

/* Clickable file paths: inline-code look, link affordance on hover. */
.modern-path { cursor: pointer; }
.modern-path:hover { color: #7dd3fc; text-decoration: underline; text-underline-offset: 2px; }
.modern-path .ext-ico { display: inline-flex; margin-left: 3px; vertical-align: -1px; opacity: 0.7; }

@media (prefers-reduced-motion: reduce) {
  .modern-enter, .modern-lightbox, .modern-lightbox img, .modern-lightbox .svgbox { animation-duration: .01ms; }
  .modern-tool-bodywrap, .modern-tool-head .chev { transition: none; }
  .modern-working .spin { animation-duration: 2s; }
}
`;

// Hand-rolled highlight.js theme aligned with the house palette (CLAUDE_TINT
// purple family for keywords, USER_TINT green family for strings) instead of
// importing a stock theme wholesale.
export const HLJS_CSS = `
.reading-md pre code.hljs { background: none; padding: 0; }
.hljs { color: #c9c9d2; }
.hljs-keyword, .hljs-literal, .hljs-selector-tag, .hljs-type { color: #c084fc; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #86efac; }
.hljs-title, .hljs-title.function_, .hljs-title.class_, .hljs-section { color: #7dd3fc; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id { color: #93c5fd; }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-link, .hljs-meta { color: #fbbf24; }
.hljs-comment, .hljs-quote, .hljs-deletion { color: #6b7280; font-style: italic; }
.hljs-doctag, .hljs-formula, .hljs-name { color: #f0abfc; }
.hljs-built_in, .hljs-builtin-name { color: #5eead4; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 650; }
`;
