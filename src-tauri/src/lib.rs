use docx_rs::{Docx, Paragraph, Run};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

#[derive(Default, Deserialize, Serialize)]
struct AppSettings {
  repo_path: Option<String>,
}

#[derive(Serialize)]
struct ProjectSummary {
  name: String,
  path: String,
}

/// Lightweight fingerprint of a project's `project.json`. Used to detect when
/// the file was changed outside the running app (e.g. Google Drive syncing in
/// a newer copy from another machine). The hash is only ever compared against
/// a baseline captured by the same running session, so a process-local
/// hashing scheme is sufficient.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMeta {
  mtime_ms: u64,
  size: u64,
  hash: String,
}

fn compute_project_meta(data_path: &Path) -> Result<ProjectMeta, String> {
  let content =
    fs::read(data_path).map_err(|error| format!("failed to read project for meta: {error}"))?;
  let metadata =
    fs::metadata(data_path).map_err(|error| format!("failed to stat project: {error}"))?;
  let mtime_ms = metadata
    .modified()
    .ok()
    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
    .map(|elapsed| elapsed.as_millis() as u64)
    .unwrap_or(0);
  let size = content.len() as u64;
  let mut hasher = DefaultHasher::new();
  content.hash(&mut hasher);
  Ok(ProjectMeta {
    mtime_ms,
    size,
    hash: hasher.finish().to_string(),
  })
}

fn is_generic_project_title(title: &str) -> bool {
  let normalized = title.trim().to_ascii_lowercase();
  normalized.is_empty() || normalized == "untitled" || normalized == "untitled project"
}

fn resolve_project_display_name(json_title: Option<&str>, directory_name: &str) -> String {
  if let Some(title) = json_title {
    let trimmed = title.trim();
    if !trimmed.is_empty() && !is_generic_project_title(trimmed) {
      return trimmed.to_string();
    }
  }

  let folder = directory_name.trim();
  if folder.is_empty() {
    "Untitled Project".to_string()
  } else {
    folder.to_string()
  }
}

fn project_name_from_json_file(project_file: &Path, directory_name: &str) -> String {
  let name = fs::read_to_string(project_file)
    .ok()
    .and_then(|content| serde_json::from_str::<Value>(&content).ok())
    .and_then(|json| json["title"].as_str().map(ToString::to_string));
  resolve_project_display_name(name.as_deref(), directory_name)
}

fn push_project_summary(results: &mut Vec<ProjectSummary>, path: &Path, name: String) {
  let path_string = path.to_string_lossy().to_string();
  if results.iter().any(|entry| entry.path == path_string) {
    return;
  }
  results.push(ProjectSummary {
    name,
    path: path_string,
  });
}

fn sanitize_name(name: &str) -> String {
  let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
  let mut sanitized: String = name
    .chars()
    .map(|char| {
      if char.is_control() || invalid_chars.contains(&char) {
        '_'
      } else {
        char
      }
    })
    .collect();

  sanitized = sanitized.trim().trim_end_matches('.').to_string();

  let reserved_names = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  ];
  if reserved_names.iter().any(|reserved| reserved.eq_ignore_ascii_case(&sanitized)) {
    sanitized.push('_');
  }

  if sanitized.is_empty() {
    "untitled".to_string()
  } else {
    sanitized
  }
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let path = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
  fs::create_dir_all(&path).map_err(|error| format!("failed to create app data dir: {error}"))?;
  Ok(path)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  Ok(app_data_dir(app)?.join("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
  let path = settings_path(app)?;
  if !path.exists() {
    return Ok(AppSettings::default());
  }
  let content = fs::read_to_string(path).map_err(|error| format!("failed to read settings: {error}"))?;
  serde_json::from_str::<AppSettings>(&content).map_err(|error| format!("failed to parse settings: {error}"))
}

fn write_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
  let path = settings_path(app)?;
  let payload = serde_json::to_string_pretty(settings).map_err(|error| format!("failed to encode settings: {error}"))?;
  fs::write(path, payload).map_err(|error| format!("failed to write settings: {error}"))
}

