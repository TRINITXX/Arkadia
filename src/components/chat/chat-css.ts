import serifItalic from "@/components/chat/fonts/instrument-serif-italic.woff2?url";
import serifRegular from "@/components/chat/fonts/instrument-serif-regular.woff2?url";
import { CHAT_TOKENS as T } from "@/lib/chat/chatTheme";

/**
 * The chat view's look ("Colonne calme", mockup A of 30/10/2026): a centred
 * column on the terminal's grey (#181a1d), the user's words in a bubble, Claude's without, tool
 * runs folded into one quiet line, one accent (terracotta). Scoped under
 * `.chat-root`.
 */
export const CHAT_CSS = `
@font-face { font-family: "Instrument Serif"; font-style: normal; font-weight: 400; font-display: swap; src: url(${serifRegular}) format("woff2"); }
@font-face { font-family: "Instrument Serif"; font-style: italic; font-weight: 400; font-display: swap; src: url(${serifItalic}) format("woff2"); }

.chat-root { --chat-bg: ${T.bg}; --chat-ink: ${T.ink}; --chat-dim: ${T.dim}; --chat-mute: ${T.mute}; --chat-line: ${T.line}; --chat-card: ${T.card}; --chat-accent: ${T.accent}; --chat-accent-ink: ${T.accentInk};
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: stretch; background: var(--chat-bg); color: var(--chat-ink);
  font-family: "Segoe UI", system-ui, sans-serif; font-size: 14.5px; line-height: 1.6; }
.chat-root *, .chat-root *::before, .chat-root *::after { box-sizing: border-box; }
.chat-col { width: min(760px, 100% - 48px); margin: 0 auto; }

.chat-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #31353b transparent; scrollbar-gutter: stable; isolation: isolate; }
.chat-scroll-inner { display: flex; flex-direction: column; gap: 14px; padding: 28px 0 42px; }
.chat-unit { content-visibility: auto; contain-intrinsic-size: auto 60px; }

.chat-title { font-family: "Instrument Serif", Georgia, serif; font-size: 34px; line-height: 1.1; color: #f4f4f5; letter-spacing: -0.005em; overflow-wrap: anywhere; }
.chat-title em { color: var(--chat-accent); font-style: italic; }
.chat-meta { font-size: 12px; color: var(--chat-mute); margin-top: -8px; }
.chat-older { font-size: 12px; color: var(--chat-mute); text-align: center; padding: 4px 0; }

.chat-user { align-self: flex-end; max-width: min(560px, 85%); background: #2b2f35; border-radius: 18px 18px 6px 18px; padding: 9px 15px; color: var(--chat-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-user .imgs { display: block; font-size: 12px; color: var(--chat-mute); margin-bottom: 2px; }
.chat-text .reading-md { font-size: 14.5px; line-height: 1.65; color: var(--chat-ink); }
/* Tailwind's reset drops list markers: lists keep their bullets and numbers. */
.chat-root .reading-md ul { list-style: disc; }
.chat-root .reading-md ol { list-style: decimal; }
.chat-text.streaming .reading-md > *:last-child::after { content: ""; display: inline-block; width: 7px; height: 15px; margin-left: 3px; vertical-align: -2px; border-radius: 2px; background: var(--chat-accent); animation: chat-blink 1s steps(2) infinite; }
@keyframes chat-blink { 50% { opacity: 0; } }
.chat-notice { align-self: center; font-size: 12px; color: var(--chat-mute); padding: 2px 10px; border-radius: 999px; border: 1px solid var(--chat-line); }
.chat-notice.error { color: #fca5a5; border-color: rgba(248,113,113,.3); }

.chat-line { display: flex; align-items: center; gap: 8px; color: var(--chat-mute); font-size: 13px; cursor: pointer; user-select: none; width: fit-content; max-width: 100%; border-radius: 8px; padding: 2px 6px 2px 2px; margin-left: -2px; }
.chat-line:hover { color: var(--chat-dim); background: #202327; }
.chat-line.static { cursor: default; }
.chat-line.static:hover { color: var(--chat-mute); background: transparent; }
.chat-line b { color: var(--chat-dim); font-weight: 500; }
.chat-line .lucide { width: 15px; height: 15px; flex-shrink: 0; }
.chat-line .chev { transition: transform .14s ease-out; }
.chat-line .chev.open { transform: rotate(90deg); }
.chat-line .spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; flex-shrink: 0; }
@keyframes chat-spin { to { transform: rotate(360deg); } }
/* Claude's work between two messages on one line: an icon and a number per kind (ChatActivityLine). */
.chat-counts { display: inline-flex; align-items: center; gap: 10px; }
.chat-counts .n { display: inline-flex; align-items: center; gap: 3px; color: var(--chat-dim); font-variant-numeric: tabular-nums; }
.chat-line .chat-counts .lucide { width: 14px; height: 14px; }
/* « Récit » (the user's picks of 02/11/2026): Claude's latest thought in full while it works, plain, under its last sentence (ChatLiveThought)… */
.chat-live-thought { display: flex; gap: 8px; margin-left: 20px; padding: 2px 0 2px 12px; border-left: 2px solid #3a3d44; font-size: 13px; line-height: 1.55; color: #a9adbd; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-live-thought .lucide { width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0; color: #c9a85a; }
.chat-live-thought p { margin: 0; min-width: 0; }
/* …the rest behind small icons on its replies: a bulb, a wrench (ChatHoverCard). The card goes to the page's top layer, out of .chat-root: it brings the column's colours. */
.chat-peeks { display: inline-flex; align-items: center; gap: 2px; align-self: flex-end; flex-shrink: 0; }
.chat-peek { position: relative; display: inline-grid; place-items: center; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #6f727a; cursor: pointer; flex-shrink: 0; }
.chat-peek:hover, .chat-peek.on { background: #25282c; color: #e2c26b; }
.chat-peek .lucide { width: 14px; height: 14px; }
.chat-peek-alone { padding: 0 2px; }
.chat-peek-card { --chat-bg: ${T.bg}; --chat-ink: ${T.ink}; --chat-dim: ${T.dim}; --chat-mute: ${T.mute}; --chat-line: ${T.line}; --chat-card: ${T.card}; --chat-accent: ${T.accent}; --chat-accent-ink: ${T.accentInk};
  position: fixed; z-index: 35; box-sizing: border-box; overflow: hidden; background: ${T.raised}; border: 1px solid ${T.lineStrong}; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 10px 12px;
  font: 12.5px/1.55 "Segoe UI", system-ui, sans-serif; color: #c4c4cb; text-align: left; pointer-events: none; }
.chat-peek-card *, .chat-peek-card *::before, .chat-peek-card *::after { box-sizing: border-box; }
.chat-peek-card.cut { -webkit-mask-image: linear-gradient(#000 78%, transparent); mask-image: linear-gradient(#000 78%, transparent); }
/* Clicked: it stays, scrolls and takes clicks. */
.chat-peek-card.pinned { overflow-y: auto; pointer-events: auto; scrollbar-width: thin; scrollbar-color: #3a3e45 transparent; }
.chat-peek-thoughts { white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-peek-thoughts p { margin: 0; }
.chat-peek-thoughts p + p { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2b2e33; }
.chat-peek-tools { display: flex; flex-direction: column; gap: 6px; }
.chat-activity-detail { display: flex; flex-direction: column; gap: 10px; margin: 6px 0 0 7px; padding-left: 14px; border-left: 1px solid var(--chat-line); }
/* The question sheet unfolded: the input hides, the sheet takes the bottom (the user's ask of 01/11/2026); folded, the input comes back. */
.chat-bottom.sheet-open .chat-col > .chat-box:not(.ask) { display: none; }
/* The sheet unfolded gives way to what stacks under it (the agents' pills, an open workflow card): the bottom fits the pane, and the sheet alone shrinks, then scrolls (02/11/2026). */
.chat-bottom.sheet-open { flex-shrink: 1; min-height: 0; }
/* The bottom rises 24px over the conversation: kept that tall, its top never passes the pane's. */
.chat-root:has(> .chat-bottom.sheet-open) > .chat-scroll { min-height: 32px; }
.chat-bottom.sheet-open > .chat-col { display: flex; flex-direction: column; min-height: 0; }
.chat-bottom.sheet-open > .chat-col > * { flex-shrink: 0; }
.chat-bottom.sheet-open > .chat-col > .chat-sheet-q { flex-shrink: 1; min-height: 120px; }
.chat-tools { display: flex; flex-direction: column; gap: 2px; margin: 4px 0 0 7px; padding-left: 14px; border-left: 1px solid var(--chat-line); }
.chat-tool .row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--chat-dim); cursor: pointer; padding: 2px 4px; border-radius: 6px; min-width: 0; }
.chat-tool .row:hover { background: #202327; }
.chat-tool .row .name { color: #d4d4d8; flex-shrink: 0; }
.chat-tool .row .arg { color: var(--chat-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; }
.chat-tool .row .err { color: #f87171; flex-shrink: 0; }
.chat-tool .out { margin: 4px 0 6px 22px; max-height: 260px; overflow: auto; border: 1px solid var(--chat-line); border-radius: 8px; background: var(--chat-card); padding: 8px 10px; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; line-height: 1.55; color: var(--chat-dim); white-space: pre-wrap; overflow-wrap: anywhere; }

.chat-card { border: 1px solid var(--chat-line); border-radius: 12px; background: var(--chat-card); overflow: hidden; }
.chat-card .head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12.5px; color: #d4d4d8; cursor: pointer; user-select: none; min-width: 0; }
.chat-card .head .path { font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chat-card .head .add { color: #4ade80; flex-shrink: 0; }
.chat-card .head .del { color: #f87171; flex-shrink: 0; }
.chat-card .head .tail { margin-left: auto; color: var(--chat-mute); flex-shrink: 0; display: flex; }
.chat-card .head .lucide { width: 15px; height: 15px; flex-shrink: 0; }
.chat-diff { margin: 0; padding: 8px 0; border-top: 1px solid #26292e; max-height: 340px; overflow: auto; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; line-height: 1.6; }
.chat-diff div { padding: 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--chat-dim); }
.chat-diff .p { color: #86efac; background: rgba(34,197,94,.07); }
.chat-diff .m { color: #fca5a5; background: rgba(239,68,68,.07); }
.chat-diff .more { color: var(--chat-mute); font-style: italic; }
.chat-card .body { border-top: 1px solid #26292e; padding: 10px 14px; }
.chat-card .body .reading-md { font-size: 13.5px; }
.chat-card .body.clamp { max-height: 220px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
/* Claude's visuals (\`show_visual\`): a band over its sandboxed page. Wide: the pane's width less a 16px gutter. */
.chat-visual { border: 1px solid var(--chat-line); border-radius: 12px; background: var(--chat-bg); overflow: hidden; container-type: inline-size; }
.chat-visual.wide { width: max(100%, calc(var(--chat-lane, 0px) - 32px)); margin-left: calc((100% - max(100%, calc(var(--chat-lane, 0px) - 32px))) / 2); }
.chat-visual-head { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 5px 6px 5px 12px; font-size: 12.5px; color: #d4d4d8; background: var(--chat-card); border-bottom: 1px solid #26292e; min-width: 0; }
.chat-visual-head > .lucide { width: 15px; height: 15px; flex-shrink: 0; color: var(--chat-accent); }
.chat-visual-head .t { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chat-visual-head .tail { margin-left: auto; display: flex; gap: 2px; flex-shrink: 0; }
.chat-visual-head .spin { width: 13px; height: 13px; margin-left: auto; margin-right: 6px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; flex-shrink: 0; }
.chat-visual-btn { display: inline-flex; align-items: center; gap: 6px; height: 27px; padding: 0 9px; border-radius: 8px; border: 0; background: transparent; color: var(--chat-dim); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.chat-visual-btn:hover { background: #25282c; color: var(--chat-ink); }
.chat-visual-btn .lucide { width: 14px; height: 14px; flex-shrink: 0; }
@container (max-width: 460px) { .chat-visual-btn .lbl { display: none; } }
.chat-visual-box iframe { display: block; width: 100%; height: 100%; border: 0; background: var(--chat-bg); color-scheme: dark; }
/* « Replier » under the page too (the user's ask of 01/11/2026). */
.chat-visual-foot { display: flex; justify-content: flex-end; padding: 2px 6px; background: var(--chat-card); border-top: 1px solid #26292e; }
.chat-visual-wait { display: flex; align-items: center; height: 120px; padding: 0 16px; color: var(--chat-mute); font-size: 12.5px; }
.chat-visual-broken { cursor: default; }
.chat-visual-broken:hover { background: transparent; color: var(--chat-mute); }
.chat-visual-broken > .lucide { color: #fcd34d; }
.chat-visual-broken .why { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chat-visual-zoom { position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column; background: var(--chat-bg); }
.chat-visual-zoom-body { flex: 1; min-height: 0; }
.chat-visual-zoom-body .chat-visual-box { height: 100%; }
.chat-qa { display: flex; flex-direction: column; gap: 2px; }
.chat-qa .q { color: var(--chat-dim); font-size: 13px; }
.chat-qa .a { color: var(--chat-ink); }

/* The bottom rises 24px over the scroll area (whose end pads as much): the messages pass behind the input and vanish under it, its corners on them (the user's ask of 31/10/2026). Above a live line or a card, they fade out. */
.chat-bottom { flex-shrink: 0; display: flex; flex-direction: column; align-items: stretch; padding: 0 0 12px; margin-top: -24px; position: relative; z-index: 1; pointer-events: none; background: linear-gradient(transparent, var(--chat-bg) 14px); }
.chat-bottom > * { pointer-events: auto; }
.chat-bottom:has(> .chat-col > div.chat-box:first-of-type) { background: none; }
/* One pixel past the column on each side: the frames' side borders hide behind it. */
.chat-bottom .chat-box { margin-inline: -1px; }
.chat-live { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--chat-dim); padding: 8px 2px; min-height: 36px; }
.chat-live .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; }
.chat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: #202327; border: 1px solid #31353b; color: #d4d4d8; font-size: 12px; line-height: 1.4; cursor: pointer; user-select: none; white-space: nowrap; }
.chat-chip:hover { border-color: #464a51; }
.chat-chip.static { cursor: default; }
.chat-chip .lucide { width: 13px; height: 13px; }
.chat-chip.warn { color: #fcd34d; border-color: rgba(252,211,77,.25); }

.chat-box { position: relative; border-radius: 20px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); padding: 12px 12px 8px; }
.chat-box.ask { border-color: #5a3a2c; }
.chat-box textarea { width: 100%; resize: none; border: 0; outline: none; background: transparent; color: var(--chat-ink); font: inherit; line-height: 1.55; padding: 2px 6px; max-height: 40vh; min-height: 26px; }
.chat-box textarea::placeholder { color: #6b6f76; }
/* A long paste's tag: a twin of the input lies behind its transparent text and draws the tag as a chip; hovered, its text, editable (ChatPasteTags). */
.chat-box > textarea { position: relative; z-index: 1; }
/* The input's hidden twin that measures the text and the words dictated in place. */
.chat-box > textarea.chat-measure { position: absolute; left: 0; top: 0; z-index: -1; height: 0; min-height: 0; overflow: hidden; visibility: hidden; pointer-events: none; }
/* The task list open: the gap up to it belongs to its dots. */
.chat-live .chat-anchor:has(> .chat-tasks)::before { content: ""; position: absolute; left: -6px; right: -6px; bottom: 100%; height: 10px; }
.chat-paste-twin { position: absolute; z-index: 0; box-sizing: border-box; border-style: solid; border-color: transparent; overflow: hidden; white-space: pre-wrap; overflow-wrap: break-word; color: transparent; pointer-events: none; }
.chat-paste-twin mark { color: transparent; background: #3a2519; border-radius: 5px; box-shadow: 0 0 0 1px #5a3a2c; }
.chat-paste-hover { position: absolute; z-index: 7; width: min(440px, calc(100% - 16px)); background: #202327; border: 1px solid #31353b; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 8px; }
.chat-box .chat-paste-hover textarea { display: block; width: 100%; min-height: 84px; max-height: 240px; resize: vertical; border: 1px solid #5a3a2c; border-radius: 8px; background: #141619; color: var(--chat-ink); font: inherit; font-size: 12.5px; line-height: 1.5; padding: 7px 9px; outline: none; }
.chat-paste-hover .ft { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 12px; color: var(--chat-mute); }
.chat-paste-hover .ft button { margin-left: auto; border: 1px solid #31353b; border-radius: 7px; background: transparent; color: #d4d4d8; font: inherit; font-size: 12px; padding: 2px 9px; cursor: pointer; }
.chat-paste-hover .ft button:hover { border-color: #464a51; background: #2a2d32; }
/* A sent paste in the user's frame: its tag, its text on hover in the page's top layer, scrolling when long (ChatPasteChip). */
.chat-paste-chip { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; margin: 0 1px; border-radius: 6px; background: #2c2f36; border: 1px solid #3d414a; color: #d4d4d8; font-size: 12.5px; line-height: 1.7; vertical-align: 1px; cursor: default; white-space: nowrap; }
.chat-paste-chip .lucide { width: 13px; height: 13px; color: #e2865f; }
.chat-paste-pop { position: fixed; z-index: 50; width: min(460px, calc(100vw - 16px)); max-height: 280px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #31353b transparent; background: #202327; border: 1px solid #31353b; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 9px 11px; font: 12.5px/1.5 "Segoe UI", system-ui, sans-serif; color: #e4e4e7; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-tools-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #2b2e33; color: var(--chat-dim); font-size: 12.5px; }
.chat-tools-row > .chat-chip, .chat-tools-row > .chat-anchor, .chat-anchor > .chat-chip { min-width: 0; }
.chat-tools-row .chat-chip .lucide { flex-shrink: 0; }
.chat-chip .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.chat-ib { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: #2a2d32; border: 0; color: var(--chat-dim); cursor: pointer; flex-shrink: 0; }
.chat-ib:not(:disabled):hover { color: var(--chat-ink); }
.chat-rail { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.chat-ib.sky { background: rgba(56,189,248,.10); } .chat-ib.sky:hover { background: rgba(56,189,248,.20); } .chat-ib.sky.on { background: rgba(56,189,248,.28); color: #bae6fd; }
.chat-ib.rose { background: rgba(244,63,94,.10); } .chat-ib.rose:hover { background: rgba(244,63,94,.20); } .chat-ib.rose.on { background: rgba(244,63,94,.28); color: #fecdd3; }
.chat-ib.amber { background: rgba(245,158,11,.10); } .chat-ib.amber:hover { background: rgba(245,158,11,.20); } .chat-ib.amber.on { background: rgba(245,158,11,.28); color: #fde68a; }
.chat-ib:disabled { opacity: .45; cursor: default; }
/* « Commandes »: the prompt bar's buttons of the settings (the user's ask of 01/11/2026). */
.chat-commands-menu { min-width: 220px; max-height: min(420px, 60vh, var(--room, 100vh)); overflow: auto; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-commands-menu h6 { margin: 6px 10px 4px; font-size: 11px; font-weight: 600; color: var(--chat-mute); }
.chat-commands-menu .lucide { width: 14px; height: 14px; flex-shrink: 0; color: var(--chat-dim); }
.chat-commands-menu .dot { width: 14px; flex-shrink: 0; }
.chat-ib .lucide { width: 16px; height: 16px; }
.chat-round { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; border: 0; cursor: pointer; flex-shrink: 0; }
.chat-round .lucide { width: 17px; height: 17px; }
.chat-round.send { background: var(--chat-accent); color: var(--chat-accent-ink); }
.chat-round.send:disabled { background: #31353b; color: #6b6f76; cursor: default; }
.chat-round.stop { background: #f4f4f5; color: #0c0c0d; }
.chat-round.mic { background: #2a2d32; color: var(--chat-dim); }
.chat-round.mic:hover { color: var(--chat-ink); }
.chat-round.mic.rec { background: #ef4444; color: #fff; box-shadow: 0 0 0 4px rgba(239,68,68,.18); }
.chat-round .spin { width: 15px; height: 15px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; }

.chat-ask-head { display: flex; align-items: center; gap: 8px; margin: 0 4px 8px; font-size: 14px; color: #f4f4f5; }
.chat-ask-head .lucide { width: 16px; height: 16px; color: var(--chat-accent); flex-shrink: 0; }
.chat-ask-head small { margin-left: auto; color: var(--chat-mute); font-size: 12px; white-space: nowrap; }
.chat-ask-sub { margin: -4px 4px 8px; font-size: 12px; color: var(--chat-mute); }
.chat-opt { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 11px; color: #d4d4d8; font-size: 13.5px; cursor: pointer; border: 0; background: transparent; width: 100%; text-align: left; font: inherit; }
.chat-opt:hover { background: #25282c; }
.chat-opt .k { width: 24px; height: 24px; border-radius: 7px; background: #2b2e33; display: grid; place-items: center; font-size: 12px; color: var(--chat-dim); flex-shrink: 0; }
.chat-opt .t { display: flex; flex-direction: column; min-width: 0; }
.chat-opt .t span { color: var(--chat-mute); font-size: 12.5px; }
.chat-opt.sel { background: #2b2623; box-shadow: inset 0 0 0 1px #5a3a2c; }
.chat-opt.sel .k { background: var(--chat-accent); color: var(--chat-accent-ink); font-weight: 700; }
.chat-ask-other { width: 100%; margin-top: 6px; border: 1px solid #31353b; border-radius: 10px; background: #141619; color: var(--chat-ink); font: inherit; font-size: 13.5px; padding: 7px 10px; outline: none; }
.chat-ask-other:focus { border-color: #5a3a2c; }
.chat-ask-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #2b2e33; flex-wrap: wrap; }
.chat-btn { border: 1px solid #31353b; background: #2a2d32; color: #e4e4e7; border-radius: 10px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.chat-btn:hover { border-color: #464a51; }
.chat-btn.primary { background: var(--chat-accent); border-color: var(--chat-accent); color: var(--chat-accent-ink); font-weight: 600; }
.chat-btn.ghost { background: transparent; }
.chat-btn:disabled { opacity: .5; cursor: default; }
.chat-btn .lucide { width: 14px; height: 14px; }
.chat-plan { max-height: 38vh; overflow: auto; margin: 0 4px 4px; padding: 8px 12px; border: 1px solid #2b2e33; border-radius: 12px; background: #141619; }
.chat-plan .reading-md { font-size: 13.5px; }
.chat-perm-input { margin: 0 4px; max-height: 160px; overflow: auto; border: 1px solid #2b2e33; border-radius: 10px; background: #141619; padding: 8px 10px; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; color: var(--chat-dim); white-space: pre-wrap; overflow-wrap: anywhere; }

.chat-status { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 11.5px; color: var(--chat-mute); padding: 9px 6px 0; }
.chat-status > span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.chat-status b { color: var(--chat-dim); font-weight: 500; }
.chat-status .hot b { color: #fcd34d; }
.chat-status { align-items: center; }
.chat-status > span { gap: 6px; }
.chat-ring { position: relative; width: 26px; height: 26px; flex-shrink: 0; }
.chat-ring svg { display: block; }
.chat-ring circle { fill: none; stroke-width: 3; }
.chat-ring .track { stroke: #2f3238; }
.chat-ring .fill { stroke: var(--chat-dim); stroke-linecap: round; transition: stroke-dasharray .4s ease-out; }
.chat-ring i { position: absolute; inset: 0; display: grid; place-items: center; font-style: normal; font-size: 9px; font-weight: 600; color: #d4d4d8; }
.chat-ring.hot .fill { stroke: #fcd34d; }
.chat-ring.hot i { color: #fcd34d; }

.chat-menu { position: absolute; bottom: calc(100% + 6px); min-width: 220px; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); padding: 6px; z-index: 6; }
.chat-menu button { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent; color: #d4d4d8; font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; cursor: pointer; text-align: left; }
.chat-menu button:hover, .chat-menu button.on { background: #2f3238; }
.chat-menu .hint { color: var(--chat-mute); font-size: 12px; margin-left: auto; }
.chat-anchor { position: relative; display: inline-flex; }

.chat-tasks { position: absolute; bottom: calc(100% + 6px); left: 0; min-width: 300px; max-width: 420px; max-height: 320px; overflow: auto; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); padding: 8px 10px; z-index: 6; }
.chat-tasks .t { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 13px; color: #d4d4d8; }
.chat-tasks .t.done { color: var(--chat-mute); text-decoration: line-through; }
.chat-tasks .t .lucide { width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0; }
.chat-tasks .t.doing .lucide { color: var(--chat-accent); }

.chat-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 92%); z-index: 9; background: #1b1d21; border-left: 1px solid #2b2e33; box-shadow: -2px 0 6px rgba(0,0,0,.3); display: flex; flex-direction: column; }
.chat-drawer .dh { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid #26292e; font-size: 14px; color: #f4f4f5; }
.chat-drawer .dh button { margin-left: auto; }
.chat-drawer .db { flex: 1; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.chat-agent { border: 1px solid #2b2e33; border-radius: 12px; padding: 10px 12px; background: #202327; display: flex; flex-direction: column; gap: 6px; }
.chat-agent .top { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #e4e4e7; min-width: 0; }
.chat-agent .top .d { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chat-agent .meta { font-size: 12px; color: var(--chat-mute); }
.chat-agent .sum { font-size: 12.5px; color: var(--chat-dim); white-space: pre-wrap; max-height: 120px; overflow: auto; }
.chat-agent .ok { color: #4ade80; } .chat-agent .ko { color: #f87171; }
.chat-agent .lucide { width: 14px; height: 14px; flex-shrink: 0; }

.chat-sheet { position: absolute; inset: 0; z-index: 10; background: rgba(14,15,17,.86); display: flex; flex-direction: column; }
.chat-sheet .sh { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid #26292e; font-size: 14px; color: #f4f4f5; background: #1b1d21; }
.chat-sheet .sh button { margin-left: auto; }
.chat-sheet .chat-scroll { background: var(--chat-bg); }

.chat-closed { display: flex; align-items: center; gap: 10px; justify-content: center; font-size: 13px; color: #fca5a5; padding: 8px; }

/* Conversation: messages, images, tools, live line, plan, search. */
/* Messages in the terminal's frames (the display mod outils-discrets): green for the user, violet for Claude, blue for another session or a subagent, red edge on an error. Over the old bubble (.chat-user). */
.chat-root .chat-frame { position: relative; align-self: stretch; max-width: none; width: 100%; border: 1px solid; border-radius: 10px; padding: 9px 14px; white-space: normal; color: var(--chat-ink); }
/* --frame-end: the frame's bottom colour, under its time and buttons. */
.chat-frame.user { --frame-end: rgb(21,31,34); border-color: #1f9f50; background: linear-gradient(rgb(25,36,40), var(--frame-end)); }
/* A reply that only says what Claude does next: a quiet line with a violet dot, so the turn's answer stands out (the user's pick 1 of 01/11/2026). */
.chat-step-reply { display: flex; gap: 10px; padding: 0 4px; }
/* « Récit »: the sentences of the exchange under way in full ink, the older ones dim (the user's pick 1 of 02/11/2026). */
.chat-step-reply::before { content: ""; width: 6px; height: 6px; margin-top: 10px; border-radius: 50%; background: #9d6ef0; flex-shrink: 0; }
.chat-step-reply .reading-md { flex: 0 1 auto; min-width: 0; font-size: 14.5px; line-height: 1.6; color: var(--chat-ink); }
.chat-step-reply.past::before { background: #6b4a99; }
.chat-step-reply.past .reading-md { color: var(--chat-dim); }
.chat-step-reply > .chat-peeks { margin-left: -4px; }
.chat-step-reply .reading-md p { margin: 0 0 4px; }
.chat-step-reply .reading-md > :last-child { margin-bottom: 0; }
/* The turn's answer: its opening line a little larger when more follows. A lone ⏳ at its end isn't more (the user's ask of 02/11/2026, \`endsWithHourglass\`). */
.chat-frame.claude .reading-md:not([data-hourglass]) > p:first-child:not(:last-child),
.chat-frame.claude .reading-md[data-hourglass] > p:first-child:not(:nth-last-child(-n + 2)) { font-size: 15.5px; font-weight: 600; color: #f4f4f5; }
/* The user's words: a green bubble on the right, its time and buttons on its left on hover (the user's pick of 01/11/2026). */
.chat-root .chat-frame.user { --frame-end: #1f3a2b; align-self: flex-end; width: fit-content; max-width: 78%; border: 0; border-radius: 16px 16px 4px 16px; background: #1f3a2b; padding: 8px 14px; }
.chat-frame.user .chat-frame-foot { right: calc(100% + 6px); bottom: 0; background: none; box-shadow: none; padding: 0; }
.chat-frame.claude { --frame-end: rgb(26,25,38); border-color: #8648c5; background: linear-gradient(rgb(33,33,48), var(--frame-end)); }
.chat-frame.peer { --frame-end: rgb(19,26,36); border-color: #2f74b5; background: linear-gradient(rgb(22,31,43), var(--frame-end)); }
.chat-frame.error { border-color: #d9534f; }
.chat-frame-head { display: flex; align-items: center; gap: 7px; height: 24px; font-size: 12.5px; margin-bottom: 2px; user-select: none; }
.chat-frame-head .lucide { width: 14px; height: 14px; flex-shrink: 0; }
.chat-frame.user .chat-frame-head { color: #22c55e; }
.chat-frame.claude .chat-frame-head { color: #b58af7; }
.chat-frame.peer .chat-frame-head { color: #60a5fa; }
.chat-frame.error .chat-frame-head { color: #f08a87; }
.chat-frame-head b { font-weight: 600; }
/* The time, « Modifier » and « Copier » in the frame's bottom-right corner, on hover only, over the text on the frame's own colour: no row kept for them (the user's picks of 01/11/2026). No copy while Claude writes. */
.chat-frame-foot { position: absolute; z-index: 1; right: 6px; bottom: 7px; display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 2px 0 6px; border-radius: 8px; background: var(--frame-end); box-shadow: -12px 0 10px -4px var(--frame-end); font-size: 11.5px; user-select: none; opacity: 0; pointer-events: none; transition: opacity .12s; }
.chat-frame:hover .chat-frame-foot, .chat-frame-foot:focus-within { opacity: 1; pointer-events: auto; }
/* A frame ending on a row of its own (« coupé », a queued message's « Envoyer maintenant » and ×): the foot goes top-right, never over those. */
.chat-frame:has(> .chat-cut-row, > .chat-queued-mark) .chat-frame-foot { bottom: auto; top: 6px; }
.chat-frame-foot time { color: var(--chat-mute); font-variant-numeric: tabular-nums; }
.chat-frame-foot .tools { display: flex; gap: 2px; }
.chat-frame-foot .copy { width: 26px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #77708c; cursor: pointer; transition: color .12s, background .12s; }
.chat-frame-foot .copy:hover { color: var(--chat-ink); background: rgba(255,255,255,.08); }
.chat-frame-foot .chat-peek { width: 26px; color: #77708c; }
.chat-frame-foot .chat-peek:hover, .chat-frame-foot .chat-peek.on { color: #e2c26b; }
.chat-frame-foot .lucide { width: 14px; height: 14px; }
.chat-frame .copy.copied { opacity: 1; color: #86efac; }
.chat-frame.streaming .chat-frame-foot { visibility: hidden; }
.chat-frame .reading-md { font-size: 14.5px; line-height: 1.65; color: var(--chat-ink); }
.chat-root .chat-frame.queued .reading-md { color: #8f8f9a; }
/* Code blocks: a block of their own, on the grey as in the frames; long lines scroll; the copy button always in the corner. */
.chat-root .modern-codeblock { position: relative; margin: 4px 0 12px; }
.chat-root .reading-md > .modern-codeblock:last-child { margin-bottom: 2px; }
.chat-root .modern-codeblock pre { margin: 0; background: #0f1114; border: 1px solid #2e3238; border-radius: 9px; padding: 10px 44px 10px 14px; overflow-x: auto; scrollbar-width: thin; scrollbar-color: #3a3e45 transparent; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12.5px; line-height: 1.6; }
.chat-root .reading-md pre code { font-family: inherit; font-size: inherit; line-height: inherit; white-space: pre; color: #d4d4d8; }
.chat-root .modern-code-copy { position: absolute; z-index: 2; right: 6px; bottom: 6px; width: 26px; height: 24px; display: grid; place-items: center; padding: 0; border-radius: 6px; border: 1px solid #2e3238; background: rgba(15,17,20,.92); color: #6f727a; cursor: pointer; transition: color .12s, border-color .12s; }
.chat-root .modern-code-copy:hover { color: var(--chat-ink); border-color: #4a4f57; }
.chat-root .modern-code-copy.copied { color: #86efac; border-color: rgba(134,239,172,.4); }
.chat-root .modern-path { cursor: pointer; }
.chat-root .modern-path:hover { color: #9ec5f8; }
.chat-root .modern-path .ext-ico { display: inline-flex; margin-left: 3px; vertical-align: -1px; opacity: .7; }
/* An image path as text (loading, missing, a video): a click opens it. */
.chat-root .modern-imgpath { color: #9ec5f8; cursor: zoom-in; text-decoration: underline dotted; text-underline-offset: 3px; overflow-wrap: anywhere; }
.chat-root .modern-imgpath:hover { color: #cfe2fb; }
/* An image path found: a mini the height of a line in its place (the user's ask of 01/11/2026), as an image Claude reads. */
.chat-root .modern-imgpath.mini { position: relative; display: inline-block; vertical-align: middle; line-height: 0; text-decoration: none; background: none; padding: 0; border: 0; }
.chat-root .modern-imgpath.mini img { display: block; height: 20px; width: auto; max-width: 40px; object-fit: contain; background: #111215; border-radius: 4px; border: 1px solid rgba(255,255,255,.14); }
.chat-root .modern-imgpath.mini:hover img { border-color: rgba(255,255,255,.4); }
.chat-root .modern-imgpath.mini .label { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* A file's path found on disk: a tag with its name, its folder in the text but unseen (search, copy); a click opens it (FilePathTag, the user's ask of 01/11/2026). */
.chat-root .modern-filetag { display: inline-block; max-width: 100%; box-sizing: border-box; padding: 0 7px; margin: 0 1px; border-radius: 6px; background: #2c2f36; border: 1px solid #3d414a; color: #d4d4d8; font-size: 12.5px; line-height: 18px; font-style: normal; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.chat-root .modern-filetag:hover { border-color: #5a5f69; color: #f4f4f5; }
.chat-root .modern-filetag .lucide { display: inline; width: 13px; height: 13px; margin-right: 4px; vertical-align: -2px; color: #9ec5f8; }
/* Inline, never out of the flow: a copied sentence keeps the path in one piece. */
.chat-root .modern-filetag .dir { font-size: 0; line-height: 0; }
/* The strip under a message: pasted images, then the files it names. */
.chat-gallery { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.chat-gallery .modern-thumb { display: block; height: 92px; width: auto; max-width: 220px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,.12); cursor: zoom-in; }
.chat-gallery .modern-thumb:hover { border-color: rgba(255,255,255,.32); }
.chat-gallery .modern-thumb-ph { display: flex; align-items: center; justify-content: center; width: 120px; height: 92px; border: 1px dashed rgba(255,255,255,.16); border-radius: 8px; color: #6f6f78; }
.chat-gallery .modern-video { position: relative; display: inline-block; height: 92px; overflow: hidden; border-radius: 8px; border: 1px solid rgba(255,255,255,.12); cursor: pointer; user-select: none; }
.chat-gallery .modern-video img { display: block; height: 92px; }
.chat-gallery .modern-video .blank { display: flex; align-items: center; justify-content: center; height: 92px; aspect-ratio: 16 / 9; background: #26262e; color: #5f5f68; }
.chat-gallery .modern-video .band { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 5px; padding: 12px 6px 4px; background: linear-gradient(transparent, rgba(0,0,0,.85)); color: #fff; font-size: 10.5px; line-height: 1.3; }
.chat-gallery .modern-video .band .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-gallery .modern-video .band small { flex-shrink: 0; margin-left: auto; }
.chat-gallery-more { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--chat-line); color: var(--chat-mute); font-size: 12px; }
.chat-gallery-more .lucide { width: 13px; height: 13px; }
/* Tool steps in words: a row's, and the last one after a series' counts. */
.chat-tool .row .step { color: var(--chat-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chat-line b { flex-shrink: 0; }
.chat-line .chat-step { color: #6f727a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
/* The live line's step, cut before the time and tokens. */
.chat-live-now { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.chat-live-now .spin { flex-shrink: 0; }
.chat-live-now .what { color: var(--chat-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chat-live-now .figures { flex-shrink: 0; white-space: pre; }
/* Claude's task list in the live line: a green dot per task done, the one under way in orange, what comes next in grey; the list on hover (the user's pick B of 01/11/2026). */
.chat-task-dots { display: inline-flex; align-items: center; gap: 4px; cursor: default; padding: 4px 0; }
.chat-task-dots i { display: block; width: 7px; height: 7px; border-radius: 50%; background: #3f8f5f; }
.chat-task-dots i.cur { width: 9px; height: 9px; background: var(--chat-accent); }
.chat-live-now .then { color: var(--chat-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* « ✻ Terminé en … » after a long turn. */
.chat-done { color: var(--chat-mute); font-size: 12.5px; padding: 0 2px; }
/* A plan waiting for the user: in full, the accent edge of the requests. */
.chat-plan-card.pending { border-color: #5a3a2c; }
.chat-plan-card .body .reading-md { font-size: 14px; }
/* Ctrl+F: the box under the chat / terminal switch. */
.chat-search { position: absolute; top: 48px; right: 14px; z-index: 8; display: flex; align-items: center; gap: 2px; width: min(340px, calc(100% - 28px)); padding: 4px 6px 4px 12px; border-radius: 10px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
.chat-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--chat-ink); font: inherit; font-size: 13px; }
.chat-search input::placeholder { color: #6b6f76; }
.chat-search .count { font-size: 11.5px; color: var(--chat-mute); padding: 0 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.chat-search button { width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--chat-dim); cursor: pointer; flex-shrink: 0; padding: 0; }
.chat-search button:hover { background: #2f3238; color: var(--chat-ink); }
.chat-search .lucide { width: 14px; height: 14px; }
/* The matches' tints are each pane's own (chatHighlightCss). */

/* Input and requests: questions, permissions, queued messages, drop. */
.chat-ask-tabs { display: flex; align-items: center; gap: 4px; margin: 0 2px 10px; overflow-x: auto; scrollbar-width: none; }
.chat-ask-tabs button { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent; background: transparent; color: var(--chat-mute); font: inherit; font-size: 12.5px; line-height: 1.4; padding: 3px 9px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.chat-ask-tabs button:not(:disabled):hover { color: var(--chat-ink); background: #25282c; }
.chat-ask-tabs button.on { color: #f4f4f5; background: #2b2623; border-color: #5a3a2c; }
.chat-ask-tabs button.done .lucide { color: var(--chat-accent); }
.chat-ask-tabs button.nav { padding: 3px 4px; }
.chat-ask-tabs button:disabled { opacity: .35; cursor: default; }
.chat-ask-tabs .lucide { width: 14px; height: 14px; flex-shrink: 0; }
.chat-ask-review { display: flex; flex-direction: column; gap: 2px; }
.chat-ask-review button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; border: 0; background: transparent; font: inherit; padding: 6px 10px; border-radius: 10px; cursor: pointer; }
.chat-ask-review button:hover { background: #25282c; }
.chat-ask-review .q { color: var(--chat-dim); font-size: 13px; }
.chat-ask-review .a { color: var(--chat-ink); font-size: 13.5px; }
.chat-ask-review .missing .a { color: #fca5a5; }
.chat-perm-always { min-width: 0; max-width: 100%; }
.chat-perm-always span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-perm-always .lucide { flex-shrink: 0; }
.chat-root .chat-user.queued, .chat-root .chat-user.queued .reading-md, .chat-root .chat-user.queued .reading-md * { color: #8f8f9a; }
.chat-queued-mark { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; font-size: 11.5px; line-height: 1.4; color: #8f8f9a; white-space: nowrap; }
.chat-queued-mark .lucide { width: 12px; height: 12px; flex-shrink: 0; }
.chat-queued-mark.dropped { color: #fca5a5; }
.chat-queued-mark button { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; border: 1px solid #3a3e45; background: transparent; color: #c4c4cc; font: inherit; font-size: 11.5px; padding: 1px 8px; border-radius: 999px; cursor: pointer; }
.chat-queued-mark button:hover { color: var(--chat-ink); border-color: #5a3a2c; background: #2b2623; }
.chat-round.send.waiting { animation: chat-send-wait 1.1s ease-in-out infinite; }
@keyframes chat-send-wait { 0%, 100% { box-shadow: 0 0 0 0 rgba(226,134,95,.5); } 50% { box-shadow: 0 0 0 7px rgba(226,134,95,0); opacity: .75; } }
@media (prefers-reduced-motion: reduce) { .chat-round.send.waiting { animation: none; box-shadow: 0 0 0 3px rgba(226,134,95,.35); } }

/* Slash commands: menu and the panels they open. */
.chat-slash { position: absolute; left: 10px; right: 10px; bottom: calc(100% + 6px); z-index: 5; max-height: min(380px, 52vh); overflow: auto; border-radius: 14px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); padding: 4px; scroll-padding: 26px 0 4px; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-slash-group { position: sticky; top: -4px; z-index: 1; background: #202327; padding: 8px 10px 4px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--chat-mute); }
.chat-slash > button.chat-slash-item { display: flex; align-items: baseline; gap: 10px; width: 100%; white-space: nowrap; padding: 5px 10px; border: 0; border-radius: 8px; background: transparent; color: #d4d4d8; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.chat-slash > button.chat-slash-item.on, .chat-slash > button.chat-slash-item:hover { background: #2f3238; }
.chat-slash-item .name { flex-shrink: 0; color: #e4e4e7; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12.5px; }
.chat-slash-item.on .name { color: var(--chat-accent); }
.chat-slash-item .args { flex-shrink: 1; min-width: 0; max-width: 36%; overflow: hidden; text-overflow: ellipsis; color: var(--chat-mute); font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; }
.chat-slash-item .desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--chat-dim); font-size: 12.5px; }
.chat-slash-hint { padding: 8px 10px; font-size: 13px; color: var(--chat-dim); }
.chat-slash-hint.error { color: #fca5a5; }
.chat-slash.panel { display: flex; flex-direction: column; overflow: hidden; padding: 6px; }
.chat-slash-title { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px; font-size: 13.5px; color: #f4f4f5; }
.chat-slash-title .lucide { width: 15px; height: 15px; color: var(--chat-accent); flex-shrink: 0; }
.chat-slash-title small { margin-left: auto; color: var(--chat-mute); font-size: 11.5px; white-space: nowrap; }
.chat-slash-rows { min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-pick { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 9px; cursor: pointer; font-size: 13px; color: #d4d4d8; min-width: 0; }
.chat-pick.on { background: #2f3238; }
.chat-pick .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-pick .m { flex-shrink: 0; color: var(--chat-mute); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.chat-pick .tag { flex-shrink: 0; font-size: 11px; color: var(--chat-accent); border: 1px solid #5a3a2c; border-radius: 999px; padding: 0 8px; white-space: nowrap; }
.chat-pick.off { cursor: default; }
.chat-pick.off .t { color: var(--chat-mute); }
/* /mcp (the user's pick A of 01/11/2026): a server per row, the dot of its state, its action; a switch on one connected or cut off. */
.chat-mcp-row .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: #6b6f76; }
.chat-mcp-row.connected .dot { background: #4ade80; }
.chat-mcp-row.failed .dot { background: #f87171; }
.chat-mcp-row.needs-auth .dot, .chat-mcp-row.pending .dot, .chat-mcp-row .dot.wait { background: #fcd34d; }
.chat-mcp-row .dot.wait { animation: chat-blink 1s steps(2) infinite; }
.chat-mcp-row .t small { margin-left: 7px; color: var(--chat-mute); font-size: 11.5px; }
.chat-mcp-row.disabled .t { color: var(--chat-mute); }
.chat-slash .chat-mcp-row .code.main { border-color: #5a3a2c; background: #2b2623; }
.chat-mcp-switch { position: relative; flex-shrink: 0; width: 26px; height: 14px; padding: 0; border: 0; border-radius: 999px; background: #3a3e45; cursor: pointer; }
.chat-mcp-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #a1a1aa; transition: left .12s; }
.chat-mcp-switch.on { background: rgba(74,222,128,.35); }
.chat-mcp-switch.on::after { left: 14px; background: #4ade80; }
.chat-mcp-err { padding: 0 10px 6px 27px; margin-top: -4px; color: var(--chat-mute); font-size: 11.5px; overflow-wrap: anywhere; }
.chat-slash .chat-pick .code { display: inline-flex; flex-shrink: 0; padding: 1px 9px; border-radius: 999px; border: 1px solid #464a51; background: #26292e; color: #e4e4e7; font: inherit; font-size: 11.5px; cursor: pointer; }
.chat-slash .chat-pick .code:hover { border-color: var(--chat-accent); background: #2b2623; }
.chat-slash-keys { margin-top: 4px; padding: 7px 10px 2px; border-top: 1px solid #2b2e33; font-size: 11.5px; color: var(--chat-mute); }
.chat-cmd { border: 1px solid var(--chat-line); border-radius: 12px; background: var(--chat-card); overflow: hidden; }
.chat-cmd .head { display: flex; align-items: baseline; gap: 8px; padding: 7px 12px; min-width: 0; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12.5px; color: #d4d4d8; }
.chat-cmd .head .lucide { width: 14px; height: 14px; flex-shrink: 0; align-self: center; color: var(--chat-mute); }
.chat-cmd .head .args { min-width: 0; color: var(--chat-mute); overflow-wrap: anywhere; }
.chat-cmd .body { border-top: 1px solid #26292e; padding: 8px 14px 10px; max-height: 420px; overflow: auto; font-size: 13px; color: var(--chat-dim); scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-cmd .body h1, .chat-cmd .body h2, .chat-cmd .body h3 { font-size: 13.5px; color: #d4d4d8; margin: 8px 0 4px; }
.chat-cmd.queued .head .name { color: #8f8f9a; }
.chat-cmd .head .chat-queued-mark { margin: 0 0 0 auto; font-family: "Segoe UI", system-ui, sans-serif; }
.chat-cmd .head .plan { margin-left: auto; align-self: center; font-family: "Segoe UI", system-ui, sans-serif; font-size: 11px; color: var(--chat-mute); }
.chat-cmd .head .plan + .chat-queued-mark { margin-left: 8px; }

/* /usage as the terminal shows it (the user's pick A of 03/11/2026): a bar
   per window, then what weighs on them, 24 h or 7 days by tab. */
.chat-cmd .body.chat-usage { max-height: none; overflow: visible; display: flex; flex-direction: column; gap: 9px; padding: 10px 14px 12px; font-size: 12.5px; }
.chat-usage .pc { font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.chat-usage .win .top { display: flex; justify-content: space-between; gap: 8px; color: #d4d4d8; }
.chat-usage .bar { height: 6px; margin: 5px 0 3px; border-radius: 99px; background: #2f3238; overflow: hidden; }
.chat-usage .bar i { display: block; height: 100%; border-radius: 99px; background: var(--chat-accent); transition: width .4s ease-out; }
.chat-usage .win.hot .bar i { background: #fcd34d; }
.chat-usage .win.hot .top .pc { color: #fcd34d; }
.chat-usage .sub { font-size: 11px; color: var(--chat-mute); }
.chat-usage .sect { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px; padding-top: 10px; border-top: 1px solid #26292e; }
.chat-usage .sect b { font-size: 12px; font-weight: 600; color: #d4d4d8; }
.chat-usage .seg { display: inline-flex; gap: 1px; padding: 1px; border: 1px solid var(--chat-line); border-radius: 999px; }
.chat-usage .seg button { padding: 1px 10px; border: 0; border-radius: 999px; background: transparent; font: inherit; font-size: 11px; color: var(--chat-mute); cursor: pointer; }
.chat-usage .seg button:hover { color: #d4d4d8; }
.chat-usage .seg button.on { background: #2b2e33; color: #e4e4e7; }
.chat-usage .tip { display: grid; grid-template-columns: 38px 1fr; gap: 1px 10px; align-items: baseline; }
.chat-usage .tip .pc { text-align: right; font-size: 12px; color: var(--chat-accent); }
.chat-usage .tip .t { color: #d4d4d8; line-height: 1.35; }
.chat-usage .tip .d { grid-column: 2; font-size: 11px; color: var(--chat-mute); }
.chat-usage .tops { display: flex; flex-direction: column; gap: 4px; }
.chat-usage .lbl { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: #6b6e76; }
.chat-usage .chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chat-usage .chip { padding: 1px 8px; border: 1px solid var(--chat-line); border-radius: 999px; font-size: 11px; color: var(--chat-mute); }
.chat-usage .chip b { font-weight: 500; color: #d4d4d8; }
.chat-usage .rest { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--chat-mute); overflow-wrap: anywhere; }

/* A \`!\` command of the user: the shell's words, its output, how it ended. */
/* Drawn at its real size, never the 60px estimate: several of them at the end
   of a column shown just past the viewport made the browser nudge the column
   up 3px on its first frame, read as the reader scrolling away (preview, 01/11). */
.chat-bash { content-visibility: visible; }
.chat-bash .head .name { color: var(--chat-accent); font-weight: 600; }
.chat-bash .head .args { color: #d4d4d8; }
.chat-bash .head .stop, .chat-bash .head .end { margin-left: auto; flex-shrink: 0; align-self: center; font-family: "Segoe UI", system-ui, sans-serif; font-size: 11.5px; color: var(--chat-mute); }
.chat-bash .head .stop { display: inline-flex; align-items: center; gap: 6px; padding: 1px 9px; border: 1px solid #3a3d43; border-radius: 999px; background: transparent; cursor: pointer; }
.chat-bash .head .stop:hover { color: #fca5a5; border-color: rgba(248,113,113,.45); }
.chat-bash .head .stop .lucide { width: 10px; height: 10px; color: inherit; }
.chat-bash .head .stop .spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; }
.chat-bash .head .end.bad { color: #fca5a5; }
.chat-bash .body.out { max-height: 320px; padding: 8px 12px 9px; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--chat-dim); }
.chat-bash .body .chat-stderr { margin-top: 4px; color: #fca5a5; }
.chat-bash .note { border-top: 1px solid #26292e; padding: 5px 12px 6px; font-size: 11.5px; color: #e7c27a; }
.chat-box textarea.bash { font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 13px; color: #f0b48f; }

/* Live activity: agent pills, workflow card, shells chip. */
/* The running subagents, one pill each (the user's pick C+ of 01/11/2026): titles shorten, then « +N »; the detail and the stop on hover. */
.chat-agent-pills { position: relative; display: flex; align-items: center; gap: 6px; margin: 0 0 8px; min-width: 0; }
.chat-agent-pills .measure { position: absolute; visibility: hidden; pointer-events: none; display: flex; gap: 6px; left: 0; top: 0; white-space: nowrap; }
.chat-agent-pill { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid #31353b; background: #1d2024; font-size: 12.5px; color: #e4e4e7; cursor: pointer; white-space: nowrap; max-width: 260px; min-width: 0; }
.chat-agent-pill:hover, .chat-agent-pill.on { border-color: #464a51; background: #25282c; }
.chat-agent-pill .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.chat-agent-pill .t { flex-shrink: 0; color: var(--chat-mute); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.chat-agent-pill.more { cursor: default; color: var(--chat-dim); }
/* Hover popovers as wide as their words, up to a cap: no empty band. */
/* A pill's detail open: the gap up to it belongs to the pill, so crossing it closes nothing (no close delay). */
.chat-agent-pills .chat-anchor:has(> .chat-menu)::before { content: ""; position: absolute; left: 0; right: 0; bottom: 100%; height: 10px; }
.chat-agent-detail { width: max-content; max-width: min(380px, 80vw); padding: 8px 10px; font-size: 13px; cursor: default; }
.chat-agent-detail .h, .chat-agent-more .h { display: flex; align-items: center; gap: 9px; min-width: 0; }
.chat-agent-detail .h b, .chat-agent-more .h b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-agent-detail .s { color: var(--chat-dim); font-size: 12.5px; margin: 3px 0 0 23px; }
.chat-agent-detail .s.retry { color: #fcd34d; }
.chat-agent-detail .a { color: var(--chat-mute); font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; margin: 3px 0 0 23px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-agent-detail .f { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; margin: 3px 0 0 23px; font-size: 12px; color: var(--chat-mute); font-variant-numeric: tabular-nums; }
.chat-agent-detail .stop { display: flex; align-items: center; gap: 6px; margin-left: auto; color: var(--chat-dim); }
.chat-agent-detail .stop button { width: auto; padding: 2px 8px; font-size: 12px; border-radius: 6px; gap: 5px; }
.chat-agent-detail .stop .lucide { width: 13px; height: 13px; }
.chat-agent-more { width: max-content; max-width: min(360px, 80vw); max-height: min(320px, var(--room, 100vh)); overflow: auto; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-agent-more button { flex-direction: column; align-items: stretch; gap: 2px; padding: 7px 10px; text-align: left; }
.chat-agent-more .m { margin-left: 23px; font-size: 11.5px; color: var(--chat-mute); }
.chat-wf .figs { margin-left: auto; flex-shrink: 0; font-size: 12px; color: var(--chat-mute); font-variant-numeric: tabular-nums; white-space: nowrap; }
.chat-agent-pill .spin, .chat-agent-detail .spin, .chat-agent-more .spin, .chat-wf .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; flex-shrink: 0; }
.chat-agent-pills .lucide, .chat-wf .agent .lucide, .chat-wf .line > .lucide { width: 14px; height: 14px; flex-shrink: 0; }
.chat-agent-pills .ok, .chat-wf .ok { color: #4ade80; }
.chat-agent-pills .ko, .chat-wf .ko { color: #f87171; }
/* An ended card: ✓ a moment, then it fades as it leaves (CARD_LINGER_MS). */
.chat-agent-pill.ended, .chat-wf.ended { animation: chat-card-out 2.5s ease-in forwards; }
@keyframes chat-card-out { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
.chat-wf { border: 1px solid #2b2e33; border-radius: 12px; background: #1d2024; margin: 0 0 8px; overflow: hidden; flex-shrink: 0; }
.chat-wf .line { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; font-size: 13px; color: #e4e4e7; min-width: 0; user-select: none; position: relative; z-index: 1; background: #1d2024; }
.chat-wf .line:hover { background: #202327; }
.chat-wf .line .ic { color: var(--chat-accent); }
.chat-wf .line .name { font-weight: 500; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-wf .bar { flex: 1; min-width: 40px; height: 5px; border-radius: 999px; background: #2b2e33; overflow: hidden; }
.chat-wf .bar > span { display: block; height: 100%; background: var(--chat-accent); border-radius: 999px; transition: width .4s ease-out; }
.chat-wf .line .figs { margin-left: 0; }
.chat-wf .line .chev { color: var(--chat-mute); }
.chat-wf .body { border-bottom: 1px solid #26292e; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.chat-wf .desc { font-size: 12.5px; color: var(--chat-dim); }
/* Each column scrolls on its own: a max-height on the grid alone lets its rows grow past it. */
.chat-wf .cols { display: grid; grid-template-columns: minmax(120px, 34%) minmax(0, 1fr); gap: 10px; }
.chat-wf .phases, .chat-wf .agents { max-height: 34cqh; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 2px; min-width: 0; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-wf .phases { border-right: 1px solid #26292e; padding-right: 8px; }
.chat-wf .phase, .chat-wf .agent { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px; cursor: pointer; font-size: 12.5px; min-width: 0; flex-shrink: 0; }
.chat-wf .phase { color: var(--chat-dim); }
.chat-wf .phase:hover, .chat-wf .agent:hover { background: #24272c; }
.chat-wf .phase.on { background: #2b2e33; color: #f4f4f5; }
.chat-wf .phase .t, .chat-wf .agent .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-wf .phase .n { margin-left: auto; color: var(--chat-mute); font-variant-numeric: tabular-nums; font-size: 12px; }
.chat-wf .agent { color: #d4d4d8; }
.chat-wf .agent .label { font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; }
.chat-wf .agent .meta { margin-left: auto; flex-shrink: 0; color: var(--chat-mute); font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.chat-wf .agent.queued { color: var(--chat-mute); }
.chat-wf .none { font-size: 12px; color: var(--chat-mute); padding: 5px 8px; }
.chat-wf .foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 12.5px; color: var(--chat-dim); }
.chat-btn.danger { background: #7f1d1d; border-color: #991b1b; color: #fee2e2; }
.chat-btn.danger:hover { border-color: #f87171; }
.chat-status-row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.chat-status-row > .chat-status { flex: 1; min-width: 0; }
.chat-shells { margin-top: 6px; flex-shrink: 0; }
.chat-chip.shells { color: #67e8f9; border-color: rgba(103,232,249,.3); background: rgba(34,211,238,.08); }
.chat-chip.shells:hover { border-color: rgba(103,232,249,.6); }
.chat-chip.chrome { color: #8ab4f8; border-color: rgba(138,180,248,.3); background: rgba(138,180,248,.08); }
.chat-chip.chrome:hover { border-color: rgba(138,180,248,.6); }
.chat-shells-list { position: absolute; bottom: calc(100% + 6px); right: 0; width: min(560px, 90vw); max-height: 50vh; overflow: auto; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); padding: 10px; z-index: 6; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-shells-list .shell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.chat-shells-list .head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.chat-shells-list .cmd { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; color: #a5f3fc; }
.chat-shells-list .dur { margin-left: auto; flex-shrink: 0; font-size: 12px; color: var(--chat-mute); font-variant-numeric: tabular-nums; }
.chat-shells-list .what { font-size: 12px; color: var(--chat-mute); }
.chat-shells-list .out { margin: 0; max-height: 200px; overflow: auto; border: 1px solid #2b2e33; border-radius: 8px; background: #141619; padding: 6px 9px; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; line-height: 1.5; color: var(--chat-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-shells-list .out.empty { color: var(--chat-mute); font-style: italic; }
.chat-live .bg-hint { color: var(--chat-mute); }
.chat-agents-done { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--chat-mute); cursor: pointer; white-space: nowrap; text-decoration: underline; text-decoration-color: #464a51; text-underline-offset: 3px; }
.chat-agents-done:hover { color: var(--chat-dim); }
.chat-agents-done .lucide { width: 13px; height: 13px; }
/* The finished agents' menu on hover (the user's pick B of 01/11/2026): title, a line of summary, time and tokens. */
.chat-agents-menu { width: min(520px, 90vw); max-height: min(420px, 60vh, var(--room, 100vh)); overflow: auto; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-agents-menu button { flex-direction: column; align-items: stretch; gap: 2px; padding: 8px 10px; text-align: left; }
.chat-agents-menu .h { display: flex; align-items: center; gap: 9px; min-width: 0; }
.chat-agents-menu .h b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-agents-menu .h .lucide { width: 14px; height: 14px; flex-shrink: 0; }
.chat-agents-menu .h .ok { color: #22c55e; }
.chat-agents-menu .h .ko { color: #f08a87; }
.chat-agents-menu .s { margin-left: 23px; font-size: 12px; color: var(--chat-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-agents-menu .m { margin-left: 23px; font-size: 11px; color: var(--chat-mute); }

/* SDK content and errors: diffs, suggestions, notices, retries, quota alerts. */
.chat-diff.numbered > div:not(.gap):not(.more) { display: grid; grid-template-columns: calc(var(--chat-diff-no, 3ch) + 10px) calc(var(--chat-diff-no, 3ch) + 10px) 16px minmax(0, 1fr); padding: 0 12px 0 0; }
.chat-diff.numbered .no { text-align: right; padding-right: 6px; color: #5d6168; user-select: none; font-variant-numeric: tabular-nums; }
.chat-diff.numbered .no + .no { border-right: 1px solid #26292e; }
.chat-diff.numbered .sign { text-align: center; user-select: none; }
.chat-diff.numbered .txt { white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-diff.numbered .p .no, .chat-diff.numbered .m .no { color: inherit; opacity: .6; }
.chat-diff .c { color: var(--chat-dim); }
.chat-diff .gap { color: var(--chat-mute); font-style: italic; padding: 2px 12px; background: #17191c; border-block: 1px solid #222428; margin: 2px 0; user-select: none; }
.chat-tool .row .chat-mark { flex-shrink: 0; font-size: 11px; line-height: 1.5; padding: 0 7px; border-radius: 999px; border: 1px solid #4a3f2c; color: #e7c27a; background: rgba(231,194,122,.06); }
.chat-tool .out .chat-stderr { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #3a2c2e; color: #fca5a5; }
.chat-tool .out .chat-stderr .lbl { display: block; font-family: "Segoe UI", system-ui, sans-serif; font-size: 11px; color: #f08a87; margin-bottom: 2px; }
.chat-tool .out .chat-out-note { margin-top: 8px; font-family: "Segoe UI", system-ui, sans-serif; font-size: 11.5px; color: var(--chat-mute); font-style: italic; }
.chat-box textarea.suggest::placeholder { color: #8b8f97; font-style: italic; }
.chat-notice.warning { color: #e7c27a; border-color: rgba(231,194,122,.32); }
.chat-past-row { opacity: .45; }
.chat-tech { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--chat-line); font-size: .9em; }
.chat-tech, .chat-tech :is(p, li, strong, em, a, code) { color: var(--chat-mute) !important; }
.chat-handoff { align-self: stretch; display: flex; flex-direction: column; align-items: center; gap: 4px; margin: 6px 0; }
.chat-handoff-rule { align-self: stretch; display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--chat-mute); }
.chat-handoff-rule::before, .chat-handoff-rule::after { content: ""; flex: 1; border-top: 1px solid #3a3e45; }
.chat-handoff-rule .spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; }
.chat-handoff-links { display: flex; gap: 8px; font-size: 12px; color: var(--chat-mute); }
.chat-handoff-links button { font: inherit; color: var(--chat-accent); background: none; border: 0; padding: 0; cursor: pointer; }
.chat-handoff-links button:hover { text-decoration: underline; }
.chat-handoff-text { align-self: stretch; margin-top: 6px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--chat-line); background: #1b1d21; max-height: 420px; overflow: auto; scrollbar-width: thin; }
.chat-notice-block { align-self: center; max-width: min(100%, 640px); font-size: 12px; color: var(--chat-dim); padding: 6px 12px; border-radius: 10px; border: 1px solid var(--chat-line); background: #1b1d21; }
.chat-notice-block .text { color: #d4d4d8; }
.chat-notice-block .detail { margin-top: 3px; color: var(--chat-mute); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 9.6em; overflow: auto; scrollbar-width: thin; }
.chat-notice-block.warning { border-color: rgba(231,194,122,.32); }
.chat-notice-block.warning .text { color: #e7c27a; }
.chat-notice-block.error { border-color: rgba(248,113,113,.3); }
.chat-notice-block.error .text { color: #fca5a5; }
.chat-frame .chat-cut-row { display: flex; justify-content: flex-end; margin-top: 4px; user-select: none; }
.chat-frame .chat-cut { font-size: 11px; line-height: 1.5; padding: 0 7px; border-radius: 999px; border: 1px solid #4a3f2c; color: #e7c27a; }
.chat-live-now.retry .what { color: #e7c27a; }

/* SDK settings: effort, models, context breakdown, MCP, hooks, permissions. */
.chat-ctx { position: relative; cursor: default; }
.chat-ctx-pop { position: absolute; bottom: calc(100% + 8px); left: -6px; z-index: 7; width: 330px; max-width: 80vw; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); padding: 8px 10px; font-size: 12px; color: var(--chat-dim); white-space: normal; }
.chat-ctx-pop .head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.chat-ctx-pop .head b { color: #e4e4e7; font-weight: 600; }
.chat-ctx-pop .wait { color: var(--chat-mute); padding: 2px 0; }
.chat-ctx-pop .row { display: grid; grid-template-columns: minmax(0, 1fr) 64px 48px 38px; align-items: center; gap: 8px; padding: 2px 0; }
.chat-ctx-pop .row .l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #d4d4d8; }
.chat-ctx-pop .row .bar { height: 5px; border-radius: 3px; background: #2f3238; overflow: hidden; }
.chat-ctx-pop .row .bar i { display: block; height: 100%; min-width: 2px; background: var(--chat-accent); border-radius: 3px; }
.chat-ctx-pop .row.free .bar i { background: #3f444b; }
.chat-ctx-pop .row.buffer .bar i { background: #6b6f76; }
.chat-ctx-pop .row.free .l, .chat-ctx-pop .row.buffer .l { color: var(--chat-mute); }
.chat-ctx-pop .row .n, .chat-ctx-pop .row .p { text-align: right; font-variant-numeric: tabular-nums; }
.chat-ctx-pop .sub { display: flex; justify-content: space-between; gap: 8px; padding: 0 0 1px 12px; color: var(--chat-mute); font-size: 11.5px; }
.chat-ctx-pop .sub span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-mcp-chip { font-size: 11.5px; padding: 1px 9px; }
.chat-mcp-list { position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 7; width: 340px; max-width: 86vw; max-height: 300px; overflow: auto; scrollbar-width: thin; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 2px 6px rgba(0,0,0,.3); padding: 6px 10px; white-space: normal; }
.chat-mcp-list .row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 2px 8px; padding: 3px 0; font-size: 12px; }
.chat-mcp-list .row .dot { width: 7px; height: 7px; border-radius: 50%; background: #6b6f76; }
.chat-mcp-list .row.connected .dot { background: #4ade80; }
.chat-mcp-list .row.failed .dot { background: #f87171; }
.chat-mcp-list .row.needs-auth .dot, .chat-mcp-list .row.pending .dot { background: #fcd34d; }
.chat-mcp-list .row .n { color: #d4d4d8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-mcp-list .row .st { color: var(--chat-mute); white-space: nowrap; }
.chat-mcp-list .row.failed .st { color: #fca5a5; }
.chat-mcp-list .row .err { grid-column: 2 / 4; color: var(--chat-mute); font-size: 11.5px; overflow-wrap: anywhere; }
.chat-queued-mark .chat-queued-remove { margin-left: 2px; padding: 1px 4px; }
.chat-queued-mark .chat-queued-remove:hover { border-color: rgba(248,113,113,.5); color: #fca5a5; background: transparent; }
.chat-plugin-errors { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chat-plugin-errors .text { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.chat-plugin-errors .chat-btn { padding: 3px 10px; font-size: 12px; }
.chat-perm-asker { margin: 0 4px 6px; font-size: 12px; color: #c4b5fd; }
.chat-perm-facts { margin: 8px 4px 0; display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--chat-mute); }
.chat-perm-facts code { font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; color: var(--chat-dim); overflow-wrap: anywhere; }
.chat-perm-facts b { color: var(--chat-dim); font-weight: 500; }
.chat-btn.chat-perm-no { border-color: #5a3a2c; background: #2b2623; color: #f4f4f5; font-weight: 600; }
.chat-btn.chat-perm-no:focus-visible { outline: 2px solid var(--chat-accent); outline-offset: 2px; }
.chat-elicit-msg { margin: 0 4px 8px; font-size: 13.5px; color: var(--chat-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-elicit-url { margin: 0 4px; display: flex; flex-direction: column; gap: 2px; border: 1px solid #2b2e33; border-radius: 10px; background: #141619; padding: 8px 10px; font-size: 12px; color: var(--chat-mute); }
.chat-elicit-url b { color: #f4f4f5; font-size: 13px; font-weight: 600; }
.chat-elicit-url span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-elicit-form { display: flex; flex-direction: column; gap: 10px; margin: 0 4px; max-height: 40vh; overflow: auto; scrollbar-width: thin; }
.chat-elicit-field { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--chat-dim); }
.chat-elicit-field .lbl { color: #d4d4d8; }
.chat-elicit-field .lbl i { color: var(--chat-accent); font-style: normal; }
.chat-elicit-field .hint { color: var(--chat-mute); font-size: 12px; }
.chat-elicit-field .chat-ask-other { margin-top: 2px; }
.chat-elicit-field.check { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; cursor: pointer; }
.chat-elicit-field.check input { accent-color: var(--chat-accent); width: 15px; height: 15px; }
.chat-elicit-field.check .hint { flex-basis: 100%; padding-left: 23px; }
.chat-elicit-field .opts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.chat-elicit-field .opts .chat-chip { font: inherit; font-size: 12.5px; }
.chat-elicit-field .opts .chat-chip.on { background: #2b2623; border-color: #5a3a2c; color: #f4f4f5; }
.chat-elicit-error { margin: 8px 4px 0; font-size: 12.5px; color: #fca5a5; }

/* Ideas of 31/10: resume, startup, welcome, grill sheet, day separators, cards, narrow pane. */
.chat-startup { display: flex; align-items: center; gap: 10px; padding: 18px 2px 4px; color: var(--chat-dim); font-size: 13.5px; }
.chat-startup .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; flex-shrink: 0; }
.chat-welcome { margin-top: 18px; border: 1px solid var(--chat-line); border-radius: 14px; background: var(--chat-card); padding: 6px; display: flex; flex-direction: column; }
.chat-welcome .hd { display: flex; align-items: center; gap: 8px; padding: 6px 10px 8px; font-size: 12.5px; color: var(--chat-dim); }
.chat-welcome .hd .lucide { width: 14px; height: 14px; color: var(--chat-accent); }
/* Its search, top right: a session older than the list, found at each letter. */
.chat-welcome .hd .search { margin-left: auto; display: flex; align-items: center; gap: 6px; min-width: 0; border: 1px solid var(--chat-line); border-radius: 8px; background: #141619; padding: 3px 8px; cursor: text; }
.chat-welcome .hd .search:focus-within { border-color: #5a3a2c; }
.chat-welcome .hd .search .lucide { width: 13px; height: 13px; flex-shrink: 0; color: var(--chat-mute); }
.chat-welcome .hd .search input { width: 150px; min-width: 0; border: 0; outline: none; background: transparent; color: var(--chat-ink); font: inherit; font-size: 12.5px; }
.chat-welcome .hd .search input::placeholder { color: var(--chat-mute); }
.chat-welcome .none { padding: 7px 10px; font-size: 13px; color: var(--chat-mute); }
.chat-welcome .row { display: flex; align-items: baseline; gap: 12px; width: 100%; padding: 7px 10px; border: 0; border-radius: 9px; background: transparent; color: #e4e4e7; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; min-width: 0; }
.chat-welcome .row:hover:not(:disabled) { background: #202327; }
.chat-welcome .row:disabled { cursor: default; color: var(--chat-mute); }
.chat-welcome .row .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-welcome .row .m { flex-shrink: 0; font-size: 12px; color: var(--chat-mute); }
.chat-older-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--chat-line); border-radius: 999px; background: transparent; color: var(--chat-dim); font: inherit; font-size: 12px; padding: 4px 12px; cursor: pointer; }
.chat-older-btn:hover:not(:disabled) { color: var(--chat-ink); border-color: #464a51; }
.chat-older-btn:disabled { cursor: default; opacity: .7; }
.chat-older-btn .lucide { width: 13px; height: 13px; }
.chat-day { display: flex; align-items: center; gap: 12px; margin: 6px 0 -2px; color: var(--chat-mute); font-size: 11.5px; letter-spacing: .02em; user-select: none; }
.chat-day::before, .chat-day::after { content: ""; flex: 1; height: 1px; background: var(--chat-line); }
.chat-card .head .chat-open-file { margin-left: auto; width: 24px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--chat-mute); cursor: pointer; flex-shrink: 0; }
.chat-card .head .chat-open-file:hover { color: var(--chat-ink); background: rgba(255,255,255,.08); }
.chat-card .head .chat-open-file .lucide { width: 13px; height: 13px; }
.chat-card .head .chat-open-file + .tail { margin-left: 2px; }
.chat-artifact { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; vertical-align: middle; margin: 2px 0; padding: 4px 5px 4px 10px; border: 1px solid #3a3f46; border-radius: 10px; background: #1d2024; color: var(--chat-ink); font-size: 13px; line-height: 1.4; cursor: pointer; text-decoration: none; }
.chat-artifact:hover { border-color: #5a3a2c; background: #221f1d; }
.chat-artifact .ico { width: 15px; height: 15px; color: var(--chat-accent); flex-shrink: 0; }
.chat-artifact .k { color: var(--chat-accent); font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; flex-shrink: 0; }
.chat-artifact .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The open icon alone, no « Ouvrir » (the user's ask of 01/11/2026). */
.chat-artifact .go { width: 14px; height: 14px; flex-shrink: 0; margin-right: 4px; color: var(--chat-mute); }
.chat-artifact:hover .go { color: var(--chat-ink); }
.chat-edit-confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; padding: 8px 10px 8px 14px; border: 1px solid #5a3a2c; border-radius: 14px; background: #241f1c; font-size: 13px; color: #e4e4e7; }
.chat-edit-confirm > .lucide { width: 15px; height: 15px; color: var(--chat-accent); flex-shrink: 0; }
.chat-edit-confirm > span { flex: 1; min-width: 200px; }
/* The question sheet (the user's pick A of 31/10/2026): its progress on top, the options as a list with Claude's reco inside its own, the mic left of a field that shows only a caret, then the send. As tall as its question needs: it scrolls only in a pane too short for it, never under 160px (the user's ask of 02/11/2026). */
.chat-sheet-q { display: flex; flex-direction: column; max-height: max(160px, calc(100cqh - 140px)); margin-bottom: 8px; border: 1px solid #5a3a2c; border-radius: 16px; background: #1d2024; box-shadow: 0 2px 6px rgba(0,0,0,.3); overflow: hidden; }
.chat-sheet-q .hd { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 8px; border-bottom: 1px solid #2b2e33; flex-shrink: 0; }
.chat-sheet-q.folded .hd { border-bottom: 0; }
.chat-sheet-q .hd .fold { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: transparent; color: #f4f4f5; font: inherit; font-size: 13.5px; padding: 3px 6px; border-radius: 8px; cursor: pointer; text-align: left; }
.chat-sheet-q.folded .hd .fold { flex: 1; min-width: 0; }
.chat-sheet-q .hd .fold:hover { background: #25282c; }
.chat-sheet-q .hd .fold b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-sheet-q .hd .fold span { color: var(--chat-mute); font-size: 12px; }
.chat-sheet-q .hd .fold .lucide { width: 15px; height: 15px; color: var(--chat-accent); flex-shrink: 0; }
.chat-sheet-q .steps { flex: 0 1 auto; min-width: 0; overflow: hidden; display: flex; align-items: center; gap: 4px; }
.chat-sheet-q .seg { position: relative; width: 30px; flex: 0 1 auto; min-width: 6px; height: 18px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.chat-sheet-q .seg::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 4px; border-radius: 2px; background: #33363c; transition: background-color .12s ease-out; }
.chat-sheet-q .seg:hover::before { background: #464a51; }
.chat-sheet-q .seg.done::before { background: #2f6b47; }
.chat-sheet-q .seg.on::before { background: var(--chat-accent); }
.chat-sheet-q .seg.rec::after { content: ""; position: absolute; top: 0; right: 0; width: 6px; height: 6px; border-radius: 50%; background: #ef4444; }
.chat-sheet-q .hd .pos { flex-shrink: 0; margin-right: auto; color: var(--chat-mute); font-size: 12px; white-space: nowrap; }
.chat-sheet-q .hd .x { width: 26px; height: 26px; flex-shrink: 0; display: grid; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--chat-mute); cursor: pointer; }
.chat-sheet-q .hd .x:hover { color: var(--chat-ink); background: #2a2d32; }
.chat-sheet-q .hd .x .lucide { width: 15px; height: 15px; }
.chat-sheet-q .hd .chev { transition: transform .14s ease-out; }
.chat-sheet-q.folded .hd .chev { transform: rotate(-90deg); }
.chat-sheet-q .qs { overflow-y: auto; padding: 10px 14px 0; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-sheet-q .q { display: flex; flex-direction: column; gap: 8px; }
.chat-sheet-q .qt { font-size: 14.5px; color: #f4f4f5; font-weight: 600; }
.chat-sheet-q .qb { font-size: 13px; color: var(--chat-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-sheet-q .opts { display: flex; flex-direction: column; gap: 5px; }
.chat-sheet-q .opt { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; text-align: left; border: 1px solid #31353b; border-radius: 10px; background: transparent; color: var(--chat-ink); font: inherit; font-size: 13.5px; line-height: 1.45; padding: 6px 10px; cursor: pointer; transition: border-color .12s ease-out, background-color .12s ease-out; }
.chat-sheet-q .opt:hover { border-color: #464a51; background: #222529; }
.chat-sheet-q .opt.on { border-color: var(--chat-accent); background: #3a2519; }
.chat-sheet-q .opt .radio { width: 15px; height: 15px; flex-shrink: 0; box-sizing: border-box; border-radius: 50%; border: 2px solid #4a4e55; }
.chat-sheet-q .opt.on .radio { border: 4px solid var(--chat-accent); }
.chat-sheet-q .opt .k { flex-shrink: 0; color: var(--chat-mute); font-weight: 600; }
.chat-sheet-q .opt .v { color: #f4f4f5; font-weight: 600; overflow-wrap: anywhere; }
.chat-sheet-q .opt .why { display: flex; align-items: center; gap: 8px; min-width: 0; color: #d6b9a8; font-size: 12.5px; }
.chat-sheet-q .reco { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-size: 11px; font-weight: 700; line-height: 1.7; color: var(--chat-accent-ink); background: var(--chat-accent); border-radius: 999px; padding: 0 7px; }
.chat-sheet-q .reco .lucide { width: 11px; height: 11px; }
/* The field and its send stay in view at the list's bottom, however long the question. */
.chat-sheet-q .free { display: flex; align-items: flex-end; gap: 8px; position: sticky; bottom: 0; padding: 4px 0 12px; background: #1d2024; }
.chat-sheet-q .free .mic { width: 32px; height: 32px; flex-shrink: 0; display: grid; place-items: center; border: 0; border-radius: 9px; background: #2a2d32; color: var(--chat-ink); cursor: pointer; }
.chat-sheet-q .free .mic:hover:not(:disabled) { background: #33363c; }
.chat-sheet-q .free .mic:disabled { opacity: .45; cursor: default; }
.chat-sheet-q .free .mic.rec { background: #ef4444; color: #fff; }
.chat-sheet-q .free .mic .lucide { width: 15px; height: 15px; }
.chat-sheet-q .free .box { position: relative; flex: 1; min-width: 0; display: flex; }
.chat-sheet-q .free textarea { flex: 1; min-width: 0; resize: none; field-sizing: content; min-height: 32px; max-height: 120px; box-sizing: border-box; border: 1px solid #31353b; border-radius: 10px; background: #141619; color: var(--chat-ink); caret-color: var(--chat-accent); font: inherit; font-size: 13px; line-height: 1.5; padding: 5px 10px; outline: none; }
.chat-sheet-q .free textarea:focus { border-color: #5a3a2c; }
.chat-sheet-q .free .caret { position: absolute; left: 11px; top: 8px; width: 2px; height: 16px; border-radius: 1px; background: var(--chat-accent); pointer-events: none; animation: chat-caret-blink 1.1s steps(1) infinite; }
.chat-sheet-q .free .box:focus-within .caret { display: none; }
@keyframes chat-caret-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .chat-sheet-q .free .caret { animation: none; } }
.chat-sheet-q .chat-voice-live { padding: 0 16px 4px; font-size: 13px; }
/* Words dictated into the field as they come: a twin over its inside draws its text, then them in grey, scrolled to the newest. */
.chat-sheet-q .free .words { position: absolute; inset: 1px; z-index: 1; box-sizing: border-box; border-radius: 9px; background: #141619; color: var(--chat-ink); font-size: 13px; line-height: 1.5; padding: 5px 10px; white-space: pre-wrap; overflow-wrap: break-word; overflow: hidden; pointer-events: none; }
.chat-sheet-q .free .words i { color: #8b8f97; }
/* The round's one send, an icon at the free field's end (no footer: the bars above step between questions). */
.chat-sheet-q .free .send { width: 32px; height: 32px; flex-shrink: 0; display: grid; place-items: center; border: 0; border-radius: 9px; background: var(--chat-accent); color: var(--chat-accent-ink); cursor: pointer; transition: opacity .12s; }
.chat-sheet-q .free .send:disabled { opacity: .4; cursor: default; }
.chat-sheet-q .free .send .lucide { width: 15px; height: 15px; }
/* A narrow pane (under ~500 px): the switch and the input's chips as icons, the switch above the column, not over it. */
/* The conversation's map on its right edge: a tick per message, the part on screen framed (ChatMinimap, the user's pick 12 of 01/11/2026). */
.chat-minimap { position: absolute; right: 14px; width: 12px; z-index: 2; }
.chat-minimap > i { position: absolute; left: 0; right: 0; height: 3px; border-radius: 2px; background: #6b4a99; cursor: pointer; transform: translateY(-1px); transition: height .1s, transform .1s; }
.chat-minimap > i:hover { height: 6px; transform: translateY(-3px); }
.chat-minimap > i.user { background: #1f9f50; }
.chat-minimap > i.question { background: var(--chat-accent); }
.chat-minimap > i.visual { background: #3b82f6; }
.chat-minimap > i.error { background: #d9534f; }
.chat-minimap .view { position: absolute; left: -3px; right: -3px; min-height: 6px; border: 1px solid #4a4e55; border-radius: 4px; background: rgba(255,255,255,.03); pointer-events: none; }
.chat-minimap .peek { position: absolute; right: 22px; transform: translateY(-50%); width: 270px; display: flex; flex-direction: column; gap: 2px; background: #202327; border: 1px solid #31353b; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 7px 10px; font-size: 12px; line-height: 1.45; color: #d4d4d8; pointer-events: none; }
.chat-minimap .peek b { font-size: 11px; font-weight: 600; color: #b58af7; }
.chat-minimap .peek b.user { color: #22c55e; }
.chat-minimap .peek b.question { color: var(--chat-accent); }
.chat-minimap .peek b.visual { color: #60a5fa; }
.chat-minimap .peek b.error { color: #f08a87; }
.chat-minimap .peek span { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* Dictation under way: a live wave, the words as they come, how to finish (the user's pick 16 of 01/11/2026). */
.chat-voice-wave { display: flex; align-items: center; gap: 10px; padding: 4px 6px 2px; font-size: 12.5px; color: var(--chat-mute); }
.chat-voice-wave .wave { display: inline-flex; align-items: center; gap: 2px; height: 18px; flex-shrink: 0; }
.chat-voice-wave .wave i { display: block; width: 3px; height: 18px; border-radius: 2px; background: var(--chat-accent); transform: scaleY(.3); animation: chat-wave .9s ease-in-out infinite; }
.chat-voice-wave.still .wave i { animation: none; transform: scaleY(.25); opacity: .6; }
@keyframes chat-wave { 0%, 100% { transform: scaleY(.25); } 50% { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .chat-voice-wave .wave i { animation: none; transform: scaleY(.5); } }
.chat-voice-wave .words { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--chat-dim); font-style: italic; }
.chat-voice-wave .hint { margin-left: auto; flex-shrink: 0; }
.chat-paste-twin .interim { color: #8b8f97; font-style: italic; }
/* Size, not inline-size: the question sheet grows to the pane's height (100cqh) before it scrolls. */
.chat-root { container-type: size; }
@container (max-width: 640px) { .chat-minimap { display: none; } }
@container (max-width: 500px) {
  .chat-sheet-q:not(.folded) .hd .fold b { display: none; }
  .chat-sheet-q:not(.folded) .hd .fold { flex-shrink: 0; }
  .chat-col { width: calc(100% - 24px); }
  .chat-scroll-inner { padding-top: 46px; }
  .chat-title { font-size: 27px; }
  .chat-tools-row { gap: 6px; }
  .chat-tools-row .chat-chip:has(> .lucide) .lbl { display: none; }
  .chat-tools-row .chat-chip:has(> .lucide) { padding: 3px 7px; }
  .chat-edit-confirm > span { min-width: 0; flex-basis: 100%; }
}
/* Attachments: cards above the input and in the user's frame (an image whole, its width following it; any other file by its icon and name), × on hover; the images Claude reads, small in their tool line. */
.chat-files { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
.chat-box > .chat-files { padding: 2px 2px 10px; max-height: min(30vh, 216px); overflow-y: auto; }
.chat-frame > .chat-files { margin: 6px 0 2px; }
.chat-file { position: relative; flex-shrink: 0; width: 128px; height: 96px; box-sizing: border-box; display: flex; flex-direction: column; align-items: stretch; border-radius: 10px; border: 1px solid #3a3e45; background: #1b1d21; color: var(--chat-dim); overflow: hidden; cursor: pointer; outline: none; transition: border-color .12s ease-out; }
.chat-file:hover { border-color: #5a5f67; }
.chat-file:focus-visible { border-color: var(--chat-accent); }
.chat-file.thumb { width: auto; min-width: 64px; max-width: 160px; align-items: center; justify-content: center; background: #111215; cursor: zoom-in; }
.chat-file.thumb.loading { width: 96px; }
.chat-file.thumb img { display: block; height: 100%; width: auto; max-width: 158px; object-fit: contain; }
.chat-file .ph { width: 20px; height: 20px; color: #5b5f66; }
.chat-file .well { flex: 1; min-height: 0; display: grid; place-items: center; background: #141619; }
.chat-file .ic { width: 24px; height: 24px; stroke-width: 1.5; color: var(--chat-dim); }
.chat-file .nm { flex-shrink: 0; padding: 6px 9px; border-top: 1px solid #2b2e33; font-size: 11.5px; line-height: 1.35; color: var(--chat-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-file .x { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center; background: rgba(0,0,0,.72); color: #fff; cursor: pointer; opacity: 0; transition: opacity .12s ease-out; }
.chat-file:hover .x, .chat-file:focus-within .x { opacity: 1; }
.chat-file .x:hover { background: #000; }
.chat-file .x .lucide { width: 12px; height: 12px; }
@media (hover: none) { .chat-file .x { opacity: 1; } }
/* Above the input, half the size (the user's ask of 31/10/2026): an image 48 px high, any other file a one-line chip. */
.chat-box > .chat-files { max-height: min(30vh, 112px); }
.chat-box > .chat-files .chat-file { height: 48px; width: auto; max-width: 220px; flex-direction: row; border-radius: 8px; }
.chat-box > .chat-files .chat-file .well { flex: 0 0 46px; }
.chat-box > .chat-files .chat-file .ic { width: 18px; height: 18px; }
.chat-box > .chat-files .chat-file .nm { align-self: center; border-top: 0; padding: 0 10px 0 8px; }
.chat-box > .chat-files .chat-file.thumb { min-width: 32px; max-width: 80px; }
.chat-box > .chat-files .chat-file.thumb.loading { width: 48px; }
.chat-box > .chat-files .chat-file.thumb img { max-width: 78px; }
.chat-box > .chat-files .chat-file .ph { width: 16px; height: 16px; }
.chat-box > .chat-files .chat-file .x { top: 2px; right: 2px; width: 16px; height: 16px; }
.chat-box > .chat-files .chat-file .x .lucide { width: 10px; height: 10px; }
.chat-read-thumbs { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
.chat-read-thumb { display: inline-block; min-width: 1px; height: 22px; }
.chat-read-thumb img { display: block; height: 22px; width: auto; max-width: 44px; object-fit: contain; background: #111215; border-radius: 4px; border: 1px solid rgba(255,255,255,.14); cursor: zoom-in; }
.chat-read-thumb img:hover { border-color: rgba(255,255,255,.4); }
.chat-read-alt { min-width: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--chat-dim); }
/* Voice, sheet, agent stop, pencil */
/* The words of a dictation under way, dim under the text until it lands. */
.chat-voice-live { padding: 0 6px 4px; color: #8b8f97; font-style: italic; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 30vh; overflow-y: auto; }
.chat-voice-live::after { content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: #ef4444; vertical-align: middle; animation: chat-voice-pulse 1.2s ease-in-out infinite; }
@keyframes chat-voice-pulse { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .chat-voice-live::after { animation: none; } }
/* Claude's message while the sheet holds its questions. */
.chat-bare-note { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 12px; font-style: italic; color: var(--chat-mute); }
.chat-bare-note .lucide { width: 13px; height: 13px; color: var(--chat-accent); }
/* A running subagent's stop, behind a question. */
.chat-agent-stop { flex-shrink: 0; width: 24px; height: 22px; margin: -2px -6px -2px 0; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--chat-mute); cursor: pointer; transition: color .12s, background .12s; }
.chat-agent-stop:hover { color: #fca5a5; background: rgba(239,68,68,.14); }
.chat-agent-ask { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-left: 22px; font-size: 12.5px; color: #fecaca; cursor: default; }
.chat-agent-ask span { margin-right: auto; }
.chat-agent-ask .chat-btn { padding: 2px 10px; font-size: 12px; }
/* The pencil when it can't act now: there, dim, its tooltip says why. */
.chat-frame-foot .copy.edit.blocked { opacity: .45; }
.chat-frame-foot .copy.edit.blocked { cursor: help; }
.chat-frame-foot .copy.edit.blocked:hover { color: #77708c; background: transparent; }
/* The input's bottom row (the user's pick of 31/10/2026): the session's button and its rings on the left, the input's own actions, the mic and send on the right; nothing under the input any more. */
.chat-tools-end { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.chat-tools-row { flex-wrap: wrap; row-gap: 6px; }
/* The rings take what is left and wrap among themselves in a narrow pane. */
.chat-tools-row > .chat-status { flex: 1 1 0; padding: 0; min-width: 0; gap: 4px 12px; }
.chat-tools-row .chat-shells { margin-top: 0; }
.chat-session-btn small .fast { color: #fcd34d; }
.chat-session-btn small .fast.cooldown { color: var(--chat-mute); }
.chat-session-btn { display: inline-flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; flex-shrink: 0; min-height: 34px; padding: 3px 10px 3px 11px; border-radius: 10px; border: 1px solid #31353b; background: #24272c; color: var(--chat-ink); font: inherit; line-height: 1.1; cursor: pointer; }
.chat-session-btn:hover { border-color: #464a51; }
.chat-session-btn.open { border-color: var(--chat-accent); }
.chat-session-btn b { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; color: #f4f4f5; white-space: nowrap; }
.chat-session-btn b .lucide { width: 12px; height: 12px; color: var(--chat-mute); }
.chat-session-btn small { font-size: 10.5px; color: var(--chat-mute); white-space: nowrap; }
.chat-session-menu { width: 300px; max-height: min(460px, 70vh); overflow: auto; scrollbar-width: thin; scrollbar-color: #31353b transparent; padding: 8px; }
.chat-session-menu h6 { margin: 6px 8px 4px; font-size: 11px; font-weight: 600; color: var(--chat-mute); }
.chat-session-menu .ck { margin-left: auto; width: 14px; height: 14px; color: var(--chat-accent); }
/* The effort slider (the user's pick of 31/10/2026): accent up to the thumb, the level named at the right of its title. */
.chat-effort-slider { margin: 0 8px 6px; }
.chat-effort-slider .hd { display: flex; align-items: baseline; justify-content: space-between; margin: 6px 0 2px; }
.chat-effort-slider .hd h6 { margin: 0; }
.chat-effort-slider .hd b { font-size: 12px; font-weight: 600; color: #f4f4f5; }
.chat-effort-slider input { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 20px; margin: 0; background: transparent; cursor: pointer; }
.chat-effort-slider input::-webkit-slider-runnable-track { height: 4px; border-radius: 999px; background: linear-gradient(to right, var(--chat-accent) var(--pct), #31353b var(--pct)); }
.chat-effort-slider input::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: #f4f4f5; border: 2px solid var(--chat-accent); box-shadow: 0 1px 3px rgba(0,0,0,.45); }
.chat-effort-slider input:focus-visible { outline: none; }
.chat-effort-slider input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px color-mix(in srgb, var(--chat-accent) 35%, transparent); }
.chat-effort-slider input.unset::-webkit-slider-thumb { opacity: 0; }
.chat-effort-slider .ends { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--chat-mute); }
.chat-session-modes { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 4px 4px; }
.chat-session-modes button { width: auto; gap: 5px; padding: 3px 9px; border-radius: 999px; border: 1px solid #31353b; font-size: 12px; color: var(--chat-dim); }
.chat-session-modes button.on { border-color: var(--chat-accent); color: #f4f4f5; background: #2b2623; }
.chat-session-modes .lucide { width: 12px; height: 12px; }
.chat-session-fast { margin: 6px 8px 2px; font-size: 11.5px; color: #fcd34d; }
`;
