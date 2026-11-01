//! CSV, TSV, and XLSX metadata inspection, row reading, and file stats.

use anyhow::{Context, Result as AnyResult, bail};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use super::data::{infer_type, is_missing_value};
use crate::error::{CommandError, IntoCommandResult};

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalColumnMetadata {
    pub name: String,
    pub inferred_type: String,
    pub levels: Vec<String>,
    pub is_identifier: bool,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDataInspection {
    pub columns: Vec<ExternalColumnMetadata>,
    #[specta(type = specta_typescript::Number)]
    pub row_count: usize,
    pub file_hash: String,
    pub sheet_name: Option<String>,
}

pub(super) fn detect_delimiter(first_line: &str) -> char {
    let comma_count = first_line.matches(',').count();
    let semicolon_count = first_line.matches(';').count();
    let tab_count = first_line.matches('\t').count();
    if semicolon_count > comma_count && semicolon_count > tab_count {
        ';'
    } else if tab_count > comma_count && tab_count > semicolon_count {
        '\t'
    } else {
        ','
    }
}

fn build_external_columns(
    headers: &[String],
    column_values: &[Vec<String>],
) -> Vec<ExternalColumnMetadata> {
    let mut columns = Vec::new();
    for (i, header) in headers.iter().enumerate() {
        let values = column_values.get(i).map(|v| v.as_slice()).unwrap_or(&[]);
        let inferred = infer_type(values);
        let levels = if inferred != "continuous" {
            let mut seen = HashSet::new();
            let mut levels = Vec::new();
            for val in values {
                if !is_missing_value(val) && seen.insert(val.clone()) {
                    levels.push(val.clone());
                }
            }
            levels
        } else {
            vec![]
        };
        columns.push(ExternalColumnMetadata {
            name: header.clone(),
            inferred_type: inferred,
            levels,
            is_identifier: false,
        });
    }
    columns
}

pub fn inspect_external_data_impl(
    absolute_path: String,
    sheet_name: Option<String>,
    delimiter: Option<String>,
) -> AnyResult<ExternalDataInspection> {
    let path = PathBuf::from(&absolute_path);
    if !path.exists() {
        bail!("File not found: {}", absolute_path);
    }
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut file = std::fs::File::open(&path)?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents)?;

    let mut hasher = Sha256::new();
    hasher.update(&contents);
    let file_hash = hex::encode(hasher.finalize());

    let parsed_delimiter = match delimiter.as_deref() {
        Some(",") => Some(','),
        Some(";") => Some(';'),
        Some("\t") => Some('\t'),
        _ => None,
    };

    match extension.as_str() {
        "tsv" => parse_external_delimited(&contents, '\t', file_hash),
        "csv" => {
            let delim_char = if let Some(d) = parsed_delimiter {
                d
            } else {
                let text = String::from_utf8_lossy(&contents);
                let first_line = text.lines().next().unwrap_or("");
                detect_delimiter(first_line)
            };
            parse_external_delimited(&contents, delim_char, file_hash)
        }
        "xlsx" => parse_external_xlsx(&path, sheet_name, file_hash),
        _ => bail!("Unsupported file format: .{}", extension),
    }
}

fn parse_external_delimited(
    contents: &[u8],
    delimiter: char,
    file_hash: String,
) -> AnyResult<ExternalDataInspection> {
    let text = String::from_utf8_lossy(contents);
    let text = text.trim_start_matches('\u{FEFF}');

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter as u8)
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers: Vec<String> = reader
        .headers()?
        .iter()
        .map(|s| s.trim().to_string())
        .collect();

    let mut column_values: Vec<Vec<String>> = vec![vec![]; headers.len()];
    let mut row_count = 0;
    for result in reader.records() {
        let record = result?;
        row_count += 1;
        for (i, field) in record.iter().enumerate() {
            if i < headers.len() {
                column_values[i].push(field.trim().to_string());
            }
        }
    }

    let columns = build_external_columns(&headers, &column_values);

    Ok(ExternalDataInspection {
        columns,
        row_count,
        file_hash,
        sheet_name: None,
    })
}

