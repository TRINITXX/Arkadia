//! Empties the saved tab groups Claude in Chrome leaves in a paired profile.
//!
//! Chrome saves every tab group (Tab Group Save V2) and keeps it when its
//! window closes (`WillCloseAllTabs`): each panel window closed leaves a
//! "⌛Claude" / "✅Claude" chip behind, ~200 a month in November 2026. With
//! the five profiles on one Google account, sync copied all of them into
//! each profile, and a reorder from sync rebuilt every profile's saved-group
//! bar on the single browser main thread: Chrome froze for 58 s on
//! 21/11/2026 (`SavedTabGroupBar::SavedTabGroupReordered`, WPR trace).
//!
//! No extension API, switch or policy deletes saved groups, so this edits
//! the profile's sync store (`Sync Data/LevelDB`) while Chrome does not have
//! it open: opening the store takes its `LOCK`, which fails while Chrome
//! holds it. It also turns off the profile's syncing of tabs and tab groups
//! in `Preferences`, so the account's groups never come back. A profile
//! with full Chrome sync (`has_setup_completed`) is a person's own and is
//! left alone. It runs in a child process of the same exe (`TIDY_ARG`):
//! the store is data Arkadia does not control, and a panic in the LevelDB
//! reader must not take Arkadia down (`panic = "abort"`).

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use rusty_leveldb::{LdbIterator, Options, WriteBatch, DB};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const DATA: &[u8] = b"saved_tab_group-dt-";
const META: &[u8] = b"saved_tab_group-md-";
const TIDY_ARG: &str = "--tidy-tab-groups";
const CHILD_TIMEOUT: Duration = Duration::from_secs(20);

/// What `tidy` did to one profile.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Tidied {
    pub groups: usize,
    pub tabs: usize,
    pub sync_turned_off: bool,
}

/// The profile folder when Arkadia was started as `tidy`'s child.
pub fn tidy_arg() -> Option<PathBuf> {
    match std::env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [flag, dir] if flag == TIDY_ARG => Some(PathBuf::from(dir)),
        _ => None,
    }
}

/// Child mode, from `main`: tidies `profile`, prints the outcome on one line.
pub fn run_child(profile: &Path) {
    // The panic the child exists for, said to the parent's log.
    std::panic::set_hook(Box::new(|info| {
        println!("err panic: {}", info.to_string().replace('\n', " "));
    }));
    println!(
        "{}",
        match tidy(profile) {
            Ok(t) => format!("ok {} {} {}", t.groups, t.tabs, u8::from(t.sync_turned_off)),
            Err(e) => format!("err {e}"),
        }
    );
}

/// `tidy` in a child process, killed after `CHILD_TIMEOUT`.
pub(crate) fn tidy_isolated(profile: &Path) -> Result<Tidied, String> {
    // Not `current_exe`: a rebuild moves it aside for minutes (`exe_link`).
    let exe = crate::exe_link::helper_exe().ok_or("Arkadia's exe not found")?;
    let mut command = std::process::Command::new(exe);
    command
        .arg(TIDY_ARG)
        .arg(profile)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + CHILD_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = std::io::Read::read_to_string(&mut stdout, &mut out);
    }
    parse_outcome(out.trim()).ok_or_else(|| format!("child ended with {status}"))?
}

fn parse_outcome(line: &str) -> Option<Result<Tidied, String>> {
    if let Some(e) = line.strip_prefix("err ") {
        return Some(Err(e.to_owned()));
    }
    let mut parts = line.strip_prefix("ok ")?.split(' ');
    let groups = parts.next()?.parse().ok()?;
    let tabs = parts.next()?.parse().ok()?;
    let sync_turned_off = parts.next()? == "1";
    Some(Ok(Tidied {
        groups,
        tabs,
        sync_turned_off,
    }))
}

