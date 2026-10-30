import serifItalic from "@/components/chat/fonts/instrument-serif-italic.woff2?url";
import serifRegular from "@/components/chat/fonts/instrument-serif-regular.woff2?url";

/**
 * The chat view's look ("Colonne calme", mockup A of 30/10/2026): a centred
 * column on near-black, the user's words in a bubble, Claude's without, tool
 * runs folded into one quiet line, one accent (terracotta). Scoped under
 * `.chat-root`.
 */
export const CHAT_CSS = `
@font-face { font-family: "Instrument Serif"; font-style: normal; font-weight: 400; font-display: swap; src: url(${serifRegular}) format("woff2"); }
@font-face { font-family: "Instrument Serif"; font-style: italic; font-weight: 400; font-display: swap; src: url(${serifItalic}) format("woff2"); }

.chat-root { --chat-bg: #0c0c0d; --chat-ink: #e4e4e7; --chat-dim: #a1a1aa; --chat-mute: #71717a; --chat-line: #232327; --chat-card: #111113; --chat-accent: #e2865f; --chat-accent-ink: #1a0f0a;
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: stretch; background: var(--chat-bg); color: var(--chat-ink);
  font-family: "Segoe UI", system-ui, sans-serif; font-size: 14.5px; line-height: 1.6; }
.chat-root *, .chat-root *::before, .chat-root *::after { box-sizing: border-box; }
.chat-col { width: min(760px, 100% - 48px); margin: 0 auto; }

.chat-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #2a2a2e transparent; }
.chat-scroll-inner { display: flex; flex-direction: column; gap: 14px; padding: 28px 0 18px; }
.chat-unit { content-visibility: auto; contain-intrinsic-size: auto 60px; }

.chat-title { font-family: "Instrument Serif", Georgia, serif; font-size: 34px; line-height: 1.1; color: #f4f4f5; letter-spacing: -0.005em; overflow-wrap: anywhere; }
.chat-title em { color: var(--chat-accent); font-style: italic; }
.chat-meta { font-size: 12px; color: var(--chat-mute); margin-top: -8px; }
.chat-older { font-size: 12px; color: var(--chat-mute); text-align: center; padding: 4px 0; }

.chat-user { align-self: flex-end; max-width: min(560px, 85%); background: #1d1d20; border-radius: 18px 18px 6px 18px; padding: 9px 15px; color: var(--chat-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
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
.chat-line:hover { color: var(--chat-dim); background: #141416; }
.chat-line b { color: var(--chat-dim); font-weight: 500; }
.chat-line .lucide { width: 15px; height: 15px; flex-shrink: 0; }
.chat-line .chev { transition: transform .14s ease-out; }
.chat-line .chev.open { transform: rotate(90deg); }
.chat-line .spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid #3f3f46; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; flex-shrink: 0; }
@keyframes chat-spin { to { transform: rotate(360deg); } }
.chat-tools { display: flex; flex-direction: column; gap: 2px; margin: 4px 0 0 7px; padding-left: 14px; border-left: 1px solid var(--chat-line); }
.chat-tool .row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--chat-dim); cursor: pointer; padding: 2px 4px; border-radius: 6px; min-width: 0; }
.chat-tool .row:hover { background: #141416; }
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
.chat-diff { margin: 0; padding: 8px 0; border-top: 1px solid #1d1d20; max-height: 340px; overflow: auto; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; line-height: 1.6; }
.chat-diff div { padding: 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--chat-dim); }
.chat-diff .p { color: #86efac; background: rgba(34,197,94,.07); }
.chat-diff .m { color: #fca5a5; background: rgba(239,68,68,.07); }
.chat-diff .more { color: var(--chat-mute); font-style: italic; }
.chat-card .body { border-top: 1px solid #1d1d20; padding: 10px 14px; }
.chat-card .body .reading-md { font-size: 13.5px; }
.chat-card .body.clamp { max-height: 220px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
.chat-qa { display: flex; flex-direction: column; gap: 2px; }
.chat-qa .q { color: var(--chat-dim); font-size: 13px; }
.chat-qa .a { color: var(--chat-ink); }

.chat-bottom { flex-shrink: 0; display: flex; flex-direction: column; align-items: stretch; padding: 0 0 12px; background: linear-gradient(transparent, var(--chat-bg) 14px); }
.chat-live { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--chat-dim); padding: 8px 2px; min-height: 36px; }
.chat-live .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #3f3f46; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; }
.chat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: #18181b; border: 1px solid #27272a; color: #d4d4d8; font-size: 12px; line-height: 1.4; cursor: pointer; user-select: none; white-space: nowrap; }
.chat-chip:hover { border-color: #3f3f46; }
.chat-chip.static { cursor: default; }
.chat-chip .lucide { width: 13px; height: 13px; }
.chat-chip.warn { color: #fcd34d; border-color: rgba(252,211,77,.25); }

.chat-box { position: relative; border-radius: 20px; background: #161618; border: 1px solid #2a2a2e; box-shadow: 0 18px 50px rgba(0,0,0,.55); padding: 12px 12px 8px; }
.chat-box.ask { border-color: #5a3a2c; }
.chat-box textarea { width: 100%; resize: none; border: 0; outline: none; background: transparent; color: var(--chat-ink); font: inherit; line-height: 1.55; padding: 2px 6px; max-height: 40vh; min-height: 26px; }
.chat-box textarea::placeholder { color: #5b5b63; }
.chat-attach { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px 8px; }
.chat-attach .img { position: relative; width: 52px; height: 52px; border-radius: 9px; overflow: hidden; border: 1px solid #2a2a2e; }
.chat-attach .img img { width: 100%; height: 100%; object-fit: cover; }
.chat-attach .img button { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: rgba(0,0,0,.7); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; }
.chat-tools-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #222226; color: var(--chat-dim); font-size: 12.5px; }
.chat-ib { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: #1f1f22; border: 0; color: var(--chat-dim); cursor: pointer; flex-shrink: 0; }
.chat-ib:hover { color: var(--chat-ink); }
.chat-ib:disabled { opacity: .45; cursor: default; }
.chat-ib .lucide { width: 16px; height: 16px; }
.chat-round { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; border: 0; cursor: pointer; flex-shrink: 0; }
.chat-round .lucide { width: 17px; height: 17px; }
.chat-round.send { background: var(--chat-accent); color: var(--chat-accent-ink); }
.chat-round.send:disabled { background: #2a2a2e; color: #5b5b63; cursor: default; }
.chat-round.stop { background: #f4f4f5; color: #0c0c0d; }
.chat-round.mic { background: #1f1f22; color: var(--chat-dim); }
.chat-round.mic:hover { color: var(--chat-ink); }
.chat-round.mic.rec { background: #ef4444; color: #fff; box-shadow: 0 0 0 4px rgba(239,68,68,.18); }
.chat-round .spin { width: 15px; height: 15px; border-radius: 50%; border: 2px solid #3f3f46; border-top-color: var(--chat-accent); animation: chat-spin .8s linear infinite; }
.chat-push { margin-left: auto; }

.chat-ask-head { display: flex; align-items: center; gap: 8px; margin: 0 4px 8px; font-size: 14px; color: #f4f4f5; }
.chat-ask-head .lucide { width: 16px; height: 16px; color: var(--chat-accent); flex-shrink: 0; }
.chat-ask-head small { margin-left: auto; color: var(--chat-mute); font-size: 12px; white-space: nowrap; }
.chat-ask-sub { margin: -4px 4px 8px; font-size: 12px; color: var(--chat-mute); }
.chat-opt { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 11px; color: #d4d4d8; font-size: 13.5px; cursor: pointer; border: 0; background: transparent; width: 100%; text-align: left; font: inherit; }
.chat-opt:hover { background: #1c1b1b; }
.chat-opt .k { width: 24px; height: 24px; border-radius: 7px; background: #232327; display: grid; place-items: center; font-size: 12px; color: var(--chat-dim); flex-shrink: 0; }
.chat-opt .t { display: flex; flex-direction: column; min-width: 0; }
.chat-opt .t span { color: var(--chat-mute); font-size: 12.5px; }
.chat-opt.sel { background: #22201f; box-shadow: inset 0 0 0 1px #5a3a2c; }
.chat-opt.sel .k { background: var(--chat-accent); color: var(--chat-accent-ink); font-weight: 700; }
.chat-ask-other { width: 100%; margin-top: 6px; border: 1px solid #2a2a2e; border-radius: 10px; background: #111113; color: var(--chat-ink); font: inherit; font-size: 13.5px; padding: 7px 10px; outline: none; }
.chat-ask-other:focus { border-color: #5a3a2c; }
.chat-ask-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #222226; flex-wrap: wrap; }
.chat-btn { border: 1px solid #2a2a2e; background: #1f1f22; color: #e4e4e7; border-radius: 10px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.chat-btn:hover { border-color: #3f3f46; }
.chat-btn.primary { background: var(--chat-accent); border-color: var(--chat-accent); color: var(--chat-accent-ink); font-weight: 600; }
.chat-btn.ghost { background: transparent; }
.chat-btn:disabled { opacity: .5; cursor: default; }
.chat-btn .lucide { width: 14px; height: 14px; }
.chat-plan { max-height: 38vh; overflow: auto; margin: 0 4px 4px; padding: 8px 12px; border: 1px solid #222226; border-radius: 12px; background: #111113; }
.chat-plan .reading-md { font-size: 13.5px; }
.chat-perm-input { margin: 0 4px; max-height: 160px; overflow: auto; border: 1px solid #222226; border-radius: 10px; background: #111113; padding: 8px 10px; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; font-size: 12px; color: var(--chat-dim); white-space: pre-wrap; overflow-wrap: anywhere; }

.chat-slash { position: absolute; left: 10px; right: 10px; bottom: calc(100% + 6px); max-height: 260px; overflow: auto; border-radius: 14px; background: #18181b; border: 1px solid #2a2a2e; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 6px; z-index: 5; }
.chat-slash button { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: #d4d4d8; font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 8px; cursor: pointer; font-family: "Cascadia Code", "JetBrains Mono", ui-monospace, monospace; }
.chat-slash button.on, .chat-slash button:hover { background: #26262a; }

.chat-status { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 11.5px; color: var(--chat-mute); padding: 9px 6px 0; }
.chat-status > span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.chat-status b { color: var(--chat-dim); font-weight: 500; }
.chat-status .hot b { color: #fcd34d; }

.chat-menu { position: absolute; bottom: calc(100% + 6px); min-width: 220px; border-radius: 12px; background: #18181b; border: 1px solid #2a2a2e; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 6px; z-index: 6; }
.chat-menu button { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent; color: #d4d4d8; font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; cursor: pointer; text-align: left; }
.chat-menu button:hover, .chat-menu button.on { background: #26262a; }
.chat-menu .hint { color: var(--chat-mute); font-size: 12px; margin-left: auto; }
.chat-anchor { position: relative; display: inline-flex; }

.chat-tasks { position: absolute; bottom: calc(100% + 6px); left: 0; min-width: 300px; max-width: 420px; max-height: 320px; overflow: auto; border-radius: 12px; background: #18181b; border: 1px solid #2a2a2e; box-shadow: 0 14px 40px rgba(0,0,0,.6); padding: 8px 10px; z-index: 6; }
.chat-tasks .t { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 13px; color: #d4d4d8; }
.chat-tasks .t.done { color: var(--chat-mute); text-decoration: line-through; }
.chat-tasks .t .lucide { width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0; }
.chat-tasks .t.doing .lucide { color: var(--chat-accent); }

.chat-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 92%); z-index: 9; background: #101012; border-left: 1px solid #222226; box-shadow: -18px 0 50px rgba(0,0,0,.5); display: flex; flex-direction: column; }
.chat-drawer .dh { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid #1d1d20; font-size: 14px; color: #f4f4f5; }
.chat-drawer .dh button { margin-left: auto; }
.chat-drawer .db { flex: 1; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.chat-agent { border: 1px solid #222226; border-radius: 12px; padding: 10px 12px; background: #131315; display: flex; flex-direction: column; gap: 6px; }
.chat-agent .top { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #e4e4e7; min-width: 0; }
.chat-agent .top .d { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chat-agent .meta { font-size: 12px; color: var(--chat-mute); }
.chat-agent .sum { font-size: 12.5px; color: var(--chat-dim); white-space: pre-wrap; max-height: 120px; overflow: auto; }
.chat-agent .ok { color: #4ade80; } .chat-agent .ko { color: #f87171; }
.chat-agent .lucide { width: 14px; height: 14px; flex-shrink: 0; }

.chat-sheet { position: absolute; inset: 0; z-index: 10; background: rgba(6,6,7,.86); display: flex; flex-direction: column; }
.chat-sheet .sh { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid #1d1d20; font-size: 14px; color: #f4f4f5; background: #0f0f11; }
.chat-sheet .sh button { margin-left: auto; }
.chat-sheet .chat-scroll { background: var(--chat-bg); }

.chat-down { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 8px); border-radius: 999px; border: 1px solid #2a2a2e; background: #18181b; color: #d4d4d8; padding: 4px 12px; font: inherit; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
.chat-down .lucide { width: 13px; height: 13px; }
.chat-closed { display: flex; align-items: center; gap: 10px; justify-content: center; font-size: 13px; color: #fca5a5; padding: 8px; }
`;
