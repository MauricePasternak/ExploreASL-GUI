//! Niivue protocol responses and project-scoped qCBF/rT1 volume resolution.

use std::path::PathBuf;
use tauri::Manager;
use tauri::http;

fn bad_request(body: &'static [u8]) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(400)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .body(body.to_vec())
        .unwrap()
}

fn not_found(body: &'static [u8]) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(404)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .body(body.to_vec())
        .unwrap()
}

fn server_error(body: &'static [u8]) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(500)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .body(body.to_vec())
        .unwrap()
}

fn forbidden(body: &'static [u8]) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(403)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .body(body.to_vec())
        .unwrap()
}

fn ok(bytes: Vec<u8>, content_type: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(200)
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .body(bytes)
        .unwrap()
}

pub fn resolve_niivue_request(
    root: PathBuf,
    path: &str,
) -> Result<(PathBuf, &'static str), (http::StatusCode, &'static [u8])> {
    let mut segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    if !segments.is_empty() && (segments[0] == "localhost" || segments[0].is_empty()) {
        log::debug!("Stripping leading host/empty segment from Niivue request path");
        segments.remove(0);
    }

    if segments.len() < 2 {
        log::error!(
            "Niivue request failed: expected at least 2 segments, found: {:?}",
            segments
        );
        return Err((
            http::StatusCode::BAD_REQUEST,
            b"Expected at least 2 path segments",
        ));
    }

    let volume_type = segments[0];
    let participant_id = segments[1];
    let run = segments.get(2);
    log::debug!(
        "Parsed segments: volume_type = {}, participant_id = {}, run = {:?}",
        volume_type,
        participant_id,
        run
    );

    let filename = match volume_type {
        "qCBF" => {
            let r = match run {
                Some(s) => {
                    let s_str = *s;
                    if let Some(stripped) = s_str.strip_suffix(".nii.gz") {
                        stripped
                    } else if let Some(stripped) = s_str.strip_suffix(".nii") {
                        stripped
                    } else {
                        s_str
                    }
                }
                None => {
                    log::error!("Niivue request failed: Missing run segment for qCBF");
                    return Err((
                        http::StatusCode::BAD_REQUEST,
                        b"Missing run segment for qCBF",
                    ));
                }
            };
            format!("qCBF_{}_{}.nii", participant_id, r)
        }
        "rT1" => {
            let identifier = participant_id
                .strip_suffix(".nii.gz")
                .or_else(|| participant_id.strip_suffix(".nii"))
                .unwrap_or(participant_id);
            if segments.len() != 2 || identifier.is_empty() {
                return Err((
                    http::StatusCode::BAD_REQUEST,
                    b"Expected rT1 participant identifier without run",
                ));
            }
            format!("rT1_{}.nii", identifier)
        }
        _ => {
            log::error!(
                "Niivue request failed: Unknown volume type: {}",
                volume_type
            );
            return Err((http::StatusCode::NOT_FOUND, b"Unknown volume type"));
        }
    };
    log::info!("Constructed lookup filename: {}", filename);

    let pop_dir = root.join("derivatives/ExploreASL/Population");
    let nii_path = pop_dir.join(&filename);
    let gz_path = pop_dir.join(format!("{}.gz", filename));
    log::debug!(
        "Checking paths: nii_path = {:?}, gz_path = {:?}",
        nii_path,
        gz_path
    );

    let (file_path, content_type) = match std::fs::canonicalize(&nii_path) {
        Ok(c) => {
            log::info!("Found raw NIfTI file: {:?}", c);
            (c, "application/octet-stream")
        }
        Err(e_nii) => match std::fs::canonicalize(&gz_path) {
            Ok(c) => {
                log::info!("Found compressed NIfTI file: {:?}", c);
                (c, "application/gzip")
            }
            Err(e_gz) => {
                log::error!(
                    "Niivue request failed: File not found in Population. nii error: {}, gz error: {}",
                    e_nii,
                    e_gz
                );
                return Err((http::StatusCode::NOT_FOUND, b"File not found"));
            }
        },
    };

    let root_canonical: PathBuf = match std::fs::canonicalize(&root) {
        Ok(r) => r,
        Err(_) => {
            log::error!("Niivue request failed: Invalid project root: {:?}", root);
            return Err((
                http::StatusCode::INTERNAL_SERVER_ERROR,
                b"Invalid project root",
            ));
        }
    };

    if !file_path.starts_with(&root_canonical) {
        log::error!(
            "Niivue request failed: Path traversal rejected: {:?} is outside of {:?}",
            file_path,
            root_canonical
        );
        return Err((http::StatusCode::FORBIDDEN, b"Path traversal rejected"));
    }

    Ok((file_path, content_type))
}

pub fn handle_niivue_protocol(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let uri = request.uri();
    let path = uri.path();
    let method = request.method();
    log::info!(
        "Niivue protocol request: Method = {}, URI path = {}",
        method,
        path
    );

    if method == http::Method::OPTIONS {
        return http::Response::builder()
            .status(200)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .header("Access-Control-Allow-Headers", "*")
            .body(Vec::new())
            .unwrap();
    }

    let app_handle = ctx.app_handle();
    let state = app_handle.state::<crate::app::state::AppState>();
    let root = match state.active_project_root.lock() {
        Ok(guard) => match *guard {
            Some(ref r) => r.clone(),
            None => {
                log::error!("Niivue request failed: No active project root");
                return not_found(b"No active project");
            }
        },
        Err(_) => {
            log::error!("Niivue request failed: State lock poisoned");
            return server_error(b"State lock poisoned");
        }
    };
    log::debug!("Active project root: {:?}", root);

    let (file_path, content_type) = match resolve_niivue_request(root, path) {
        Ok(res) => res,
        Err((status, body)) => {
            return match status {
                http::StatusCode::BAD_REQUEST => bad_request(body),
                http::StatusCode::NOT_FOUND => not_found(body),
                http::StatusCode::FORBIDDEN => forbidden(body),
                _ => server_error(body),
            };
        }
    };

    log::info!("Reading file: {:?}", file_path);
    let bytes = match std::fs::read(&file_path) {
        Ok(b) => {
            log::info!("Successfully read {} bytes from {:?}", b.len(), file_path);
            b
        }
        Err(e) => {
            log::error!(
                "Niivue request failed: Failed to read file {:?}: {}",
                file_path,
                e
            );
            return http::Response::builder()
                .status(500)
                .body(format!("Failed to read file: {}", e).into_bytes())
                .unwrap();
        }
    };
    ok(bytes, content_type)
}

#[cfg(test)]
#[path = "niivue_protocol_tests.rs"]
mod tests;
