//! Natural-language search over the transcripts, driven by a headless
//! `claude -p`.
//!
//! Typing a sentence rather than keywords runs two calls. The first turns the
//! sentence into search constraints — mostly a time window, which is what
//! actually narrows 3 000 transcripts down to a readable handful. The second
//! hands the resulting passages back to Claude, which answers in prose and
//! cites the sessions it used.
//!
//! Four properties of this pipeline were established by measurement and are not
//! incidental:
//!
//! * **Sanitised invocation.** Run from the repo, `claude -p` inherits
//!   `CLAUDE.md`, every MCP server and every skill — some 32 000 tokens of
//!   instructions — and reads a "reply with JSON only" system prompt as a
//!   prompt injection, refusing outright. The flags below strip all of it.
//! * **Corpus over stdin.** A bundle of passages runs past 130 000 characters;
//!   Windows caps a command line near 32 000, and the process dies in 300 ms
//!   with no usable diagnostic. The prompt therefore never travels as an
//!   argument.
//! * **A dedicated working directory.** Every headless call writes its own
//!   transcript under `~/.claude/projects`, containing the query and the
//!   passages. Left alone, searching for a word manufactures a session
//!   containing that word, which then pollutes the next search. Calls run from
//!   [`workspace_dir`], and the session index skips anything found there.
//! * **The perimeter is ours to report.** Asked to declare how much of the
//!   corpus it had seen, the model silently dropped the instruction. The
//!   counts travel as data and the UI renders them.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::sessions::{
    gather_ai_candidates, query_terms, AiCandidate, SessionIndex, TimeWindow,
};

/// Model behind both calls. Measured against Haiku on this exact task: better
/// synonyms, correct reading of "hier soir" as an evening window, obeys the
/// output contract — and, counter-intuitively, faster.
const MODEL: &str = "claude-sonnet-5";
/// The constraint call is small; if it has not answered by now it never will.
const PLAN_TIMEOUT: Duration = Duration::from_secs(60);
/// The reading call carries the whole bundle, so it gets more room.
const READ_TIMEOUT: Duration = Duration::from_secs(120);
/// Tools are useless here and only invite the model to wander.
const NO_TOOLS: &str = "Bash,Read,Write,Edit,Glob,Grep,Task,WebSearch,WebFetch,Skill,NotebookEdit";

const PLAN_SYSTEM: &str = "\
Tu convertis une demande de recherche en francais en mots-cles pour une recherche plein texte \
sur des transcriptions de conversations de developpement.

Reponds UNIQUEMENT par un objet JSON brut, sans bloc de code, sans texte autour:
{\"termes\":[\"mot1\",\"mot2\"],\"apres\":null,\"avant\":null}

Regles:
- Melange OBLIGATOIREMENT deux calibres, car les termes sont cherches en OU:
  * 2 a 4 expressions precises de plusieurs mots, telles qu'on les ecrirait vraiment;
  * 2 a 4 mots simples et discriminants du domaine, francais ou anglais.
  Les expressions ciblent, les mots simples rattrapent les formulations qu'on n'a pas prevues.
- Ne mets PAS deux formes du meme mot (le pluriel est trouve par le singulier).
- Evite les mots si courants qu'ils apparaitraient dans presque toute conversation de \
developpement (fichier, code, erreur, projet, test).
- N'inclus JAMAIS de radical tronque, de participe passe, ni de mot vide.
- Chaque terme doit etre un mot ou une expression qu'un humain aurait reellement ecrit.
- apres/avant = bornes ISO8601 en UTC si la demande porte une notion de temps, sinon null.
- Conventions horaires, en heure locale: matin 6h-12h, apres-midi 12h-18h, soir 18h-minuit, \
nuit minuit-6h. 'hier soir' commence donc a 18h la veille et court jusqu'au petit matin.
- En cas de doute sur une borne, elargis plutot que de restreindre: une session manquee est \
pire qu'une session en trop.";

const READ_SYSTEM: &str = "\
Tu reponds a une question en t'appuyant UNIQUEMENT sur les extraits de conversations fournis.

Regles:
- Reponds en francais, en 4 phrases maximum, de facon directe et concrete.
- Cite les sessions qui portent la reponse par leur identifiant complet, une par ligne, \
prefixees de '-> '.
- Si les extraits ne contiennent pas la reponse, dis-le franchement. N'invente rien, \
ne deduis rien qui ne soit pas ecrit, et n'invente aucun identifiant de session.
- Ne commente pas le nombre d'extraits que tu as recus.";

/// What the constraint call extracted.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
pub struct SearchPlan {
    /// Terms to look for — synonyms of one idea, so they match as alternatives.
    pub terms: Vec<String>,
    pub after: Option<String>,
    pub before: Option<String>,
}

/// The reader's verdict, plus the numbers the UI needs to state the perimeter.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct SearchAnswer {
    pub answer: String,
    /// Session ids the answer leans on, in the order they were cited.
    pub cited: Vec<String>,
    /// Sessions actually read, and sessions that matched in total.
    pub read: usize,
    pub total: usize,
}

