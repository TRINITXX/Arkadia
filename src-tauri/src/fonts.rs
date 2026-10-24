use font_kit::family_name::FamilyName;
use font_kit::handle::Handle;
use font_kit::properties::Properties;
use font_kit::source::SystemSource;
use std::fs;

/// The font file of `family`, as raw bytes. A `Vec<u8>` result would travel
/// as a JSON array of numbers: 6.9 MB of text for the 2.4 MB Maple Mono NF,
/// built here and parsed by the page. Off the main thread for the same reason.
#[tauri::command(async)]
pub fn get_font_data(family: String) -> Result<tauri::ipc::Response, String> {
    let primary = family
        .split(',')
        .next()
        .map(|s| s.trim().trim_matches('"').to_string())
        .unwrap_or_default();
    if primary.is_empty() {
        return Err("empty font family".into());
    }

    let source = SystemSource::new();
    let handle = source
        .select_best_match(&[FamilyName::Title(primary.clone())], &Properties::new())
        .map_err(|e| format!("font '{}' not found: {}", primary, e))?;

    let bytes = match handle {
        Handle::Path { path, .. } => {
            fs::read(&path).map_err(|e| format!("failed to read '{}': {}", path.display(), e))?
        }
        Handle::Memory { bytes, .. } => (*bytes).clone(),
    };
    Ok(tauri::ipc::Response::new(bytes))
}
