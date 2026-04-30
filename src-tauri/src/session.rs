use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SESSION_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionFile {
    pub version: u32,
    pub saved_at: String,
    pub active_project_id: Option<Uuid>,
    pub projects: Vec<ProjectSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectSession {
    pub project_id: Uuid,
    pub active_tab_id: Option<Uuid>,
    pub tabs: Vec<TabSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TabSession {
    pub tab_id: Uuid,
    pub title: String,
    pub active_pane_id: Uuid,
    pub pane_tree: PaneTreeSerialized,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PaneTreeSerialized {
    Leaf {
        pane_id: Uuid,
        cwd: String,
        profile_id: String,
        agent_resume: Option<AgentResume>,
    },
    Split {
        orientation: Orientation,
        ratio: f32,
        left: Box<PaneTreeSerialized>,
        right: Box<PaneTreeSerialized>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentResume {
    pub kind: String,
    pub session_id: String,
    pub command: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_complex_session() {
        let s = SessionFile {
            version: SESSION_VERSION,
            saved_at: "2026-04-30T12:00:00Z".into(),
            active_project_id: Some(Uuid::new_v4()),
            projects: vec![ProjectSession {
                project_id: Uuid::new_v4(),
                active_tab_id: Some(Uuid::new_v4()),
                tabs: vec![TabSession {
                    tab_id: Uuid::new_v4(),
                    title: "main".into(),
                    active_pane_id: Uuid::new_v4(),
                    pane_tree: PaneTreeSerialized::Split {
                        orientation: Orientation::Horizontal,
                        ratio: 0.5,
                        left: Box::new(PaneTreeSerialized::Leaf {
                            pane_id: Uuid::new_v4(),
                            cwd: "C:\\Users\\test".into(),
                            profile_id: "pwsh".into(),
                            agent_resume: Some(AgentResume {
                                kind: "claude-code".into(),
                                session_id: "abc-123".into(),
                                command: "ccd --resume".into(),
                            }),
                        }),
                        right: Box::new(PaneTreeSerialized::Leaf {
                            pane_id: Uuid::new_v4(),
                            cwd: "C:\\Users\\test".into(),
                            profile_id: "pwsh".into(),
                            agent_resume: None,
                        }),
                    },
                }],
            }],
        };
        let j = serde_json::to_string(&s).unwrap();
        let back: SessionFile = serde_json::from_str(&j).unwrap();
        assert_eq!(s, back);
    }
}

use std::path::{Path, PathBuf};

pub fn save_atomic(file: &Path, session: &SessionFile) -> std::io::Result<()> {
    let tmp = tmp_path(file);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(session)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, file)?;
    Ok(())
}

pub fn load_with_recovery(file: &Path) -> Option<SessionFile> {
    let tmp = tmp_path(file);
    if tmp.exists() && !file.exists() {
        let _ = std::fs::rename(&tmp, file);
    }
    let content = std::fs::read_to_string(file).ok()?;
    let s: SessionFile = serde_json::from_str(&content).ok()?;
    if s.version != SESSION_VERSION {
        return None;
    }
    Some(s)
}

pub fn clear(file: &Path) {
    let _ = std::fs::remove_file(file);
    let _ = std::fs::remove_file(tmp_path(file));
}

fn tmp_path(file: &Path) -> PathBuf {
    let mut s = file.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    fn empty_session() -> SessionFile {
        SessionFile {
            version: SESSION_VERSION,
            saved_at: "2026-04-30T00:00:00Z".into(),
            active_project_id: None,
            projects: vec![],
        }
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        save_atomic(&path, &empty_session()).unwrap();
        let loaded = load_with_recovery(&path).unwrap();
        assert_eq!(loaded.version, SESSION_VERSION);
    }

    #[test]
    fn promotes_tmp_when_main_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        let tmp = tmp_path(&path);
        std::fs::write(&tmp, serde_json::to_string(&empty_session()).unwrap()).unwrap();
        assert!(!path.exists());
        let loaded = load_with_recovery(&path).unwrap();
        assert_eq!(loaded.version, SESSION_VERSION);
        assert!(path.exists());
    }

    #[test]
    fn returns_none_for_old_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        std::fs::write(&path, r#"{"version":0,"saved_at":"x","active_project_id":null,"projects":[]}"#).unwrap();
        assert!(load_with_recovery(&path).is_none());
    }

    #[test]
    fn returns_none_for_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(load_with_recovery(&path).is_none());
    }
}
