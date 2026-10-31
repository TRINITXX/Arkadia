import serifItalic from "@/components/chat/fonts/instrument-serif-italic.woff2?url";
import serifRegular from "@/components/chat/fonts/instrument-serif-regular.woff2?url";

/**
 * The chat view's look ("Colonne calme", mockup A of 30/10/2026): a centred
 * column on the terminal's grey (#181a1d), the user's words in a bubble, Claude's without, tool
 * runs folded into one quiet line, one accent (terracotta). Scoped under
 * `.chat-root`.
 */
export const CHAT_CSS = `
@font-face { font-family: "Instrument Serif"; font-style: normal; font-weight: 400; font-display: swap; src: url(${serifRegular}) format("woff2"); }
@font-face { font-family: "Instrument Serif"; font-style: italic; font-weight: 400; font-display: swap; src: url(${serifItalic}) format("woff2"); }

.chat-root { --chat-bg: #181a1d; --chat-ink: #e4e4e7; --chat-dim: #a1a1aa; --chat-mute: #858790; --chat-line: #2b2e33; --chat-card: #141619; --chat-accent: #e2865f; --chat-accent-ink: #1a0f0a;
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: stretch; background: var(--chat-bg); color: var(--chat-ink);
  font-family: "Segoe UI", system-ui, sans-serif; font-size: 14.5px; line-height: 1.6; }
.chat-root *, .chat-root *::before, .chat-root *::after { box-sizing: border-box; }
.chat-col { width: min(760px, 100% - 48px); margin: 0 auto; }

.chat-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-scroll-inner { display: flex; flex-direction: column; gap: 14px; padding: 28px 0 18px; }
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
.chat-line b { color: var(--chat-dim); font-weight: 500; }
.chat-line .lucide { width: 15px; height: 15px; flex-shrink: 0; }
.chat-line .chev { transition: transform .14s ease-out; }
.chat-line .chev.open { transform: rotate(90deg); }
.chat-line .spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; flex-shrink: 0; }
@keyframes chat-spin { to { transform: rotate(360deg); } }
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
.chat-qa { display: flex; flex-direction: column; gap: 2px; }
.chat-qa .q { color: var(--chat-dim); font-size: 13px; }
.chat-qa .a { color: var(--chat-ink); }

.chat-bottom { flex-shrink: 0; display: flex; flex-direction: column; align-items: stretch; padding: 0 0 12px; background: linear-gradient(transparent, var(--chat-bg) 14px); }
.chat-live { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--chat-dim); padding: 8px 2px; min-height: 36px; }
.chat-live .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; }
.chat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: #202327; border: 1px solid #31353b; color: #d4d4d8; font-size: 12px; line-height: 1.4; cursor: pointer; user-select: none; white-space: nowrap; }
.chat-chip:hover { border-color: #464a51; }
.chat-chip.static { cursor: default; }
.chat-chip .lucide { width: 13px; height: 13px; }
.chat-chip.warn { color: #fcd34d; border-color: rgba(252,211,77,.25); }

.chat-box { position: relative; border-radius: 20px; background: #202327; border: 1px solid #31353b; box-shadow: 0 18px 50px rgba(0,0,0,.55); padding: 12px 12px 8px; }
.chat-box.ask { border-color: #5a3a2c; }
.chat-box textarea { width: 100%; resize: none; border: 0; outline: none; background: transparent; color: var(--chat-ink); font: inherit; line-height: 1.55; padding: 2px 6px; max-height: 40vh; min-height: 26px; }
.chat-box textarea::placeholder { color: #6b6f76; }
.chat-attach { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px 8px; }
.chat-attach .img { position: relative; width: 52px; height: 52px; border-radius: 9px; overflow: hidden; border: 1px solid #31353b; }
.chat-attach .img img { width: 100%; height: 100%; object-fit: cover; }
.chat-attach .img button { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: rgba(0,0,0,.7); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; }
.chat-tools-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #2b2e33; color: var(--chat-dim); font-size: 12.5px; }
.chat-tools-row > .chat-chip, .chat-tools-row > .chat-anchor, .chat-anchor > .chat-chip { min-width: 0; }
.chat-tools-row .chat-chip .lucide { flex-shrink: 0; }
.chat-chip .lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.chat-ib { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: #2a2d32; border: 0; color: var(--chat-dim); cursor: pointer; flex-shrink: 0; }
.chat-ib:not(:disabled):hover { color: var(--chat-ink); }
.chat-rail { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.chat-ib.sky { background: rgba(56,189,248,.10); } .chat-ib.sky:hover { background: rgba(56,189,248,.20); } .chat-ib.sky.on { background: rgba(56,189,248,.28); color: #bae6fd; }
.chat-ib.rose { background: rgba(244,63,94,.10); } .chat-ib.rose:hover { background: rgba(244,63,94,.20); } .chat-ib.rose.on { background: rgba(244,63,94,.28); color: #fecdd3; }
.chat-ib:disabled { opacity: .45; cursor: default; }
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
.chat-push { margin-left: auto; }

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

.chat-menu { position: absolute; bottom: calc(100% + 6px); min-width: 220px; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 6px; z-index: 6; }
.chat-menu button { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent; color: #d4d4d8; font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; cursor: pointer; text-align: left; }
.chat-menu button:hover, .chat-menu button.on { background: #2f3238; }
.chat-menu .hint { color: var(--chat-mute); font-size: 12px; margin-left: auto; }
.chat-anchor { position: relative; display: inline-flex; }

.chat-tasks { position: absolute; bottom: calc(100% + 6px); left: 0; min-width: 300px; max-width: 420px; max-height: 320px; overflow: auto; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 8px 10px; z-index: 6; }
.chat-tasks .t { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 13px; color: #d4d4d8; }
.chat-tasks .t.done { color: var(--chat-mute); text-decoration: line-through; }
.chat-tasks .t .lucide { width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0; }
.chat-tasks .t.doing .lucide { color: var(--chat-accent); }

.chat-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 92%); z-index: 9; background: #1b1d21; border-left: 1px solid #2b2e33; box-shadow: -18px 0 50px rgba(0,0,0,.5); display: flex; flex-direction: column; }
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

.chat-down { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 8px); border-radius: 999px; border: 1px solid #31353b; background: #202327; color: #d4d4d8; padding: 4px 12px; font: inherit; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
.chat-down .lucide { width: 13px; height: 13px; }
.chat-closed { display: flex; align-items: center; gap: 10px; justify-content: center; font-size: 13px; color: #fca5a5; padding: 8px; }

/* Conversation: messages, images, tools, live line, plan, search. */
/* Messages in the terminal's frames (the display mod outils-discrets): green for the user, violet for Claude, blue for another session or a subagent, red edge on an error. Over the old bubble (.chat-user). */
.chat-root .chat-frame { align-self: stretch; max-width: none; width: 100%; border: 1px solid; border-radius: 10px; padding: 5px 14px 10px; white-space: normal; color: var(--chat-ink); }
.chat-frame.user { border-color: #1f9f50; background: linear-gradient(rgb(25,36,40), rgb(21,31,34)); }
.chat-frame.claude { border-color: #8648c5; background: linear-gradient(rgb(33,33,48), rgb(26,25,38)); }
.chat-frame.peer { border-color: #2f74b5; background: linear-gradient(rgb(22,31,43), rgb(19,26,36)); }
.chat-frame.error { border-color: #d9534f; }
.chat-frame-head { display: flex; align-items: center; gap: 7px; height: 24px; font-size: 12.5px; margin-bottom: 2px; user-select: none; }
.chat-frame-head .lucide { width: 14px; height: 14px; flex-shrink: 0; }
.chat-frame.user .chat-frame-head { color: #22c55e; }
.chat-frame.claude .chat-frame-head { color: #b58af7; }
.chat-frame.peer .chat-frame-head { color: #60a5fa; }
.chat-frame.error .chat-frame-head { color: #f08a87; }
.chat-frame-head b { font-weight: 600; }
.chat-frame-head time { color: var(--chat-mute); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.chat-frame-head .copy { margin-left: auto; width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--chat-mute); cursor: pointer; opacity: 0; transition: opacity .12s; }
.chat-frame:hover .chat-frame-head .copy, .chat-frame-head .copy:focus-visible { opacity: 1; }
.chat-frame-head .copy:hover { color: var(--chat-ink); background: rgba(255,255,255,.08); }
/* Claude's « Copier le message »: at the foot, always there, discreet; none while it streams. */
.chat-frame-foot { display: flex; justify-content: flex-end; height: 22px; margin: 2px -8px -6px 0; }
.chat-frame-foot .copy { width: 26px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #77708c; cursor: pointer; transition: color .12s, background .12s; }
.chat-frame-foot .copy:hover { color: var(--chat-ink); background: rgba(255,255,255,.08); }
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
.chat-root .modern-code-copy { position: absolute; right: 6px; bottom: 6px; width: 26px; height: 24px; display: grid; place-items: center; padding: 0; border-radius: 6px; border: 1px solid #2e3238; background: rgba(15,17,20,.92); color: #6f727a; cursor: pointer; transition: color .12s, border-color .12s; }
.chat-root .modern-code-copy:hover { color: var(--chat-ink); border-color: #4a4f57; }
.chat-root .modern-code-copy.copied { color: #86efac; border-color: rgba(134,239,172,.4); }
.chat-root .modern-path { cursor: pointer; }
.chat-root .modern-path:hover { color: #9ec5f8; }
.chat-root .modern-path .ext-ico { display: inline-flex; margin-left: 3px; vertical-align: -1px; opacity: .7; }
/* An image path left as text: the picture is in the strip, a click opens it. */
.chat-root .modern-imgpath { color: #9ec5f8; cursor: zoom-in; text-decoration: underline dotted; text-underline-offset: 3px; overflow-wrap: anywhere; }
.chat-root .modern-imgpath:hover { color: #cfe2fb; }
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
/* « ✻ Terminé en … » after a long turn. */
.chat-done { color: var(--chat-mute); font-size: 12.5px; padding: 0 2px; }
/* A plan waiting for the user: in full, the accent edge of the requests. */
.chat-plan-card.pending { border-color: #5a3a2c; }
.chat-plan-card .body .reading-md { font-size: 14px; }
/* Ctrl+F: the box under the chat / terminal switch. */
.chat-search { position: absolute; top: 48px; right: 14px; z-index: 8; display: flex; align-items: center; gap: 2px; width: min(340px, calc(100% - 28px)); padding: 4px 6px 4px 12px; border-radius: 10px; background: #202327; border: 1px solid #31353b; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
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
.chat-slash { position: absolute; left: 10px; right: 10px; bottom: calc(100% + 6px); z-index: 5; max-height: min(380px, 52vh); overflow: auto; border-radius: 14px; background: #202327; border: 1px solid #31353b; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 4px; scroll-padding: 26px 0 4px; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
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

/* Live activity: agent cards, workflow card, shells chip. */
.chat-agent-cards { display: flex; flex-direction: column; gap: 6px; margin: 0 0 8px; max-height: 32vh; overflow: auto; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-agent-card { border: 1px solid #2b2e33; border-radius: 12px; background: #1d2024; padding: 7px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; min-width: 0; flex-shrink: 0; transition: border-color .15s; }
.chat-agent-card:hover { border-color: #464a51; }
.chat-agent-card .r1 { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: #e4e4e7; }
.chat-agent-card .r1 .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.chat-agent-card .r1 .type { flex-shrink: 0; font-size: 11px; color: var(--chat-mute); border: 1px solid #31353b; border-radius: 999px; padding: 0 7px; }
.chat-agent-card .r1 .figs, .chat-wf .figs { margin-left: auto; flex-shrink: 0; font-size: 12px; color: var(--chat-mute); font-variant-numeric: tabular-nums; white-space: nowrap; }
.chat-agent-card .r2 { display: flex; align-items: baseline; gap: 12px; min-width: 0; padding-left: 22px; font-size: 12px; color: var(--chat-dim); }
.chat-agent-card .r2 .sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-agent-card .r2 .act { margin-left: auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--chat-mute); font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; }
.chat-agent-card .r2 .retry { color: #fcd34d; }
.chat-agent-card .spin, .chat-wf .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #464a51; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; flex-shrink: 0; }
.chat-agent-card .lucide, .chat-wf .agent .lucide, .chat-wf .line > .lucide { width: 14px; height: 14px; flex-shrink: 0; }
.chat-agent-card .ok, .chat-wf .ok { color: #4ade80; }
.chat-agent-card .ko, .chat-wf .ko { color: #f87171; }
/* An ended card: ✓ a moment, then it fades as it leaves (CARD_LINGER_MS). */
.chat-agent-card.ended, .chat-wf.ended { animation: chat-card-out 2.5s ease-in forwards; }
@keyframes chat-card-out { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
.chat-wf { border: 1px solid #2b2e33; border-radius: 12px; background: #1d2024; margin: 0 0 8px; overflow: hidden; flex-shrink: 0; }
.chat-wf .line { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; font-size: 13px; color: #e4e4e7; min-width: 0; user-select: none; }
.chat-wf .line:hover { background: #202327; }
.chat-wf .line .ic { color: var(--chat-accent); }
.chat-wf .line .name { font-weight: 500; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-wf .bar { flex: 1; min-width: 40px; height: 5px; border-radius: 999px; background: #2b2e33; overflow: hidden; }
.chat-wf .bar > span { display: block; height: 100%; background: var(--chat-accent); border-radius: 999px; transition: width .4s ease-out; }
.chat-wf .line .figs { margin-left: 0; }
.chat-wf .line .chev { color: var(--chat-mute); }
.chat-wf .body { border-bottom: 1px solid #26292e; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.chat-wf .desc { font-size: 12.5px; color: var(--chat-dim); }
.chat-wf .cols { display: grid; grid-template-columns: minmax(120px, 34%) minmax(0, 1fr); gap: 10px; max-height: 34vh; }
.chat-wf .phases, .chat-wf .agents { overflow: auto; display: flex; flex-direction: column; gap: 2px; min-width: 0; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
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
.chat-shells-list { position: absolute; bottom: calc(100% + 6px); right: 0; width: min(560px, 90vw); max-height: 50vh; overflow: auto; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 10px; z-index: 6; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-shells-list .shell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.chat-shells-list .head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.chat-shells-list .cmd { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; color: #a5f3fc; }
.chat-shells-list .dur { margin-left: auto; flex-shrink: 0; font-size: 12px; color: var(--chat-mute); font-variant-numeric: tabular-nums; }
.chat-shells-list .what { font-size: 12px; color: var(--chat-mute); }
.chat-shells-list .out { margin: 0; max-height: 200px; overflow: auto; border: 1px solid #2b2e33; border-radius: 8px; background: #141619; padding: 6px 9px; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 11.5px; line-height: 1.5; color: var(--chat-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-shells-list .out.empty { color: var(--chat-mute); font-style: italic; }
.chat-live-now .step-time { flex-shrink: 0; white-space: pre; color: var(--chat-dim); }
.chat-live .bg-hint { color: var(--chat-mute); }
.chat-agents-done { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--chat-mute); cursor: pointer; white-space: nowrap; text-decoration: underline; text-decoration-color: #464a51; text-underline-offset: 3px; }
.chat-agents-done:hover { color: var(--chat-dim); }
.chat-agents-done .lucide { width: 13px; height: 13px; }

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
.chat-notice-block { align-self: center; max-width: min(100%, 640px); font-size: 12px; color: var(--chat-dim); padding: 6px 12px; border-radius: 10px; border: 1px solid var(--chat-line); background: #1b1d21; }
.chat-notice-block .text { color: #d4d4d8; }
.chat-notice-block .detail { margin-top: 3px; color: var(--chat-mute); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 9.6em; overflow: auto; scrollbar-width: thin; }
.chat-notice-block.warning { border-color: rgba(231,194,122,.32); }
.chat-notice-block.warning .text { color: #e7c27a; }
.chat-notice-block.error { border-color: rgba(248,113,113,.3); }
.chat-notice-block.error .text { color: #fca5a5; }
.chat-frame-head .chat-cut { font-size: 11px; line-height: 1.5; padding: 0 7px; border-radius: 999px; border: 1px solid #4a3f2c; color: #e7c27a; }
.chat-live-now.retry .what { color: #e7c27a; }

/* SDK settings: effort, models, context breakdown, MCP, hooks, permissions. */
.chat-model-menu { max-height: min(340px, 50vh); overflow: auto; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-effort-menu { min-width: 170px; }
.chat-fast { flex-shrink: 0; font-size: 11.5px; color: #fcd34d; padding: 2px 8px; border-radius: 999px; background: rgba(252,211,77,.08); border: 1px solid rgba(252,211,77,.22); white-space: nowrap; cursor: default; }
.chat-fast.cooldown { color: var(--chat-mute); background: transparent; border-color: #31353b; }
.chat-ctx { position: relative; cursor: default; }
.chat-ctx-pop { position: absolute; bottom: calc(100% + 8px); left: -6px; z-index: 7; width: 330px; max-width: 80vw; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 8px 10px; font-size: 12px; color: var(--chat-dim); white-space: normal; }
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
.chat-mcp-list { position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 7; width: 340px; max-width: 86vw; max-height: 300px; overflow: auto; scrollbar-width: thin; border-radius: 12px; background: #202327; border: 1px solid #31353b; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 6px 10px; white-space: normal; }
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
.chat-frame-head .copy.edit + .copy { margin-left: 0; }
.chat-card .head .chat-open-file { margin-left: auto; width: 24px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--chat-mute); cursor: pointer; flex-shrink: 0; }
.chat-card .head .chat-open-file:hover { color: var(--chat-ink); background: rgba(255,255,255,.08); }
.chat-card .head .chat-open-file .lucide { width: 13px; height: 13px; }
.chat-card .head .chat-open-file + .tail { margin-left: 2px; }
.chat-artifact { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; vertical-align: middle; margin: 2px 0; padding: 4px 5px 4px 10px; border: 1px solid #3a3f46; border-radius: 10px; background: #1d2024; color: var(--chat-ink); font-size: 13px; line-height: 1.4; cursor: pointer; text-decoration: none; }
.chat-artifact:hover { border-color: #5a3a2c; background: #221f1d; }
.chat-artifact .ico { width: 15px; height: 15px; color: var(--chat-accent); flex-shrink: 0; }
.chat-artifact .k { color: var(--chat-accent); font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; flex-shrink: 0; }
.chat-artifact .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-artifact .go { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; padding: 2px 9px; border-radius: 7px; background: #2a2d32; color: #d4d4d8; font-size: 12px; }
.chat-artifact .go .lucide { width: 12px; height: 12px; }
.chat-edit-confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; padding: 8px 10px 8px 14px; border: 1px solid #5a3a2c; border-radius: 14px; background: #241f1c; font-size: 13px; color: #e4e4e7; }
.chat-edit-confirm > .lucide { width: 15px; height: 15px; color: var(--chat-accent); flex-shrink: 0; }
.chat-edit-confirm > span { flex: 1; min-width: 200px; }
.chat-sheet-q { display: flex; flex-direction: column; max-height: 46vh; margin-bottom: 8px; border: 1px solid #5a3a2c; border-radius: 16px; background: #1d2024; box-shadow: 0 14px 40px rgba(0,0,0,.45); overflow: hidden; }
.chat-sheet-q .hd { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 8px; border-bottom: 1px solid #2b2e33; }
.chat-sheet-q.folded .hd { border-bottom: 0; }
.chat-sheet-q .hd .fold { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: transparent; color: #f4f4f5; font: inherit; font-size: 13.5px; padding: 3px 6px; border-radius: 8px; cursor: pointer; text-align: left; }
.chat-sheet-q .hd .fold:hover { background: #25282c; }
.chat-sheet-q .hd .fold span { color: var(--chat-mute); font-size: 12px; }
.chat-sheet-q .hd .fold > .lucide:first-child { width: 15px; height: 15px; color: var(--chat-accent); flex-shrink: 0; }
.chat-sheet-q .hd .chev { width: 14px; height: 14px; margin-left: auto; color: var(--chat-mute); transition: transform .14s ease-out; }
.chat-sheet-q.folded .hd .chev { transform: rotate(-90deg); }
.chat-sheet-q .hd .x { width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--chat-mute); cursor: pointer; }
.chat-sheet-q .hd .x:hover { color: var(--chat-ink); background: #2a2d32; }
.chat-sheet-q .hd .x .lucide { width: 15px; height: 15px; }
.chat-sheet-q .qs { overflow-y: auto; padding: 4px 12px; scrollbar-width: thin; scrollbar-color: #31353b transparent; }
.chat-sheet-q .q { padding: 10px 0; border-bottom: 1px solid #26292e; display: flex; flex-direction: column; gap: 6px; }
.chat-sheet-q .q:last-child { border-bottom: 0; }
.chat-sheet-q .qt { font-size: 13.5px; color: #f4f4f5; font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
.chat-sheet-q .qt .id { flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--chat-accent-ink); background: var(--chat-accent); border-radius: 6px; padding: 0 6px; }
.chat-sheet-q .qb { font-size: 12.5px; color: var(--chat-dim); white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.chat-sheet-q .qr { font-size: 12.5px; color: #d6b9a8; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-sheet-q .opts { display: flex; flex-wrap: wrap; gap: 6px; }
.chat-sheet-q .opt { border: 1px solid #31353b; border-radius: 999px; background: #202327; color: #d4d4d8; font: inherit; font-size: 12.5px; padding: 3px 11px; cursor: pointer; max-width: 100%; text-align: left; }
.chat-sheet-q .opt:hover { border-color: #464a51; }
.chat-sheet-q .opt b { color: var(--chat-dim); font-weight: 600; }
.chat-sheet-q .opt.rec { border-color: #5a3a2c; }
.chat-sheet-q .opt.reco { color: #f4d0bd; border-color: #5a3a2c; }
.chat-sheet-q .opt.on { background: var(--chat-accent); border-color: var(--chat-accent); color: var(--chat-accent-ink); }
.chat-sheet-q .opt.on b { color: var(--chat-accent-ink); }
.chat-sheet-q .free { display: flex; align-items: flex-end; gap: 6px; }
.chat-sheet-q .free textarea { flex: 1; min-width: 0; resize: none; field-sizing: content; max-height: 120px; border: 1px solid #31353b; border-radius: 10px; background: #141619; color: var(--chat-ink); font: inherit; font-size: 13px; line-height: 1.5; padding: 5px 10px; outline: none; }
.chat-sheet-q .free textarea:focus { border-color: #5a3a2c; }
.chat-sheet-q .free textarea::placeholder { color: #6b6f76; }
.chat-sheet-q .free .mic { width: 30px; height: 30px; flex-shrink: 0; display: grid; place-items: center; border: 0; border-radius: 9px; background: #2a2d32; color: var(--chat-dim); cursor: pointer; }
.chat-sheet-q .free .mic:hover:not(:disabled) { color: var(--chat-ink); }
.chat-sheet-q .free .mic:disabled { opacity: .45; cursor: default; }
.chat-sheet-q .free .mic.rec { background: #ef4444; color: #fff; }
.chat-sheet-q .free .mic .lucide { width: 15px; height: 15px; }
.chat-sheet-q .ft { display: flex; align-items: center; gap: 10px; justify-content: flex-end; padding: 8px 12px; border-top: 1px solid #2b2e33; font-size: 12px; color: var(--chat-mute); }
.chat-sheet-q .ft span { margin-right: auto; }
/* A narrow pane (under ~500 px): the switch and the input's chips as icons, the switch above the column, not over it. */
.chat-root { container-type: inline-size; }
@container (max-width: 500px) {
  .chat-col { width: calc(100% - 24px); }
  .chat-scroll-inner { padding-top: 46px; }
  .chat-title { font-size: 27px; }
  .chat-toggle { top: 8px; right: 10px; }
  .chat-toggle .lbl { display: none; }
  .chat-toggle button { padding: 3px 7px; }
  .chat-tools-row { gap: 6px; }
  .chat-tools-row .chat-chip:has(> .lucide) .lbl { display: none; }
  .chat-tools-row .chat-chip:has(> .lucide) { padding: 3px 7px; }
  .chat-edit-confirm > span { min-width: 0; flex-basis: 100%; }
}
`;