/// Empties the Claude groups of the profile in folder `profile`. Err while
/// Chrome has its sync store open, or for a profile with full sync.
pub(crate) fn tidy(profile: &Path) -> Result<Tidied, String> {
    let prefs_file = profile.join("Preferences");
    if read_prefs(&prefs_file)?
        .0
        .pointer("/sync/has_setup_completed")
        == Some(&Value::Bool(true))
    {
        return Err("full Chrome sync, left alone".into());
    }
    let store = profile.join("Sync Data").join("LevelDB");
    if !store.join("CURRENT").exists() {
        return Ok(Tidied::default());
    }
    // A silent log: rusty-leveldb would rotate Chrome's LOG before the LOCK.
    let silent = rusty_leveldb::infolog::Logger(Box::new(std::io::sink()));
    let options = Options {
        create_if_missing: false,
        log: Some(std::rc::Rc::new(std::cell::RefCell::new(silent))),
        ..Options::default()
    };
    let mut db = DB::open(&store, options).map_err(|e| format!("sync store: {e}"))?;
    // Read again under the LOCK, and written only if Chrome did not write it
    // meanwhile (a profile closing writes it last).
    let (mut prefs, stamp) = read_prefs(&prefs_file)?;
    let sync_turned_off = turn_off_tab_sync(&mut prefs);
    let mut ids = HashSet::new();
    let mut entities = Vec::new();
    let mut iter = db.new_iter().map_err(|e| format!("sync store: {e}"))?;
    iter.seek(DATA);
    while let Some((key, value)) = iter.current() {
        let Some(id) = key.strip_prefix(DATA) else {
            break;
        };
        let id = String::from_utf8_lossy(id).into_owned();
        if let Some(entity) = entity(&id, &value) {
            entities.push(entity);
        }
        ids.insert(id);
        if !iter.advance() {
            break;
        }
    }
    drop(iter);
    let doomed = doomed(&entities, &ids);
    if !doomed.is_empty() {
        let mut batch = WriteBatch::default();
        for id in &doomed {
            batch.delete(&[DATA, id.as_bytes()].concat());
            batch.delete(&[META, id.as_bytes()].concat());
        }
        db.write(batch, true)
            .map_err(|e| format!("sync store: {e}"))?;
    }
    // After the store, so a refused rename does not keep the groups; still
    // under the LOCK.
    let written = if sync_turned_off {
        write_prefs(&prefs_file, &prefs, &stamp)
    } else {
        Ok(())
    };
    db.close().map_err(|e| format!("sync store: {e}"))?;
    let groups = entities
        .iter()
        .filter(|e| e.group.is_none() && doomed.contains(&e.id))
        .count();
    written.map_err(|e| format!("{e} ({groups} Claude groups deleted)"))?;
    Ok(Tidied {
        groups,
        tabs: doomed.len() - groups,
        sync_turned_off,
    })
}

type Stamp = (u64, Option<std::time::SystemTime>);

fn stamp(file: &Path) -> std::io::Result<Stamp> {
    let meta = std::fs::metadata(file)?;
    Ok((meta.len(), meta.modified().ok()))
}

fn read_prefs(file: &Path) -> Result<(Value, Stamp), String> {
    let error = |e: &dyn std::fmt::Display| format!("Preferences: {e}");
    let stamp = stamp(file).map_err(|e| error(&e))?;
    let raw = std::fs::read_to_string(file).map_err(|e| error(&e))?;
    let prefs = serde_json::from_str(&raw).map_err(|e| error(&e))?;
    Ok((prefs, stamp))
}

/// Flushed before it replaces the file, as Chrome's own writer does: a
/// power cut must not leave an empty `Preferences` (default settings).
fn write_prefs(file: &Path, prefs: &Value, read: &Stamp) -> Result<(), String> {
    let tmp = file.with_file_name("Preferences.arkadia-tmp");
    let written = (|| {
        let mut out = std::fs::File::create(&tmp)?;
        out.write_all(prefs.to_string().as_bytes())?;
        out.sync_all()?;
        drop(out);
        if stamp(file)? != *read {
            return Err(std::io::Error::other("changed meanwhile"));
        }
        std::fs::rename(&tmp, file)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written.map_err(|e| format!("Preferences: {e}"))
}

/// Chrome's key for an account in `sync.selected_types_per_account`.
fn account_key(gaia: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(gaia.as_bytes()))
}

/// Turns off syncing of tabs and saved tab groups (one "History and tabs"
/// switch in Chrome's settings) for every account the profile knows, its
/// entry created when Chrome has none yet. True when it changed.
fn turn_off_tab_sync(prefs: &mut Value) -> bool {
    let keys: Vec<String> = prefs
        .get("account_info")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|account| account.get("gaia")?.as_str())
        .map(account_key)
        .collect();
    let Some(sync) = prefs
        .as_object_mut()
        .and_then(|p| p.entry("sync").or_insert_with(|| json!({})).as_object_mut())
    else {
        return false;
    };
    let Some(accounts) = sync
        .entry("selected_types_per_account")
        .or_insert_with(|| json!({}))
        .as_object_mut()
    else {
        return false;
    };
    for key in keys {
        accounts.entry(key).or_insert_with(|| json!({}));
    }
    let mut changed = false;
    for types in accounts.values_mut().filter_map(Value::as_object_mut) {
        for key in ["sync.saved_tab_groups", "sync.tabs"] {
            if types.get(key) != Some(&Value::Bool(false)) {
                types.insert(key.to_owned(), Value::Bool(false));
                changed = true;
            }
        }
    }
    changed
}

