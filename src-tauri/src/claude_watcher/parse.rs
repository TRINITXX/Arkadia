use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub enum Entry {
    User,
    AssistantPartial,
    AssistantContinuing,
    AssistantComplete,
    ToolUse { name: String },
    ToolResult,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedLine {
    pub entry: Entry,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
struct RawEntry {
    #[serde(rename = "type")]
    kind: Option<String>,
    cwd: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    stop_reason: Option<serde_json::Value>,
    content: Option<serde_json::Value>,
}

/// Find the first `tool_use` block inside `message.content[]` and return its `name`.
/// Returns None when the content is absent, a plain string, or has no tool_use block.
fn first_tool_use_name(content: &serde_json::Value) -> Option<String> {
    let arr = content.as_array()?;
    for item in arr {
        if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
            return item
                .get("name")
                .and_then(|n| n.as_str())
                .map(String::from);
        }
    }
    None
}

/// Returns true if any block in `content[]` is a `tool_result`.
fn has_tool_result(content: &serde_json::Value) -> bool {
    content
        .as_array()
        .map(|arr| {
            arr.iter()
                .any(|item| item.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
        })
        .unwrap_or(false)
}

pub fn parse_line(line: &str) -> Option<ParsedLine> {
    let raw: RawEntry = serde_json::from_str(line).ok()?;
    let entry = match raw.kind.as_deref() {
        Some("user") => {
            // user messages can carry a tool_result block (resolved by Claude Code itself)
            let is_tool_result = raw
                .message
                .as_ref()
                .and_then(|m| m.content.as_ref())
                .map(has_tool_result)
                .unwrap_or(false);
            if is_tool_result {
                Entry::ToolResult
            } else {
                Entry::User
            }
        }
        Some("assistant") => {
            // assistant messages with a tool_use in content are the real tool invocations
            let tool_name = raw
                .message
                .as_ref()
                .and_then(|m| m.content.as_ref())
                .and_then(first_tool_use_name);
            if let Some(name) = tool_name {
                Entry::ToolUse { name }
            } else {
                let stop_reason = raw.message.as_ref().and_then(|m| m.stop_reason.as_ref());
                match stop_reason {
                    Some(serde_json::Value::Null) | None => Entry::AssistantPartial,
                    Some(serde_json::Value::String(s)) if s == "tool_use" => {
                        Entry::AssistantContinuing
                    }
                    Some(_) => Entry::AssistantComplete,
                }
            }
        }
        _ => Entry::Other,
    };
    Some(ParsedLine { entry, cwd: raw.cwd })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_user_entry() {
        let line = r#"{"type":"user","message":{"role":"user","content":"hi"},"cwd":"/tmp"}"#;
        let parsed = parse_line(line).unwrap();
        assert_eq!(parsed.entry, Entry::User);
        assert_eq!(parsed.cwd.as_deref(), Some("/tmp"));
    }

    #[test]
    fn parses_assistant_complete() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn","content":""}}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::AssistantComplete);
    }

    #[test]
    fn parses_assistant_tool_use_stop_as_continuing() {
        // assistant message with stop_reason "tool_use" but content has no tool_use block
        // (rare edge case: a continuation marker before the actual tool block).
        let line = r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"tool_use","content":""}}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::AssistantContinuing);
    }

    #[test]
    fn parses_assistant_partial_via_null_stop_reason() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","stop_reason":null,"content":""}}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::AssistantPartial);
    }

    #[test]
    fn parses_assistant_partial_via_missing_message() {
        let line = r#"{"type":"assistant"}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::AssistantPartial);
    }

    #[test]
    fn parses_assistant_with_nested_tool_use() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"AskUserQuestion","input":{}}],"stop_reason":"tool_use"}}"#;
        match parse_line(line).unwrap().entry {
            Entry::ToolUse { name } => assert_eq!(name, "AskUserQuestion"),
            other => panic!("expected ToolUse, got {:?}", other),
        }
    }

    #[test]
    fn parses_assistant_with_text_then_tool_use() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"reading…"},{"type":"tool_use","name":"Read","input":{}}],"stop_reason":"tool_use"}}"#;
        match parse_line(line).unwrap().entry {
            Entry::ToolUse { name } => assert_eq!(name, "Read"),
            other => panic!("expected ToolUse, got {:?}", other),
        }
    }

    #[test]
    fn parses_user_with_tool_result_block() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"ok"}]}}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::ToolResult);
    }

    #[test]
    fn malformed_json_returns_none() {
        assert!(parse_line("not json at all").is_none());
        assert!(parse_line(r#"{"type":"user"#).is_none());
    }

    #[test]
    fn unknown_type_becomes_other() {
        let line = r#"{"type":"summary","content":"..."}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::Other);
    }
}