fn project_json_path(project_path: &Path) -> PathBuf {
  project_path.join("project.json")
}

fn repo_path_from_settings(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let settings = read_settings(app)?;
  let raw = settings
    .repo_path
    .ok_or_else(|| "repo path is not configured".to_string())?;
  let path = PathBuf::from(raw);
  if !path.exists() || !path.is_dir() {
    return Err("configured repo path does not exist or is not a directory".to_string());
  }
  Ok(path)
}

#[tauri::command]
fn get_repo_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let settings = read_settings(&app)?;
  Ok(settings.repo_path)
}

#[tauri::command]
fn set_repo_path(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
  let path = PathBuf::from(repo_path.clone());
  if !path.exists() || !path.is_dir() {
    return Err("repo path must be an existing directory".to_string());
  }
  let mut settings = read_settings(&app)?;
  settings.repo_path = Some(repo_path);
  write_settings(&app, &settings)
}

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
  let repo_path = repo_path_from_settings(&app)?;
  let mut results: Vec<ProjectSummary> = Vec::new();

  let root_project_file = project_json_path(&repo_path);
  if root_project_file.exists() {
    let directory_name = repo_path
      .file_name()
      .map(|name| name.to_string_lossy().to_string())
      .unwrap_or_else(|| "Untitled Project".to_string());
    let name = project_name_from_json_file(&root_project_file, &directory_name);
    push_project_summary(&mut results, &repo_path, name);
  }

  for entry in fs::read_dir(&repo_path).map_err(|error| format!("failed to read repo dir: {error}"))? {
    let entry = entry.map_err(|error| format!("failed to read repo entry: {error}"))?;
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }

    let project_file = project_json_path(&path);
    if !project_file.exists() {
      continue;
    }

    let directory_name = entry.file_name().to_string_lossy().to_string();
    let name = project_name_from_json_file(&project_file, &directory_name);
    push_project_summary(&mut results, &path, name);
  }

  results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  Ok(results)
}

#[tauri::command]
fn create_project(app: tauri::AppHandle, project_name: String, project_json: String) -> Result<ProjectSummary, String> {
  serde_json::from_str::<Value>(&project_json).map_err(|error| format!("invalid project json: {error}"))?;
  let repo_path = repo_path_from_settings(&app)?;
  let display_name = project_name.trim();
  let dir_name = sanitize_name(display_name);
  let project_dir = repo_path.join(dir_name.clone());
  if project_dir.exists() {
    return Err("project directory already exists".to_string());
  }
  fs::create_dir_all(&project_dir).map_err(|error| format!("failed to create project directory: {error}"))?;

  let data_path = project_json_path(&project_dir);
  let temp_path = project_dir.join("project.json.tmp");
  fs::write(&temp_path, project_json).map_err(|error| format!("failed to write temp project: {error}"))?;
  fs::rename(&temp_path, &data_path).map_err(|error| format!("failed to finalize project write: {error}"))?;

  Ok(ProjectSummary {
    name: if display_name.is_empty() {
      "untitled".to_string()
    } else {
      display_name.to_string()
    },
    path: project_dir.to_string_lossy().to_string(),
  })
}

const MAX_PROJECT_SNAPSHOTS: usize = 10;
const SNAPSHOT_DIR: &str = ".lightscript/backups";

fn snapshot_timestamp() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let duration = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default();
  format!("{}-{:03}", duration.as_secs(), duration.subsec_millis())
}

fn is_snapshot_file_name(name: &str) -> bool {
  name.starts_with("project-") && name.ends_with(".json")
}