/// A saved group (`group` None) or a saved tab (`group` its group's id).
#[derive(Debug, PartialEq)]
struct Entity {
    id: String,
    title: String,
    group: Option<String>,
}

/// The ids to delete: Claude's groups, their tabs, and tabs whose group has
/// no record at all (`ids`, readable or not). Groups of the profile's owner
/// stay.
fn doomed(entities: &[Entity], ids: &HashSet<String>) -> HashSet<String> {
    let claude: HashSet<&str> = entities
        .iter()
        .filter(|e| e.group.is_none() && e.title.contains("Claude"))
        .map(|e| e.id.as_str())
        .collect();
    entities
        .iter()
        .filter(|e| match &e.group {
            None => claude.contains(e.id.as_str()),
            Some(g) => claude.contains(g.as_str()) || !ids.contains(g),
        })
        .map(|e| e.id.clone())
        .collect()
}

/// Reads a `saved_tab_group-dt-` record: `SavedTabGroupData` whose field 2
/// is `SavedTabGroupSpecifics` (4 = group, its title 2; 5 = tab, its group
/// id 1). None for a record it cannot read, which stays.
fn entity(id: &str, value: &[u8]) -> Option<Entity> {
    let specifics = bytes_field(value, 2)?;
    let (title, group) = match bytes_field(specifics, 5) {
        Some(tab) => (String::new(), Some(text_field(tab, 1)?)),
        None => (
            bytes_field(specifics, 4)
                .and_then(|g| text_field(g, 2))
                .unwrap_or_default(),
            None,
        ),
    };
    Some(Entity {
        id: id.to_owned(),
        title,
        group,
    })
}

