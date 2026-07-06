use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ExternalAction {
    pub kind: String,
    pub path: Option<String>,
    pub name: Option<String>,
    pub color: Option<String>,
    pub run: Option<String>,
    pub after: Option<String>,
    pub level: Option<String>,
    pub message: Option<String>,
}

/// Reads the value following `flag` in `argv` (e.g. `--path C:\x` → `Some("C:\\x")`).
fn value_after(argv: &[String], flag: &str) -> Option<String> {
    argv.iter().position(|a| a == flag).and_then(|i| argv.get(i + 1)).cloned()
}

/// Parses Arkadia's external-action argv vocabulary. Returns `None` when no
/// `--wt-*` action flag is present (i.e. an ordinary launch / focus forward).
pub fn parse_external_action(argv: &[String]) -> Option<ExternalAction> {
    let kind = if argv.iter().any(|a| a == "--wt-add") {
        "add"
    } else if argv.iter().any(|a| a == "--wt-remove") {
        "remove"
    } else if argv.iter().any(|a| a == "--wt-notify") {
        "notify"
    } else {
        return None;
    };
    Some(ExternalAction {
        kind: kind.to_string(),
        path: value_after(argv, "--path"),
        name: value_after(argv, "--name"),
        color: value_after(argv, "--color"),
        run: value_after(argv, "--run"),
        after: value_after(argv, "--after"),
        level: value_after(argv, "--level"),
        message: value_after(argv, "--message"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_wt_add_with_all_flags() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe", "--wt-add",
            "--path", "C:\\wt\\vtc-mobile-side",
            "--name", "vtc-mobile-side",
            "--color", "#ee9b00",
            "--run", "ccd",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "add");
        assert_eq!(a.path.as_deref(), Some("C:\\wt\\vtc-mobile-side"));
        assert_eq!(a.name.as_deref(), Some("vtc-mobile-side"));
        assert_eq!(a.color.as_deref(), Some("#ee9b00"));
        assert_eq!(a.run.as_deref(), Some("ccd"));
    }

    #[test]
    fn parses_wt_remove_with_after() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe", "--wt-remove",
            "--path", "C:\\wt\\x",
            "--after", "git worktree remove --force C:\\wt\\x",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "remove");
        assert_eq!(a.after.as_deref(), Some("git worktree remove --force C:\\wt\\x"));
    }

    #[test]
    fn parses_wt_notify() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe", "--wt-notify", "--level", "info", "--message", "done",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "notify");
        assert_eq!(a.level.as_deref(), Some("info"));
        assert_eq!(a.message.as_deref(), Some("done"));
    }

    #[test]
    fn returns_none_without_action_flag() {
        assert!(parse_external_action(&argv(&["arkadia.exe"])).is_none());
        assert!(parse_external_action(&argv(&["arkadia.exe", "--focus"])).is_none());
    }
}
