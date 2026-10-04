//! Host command preparation outside the AppImage environment.

use std::env;
use std::path::Path;
use std::process::Command;

fn is_appimage_path(path: &str) -> bool {
    path.contains("/.mount_") || path.contains("/tmp/.mount_")
}

pub(crate) fn sanitize_ld_library_path(ld_path: &str, appdir: Option<&str>) -> Vec<String> {
    env::split_paths(ld_path)
        .filter_map(|p| p.to_str().map(String::from))
        .filter(|p| {
            if is_appimage_path(p) {
                return false;
            }
            if let Some(ad) = appdir
                && p.starts_with(ad)
            {
                return false;
            }
            true
        })
        .collect()
}

pub(crate) fn should_redirect_cwd(cwd: &str, appdir: Option<&str>) -> bool {
    is_appimage_path(cwd) || appdir.is_some_and(|ad| cwd.starts_with(ad))
}

pub(crate) fn sanitize_command_env(command: &mut Command) {
    if let Ok(ld_path) = env::var("LD_LIBRARY_PATH") {
        let appdir = env::var("APPDIR").ok();
        let sanitized = sanitize_ld_library_path(&ld_path, appdir.as_deref());

        if sanitized.is_empty() {
            log::debug!("[AppImage] Stripped AppImage paths from LD_LIBRARY_PATH (now empty)");
            command.env_remove("LD_LIBRARY_PATH");
        } else {
            match env::join_paths(sanitized.iter().map(Path::new)) {
                Ok(new_ld) => {
                    log::debug!("[AppImage] Sanitized LD_LIBRARY_PATH: {:?}", new_ld);
                    command.env("LD_LIBRARY_PATH", new_ld);
                }
                Err(_) => {
                    log::warn!(
                        "[AppImage] join_paths failed for sanitized LD_LIBRARY_PATH; removing variable"
                    );
                    command.env_remove("LD_LIBRARY_PATH");
                }
            }
        }
    }

    if let Ok(ld_preload) = env::var("LD_PRELOAD")
        && is_appimage_path(&ld_preload)
    {
        log::debug!("[AppImage] Removed AppImage LD_PRELOAD");
        command.env_remove("LD_PRELOAD");
    }
}

pub(crate) fn create_system_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    sanitize_command_env(&mut command);

    if let Ok(cwd) = env::current_dir() {
        let cwd_str = cwd.to_string_lossy();
        let appdir = env::var("APPDIR").ok();
        if should_redirect_cwd(&cwd_str, appdir.as_deref()) {
            log::debug!(
                "[AppImage] Changing command working directory from AppImage mount {:?} to temp_dir {:?}",
                cwd,
                env::temp_dir()
            );
            command.current_dir(env::temp_dir());
        }
    } else {
        command.current_dir(env::temp_dir());
    }

    command
}