fn varint(buf: &[u8], at: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *buf.get(*at)?;
        *at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

/// The last length-delimited field `field` of protobuf message `buf`. None
/// when absent or when `buf` is not a well-formed message.
fn bytes_field(buf: &[u8], field: u64) -> Option<&[u8]> {
    let mut at = 0;
    let mut found = None;
    while at < buf.len() {
        let tag = varint(buf, &mut at)?;
        match tag & 7 {
            0 => {
                varint(buf, &mut at)?;
            }
            1 => at += 8,
            5 => at += 4,
            2 => {
                let len = usize::try_from(varint(buf, &mut at)?).ok()?;
                let bytes = buf.get(at..at.checked_add(len)?)?;
                if tag >> 3 == field {
                    found = Some(bytes);
                }
                at += len;
            }
            _ => return None,
        }
    }
    (at == buf.len()).then_some(found).flatten()
}

fn text_field(buf: &[u8], field: u64) -> Option<String> {
    bytes_field(buf, field).map(|b| String::from_utf8_lossy(b).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn len_field(field: u64, bytes: &[u8]) -> Vec<u8> {
        let mut out = vec![u8::try_from(field << 3 | 2).unwrap()];
        out.push(u8::try_from(bytes.len()).unwrap());
        out.extend_from_slice(bytes);
        out
    }

    fn group(id: &str, title: &str) -> Vec<u8> {
        let specifics = [
            len_field(1, id.as_bytes()),
            len_field(4, &len_field(2, title.as_bytes())),
        ]
        .concat();
        [vec![8, 1], len_field(2, &specifics)].concat()
    }

    fn tab(id: &str, group: &str) -> Vec<u8> {
        let specifics = [
            len_field(1, id.as_bytes()),
            len_field(5, &len_field(1, group.as_bytes())),
        ]
        .concat();
        [vec![8, 1], len_field(2, &specifics)].concat()
    }

    #[test]
    fn reads_a_group_and_a_tab_record() {
        assert_eq!(
            entity("g1", &group("g1", "⌛Claude")),
            Some(Entity {
                id: "g1".into(),
                title: "⌛Claude".into(),
                group: None
            })
        );
        assert_eq!(
            entity("t1", &tab("t1", "g1")),
            Some(Entity {
                id: "t1".into(),
                title: String::new(),
                group: Some("g1".into())
            })
        );
        assert_eq!(entity("x", b"\x12\xff"), None);
    }

    #[test]
    fn deletes_claude_groups_their_tabs_and_orphans_only() {
        let entities = [
            entity("c1", &group("c1", "✅Claude")).unwrap(),
            entity("c1t", &tab("c1t", "c1")).unwrap(),
            entity("own", &group("own", "Open Repair")).unwrap(),
            entity("ownt", &tab("ownt", "own")).unwrap(),
            entity("orphan", &tab("orphan", "gone")).unwrap(),
            entity("odd-t", &tab("odd-t", "odd")).unwrap(),
        ];
        // "odd": a group record that could not be read; its tab stays.
        let ids: HashSet<String> = ["c1", "c1t", "own", "ownt", "orphan", "odd", "odd-t"]
            .map(String::from)
            .into();
        let mut doomed: Vec<String> = doomed(&entities, &ids).into_iter().collect();
        doomed.sort_unstable();
        assert_eq!(doomed, ["c1", "c1t", "orphan"]);
    }

    #[test]
    fn turns_off_tab_sync_for_every_known_account_once() {
        let known = account_key("102");
        let mut prefs = json!({
            "account_info": [{"gaia": "101"}, {"gaia": "102"}],
            "sync": {"selected_types_per_account": {
                known.clone(): {"sync.saved_tab_groups": true, "sync.tabs": true, "sync.typed_urls": true}
            }}
        });
        assert!(turn_off_tab_sync(&mut prefs));
        let accounts = &prefs["sync"]["selected_types_per_account"];
        assert_eq!(
            accounts[&known],
            json!({"sync.saved_tab_groups": false, "sync.tabs": false, "sync.typed_urls": true})
        );
        assert_eq!(
            accounts[&account_key("101")],
            json!({"sync.saved_tab_groups": false, "sync.tabs": false})
        );
        assert!(!turn_off_tab_sync(&mut prefs));
    }

    #[test]
    fn reads_the_childs_outcome() {
        assert_eq!(
            parse_outcome("ok 3 5 1"),
            Some(Ok(Tidied {
                groups: 3,
                tabs: 5,
                sync_turned_off: true
            }))
        );
        assert_eq!(parse_outcome("err locked"), Some(Err("locked".into())));
        assert_eq!(parse_outcome(""), None);
    }

    fn profile_with(records: &[(&str, Vec<u8>)], prefs: &Value) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Preferences"), prefs.to_string()).unwrap();
        let store = dir.path().join("Sync Data").join("LevelDB");
        std::fs::create_dir_all(&store).unwrap();
        let mut db = DB::open(&store, Options::default()).unwrap();
        db.put(b"bookmarks-dt-1", b"kept").unwrap();
        for (id, value) in records {
            db.put(&[DATA, id.as_bytes()].concat(), value).unwrap();
            db.put(&[META, id.as_bytes()].concat(), b"meta").unwrap();
        }
        db.close().unwrap();
        dir
    }

    #[test]
    fn empties_a_closed_profile_and_keeps_the_rest() {
        let prefs = json!({"sync": {"selected_types_per_account": {"a": {"sync.tabs": true}}}});
        let dir = profile_with(
            &[
                ("c1", group("c1", "⌛Claude")),
                ("c1t", tab("c1t", "c1")),
                ("own", group("own", "Mine")),
            ],
            &prefs,
        );
        let tidied = tidy(dir.path()).unwrap();
        assert_eq!(
            tidied,
            Tidied {
                groups: 1,
                tabs: 1,
                sync_turned_off: true
            }
        );
        let mut db = DB::open(
            dir.path().join("Sync Data").join("LevelDB"),
            Options::default(),
        )
        .unwrap();
        assert!(db.get(b"saved_tab_group-dt-c1").is_none());
        assert!(db.get(b"saved_tab_group-md-c1t").is_none());
        assert!(db.get(b"saved_tab_group-dt-own").is_some());
        assert_eq!(db.get(b"bookmarks-dt-1").as_deref(), Some(&b"kept"[..]));
        let written = read_prefs(&dir.path().join("Preferences")).unwrap().0;
        assert_eq!(
            written["sync"]["selected_types_per_account"]["a"]["sync.tabs"],
            false
        );
        assert!(!dir.path().join("Preferences.arkadia-tmp").exists());
    }

    #[test]
    fn leaves_an_open_or_fully_synced_profile_alone() {
        let prefs = json!({"sync": {"selected_types_per_account": {"a": {"sync.tabs": true}}}});
        let dir = profile_with(&[("c1", group("c1", "⌛Claude"))], &prefs);
        let held = DB::open(
            dir.path().join("Sync Data").join("LevelDB"),
            Options::default(),
        )
        .unwrap();
        assert!(tidy(dir.path()).is_err());
        drop(held);
        let written = std::fs::read_to_string(dir.path().join("Preferences")).unwrap();
        assert_eq!(written, prefs.to_string());

        let synced = json!({"sync": {"has_setup_completed": true}});
        let dir = profile_with(&[("c1", group("c1", "⌛Claude"))], &synced);
        assert!(tidy(dir.path()).is_err());
    }
}