/// A candidate as the list renders it — the passages stay in Rust.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct CandidateRow {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub mtime: u64,
    pub count: usize,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct CandidateList {
    pub rows: Vec<CandidateRow>,
    pub total: usize,
}

/// Passages held between the candidate call and the reading call, so a 130 KB
/// bundle never crosses the IPC boundary twice.
#[derive(Default)]
pub struct AiSearchState(std::sync::Mutex<Vec<AiCandidate>>);

/// Where headless calls run, so their transcripts land in one project folder
/// the index can ignore. Created on demand.
pub fn workspace_dir() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("Arkadia").join("ai-search");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// The `claude` executable. `PATH` is not enough: an app started from Explorer
/// does not inherit the shell's, and the binary lives in `~/.local/bin`.
fn claude_binary() -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local").join("bin"));
        roots.push(home.join("AppData").join("Roaming").join("npm"));
    }
    if let Ok(path) = std::env::var("PATH") {
        roots.extend(std::env::split_paths(&path));
    }
    let names = if cfg!(windows) {
        &["claude.exe", "claude.cmd", "claude"][..]
    } else {
        &["claude"][..]
    };
    for root in roots {
        for name in names {
            let p = root.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Why a call could not produce an answer — phrased for the panel that shows it.
fn friendly_error(stdout: &str, stderr: &str) -> String {
    let all = format!("{stdout}\n{stderr}");
    if all.contains("out_of_credits") || all.contains("rate_limit") && all.contains("exceeded") {
        return "Quota Claude épuisé — réessaie après la réinitialisation.".into();
    }
    if all.contains("not logged in") || all.contains("Invalid API key") || all.contains("/login") {
        return "Claude Code n'est pas connecté — lance `claude` dans un terminal pour t'authentifier.".into();
    }
    let line = stderr
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("réponse illisible");
    format!("L'appel a échoué : {}", crate::sessions::truncate_for_ui(line, 160))
}

/// Runs one sanitised headless call, prompt on stdin, and returns the `result`
/// text of the CLI's JSON envelope.
fn run_claude(system: &str, prompt: &str, timeout: Duration) -> Result<String, String> {
    let bin = claude_binary().ok_or_else(|| {
        "Binaire `claude` introuvable (cherché dans ~/.local/bin, %APPDATA%\\npm et le PATH)."
            .to_string()
    })?;
    let cwd = workspace_dir()
        .ok_or_else(|| "Impossible de créer le dossier de travail de la recherche IA.".to_string())?;

    let mut child = Command::new(&bin)
        .current_dir(&cwd)
        .args([
            "-p",
            "--model",
            MODEL,
            "--output-format",
            "json",
            // Without these the call inherits the project's CLAUDE.md, MCP
            // servers and skills, and the model refuses the output contract.
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
            "--exclude-dynamic-system-prompt-sections",
            "--disallowed-tools",
            NO_TOOLS,
            "--system-prompt",
            system,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de lancer `claude` : {e}"))?;

    // The bundle goes here, never in the argv: Windows caps a command line
    // around 32 000 characters and a 130 KB prompt kills the process outright.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let out = match rx.recv_timeout(timeout) {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(format!("Impossible de lire la réponse de `claude` : {e}")),
        Err(_) => {
            return Err(format!(
                "Pas de réponse au bout de {} s.",
                timeout.as_secs()
            ))
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    envelope_result(&stdout).ok_or_else(|| friendly_error(&stdout, &stderr))
}

/// The `result` field of the CLI's JSON envelope. The stream is wrapped in
/// terminal escape sequences, so the array is located rather than parsed whole.
fn envelope_result(stdout: &str) -> Option<String> {
    let start = stdout.find("[{")?;
    let value: Value = serde_json::from_str(stdout[start..].trim_end_matches(|c: char| c != ']'))
        .or_else(|_| serde_json::from_str(&stdout[start..]))
        .ok()?;
    let entry = value
        .as_array()?
        .iter()
        .rev()
        .find(|v| v.get("type").and_then(Value::as_str) == Some("result"))?;
    if entry.get("is_error").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    entry
        .get("result")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Strips a ``` fence if the model wrapped its JSON in one — Sonnet returns it
/// raw, Haiku did not, and the contract should not hinge on that.
fn unfence(s: &str) -> &str {
    let t = s.trim();
    let Some(rest) = t.strip_prefix("```") else {
        return t;
    };
    let rest = rest.strip_prefix("json").unwrap_or(rest);
    rest.trim().trim_end_matches("```").trim()
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// The constraint prompt, stamped with the current moment.
///
/// `--exclude-dynamic-system-prompt-sections` strips Claude Code's own date
/// injection along with everything else, and a model that does not know what
/// day it is resolves "hier soir" to the wrong window — silently, since the
/// output still looks well formed. The local offset travels too, because the
/// transcripts are stamped in UTC while the user means their own evening.
fn plan_system() -> String {
    let now = chrono::Local::now();
    format!(
        "{PLAN_SYSTEM}\n\nMoment present: {} (UTC{}). Raisonne dans ce fuseau, \
         puis convertis les bornes en UTC.",
        now.format("%A %d %B %Y, %Hh%M"),
        now.format("%:z")
    )
}

/// Turns a sentence into search constraints.
#[tauri::command(async)]
pub fn ai_search_plan(query: String) -> Result<SearchPlan, String> {
    let raw = run_claude(&plan_system(), query.trim(), PLAN_TIMEOUT)?;
    let parsed: Value = serde_json::from_str(unfence(&raw))
        .map_err(|_| "Réponse inattendue du modèle (JSON illisible).".to_string())?;
    let terms = parsed
        .get("termes")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_lowercase())
                .filter(|s| s.chars().count() >= 2)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let field = |k: &str| {
        parsed
            .get(k)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Ok(SearchPlan {
        terms,
        after: field("apres"),
        before: field("avant"),
    })
}

/// Gathers and ranks the candidates for a plan, stashing their passages.
#[tauri::command(async)]
pub fn ai_search_candidates(
    plan: SearchPlan,
    index: State<'_, SessionIndex>,
    state: State<'_, AiSearchState>,
) -> CandidateList {
    let window = TimeWindow::parse(plan.after.as_deref(), plan.before.as_deref());
    let found = gather_ai_candidates(&index, &plan.terms, &window);
    let rows = found
        .kept
        .iter()
        .map(|c| CandidateRow {
            id: c.id.clone(),
            title: c.title.clone(),
            cwd: c.cwd.clone(),
            mtime: c.mtime,
            count: c.count,
        })
        .collect();
    if let Ok(mut held) = state.0.lock() {
        *held = found.kept;
    }
    CandidateList {
        rows,
        total: found.total,
    }
}

/// Reads the stashed passages and answers the original question.
#[tauri::command(async)]
pub fn ai_search_answer(
    query: String,
    total: usize,
    state: State<'_, AiSearchState>,
) -> Result<SearchAnswer, String> {
    let held = match state.0.lock() {
        Ok(h) => h.clone(),
        Err(e) => e.into_inner().clone(),
    };
    if held.is_empty() {
        return Err("Aucun extrait à lire.".into());
    }
    let mut bundle = String::with_capacity(64 * 1024);
    bundle.push_str("QUESTION: ");
    bundle.push_str(query.trim());
    bundle.push_str("\n\n");
    for c in &held {
        bundle.push_str(&format!(
            "=== session {} · {} ===\n{}\n\n",
            c.id,
            c.title,
            c.chunks.join("\n")
        ));
    }
    let answer = run_claude(READ_SYSTEM, &bundle, READ_TIMEOUT)?;
    let cited = held
        .iter()
        .map(|c| c.id.clone())
        .filter(|id| answer.contains(id.as_str()))
        .collect();
    Ok(SearchAnswer {
        answer: answer.trim().to_string(),
        cited,
        read: held.len(),
        total,
    })
}

/// Free the stashed passages when the overlay closes.
#[tauri::command]
pub fn ai_search_forget(state: State<'_, AiSearchState>) {
    if let Ok(mut held) = state.0.lock() {
        held.clear();
    }
}

/// The plain-search terms for a query — the frontend needs the exact same
/// splitting to highlight what the backend matched.
#[tauri::command]
pub fn search_terms(query: String) -> Vec<String> {
    query_terms(&query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfence_handles_both_shapes() {
        assert_eq!(unfence("{\"a\":1}"), "{\"a\":1}");
        assert_eq!(unfence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(unfence("```\n{\"a\":1}\n```"), "{\"a\":1}");
    }

    #[test]
    fn envelope_result_picks_the_result_entry() {
        let out = r#"ESC[{"type":"system","subtype":"init"},{"type":"result","is_error":false,"result":"salut"}]"#;
        assert_eq!(envelope_result(out).as_deref(), Some("salut"));
    }

    #[test]
    fn envelope_result_rejects_an_errored_run() {
        let out = r#"[{"type":"result","is_error":true,"result":"boom"}]"#;
        assert!(envelope_result(out).is_none());
    }

    /// Manual end-to-end check that the sanitised invocation works when spawned
    /// from Rust rather than a shell — different PATH, no TTY, no inherited
    /// environment. This is the one risk the design could not settle on paper.
    /// `cargo test --lib -- --ignored --nocapture real_plan_call`.
    #[test]
    #[ignore]
    fn real_plan_call() {
        println!("binaire : {:?}", claude_binary());
        println!("workspace : {:?}", workspace_dir());
        let t = std::time::Instant::now();
        let plan = ai_search_plan("les identifiants qu'on a créés hier soir".into());
        println!("en {:?} → {plan:?}", t.elapsed());
        let plan = plan.expect("the sanitized call must succeed");
        assert!(!plan.terms.is_empty(), "no terms came back");
    }

    /// Manual end-to-end run over the real `~/.claude/projects`: plan, gather,
    /// read. Reports the timing and the perimeter of each stage.
    /// `cargo test --release --lib -- --ignored --nocapture real_full_pipeline`.
    #[test]
    #[ignore]
    fn real_full_pipeline() {
        let query = "qu'est-ce qu'on avait conclu sur les notifications en plein écran";
        let t = std::time::Instant::now();
        let plan = ai_search_plan(query.into()).expect("plan");
        println!("plan     {:?} · {:?}", t.elapsed(), plan);

        let index = crate::sessions::SessionIndex::default();
        let window = TimeWindow::parse(plan.after.as_deref(), plan.before.as_deref());
        let t = std::time::Instant::now();
        let found = gather_ai_candidates(&index, &plan.terms, &window);
        println!(
            "gather   {:?} · {} candidates, {} lues",
            t.elapsed(),
            found.total,
            found.kept.len()
        );
        for c in found.kept.iter().take(5) {
            println!("   {:>4}× {} · {}", c.count, &c.id[..8], c.title);
        }
        assert!(!found.kept.is_empty(), "nothing to read");

        let mut bundle = format!("QUESTION: {query}\n\n");
        for c in &found.kept {
            bundle.push_str(&format!(
                "=== session {} · {} ===\n{}\n\n",
                c.id,
                c.title,
                c.chunks.join("\n")
            ));
        }
        println!("bundle   {} caracteres", bundle.len());
        let t = std::time::Instant::now();
        let answer = run_claude(READ_SYSTEM, &bundle, READ_TIMEOUT).expect("read");
        println!("read     {:?}\n\n{answer}", t.elapsed());
    }

    #[test]
    fn friendly_error_names_the_quota() {
        let msg = friendly_error(r#"{"overageDisabledReason":"out_of_credits"}"#, "");
        assert!(msg.contains("Quota"), "got {msg}");
    }
}
