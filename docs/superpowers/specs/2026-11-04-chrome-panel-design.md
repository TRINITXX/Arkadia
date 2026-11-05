# Chrome panel — design

Framed with Alexis on 2026-11-04. Pages (choices stored in each page's `choices` collection):
https://claude.ai/artifact/W5w2AmpLyvn49f4u4J7uXz, https://claude.ai/artifact/6NNVDozAzPSyY2xNHg6Z9o,
plan https://claude.ai/artifact/VvHBvoDs3qaAKSe5Cz87Cu.

## Goal

When Claude drives Chrome (Claude in Chrome MCP), the session's real Chrome window (the Chrome profile
paired with the session's Claude account) sits in Arkadia's right panel, as a tab of the artifact panel,
instead of popping up in front. Alexis sees Claude browse and can take over (click, type, sign in).

## Decisions (do not reopen without Alexis)

- The REAL Chrome window, not a WebView2 browser: Chrome encrypts sessions for itself (App-Bound
  Encryption) and the Claude extension needs Chrome (native messaging, debugger, tab groups).
- Only Claude's window goes in the panel; Alexis's own Chrome windows stay normal.
- A "Chrome, <profile>" tab in the artifact panel (mockup A), per pane (= per session).
- Opens by itself when Claude browses, never in front of another app; follows the active Arkadia tab.
- Account -> profile table: `~/.claude/chrome-profiles.json` (already read by `chrome_profile.rs` and
  `~/.claude/hooks/chrome-profile-open.ps1`), automatic by name, editable in Settings.
- Globe button next to Settings in the toolbar: shows/hides the panel on the active pane's Chrome tab;
  if Claude has not browsed yet, opens an empty Chrome window of the pane's profile in the panel.
- The window closes with its session (pane closed, Arkadia quit). Connections live in the profile.
- One window per session. When Arkadia cannot steer (see below), Claude still browses and the panel says so.
- Lab first, nothing on the iPhone.
- Q16 (pending on 2026-11-04): a separate synced Chrome profile "Claude" for rotoloalexis@gmail.com,
  so Alexis's personal "Alexis" profile never receives Claude's tabs.

## Facts measured in the spike (Chrome 156, extension 1.0.105, Windows 11, 300 % scale)

- A Chrome top-level window owned by `main` (GWLP_HWNDPARENT) and laid by SetWindowPos over the panel:
  clicks, keyboard, scrolling work; Claude's clicks do not take Arkadia's keyboard.
- Chrome draws nothing while minimized (CDP `Page.captureScreenshot` times out); off-screen it still draws.
  So a window that leaves the panel is moved off-screen, never minimized, never hidden.
- Owned windows hide with their owner: only the displayed window is owned; parked ones are not.
- Chrome draws its own minimize/maximize/close buttons even with those styles removed: clip them
  with a window region.
- The extension moves/resizes its window by itself: re-place on every location change (WinEvent).
- A session's tab group goes into `chrome.windows.getLastFocused({windowTypes:["normal"]})` of the profile,
  else into a new window created `focused:false`. A freshly launched window is not reliably "last focused".
  Activating a window makes it last focused (a faked WM_ACTIVATE also pulled it to the foreground).
- A window's profile = its AppUserModelID: `Chrome` (Default), `Chrome.UserData.Profile3` ("Profile 3").
- Cross-process owner links attach the two threads' input queues: a hung Chrome UI thread could stall
  Arkadia's input. Mitigation: un-own a window that stops answering (SendMessageTimeout).

## Mechanism

1. **Request** (before every Claude in Chrome tool call, throttled): the session drops
   `%LOCALAPPDATA%\Arkadia\chrome-inbox[-lab]\<id>.json` = `{ paneId, id }` and waits up to 12 s for
   `<id>.ack`. Terminal panes: `chrome-profile-open.ps1` (PreToolUse `mcp__claude-in-chrome__.*`),
   which keeps its old behavior outside Arkadia. Chat panes: a PreToolUse hook in `chat-server/server.ts`
   (chats run with `settingSources: []`, so user hooks never run there).
2. **Rust watcher** emits `chrome-request {id, paneId}` to main. The frontend finds the pane's tab and
   account, adds the pane's Chrome item, shows it if the tab is active, and calls
   `chrome_view_prepare {id, key, account}`.
3. **Prepare**: find or create the session window (launch `chrome --profile-directory=<dir> --new-window
   data:text/html,<title>Arkadia-<pid>-<n></title>` and take the window showing that unique title: a window
   Chrome restores or Alexis opens meanwhile is never adopted), configure it (owner off, WS_EX_TOOLWINDOW,
   no thick frame, a window property marking it Arkadia's), park or place it, then **steer**: when an
   Arkadia window is in the foreground, activate the Chrome window and give the foreground back to main
   (it becomes the profile's last-focused window). Otherwise no steering, and the answer says `steered:false`
   when another window of that profile was used since the last steer: the panel shows a note. Writes the ack.
4. **Display**: the panel reports its body bounds; the active Chrome item's window is owned by main,
   placed over the body right above main in the z-order (never after a topmost window), clipped
   (caption buttons). Anything else (other item, panel closed, overlay over
   main, main minimized): un-owned and parked off-screen.
5. **Lifecycle**: pane closed -> `chrome_view_close(key)` (WM_CLOSE). Arkadia exit -> close all. On start,
   windows still carrying Arkadia's property (crash) are closed.

## After Alexis's first try (05/11/2026)

- Arkadia came in front: Chrome activates a window launched from the command line, and an owned
  window drags its owner up. Now the foreground goes back to the window that had it, after a launch and
  whenever a panel window takes it without a click of Alexis inside it (`user_caused`).
- The toolbar's right end was out of view: the window is now exactly the panel's width, the caption
  buttons cut out by a notch in the region.
- The launch page stayed as an extra tab. Alexis kept one window per session (not one per account, where
  the extension would create its own single-tab window) and asked to close that tab every time: a call that
  ran (PostToolUse, registered with the same matcher in `~/.claude/settings.json`, shared by every account
  through symlinks, and in the chat server) closes it with `WM_APPCOMMAND`/`APPCOMMAND_CLOSE` (Chrome's
  "close tab", no focus needed), only when the group landed there and the launch page is still the active
  tab. Never on a delay: it could close the window's last tab.

## Second try (05/11/2026)

- A white full-screen flash at each launch: Chrome shows the new window (often maximized) before Arkadia
  parks it. While a launch lives, a WinEvent hook on window creation makes every new Chrome frame fully
  transparent (WS_EX_LAYERED, alpha 0); the panel's window is unveiled once parked off-screen, any other at
  the launch's end. DWM cloaking is refused for another process's window (E_ACCESSDENIED, tried).
- Caption buttons: a window region made Chrome paint the corner white, and Chrome draws its buttons
  whatever the styles (WS_SYSMENU and boxes removed: still drawn). A cover window of Arkadia's, owned by
  the Chrome window (always above it), no activation, painted the tab strip's color read with PrintWindow
  (PW_RENDERFULLCONTENT), resampled when the window gains or loses the foreground.
- Layout A chosen: Arkadia's title row (tabs, window buttons) runs the whole width; the panel opens below
  it. The tab strip shows no scrollbar (wheel scrolls); the globe and the settings never shrink.

## Out of scope (v1)

Spare pre-steered windows, tab-group window detection through UI Automation, iPhone.
