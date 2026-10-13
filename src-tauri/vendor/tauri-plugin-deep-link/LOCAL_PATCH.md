Vendored tauri-plugin-deep-link 2.4.7 (Apache-2.0 OR MIT).

All three raw URL emission paths filter to validated v1/import URLs before emitting any Tauri event. App-target events alone are unsafe because JS can subscribe with target App. OAuth uses native application RunEvent, single-instance and startup dispatch. The app exposes only validated import URLs through its own IPC command; plugin raw get_current permission is not granted. Recheck these guarantees on upgrade.
