//! Which panes some window shows right now, and how often the others repaint.
//!
//! Every pane streams its full screen to the webviews (`terminal-render`), and
//! a busy Claude Code session repaints about nine times a second whether anyone
//! looks at it or not. Ten such sessions in hidden tabs sent the page ~94 frames
//! of ~116 KB a second (measured 24/10/2026): it fell further behind every
//! second, its memory climbed 30 MB/s, and the watchdog ended up reloading it.
//! A pane nobody shows still gets frames — its title drives the sidebar badge —
//! but at `HIDDEN_FRAME_INTERVAL`; the panes on screen keep the full rate.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use parking_lot::Mutex;

/// Pace of a pane no window shows. Its badge follows a title that changes about
/// once a second, so half a second costs nothing visible.
pub const HIDDEN_FRAME_INTERVAL: Duration = Duration::from_millis(500);

/// Whether a pane with pending changes should be sent now.
pub fn frame_due(shown: bool, since_last: Duration) -> bool {
    shown || since_last >= HIDDEN_FRAME_INTERVAL
}

/// Panes each webview declared on screen, keyed by webview label.
#[derive(Default)]
pub struct PaneViewers {
    by_window: Mutex<HashMap<String, HashSet<String>>>,
}

impl PaneViewers {
    /// Replaces what `window` shows; returns the panes shown by any window.
    pub fn set(&self, window: &str, panes: HashSet<String>) -> HashSet<String> {
        let mut map = self.by_window.lock();
        if panes.is_empty() {
            map.remove(window);
        } else {
            map.insert(window.to_string(), panes);
        }
        union(&map)
    }

    /// Drops a destroyed window's panes; returns the panes still shown.
    pub fn forget(&self, window: &str) -> HashSet<String> {
        let mut map = self.by_window.lock();
        map.remove(window);
        union(&map)
    }
}

fn union(map: &HashMap<String, HashSet<String>>) -> HashSet<String> {
    map.values().flatten().cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_shown_pane_is_sent_every_tick() {
        assert!(frame_due(true, Duration::ZERO));
    }

    #[test]
    fn a_hidden_pane_waits_for_its_slower_pace() {
        assert!(!frame_due(false, Duration::from_millis(100)));
        assert!(frame_due(false, HIDDEN_FRAME_INTERVAL));
    }

    #[test]
    fn a_pane_counts_as_shown_while_any_window_shows_it() {
        let v = PaneViewers::default();
        v.set("main", set(&["a", "b"]));
        let shown = v.set("popup-x", set(&["c"]));
        assert_eq!(shown, set(&["a", "b", "c"]));
        assert_eq!(v.set("main", set(&["b"])), set(&["b", "c"]));
    }

    #[test]
    fn a_destroyed_window_stops_counting() {
        let v = PaneViewers::default();
        v.set("main", set(&["a"]));
        v.set("popup-x", set(&["a", "c"]));
        assert_eq!(v.forget("popup-x"), set(&["a"]));
        assert_eq!(v.forget("main"), set(&[]));
    }
}
