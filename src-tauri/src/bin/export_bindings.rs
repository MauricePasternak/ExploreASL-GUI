use anyhow::{Context, Result, bail};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn files(directory: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    walkdir::WalkDir::new(directory)
        .min_depth(1)
        .into_iter()
        .filter(|entry| !entry.as_ref().is_ok_and(|entry| entry.file_type().is_dir()))
        .map(|entry| {
            let entry = entry?;
            Ok((
                entry.path().strip_prefix(directory)?.to_path_buf(),
                fs::read(entry.path())?,
            ))
        })
        .collect()
}

fn export(directory: &Path) -> Result<()> {
    let path = directory.join("bindings.ts");
    exploreasl_gui_lib::export_bindings(&path)?;
    // ponytail: rc.26-only output fix; remove when upstream honors noUnused*.
    // Preserve the assertion's type check without relaxing compiler options.
    let generated = fs::read_to_string(&path)?.replace(
        "const _assertTypedErrorFollowsContract: <T, E>(result: Promise<T>) => Promise<any> = typedError;",
        "const _assertTypedErrorFollowsContract: <T, _E>(result: Promise<T>) => Promise<any> = typedError;\nvoid _assertTypedErrorFollowsContract;",
    );
    let switches = serde_json::to_string_pretty(
        &exploreasl_gui_lib::project::model::DataPar::switch_defaults(),
    )?;
    fs::write(
        &path,
        format!("{generated}\nexport const PARAMETER_SWITCH_DEFAULTS = {switches} as const;\n"),
    )?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let status = Command::new("pnpm")
        .current_dir(root)
        .args(["exec", "prettier", "--write"])
        .arg(directory)
        .args(["--parser", "typescript"])
        .arg("--config")
        .arg(root.join(".prettierrc"))
        .status()
        .context("Could not format generated TypeScript with installed Prettier")?;
    if !status.success() {
        bail!("Formatting generated TypeScript failed");
    }
    Ok(())
}

fn main() -> Result<()> {
    let check = match std::env::args().nth(1).as_deref() {
        None => false,
        Some("--check") => true,
        Some(_) => bail!("Usage: export_bindings [--check]"),
    };
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/generated");
    let temporary = tempfile::tempdir()?;
    export(temporary.path())?;
    let generated = files(temporary.path())?;
    if check {
        if files(&directory).context("Run pnpm bindings:generate first")? != generated {
            bail!("IPC bindings are stale; run pnpm bindings:generate");
        }
        println!("IPC bindings match native commands and types");
    } else {
        fs::create_dir_all(&directory)?;
        for name in files(&directory)?.keys() {
            if !generated.contains_key(name) {
                fs::remove_file(directory.join(name))?;
            }
        }
        for (name, bytes) in generated {
            let path = directory.join(name);
            fs::create_dir_all(path.parent().unwrap())?;
            fs::write(path, bytes)?;
        }
    }
    Ok(())
}
