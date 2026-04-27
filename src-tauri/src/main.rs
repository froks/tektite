// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Work around WebKit2GTK black screen on Linux systems where
    // GPU DMA-BUF rendering fails silently.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

        // Ensure the dark GTK theme variant is used so that WebKit's
        // prefers-color-scheme media query reports "dark" correctly.
        if std::env::var("GTK_THEME").is_err() {
            std::env::set_var("GTK_THEME", "Adwaita:dark");
        }
    }

    tektite_lib::run()
}