fn parse_external_xlsx(
    path: &Path,
    sheet_name: Option<String>,
    file_hash: String,
) -> AnyResult<ExternalDataInspection> {
    use calamine::{Reader, Xlsx, open_workbook};

    let mut workbook: Xlsx<_> = open_workbook(path)?;
    let sheet_names = workbook.sheet_names();
    if sheet_names.is_empty() {
        bail!("xlsx file has no sheets");
    }
    let target_sheet = sheet_name.unwrap_or_else(|| sheet_names[0].clone());
    let range = workbook.worksheet_range(&target_sheet)?;

    let mut rows_iter = range.rows();
    let header_row = rows_iter.next().context("xlsx sheet is empty")?;
    let headers: Vec<String> = header_row.iter().map(|c| c.to_string()).collect();

    let mut column_values: Vec<Vec<String>> = vec![vec![]; headers.len()];
    let mut row_count = 0;
    for row in rows_iter {
        row_count += 1;
        for (i, cell) in row.iter().enumerate() {
            if i < headers.len() {
                column_values[i].push(cell.to_string());
            }
        }
    }

    let columns = build_external_columns(&headers, &column_values);

    Ok(ExternalDataInspection {
        columns,
        row_count,
        file_hash,
        sheet_name: Some(target_sheet),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn inspect_external_data(
    absolute_path: String,
    sheet_name: Option<String>,
    delimiter: Option<String>,
) -> Result<ExternalDataInspection, CommandError> {
    inspect_external_data_impl(absolute_path, sheet_name, delimiter).into_command_result()
}

fn normalize_na(value: &str, na_tokens: &[String]) -> String {
    let trimmed = value.trim();
    let na_set: HashSet<&str> = na_tokens.iter().map(|s| s.as_str()).collect();
    if na_set.contains(trimmed) {
        return String::new();
    }
    trimmed.to_string()
}

pub(super) fn parse_external_rows(
    path: &Path,
    delimiter: char,
    na_tokens: &[String],
) -> AnyResult<Vec<HashMap<String, String>>> {
    let text = std::fs::read_to_string(path)?;
    let text = text.trim_start_matches('\u{FEFF}');

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter as u8)
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers: Vec<String> = reader
        .headers()?
        .iter()
        .map(|s| s.trim().to_string())
        .collect();

    let mut rows = Vec::new();
    for result in reader.records() {
        let record = result?;
        let mut row = HashMap::new();
        for (i, field) in record.iter().enumerate() {
            if i < headers.len() {
                row.insert(headers[i].clone(), normalize_na(field, na_tokens));
            }
        }
        rows.push(row);
    }
    Ok(rows)
}

pub(super) fn parse_external_xlsx_rows(
    path: &Path,
    sheet_name: Option<String>,
    na_tokens: &[String],
) -> AnyResult<Vec<HashMap<String, String>>> {
    use calamine::{Reader, Xlsx, open_workbook};

    let mut workbook: Xlsx<_> = open_workbook(path)?;
    let sheet_names = workbook.sheet_names();
    if sheet_names.is_empty() {
        bail!("xlsx file has no sheets");
    }
    let target_sheet = sheet_name.unwrap_or_else(|| sheet_names[0].clone());
    let range = workbook.worksheet_range(&target_sheet)?;

    let mut rows_iter = range.rows();
    let header_row = rows_iter.next().context("xlsx sheet is empty")?;
    let headers: Vec<String> = header_row.iter().map(|c| c.to_string()).collect();

    let na_set: HashSet<String> = na_tokens.iter().cloned().collect();

    let mut rows = Vec::new();
    for row in rows_iter {
        let mut row_map = HashMap::new();
        for (i, cell) in row.iter().enumerate() {
            if i < headers.len() {
                let val = cell.to_string();
                let normalized = if na_set.contains(&val) {
                    String::new()
                } else {
                    val
                };
                row_map.insert(headers[i].clone(), normalized);
            }
        }
        rows.push(row_map);
    }
    Ok(rows)
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileStats {
    pub mtime: String,
    #[specta(type = specta_typescript::Number)]
    pub size: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn stat_file(path: String) -> Result<FileStats, CommandError> {
    (|| -> AnyResult<FileStats> {
        let meta = std::fs::metadata(&path)?;
        let mtime = meta
            .modified()
            .map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs().to_string())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        Ok(FileStats {
            mtime,
            size: meta.len(),
        })
    })()
    .into_command_result()
}
