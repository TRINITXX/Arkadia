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
    pub prompt_file: Option<String>,
}

impl ExternalAction {
    /// True for an action that must not bring Arkadia's window to the front:
    /// `--tab-add` comes from a script while Alexis may be typing elsewhere,
    /// `--chat-add` from a button he clicked in Chrome, where he stays.
    pub fn stays_in_background(&self) -> bool {
        self.kind == "tab" || self.kind == "chat"
    }
}

/// Largest prompt file `--chat-add` reads: a prompt, not a document.
const MAX_PROMPT_BYTES: u64 = 256 * 1024;

/// `--chat-add`: the prompt read from `--prompt-file` into `message`. The
/// prompt travels in a file because the single-instance plugin joins the argv
/// with `|` and splits it back: a prompt written in the argv would be cut at
/// its first `|`. Left without a message when the file is missing or too big.
/// Read after the caller's process has exited: the file must outlive it. A
/// relative path resolves against Arkadia's own folder, not the caller's.
pub fn load_prompt(mut action: ExternalAction) -> ExternalAction {
    if action.kind != "chat" {
        return action;
    }
    action.message = action.prompt_file.as_deref().and_then(|path| {
        let size = std::fs::metadata(path).ok()?.len();
        if size > MAX_PROMPT_BYTES {
            return None;
        }
        std::fs::read_to_string(path)
            .ok()
            .filter(|text| !text.trim().is_empty())
    });
    action
}

/// Reads the value following `flag` in `argv` (e.g. `--path C:\x` → `Some("C:\\x")`).
fn value_after(argv: &[String], flag: &str) -> Option<String> {
    argv.iter()
        .position(|a| a == flag)
        .and_then(|i| argv.get(i + 1))
        .cloned()
}

/// Parses Arkadia's external-action argv vocabulary. Returns `None` when no
/// action flag is present (i.e. an ordinary launch / focus forward).
///
/// `--wt-add` adds a project (a worktree); `--tab-add` opens one more tab in
/// the project already open on `--path` and runs `--run` in it. There `--name`
/// is the tab's fixed title, shown instead of its terminal's. `--chat-add`
/// opens a chat tab in the project on `--path`, in the background, and sends
/// it the prompt of `--prompt-file` (`load_prompt`).
pub fn parse_external_action(argv: &[String]) -> Option<ExternalAction> {
    let kind = if argv.iter().any(|a| a == "--wt-add") {
        "add"
    } else if argv.iter().any(|a| a == "--wt-remove") {
        "remove"
    } else if argv.iter().any(|a| a == "--wt-notify") {
        "notify"
    } else if argv.iter().any(|a| a == "--tab-add") {
        "tab"
    } else if argv.iter().any(|a| a == "--chat-add") {
        "chat"
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
        prompt_file: value_after(argv, "--prompt-file"),
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
            "arkadia.exe",
            "--wt-add",
            "--path",
            "C:\\wt\\vtc-mobile-side",
            "--name",
            "vtc-mobile-side",
            "--color",
            "#ee9b00",
            "--run",
            "ccd",
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
            "arkadia.exe",
            "--wt-remove",
            "--path",
            "C:\\wt\\x",
            "--after",
            "git worktree remove --force C:\\wt\\x",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "remove");
        assert_eq!(
            a.after.as_deref(),
            Some("git worktree remove --force C:\\wt\\x")
        );
    }

    #[test]
    fn parses_wt_notify() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe",
            "--wt-notify",
            "--level",
            "info",
            "--message",
            "done",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "notify");
        assert_eq!(a.level.as_deref(), Some("info"));
        assert_eq!(a.message.as_deref(), Some("done"));
    }

    #[test]
    fn parses_tab_add() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe",
            "--tab-add",
            "--path",
            "C:\\dev\\vtc-mobile",
            "--name",
            "Serveur dev",
            "--run",
            "npx expo start --dev-client",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "tab");
        assert_eq!(a.path.as_deref(), Some("C:\\dev\\vtc-mobile"));
        assert_eq!(a.name.as_deref(), Some("Serveur dev"));
        assert_eq!(a.run.as_deref(), Some("npx expo start --dev-client"));
    }

    #[test]
    fn parses_chat_add() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe",
            "--chat-add",
            "--path",
            "C:\\Users\\x\\Claude Desktop",
            "--prompt-file",
            "C:\\tmp\\prompt.txt",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "chat");
        assert_eq!(a.path.as_deref(), Some("C:\\Users\\x\\Claude Desktop"));
        assert_eq!(a.prompt_file.as_deref(), Some("C:\\tmp\\prompt.txt"));
    }

    #[test]
    fn load_prompt_reads_the_file_into_message() {
        let dir = std::env::temp_dir().join(format!("arkadia-chat-add-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("prompt.txt");
        std::fs::write(&file, "Juge ce tweet | et ses réponses").unwrap();
        let path = file.to_string_lossy().to_string();
        let a = load_prompt(
            parse_external_action(&argv(&[
                "arkadia.exe",
                "--chat-add",
                "--prompt-file",
                &path,
            ]))
            .unwrap(),
        );
        assert_eq!(
            a.message.as_deref(),
            Some("Juge ce tweet | et ses réponses")
        );
        std::fs::write(&file, "   ").unwrap();
        let blank = load_prompt(
            parse_external_action(&argv(&[
                "arkadia.exe",
                "--chat-add",
                "--prompt-file",
                &path,
            ]))
            .unwrap(),
        );
        assert_eq!(blank.message, None);
        let _ = std::fs::remove_dir_all(&dir);
        let missing = load_prompt(
            parse_external_action(&argv(&[
                "arkadia.exe",
                "--chat-add",
                "--prompt-file",
                &path,
            ]))
            .unwrap(),
        );
        assert_eq!(missing.message, None);
    }

    #[test]
    fn load_prompt_leaves_other_actions_alone() {
        let a = load_prompt(
            parse_external_action(&argv(&["arkadia.exe", "--wt-notify", "--message", "done"]))
                .unwrap(),
        );
        assert_eq!(a.message.as_deref(), Some("done"));
    }

    #[test]
    fn only_tab_add_and_chat_add_stay_in_background() {
        let action = |flag: &str| parse_external_action(&argv(&["arkadia.exe", flag])).unwrap();
        assert!(action("--tab-add").stays_in_background());
        assert!(action("--chat-add").stays_in_background());
        assert!(!action("--wt-add").stays_in_background());
        assert!(!action("--wt-remove").stays_in_background());
        assert!(!action("--wt-notify").stays_in_background());
    }

    #[test]
    fn returns_none_without_action_flag() {
        assert!(parse_external_action(&argv(&["arkadia.exe"])).is_none());
        assert!(parse_external_action(&argv(&["arkadia.exe", "--focus"])).is_none());
    }
}
