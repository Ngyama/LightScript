use docx_rs::{Docx, Paragraph, Run};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;
use tauri::{LogicalSize, Size};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectLastOpened {
  last_script_id: Option<String>,
  last_scene_id: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
struct AppSettings {
  repo_path: Option<String>,
  #[serde(default)]
  projects: HashMap<String, ProjectLastOpened>,
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

/// Per Scene (or project.json) ring size — not a global pool across the work.
const MAX_SNAPSHOTS_PER_SCENE: usize = 10;
const MAX_SNAPSHOTS_PROJECT_META: usize = 8;
const SNAPSHOT_DIR: &str = ".lightscript/backups";

fn snapshot_timestamp() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let duration = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default();
  format!("{}-{:03}", duration.as_secs(), duration.subsec_millis())
}

fn is_legacy_monolithic_snapshot_name(name: &str) -> bool {
  name.starts_with("project-") && name.ends_with(".json")
}

fn snapshot_cap_for_relative(relative_path: &str) -> usize {
  let normalized = relative_path.replace('\\', "/");
  if normalized.eq_ignore_ascii_case("project.json") {
    MAX_SNAPSHOTS_PROJECT_META
  } else {
    MAX_SNAPSHOTS_PER_SCENE
  }
}

/// Live `scripts/a/scenes/b.json` → `.lightscript/backups/scripts/a/scenes/b/`
/// Live `project.json` → `.lightscript/backups/project.json/`
fn snapshot_ring_dir(project_dir: &Path, relative_path: &str) -> PathBuf {
  let normalized = relative_path.replace('\\', "/");
  if normalized.eq_ignore_ascii_case("project.json") {
    return project_dir.join(SNAPSHOT_DIR).join("project.json");
  }
  let stem = normalized
    .strip_suffix(".json")
    .unwrap_or(normalized.as_str());
  project_dir.join(SNAPSHOT_DIR).join(stem)
}

fn backup_rel_within_dir(backup_dir: &Path, file_path: &Path) -> Option<String> {
  let rel = file_path.strip_prefix(backup_dir).ok()?;
  let text = rel.to_string_lossy().replace('\\', "/");
  if text.is_empty() || text.contains("..") {
    return None;
  }
  Some(text)
}

fn original_path_from_ring_backup(backup_rel: &str) -> Option<String> {
  // `project.json/123-456.bak` or `scripts/sid/scenes/scid/123-456.bak`
  let normalized = backup_rel.replace('\\', "/");
  if !normalized.ends_with(".bak") {
    return None;
  }
  let parent = Path::new(&normalized).parent()?.to_string_lossy().replace('\\', "/");
  if parent.is_empty() {
    return None;
  }
  if parent.eq_ignore_ascii_case("project.json") {
    return Some("project.json".to_string());
  }
  Some(format!("{parent}.json"))
}

fn normalize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
  let trimmed = relative_path.trim().replace('\\', "/");
  if trimmed.is_empty() {
    return Err("relative path cannot be empty".to_string());
  }
  let path = PathBuf::from(&trimmed);
  if path.is_absolute() {
    return Err("relative path must not be absolute".to_string());
  }
  for component in path.components() {
    match component {
      Component::Normal(_) => {}
      Component::CurDir => {}
      _ => {
        return Err("relative path must stay inside the project directory".to_string());
      }
    }
  }
  Ok(PathBuf::from(trimmed))
}

fn resolve_project_relative(project_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
  let relative = normalize_relative_path(relative_path)?;
  let joined = project_dir.join(&relative);
  let canonical_dir = fs::canonicalize(project_dir)
    .map_err(|error| format!("failed to canonicalize project path: {error}"))?;
  if joined.exists() {
    let canonical_file = fs::canonicalize(&joined)
      .map_err(|error| format!("failed to canonicalize project file: {error}"))?;
    if !canonical_file.starts_with(&canonical_dir) {
      return Err("relative path must stay inside the project directory".to_string());
    }
    return Ok(joined);
  }
  // Parent must exist inside project for new files.
  if let Some(parent) = joined.parent() {
    if parent.exists() {
      let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("failed to canonicalize parent path: {error}"))?;
      if !canonical_parent.starts_with(&canonical_dir) {
        return Err("relative path must stay inside the project directory".to_string());
      }
    } else if parent != project_dir && !parent.starts_with(project_dir) {
      return Err("relative path must stay inside the project directory".to_string());
    }
  }
  Ok(joined)
}