fn prune_project_snapshots(backup_dir: &Path) -> Result<(), String> {
  let mut snapshots: Vec<PathBuf> = Vec::new();
  for entry in fs::read_dir(backup_dir)
    .map_err(|error| format!("failed to read snapshot dir: {error}"))?
  {
    let entry = entry.map_err(|error| format!("failed to read snapshot entry: {error}"))?;
    if !entry.path().is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if is_snapshot_file_name(&name) {
      snapshots.push(entry.path());
    }
  }

  snapshots.sort();
  while snapshots.len() > MAX_PROJECT_SNAPSHOTS {
    let oldest = snapshots.remove(0);
    fs::remove_file(&oldest).map_err(|error| format!("failed to prune snapshot: {error}"))?;
  }
  Ok(())
}

fn snapshot_project_before_save(project_dir: &Path) -> Result<(), String> {
  let data_path = project_json_path(project_dir);
  if !data_path.exists() {
    return Ok(());
  }

  let backup_dir = project_dir.join(SNAPSHOT_DIR);
  fs::create_dir_all(&backup_dir).map_err(|error| format!("failed to create snapshot dir: {error}"))?;

  let backup_path = backup_dir.join(format!("project-{}.json", snapshot_timestamp()));
  fs::copy(&data_path, &backup_path).map_err(|error| format!("failed to write project snapshot: {error}"))?;
  prune_project_snapshots(&backup_dir)
}

