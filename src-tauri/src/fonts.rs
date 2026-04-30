use font_kit::family_name::FamilyName;
use font_kit::handle::Handle;
use font_kit::properties::Properties;
use font_kit::source::SystemSource;
use std::fs;

#[tauri::command]
pub fn get_font_data(family: String) -> Result<Vec<u8>, String> {
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
        .select_best_match(
            &[FamilyName::Title(primary.clone())],
            &Properties::new(),
        )
        .map_err(|e| format!("font '{}' not found: {}", primary, e))?;

    match handle {
        Handle::Path { path, .. } => fs::read(&path)
            .map_err(|e| format!("failed to read '{}': {}", path.display(), e)),
        Handle::Memory { bytes, .. } => Ok((*bytes).clone()),
    }
}