fn snapshot_file_before_save(project_dir: &Path, data_path: &Path, relative_path: &str) -> Result<(), String> {
  if !data_path.exists() {
    return Ok(());
  }
  let ring_dir = snapshot_ring_dir(project_dir, relative_path);
  fs::create_dir_all(&ring_dir).map_err(|error| format!("failed to create snapshot dir: {error}"))?;
  let backup_path = ring_dir.join(format!("{}.bak", snapshot_timestamp()));
  fs::copy(data_path, &backup_path).map_err(|error| format!("failed to write file snapshot: {error}"))?;
  prune_ring_dir(&ring_dir, snapshot_cap_for_relative(relative_path))?;
  prune_legacy_flat_for_relative(project_dir, relative_path)
}

fn is_bak_file_name(name: &str) -> bool {
  name.ends_with(".bak")
}

fn prune_ring_dir(ring_dir: &Path, cap: usize) -> Result<(), String> {
  if !ring_dir.exists() {
    return Ok(());
  }
  let mut snapshots: Vec<PathBuf> = Vec::new();
  for entry in fs::read_dir(ring_dir)
    .map_err(|error| format!("failed to read snapshot dir: {error}"))?
  {
    let entry = entry.map_err(|error| format!("failed to read snapshot entry: {error}"))?;
    if !entry.path().is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if is_bak_file_name(&name) {
      snapshots.push(entry.path());
    }
  }
  snapshots.sort();
  while snapshots.len() > cap {
    let oldest = snapshots.remove(0);
    fs::remove_file(&oldest).map_err(|error| format!("failed to prune snapshot: {error}"))?;
  }
  Ok(())
}

/// Older builds stored flat `scripts__id__scenes__id.json-ts.bak` in backups root.
fn prune_legacy_flat_for_relative(project_dir: &Path, relative_path: &str) -> Result<(), String> {
  let backup_root = project_dir.join(SNAPSHOT_DIR);
  if !backup_root.exists() {
    return Ok(());
  }
  let safe_prefix = format!("{}-", relative_path.replace(['/', '\\'], "__"));
  let mut snapshots: Vec<PathBuf> = Vec::new();
  for entry in fs::read_dir(&backup_root)
    .map_err(|error| format!("failed to read snapshot dir: {error}"))?
  {
    let entry = entry.map_err(|error| format!("failed to read snapshot entry: {error}"))?;
    if !entry.path().is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with(&safe_prefix) && name.ends_with(".bak") {
      snapshots.push(entry.path());
    }
  }
  // Prefer the nested ring; drop legacy flats for this file once a ring exists.
  let ring_dir = snapshot_ring_dir(project_dir, relative_path);
  let ring_has_files = ring_dir.exists()
    && fs::read_dir(&ring_dir)
      .map(|mut it| it.next().is_some())
      .unwrap_or(false);
  if ring_has_files {
    for path in snapshots {
      let _ = fs::remove_file(path);
    }
    return Ok(());
  }
  snapshots.sort();
  let cap = snapshot_cap_for_relative(relative_path);
  while snapshots.len() > cap {
    let oldest = snapshots.remove(0);
    fs::remove_file(&oldest).map_err(|error| format!("failed to prune snapshot: {error}"))?;
  }
  Ok(())
}

fn validate_backup_file_name(file_name: &str) -> Result<(), String> {
  let normalized = file_name.replace('\\', "/");
  if normalized.is_empty()
    || normalized.contains("..")
    || Path::new(&normalized).is_absolute()
  {
    return Err("invalid backup file name".to_string());
  }
  if !normalized.ends_with(".bak") && !is_legacy_monolithic_snapshot_name(&normalized) {
    return Err("invalid backup file name".to_string());
  }
  Ok(())
}