#[tauri::command]
fn save_project_to_path(project_path: String, project_json: String) -> Result<ProjectMeta, String> {
  serde_json::from_str::<Value>(&project_json).map_err(|error| format!("invalid project json: {error}"))?;
  let project_dir = PathBuf::from(project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  snapshot_project_before_save(&project_dir)?;
  let data_path = project_json_path(&project_dir);
  let temp_path = project_dir.join("project.json.tmp");
  fs::write(&temp_path, project_json).map_err(|error| format!("failed to write temp project: {error}"))?;
  fs::rename(&temp_path, &data_path).map_err(|error| format!("failed to finalize project write: {error}"))?;
  compute_project_meta(&data_path)
}

#[tauri::command]
fn get_project_meta(project_path: String) -> Result<Option<ProjectMeta>, String> {
  let data_path = project_json_path(&PathBuf::from(project_path));
  if !data_path.exists() {
    return Ok(None);
  }
  Ok(Some(compute_project_meta(&data_path)?))
}

/// A project directory only ever legitimately contains `project.json` (and a
/// transient `project.json.tmp` mid-write). Cloud clients like Google Drive
/// resolve a two-device edit conflict by keeping the loser as a sibling copy,
/// e.g. `project (1).json` or `project (Name's conflicted copy 2024-01-01).json`.
/// Any other `project*.json` is therefore treated as a conflict copy.
fn is_conflict_copy_name(name: &str) -> bool {
  if name.eq_ignore_ascii_case("project.json") {
    return false;
  }
  let lower = name.to_lowercase();
  lower.starts_with("project") && lower.ends_with(".json")
}

#[tauri::command]
fn list_conflict_copies(project_path: String) -> Result<Vec<String>, String> {
  let project_dir = PathBuf::from(project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let mut copies: Vec<String> = Vec::new();
  for entry in
    fs::read_dir(&project_dir).map_err(|error| format!("failed to read project dir: {error}"))?
  {
    let entry = entry.map_err(|error| format!("failed to read project entry: {error}"))?;
    if !entry.path().is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if is_conflict_copy_name(&name) {
      copies.push(name);
    }
  }
  copies.sort();
  Ok(copies)
}

#[tauri::command]
fn delete_project(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
  let repo_path = repo_path_from_settings(&app)?;
  let project_dir = PathBuf::from(&project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }

  let canonical_project = fs::canonicalize(&project_dir)
    .map_err(|error| format!("failed to canonicalize project path: {error}"))?;
  let canonical_repo =
    fs::canonicalize(&repo_path).map_err(|error| format!("failed to canonicalize repo path: {error}"))?;

  if !canonical_project.starts_with(&canonical_repo) || canonical_project == canonical_repo {
    return Err("project path must be inside repo path".to_string());
  }

  fs::remove_dir_all(&canonical_project)
    .map_err(|error| format!("failed to delete project directory: {error}"))?;
  Ok(())
}

#[tauri::command]
fn load_project_from_path(project_path: String) -> Result<String, String> {
  let project_dir = PathBuf::from(project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let data_path = project_json_path(&project_dir);
  if !data_path.exists() {
    return Err("project.json was not found".to_string());
  }

  let content = fs::read_to_string(data_path).map_err(|error| format!("failed to read project: {error}"))?;
  Ok(content)
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    if !parent.as_os_str().is_empty() {
      fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create destination directory: {error}"))?;
    }
  }
  Ok(())
}

/// Write a UTF-8 text payload (Markdown / plain text / anything else
/// pre-rendered by the frontend) to a user-chosen path.
#[tauri::command]
fn write_text_export(target_path: String, content: String) -> Result<String, String> {
  let path = PathBuf::from(&target_path);
  ensure_parent_dir(&path)?;
  fs::write(&path, content).map_err(|error| format!("failed to write export file: {error}"))?;
  Ok(path.to_string_lossy().to_string())
}

/// Render a Scene JSON tree into a real Office Open XML .docx and write it to
/// the user-chosen path. Tries to mirror the Markdown export structure:
/// bold scene title, plain narrative paragraphs, "speaker: "quoted text""
/// for dialogue blocks.
#[tauri::command]
fn write_docx_export(target_path: String, scene_json: String) -> Result<String, String> {
  let scene: Value =
    serde_json::from_str(&scene_json).map_err(|error| format!("invalid scene json: {error}"))?;

  let path = PathBuf::from(&target_path);
  ensure_parent_dir(&path)?;

  let title = scene["title"].as_str().unwrap_or("Untitled").trim();
  let mut docx = Docx::new().add_paragraph(
    Paragraph::new().add_run(Run::new().add_text(title).bold().size(32)),
  );

  if let Some(blocks) = scene["blocks"].as_array() {
    for block in blocks {
      let block_type = block["type"].as_str().unwrap_or("");
      let text = block["text"].as_str().unwrap_or("").trim();
      if text.is_empty() {
        continue;
      }

      let paragraph = match block_type {
        "narrative" => Paragraph::new().add_run(Run::new().add_text(text)),
        "dialogue" => {
          let speaker = block["character"].as_str().unwrap_or("").trim();
          let quoted = format!("\u{201C}{}\u{201D}", text);
          if speaker.is_empty() {
            Paragraph::new().add_run(Run::new().add_text(quoted))
          } else {
            Paragraph::new()
              .add_run(Run::new().add_text(format!("{}\u{FF1A}", speaker)).bold())
              .add_run(Run::new().add_text(quoted))
          }
        }
        _ => continue,
      };
      docx = docx.add_paragraph(paragraph);
    }
  }

  let file =
    fs::File::create(&path).map_err(|error| format!("failed to create file: {error}"))?;
  docx
    .build()
    .pack(file)
    .map_err(|error| format!("failed to write docx: {error}"))?;

  Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
  let file_path = PathBuf::from(path);
  if !file_path.exists() || !file_path.is_file() {
    return Err("file does not exist or is not a regular file".to_string());
  }
  fs::read_to_string(&file_path).map_err(|error| format!("failed to read file: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      get_repo_path,
      set_repo_path,
      list_projects,
      create_project,
      delete_project,
      save_project_to_path,
      get_project_meta,
      list_conflict_copies,
      load_project_from_path,
      write_text_export,
      write_docx_export,
      read_text_file,
    ])
    .setup(|app| {
      if let Some(window) = app.get_webview_window("main") {
        window.set_icon(tauri::include_image!("icons/32x32.png"))?;
      }
      app.handle().plugin(tauri_plugin_dialog::init())?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
