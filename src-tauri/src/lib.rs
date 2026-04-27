use std::fs;
use std::path::Path;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileEntry>>,
}

#[derive(Serialize, Clone)]
struct FsChangeEvent {
    kind: String,
    paths: Vec<String>,
}

struct WatcherState(Mutex<Option<notify::RecommendedWatcher>>);

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    // Encode to base64 using the standard alphabet
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 3) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 { out.push(TABLE[((b1 & 0xf) << 2) | (b2 >> 6)] as char); } else { out.push('='); }
        if chunk.len() > 2 { out.push(TABLE[b2 & 0x3f] as char); } else { out.push('='); }
    }
    Ok(out)
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result: Vec<FileEntry> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let is_dir = metadata.is_dir();
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();

        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }

        // Only include supported file types and directories
        let is_image = name.ends_with(".jpg") || name.ends_with(".jpeg")
            || name.ends_with(".png") || name.ends_with(".gif")
            || name.ends_with(".webp") || name.ends_with(".avif")
            || name.ends_with(".svg");
        if !is_dir && !name.ends_with(".md") && !name.ends_with(".pdf")
            && !name.ends_with(".txt") && !is_image {
            continue;
        }

        result.push(FileEntry {
            name,
            path: full_path,
            is_dir,
            children: None,
        });
    }

    result.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(result)
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("File already exists".to_string());
    }
    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("A folder with that name already exists".to_string());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn get_initial_folder() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(path) = args.get(1) {
        let p = Path::new(path);
        if p.is_dir() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    if Path::new(&new_path).exists() {
        return Err("A file with that name already exists".to_string());
    }
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_watching(
    path: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    use notify::Watcher;

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = None; // drop existing watcher

    let app = app_handle.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(_) => return,
        };
        let kind = match event.kind {
            notify::EventKind::Create(_) => "created",
            notify::EventKind::Remove(_) => "removed",
            notify::EventKind::Modify(_) => "modified",
            _ => return,
        };
        let paths: Vec<String> = event
            .paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        let _ = app.emit("fs-change", FsChangeEvent { kind: kind.to_string(), paths });
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), notify::RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
fn stop_watching(state: tauri::State<WatcherState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatcherState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            let icon_bytes = include_bytes!("../icons/128x128.png");

            // Set the GTK default window icon (affects taskbar on GTK-based DEs)
            // and force dark theme variant for WebKit's prefers-color-scheme
            #[cfg(target_os = "linux")]
            {
                use gtk::prelude::*;
                use gtk::gdk_pixbuf::PixbufLoader;
                let loader = PixbufLoader::with_type("png")?;
                loader.write(icon_bytes)?;
                loader.close()?;
                let pixbuf = loader.pixbuf().expect("Failed to get pixbuf");
                gtk::Window::set_default_icon(&pixbuf);

                if let Some(settings) = gtk::Settings::default() {
                    settings.set_gtk_application_prefer_dark_theme(true);
                }
            }

            // Also set the individual window icon via Tauri API
            let window = app.get_webview_window("main").unwrap();
            let icon = tauri::image::Image::from_bytes(icon_bytes)?;
            window.set_icon(icon)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_base64,
            write_file,
            list_directory,
            create_file,
            create_directory,
            rename_file,
            file_exists,
            get_initial_folder,
            start_watching,
            stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