fn collect_bak_files(dir: &Path, backup_root: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
  if !dir.exists() {
    return Ok(());
  }
  for entry in fs::read_dir(dir).map_err(|error| format!("failed to read backups: {error}"))? {
    let entry = entry.map_err(|error| format!("failed to read backup entry: {error}"))?;
    let path = entry.path();
    if path.is_dir() {
      collect_bak_files(&path, backup_root, out)?;
      continue;
    }
    if !path.is_file() {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if is_bak_file_name(&name) || is_legacy_monolithic_snapshot_name(&name) {
      out.push(path);
    }
  }
  Ok(())
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
fn create_project(app: tauri::AppHandle, project_name: String) -> Result<ProjectSummary, String> {
  let repo_path = repo_path_from_settings(&app)?;
  let display_name = project_name.trim();
  let dir_name = sanitize_name(display_name);
  let project_dir = repo_path.join(dir_name.clone());
  if project_dir.exists() {
    return Err("project directory already exists".to_string());
  }
  fs::create_dir_all(&project_dir).map_err(|error| format!("failed to create project directory: {error}"))?;

  Ok(ProjectSummary {
    name: if display_name.is_empty() {
      "untitled".to_string()
    } else {
      display_name.to_string()
    },
    path: project_dir.to_string_lossy().to_string(),
  })
}

#[tauri::command]
fn save_project_to_path(
  project_path: String,
  project_json: String,
  expected_hash: Option<String>,
) -> Result<ProjectMeta, String> {
  write_project_file(
    project_path,
    "project.json".to_string(),
    project_json,
    expected_hash,
    Some(true),
  )
}

#[tauri::command]
fn write_project_file(
  project_path: String,
  relative_path: String,
  contents: String,
  expected_hash: Option<String>,
  take_snapshot: Option<bool>,
) -> Result<ProjectMeta, String> {
  if relative_path.replace('\\', "/").ends_with(".json") {
    serde_json::from_str::<Value>(&contents)
      .map_err(|error| format!("invalid json: {error}"))?;
  }
  let project_dir = PathBuf::from(&project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let data_path = resolve_project_relative(&project_dir, &relative_path)?;
  if let Some(expected) = expected_hash.as_deref() {
    if data_path.exists() {
      let current = compute_project_meta(&data_path)?;
      if current.hash != expected {
        return Err("external_update".to_string());
      }
    }
  }
  if take_snapshot.unwrap_or(false) {
    snapshot_file_before_save(&project_dir, &data_path, &relative_path)?;
  }
  ensure_parent_dir(&data_path)?;
  let file_name = data_path
    .file_name()
    .map(|name| name.to_string_lossy().to_string())
    .unwrap_or_else(|| "file.json".to_string());
  let temp_path = data_path
    .parent()
    .unwrap_or(&project_dir)
    .join(format!("{file_name}.tmp"));
  fs::write(&temp_path, contents).map_err(|error| format!("failed to write temp file: {error}"))?;
  fs::rename(&temp_path, &data_path).map_err(|error| format!("failed to finalize file write: {error}"))?;
  compute_project_meta(&data_path)
}

#[tauri::command]
fn read_project_file(project_path: String, relative_path: String) -> Result<String, String> {
  let project_dir = PathBuf::from(project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let data_path = resolve_project_relative(&project_dir, &relative_path)?;
  if !data_path.exists() || !data_path.is_file() {
    return Err(format!("file not found: {relative_path}"));
  }
  fs::read_to_string(&data_path).map_err(|error| format!("failed to read file: {error}"))
}

#[tauri::command]
fn get_project_file_meta(
  project_path: String,
  relative_path: String,
) -> Result<Option<ProjectMeta>, String> {
  let project_dir = PathBuf::from(project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let data_path = resolve_project_relative(&project_dir, &relative_path)?;
  if !data_path.exists() {
    return Ok(None);
  }
  Ok(Some(compute_project_meta(&data_path)?))
}

#[tauri::command]
fn delete_project_file(
  project_path: String,
  relative_path: String,
  expected_hash: Option<String>,
) -> Result<(), String> {
  let project_dir = PathBuf::from(project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let data_path = resolve_project_relative(&project_dir, &relative_path)?;
  if !data_path.exists() {
    return Ok(());
  }
  if let Some(expected) = expected_hash.as_deref() {
    let current = compute_project_meta(&data_path)?;
    if current.hash != expected {
      return Err("external_update".to_string());
    }
  }
  snapshot_file_before_save(&project_dir, &data_path, &relative_path)?;
  fs::remove_file(&data_path).map_err(|error| format!("failed to delete file: {error}"))?;
  Ok(())
}

#[tauri::command]
fn get_project_meta(project_path: String) -> Result<Option<ProjectMeta>, String> {
  get_project_file_meta(project_path, "project.json".to_string())
}

/// Cloud clients like Google Drive keep losers as sibling copies,
/// e.g. `project (1).json` or `scene-id (1).json`.
fn is_conflict_copy_name(name: &str, canonical_stem: &str) -> bool {
  if name.eq_ignore_ascii_case(&format!("{canonical_stem}.json")) {
    return false;
  }
  let lower = name.to_lowercase();
  let stem = canonical_stem.to_lowercase();
  lower.starts_with(&stem) && lower.ends_with(".json")
}

fn is_clean_scene_file_name(name: &str) -> bool {
  if !name.ends_with(".json") {
    return false;
  }
  let stem = &name[..name.len() - 5];
  !stem.is_empty()
    && !stem.contains(' ')
    && !stem.contains('(')
    && !name.to_lowercase().contains("conflicted")
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
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();
    if path.is_file() {
      if is_conflict_copy_name(&name, "project") {
        copies.push(name);
      }
      continue;
    }
    if !path.is_dir() || name == ".lightscript" {
      continue;
    }
    collect_scene_conflicts(&path, &name, &mut copies)?;
  }

  copies.sort();
  Ok(copies)
}

fn collect_scene_conflicts(dir: &Path, relative_prefix: &str, out: &mut Vec<String>) -> Result<(), String> {
  for entry in fs::read_dir(dir).map_err(|error| format!("failed to read dir: {error}"))? {
    let entry = entry.map_err(|error| format!("failed to read dir entry: {error}"))?;
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();
    let display_prefix = if relative_prefix.is_empty() {
      name.clone()
    } else {
      format!("{relative_prefix}/{name}")
    };
    if path.is_dir() {
      collect_scene_conflicts(&path, &display_prefix, out)?;
      continue;
    }
    if !path.is_file() || !name.ends_with(".json") || name.ends_with(".tmp") {
      continue;
    }
    let parent_name = path
      .parent()
      .and_then(|parent| parent.file_name())
      .map(|value| value.to_string_lossy().to_string())
      .unwrap_or_default();
    if parent_name != "scenes" {
      continue;
    }
    if is_clean_scene_file_name(&name) {
      continue;
    }
    out.push(format!("{relative_prefix}/{name}"));
  }
  Ok(())
}

#[tauri::command]
fn get_project_last_opened(
  app: tauri::AppHandle,
  project_path: String,
) -> Result<Option<ProjectLastOpened>, String> {
  let settings = read_settings(&app)?;
  Ok(settings.projects.get(&project_path).cloned())
}

#[tauri::command]
fn set_project_last_opened(
  app: tauri::AppHandle,
  project_path: String,
  last_script_id: Option<String>,
  last_scene_id: Option<String>,
) -> Result<(), String> {
  let mut settings = read_settings(&app)?;
  settings.projects.insert(
    project_path,
    ProjectLastOpened {
      last_script_id,
      last_scene_id,
    },
  );
  write_settings(&app, &settings)
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

/// Render one or more scenes into a .docx.
/// Accepts either a single scene object `{ title, blocks }` (legacy) or
/// `{ scenes: [ { title, blocks }, ... ] }` for merged multi-scene export.
#[tauri::command]
fn write_docx_export(target_path: String, scene_json: String) -> Result<String, String> {
  let payload: Value =
    serde_json::from_str(&scene_json).map_err(|error| format!("invalid scene json: {error}"))?;

  let path = PathBuf::from(&target_path);
  ensure_parent_dir(&path)?;

  let scenes: Vec<&Value> = if let Some(list) = payload.get("scenes").and_then(|v| v.as_array()) {
    list.iter().collect()
  } else {
    vec![&payload]
  };

  let mut docx = Docx::new();
  let mut wrote_any = false;

  for (index, scene) in scenes.iter().enumerate() {
    if index > 0 {
      docx = docx.add_paragraph(Paragraph::new());
    }

    let title = scene["title"].as_str().unwrap_or("Untitled").trim();
    docx = docx.add_paragraph(
      Paragraph::new().add_run(Run::new().add_text(title).bold().size(32)),
    );
    wrote_any = true;

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
        wrote_any = true;
      }
    }
  }

  if !wrote_any {
    docx = docx.add_paragraph(
      Paragraph::new().add_run(Run::new().add_text("Untitled").bold().size(32)),
    );
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

/// Preferred design size. On smaller screens we scale down to fit the work area
/// while keeping the 16:10 aspect ratio; on larger screens we stay at design size
/// so the writing chrome doesn't stretch too thin.
const DESIGN_WINDOW_WIDTH: f64 = 1600.0;
const DESIGN_WINDOW_HEIGHT: f64 = 1000.0;
const DESIGN_ASPECT: f64 = DESIGN_WINDOW_WIDTH / DESIGN_WINDOW_HEIGHT;
/// Leave headroom for taskbars / docks and a little breathing room around the frame.
const SCREEN_FIT_RATIO: f64 = 0.9;
const MIN_WINDOW_WIDTH: f64 = 1100.0;
const MIN_WINDOW_HEIGHT: f64 = 700.0;

fn fit_window_to_monitor(window: &tauri::WebviewWindow) {
  let Ok(Some(monitor)) = window.current_monitor() else {
    return;
  };

  let scale = monitor.scale_factor();
  let work = monitor.work_area().size;
  let available_w = (work.width as f64 / scale) * SCREEN_FIT_RATIO;
  let available_h = (work.height as f64 / scale) * SCREEN_FIT_RATIO;

  let mut width = DESIGN_WINDOW_WIDTH.min(available_w);
  let mut height = DESIGN_WINDOW_HEIGHT.min(available_h);

  // Clamp to design aspect so the layout stays predictable.
  if width / height > DESIGN_ASPECT {
    width = height * DESIGN_ASPECT;
  } else {
    height = width / DESIGN_ASPECT;
  }

  width = width.max(MIN_WINDOW_WIDTH.min(available_w));
  height = height.max(MIN_WINDOW_HEIGHT.min(available_h));

  let _ = window.set_size(Size::Logical(LogicalSize::new(width.round(), height.round())));
  let _ = window.center();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectBackupEntry {
  file_name: String,
  original_relative_path: String,
  mtime_ms: u64,
  size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreBackupResult {
  restored_relative_path: String,
}

fn parse_legacy_flat_backup_original_path(file_name: &str) -> Option<String> {
  // `{safe_relative}-{secs}-{millis}.bak` where safe_relative used `__` for `/`
  if !file_name.ends_with(".bak") {
    return None;
  }
  let without_ext = &file_name[..file_name.len() - 4];
  let bytes = without_ext.as_bytes();
  let mut idx = without_ext.len();
  while idx > 0 && bytes[idx - 1].is_ascii_digit() {
    idx -= 1;
  }
  if idx == without_ext.len() || idx == 0 || bytes[idx - 1] != b'-' {
    return None;
  }
  idx -= 1;
  let after_millis_dash = idx;
  while idx > 0 && bytes[idx - 1].is_ascii_digit() {
    idx -= 1;
  }
  if idx == after_millis_dash || idx == 0 || bytes[idx - 1] != b'-' {
    return None;
  }
  let safe = &without_ext[..idx - 1];
  if safe.is_empty() {
    return None;
  }
  Some(safe.replace("__", "/"))
}

#[tauri::command]
fn list_project_backups(project_path: String) -> Result<Vec<ProjectBackupEntry>, String> {
  let project_dir = PathBuf::from(project_path);
  let backup_dir = project_dir.join(SNAPSHOT_DIR);
  if !backup_dir.exists() {
    return Ok(Vec::new());
  }
  let mut files: Vec<PathBuf> = Vec::new();
  collect_bak_files(&backup_dir, &backup_dir, &mut files)?;
  let mut entries: Vec<ProjectBackupEntry> = Vec::new();
  for path in files {
    let Some(backup_rel) = backup_rel_within_dir(&backup_dir, &path) else {
      continue;
    };
    let original = if backup_rel.contains('/') {
      original_path_from_ring_backup(&backup_rel)
    } else {
      parse_legacy_flat_backup_original_path(&backup_rel)
    };
    let Some(original) = original else {
      continue;
    };
    let meta = compute_project_meta(&path)?;
    entries.push(ProjectBackupEntry {
      file_name: backup_rel,
      original_relative_path: original,
      mtime_ms: meta.mtime_ms,
      size: meta.size,
    });
  }
  entries.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
  Ok(entries)
}

#[tauri::command]
fn read_project_backup(project_path: String, file_name: String) -> Result<String, String> {
  validate_backup_file_name(&file_name)?;
  let path = PathBuf::from(project_path)
    .join(SNAPSHOT_DIR)
    .join(file_name.replace('\\', "/"));
  if !path.exists() || !path.is_file() {
    return Err("backup file not found".to_string());
  }
  fs::read_to_string(path).map_err(|error| format!("failed to read backup: {error}"))
}

#[tauri::command]
fn restore_project_backup(
  project_path: String,
  file_name: String,
  as_copy: bool,
) -> Result<RestoreBackupResult, String> {
  validate_backup_file_name(&file_name)?;
  let project_dir = PathBuf::from(&project_path);
  let backup_rel = file_name.replace('\\', "/");
  let backup_path = project_dir.join(SNAPSHOT_DIR).join(&backup_rel);
  if !backup_path.exists() {
    return Err("backup file not found".to_string());
  }
  let original = if backup_rel.contains('/') {
    original_path_from_ring_backup(&backup_rel)
  } else {
    parse_legacy_flat_backup_original_path(&backup_rel)
  }
  .ok_or_else(|| "unable to parse backup original path".to_string())?;
  let content =
    fs::read_to_string(&backup_path).map_err(|error| format!("failed to read backup: {error}"))?;

  let target_relative = if as_copy {
    let stamp = snapshot_timestamp();
    if original.eq_ignore_ascii_case("project.json") {
      format!("project.restored-{stamp}.json")
    } else if let Some(stripped) = original.strip_suffix(".json") {
      format!("{stripped}.restored-{stamp}.json")
    } else {
      format!("{original}.restored-{stamp}")
    }
  } else {
    original.clone()
  };

  write_project_file(
    project_path,
    target_relative.clone(),
    content,
    None,
    Some(!as_copy),
  )?;
  Ok(RestoreBackupResult {
    restored_relative_path: target_relative,
  })
}

#[tauri::command]
fn save_synced_copies(
  project_path: String,
  relative_paths: Vec<String>,
) -> Result<Vec<String>, String> {
  let project_dir = PathBuf::from(&project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let stamp = snapshot_timestamp();
  let out_dir = project_dir.join(".lightscript/saved-both");
  fs::create_dir_all(&out_dir).map_err(|error| format!("failed to create saved-both dir: {error}"))?;
  let mut written: Vec<String> = Vec::new();
  for relative in relative_paths {
    let source = resolve_project_relative(&project_dir, &relative)?;
    if !source.exists() {
      continue;
    }
    let safe = relative.replace(['/', '\\'], "__");
    let dest_name = format!("{safe}.synced-{stamp}.json");
    let dest = out_dir.join(&dest_name);
    fs::copy(&source, &dest).map_err(|error| format!("failed to copy synced file: {error}"))?;
    written.push(format!(".lightscript/saved-both/{dest_name}"));
  }
  Ok(written)
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
      write_project_file,
      read_project_file,
      get_project_file_meta,
      delete_project_file,
      get_project_meta,
      list_conflict_copies,
      get_project_last_opened,
      set_project_last_opened,
      list_project_backups,
      read_project_backup,
      restore_project_backup,
      save_synced_copies,
      load_project_from_path,
      write_text_export,
      write_docx_export,
      read_text_file,
    ])
    .setup(|app| {
      if let Some(window) = app.get_webview_window("main") {
        window.set_icon(tauri::include_image!("icons/32x32.png"))?;
        fit_window_to_monitor(&window);
      }
      app.handle().plugin(tauri_plugin_dialog::init())?;
      app.handle().plugin(tauri_plugin_process::init())?;
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
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
