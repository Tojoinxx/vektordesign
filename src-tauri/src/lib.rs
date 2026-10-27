//! Desktop-Hülle für Vektordesign (Tauri 2).
//!
//! Die ganze Anwendung läuft im WebView; Rust stellt nur bereit, was der Browser nicht kann:
//! Dateien an beliebigen Orten lesen/schreiben (nach Auswahl im Systemdialog) und die Liste
//! der installierten Schriftarten.

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};

use std::sync::OnceLock;

/// Schriftdatenbank des Systems (einmal geladen).
fn font_db() -> &'static fontdb::Database {
    static DB: OnceLock<fontdb::Database> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

/// Schriftdatei zu Familie, Stärke und Stil (für „Text in Pfade“). Antwort: 4 Byte Index der
/// Schrift in einer Sammlung (.ttc, little endian), danach die Datei.
#[tauri::command]
fn font_file(family: String, weight: u16, italic: bool) -> Result<Response, String> {
    let db = font_db();
    let families = [fontdb::Family::Name(&family)];
    let query = fontdb::Query {
        families: &families,
        weight: fontdb::Weight(weight),
        stretch: fontdb::Stretch::Normal,
        style: if italic { fontdb::Style::Italic } else { fontdb::Style::Normal },
    };
    let id = db
        .query(&query)
        .ok_or_else(|| format!("Schrift „{family}“ ist nicht installiert"))?;
    db.with_face_data(id, |data, index| {
        let mut out = Vec::with_capacity(data.len() + 4);
        out.extend_from_slice(&index.to_le_bytes());
        out.extend_from_slice(data);
        out
    })
    .map(Response::new)
    .ok_or_else(|| format!("Schrift „{family}“ konnte nicht gelesen werden"))
}

/// Alle installierten Schriftfamilien, alphabetisch und ohne Doppelte.
#[tauri::command]
fn list_fonts() -> Vec<String> {
    let db = font_db();
    let mut names: Vec<String> = db
        .faces()
        .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// Liest eine Datei als Binärdaten (kommt im Frontend als ArrayBuffer an).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Datei konnte nicht gelesen werden: {e}"))
}

/// Schreibt Binärdaten; der Zielpfad steht URL-kodiert im Header `x-path`.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let raw = request
        .headers()
        .get("x-path")
        .ok_or_else(|| "Zielpfad fehlt".to_string())?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = percent_decode_str(raw)
        .decode_utf8()
        .map_err(|e| e.to_string())?
        .into_owned();
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Ungültige Daten (Binärdaten erwartet)".into());
    };
    std::fs::write(&path, data).map_err(|e| format!("Datei konnte nicht gespeichert werden: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_fonts, font_file, read_file, write_file]);

    #[cfg(any(debug_assertions, feature = "selftest"))]
    if let Some(plugin) = selftest::plugin() {
        builder = builder.plugin(plugin);
    }

    builder
        .run(tauri::generate_context!())
        .expect("Vektordesign konnte nicht gestartet werden");
}

/// Selbsttest im echten Fenster (tests/desktop): Nur in Debug-Builds oder mit dem Cargo-Feature
/// `selftest`. Ist die Umgebungsvariable `VEKTORDESIGN_SELFTEST` auf eine JavaScript-Datei gesetzt,
/// wird sie vor dem Laden der Oberfläche eingebunden. Veröffentlichte Installer enthalten das nicht.
#[cfg(any(debug_assertions, feature = "selftest"))]
mod selftest {
    pub fn plugin<R: tauri::Runtime>() -> Option<tauri::plugin::TauriPlugin<R>> {
        let path = std::env::var("VEKTORDESIGN_SELFTEST").ok()?;
        match std::fs::read_to_string(&path) {
            Ok(js) => Some(tauri::plugin::Builder::new("vd-selftest").js_init_script(js).build()),
            Err(e) => {
                eprintln!("Selbsttest {path} nicht lesbar: {e}");
                None
            }
        }
    }
}
