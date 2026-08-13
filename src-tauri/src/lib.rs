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

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncPrefs {
  #[serde(default = "default_true")]
  auto_push_on_leave: bool,
  #[serde(default)]
  periodic_push_minutes: u32,
}

fn default_true() -> bool {
  true
}

impl Default for SyncPrefs {
  fn default() -> Self {
    Self {
      auto_push_on_leave: true,
      periodic_push_minutes: 0,
    }
  }
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct ProjectSyncState {
  last_push_at: Option<u64>,
  last_pull_at: Option<u64>,
  #[serde(default)]
  last_push_fingerprints: HashMap<String, String>,
  #[serde(default)]
  last_known_cloud_fingerprints: HashMap<String, String>,
}

#[derive(Default, Deserialize, Serialize)]
struct AppSettings {
  repo_path: Option<String>,
  #[serde(default)]
  cloud_mirror_path: Option<String>,
  #[serde(default)]
  sync: SyncPrefs,
  /// Keyed by project folder name (relative identity across machines).
  #[serde(default)]
  sync_state: HashMap<String, ProjectSyncState>,
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
  let settings = read_settings(&app)?;
  if let Some(cloud) = settings.cloud_mirror_path.as_deref() {
    validate_distinct_library_roots(&path, Path::new(cloud))?;
  }
  let mut settings = settings;
  settings.repo_path = Some(repo_path);
  write_settings(&app, &settings)
}

fn cloud_mirror_path_from_settings(settings: &AppSettings) -> Result<Option<PathBuf>, String> {
  let Some(raw) = settings.cloud_mirror_path.as_ref() else {
    return Ok(None);
  };
  let path = PathBuf::from(raw);
  if !path.exists() || !path.is_dir() {
    return Err("configured cloud mirror path does not exist or is not a directory".to_string());
  }
  Ok(Some(path))
}

fn validate_distinct_library_roots(local: &Path, cloud: &Path) -> Result<(), String> {
  let local_canon = fs::canonicalize(local)
    .map_err(|error| format!("failed to canonicalize local library: {error}"))?;
  let cloud_canon = fs::canonicalize(cloud)
    .map_err(|error| format!("failed to canonicalize cloud mirror: {error}"))?;
  if local_canon == cloud_canon {
    return Err("本地作品库与云端镜像不能是同一个文件夹".to_string());
  }
  if cloud_canon.starts_with(&local_canon) {
    return Err("云端镜像不能位于本地作品库内部".to_string());
  }
  if local_canon.starts_with(&cloud_canon) {
    return Err("本地作品库不能位于云端镜像内部".to_string());
  }
  Ok(())
}

fn project_key_from_paths(repo_path: &Path, project_path: &Path) -> Result<String, String> {
  let canonical_project = fs::canonicalize(project_path)
    .map_err(|error| format!("failed to canonicalize project path: {error}"))?;
  let canonical_repo = fs::canonicalize(repo_path)
    .map_err(|error| format!("failed to canonicalize repo path: {error}"))?;
  if canonical_project == canonical_repo {
    return Ok(
      canonical_repo
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string()),
    );
  }
  if !canonical_project.starts_with(&canonical_repo) {
    return Err("project path must be inside the local library".to_string());
  }
  let rel = canonical_project
    .strip_prefix(&canonical_repo)
    .map_err(|_| "project path must be inside the local library".to_string())?;
  let key = rel.to_string_lossy().replace('\\', "/");
  if key.is_empty() || key.contains("..") {
    return Err("invalid project key".to_string());
  }
  Ok(key)
}

fn cloud_project_dir(cloud_root: &Path, project_key: &str) -> Result<PathBuf, String> {
  let joined = cloud_root.join(project_key);
  let normalized = normalize_relative_path(project_key)?;
  if normalized.as_os_str().is_empty() {
    return Err("invalid project key".to_string());
  }
  Ok(joined)
}

/// Live syncable files only: project.json + scripts/**/scenes/*.json (skips .lightscript).
fn collect_live_file_hashes(project_dir: &Path) -> Result<HashMap<String, String>, String> {
  let mut out: HashMap<String, String> = HashMap::new();
  let meta = project_json_path(project_dir);
  if meta.exists() {
    let fingerprint = compute_project_meta(&meta)?;
    out.insert("project.json".to_string(), fingerprint.hash);
  }
  collect_live_scene_hashes(project_dir, project_dir, &mut out)?;
  Ok(out)
}

fn collect_live_scene_hashes(
  project_dir: &Path,
  dir: &Path,
  out: &mut HashMap<String, String>,
) -> Result<(), String> {
  if !dir.exists() {
    return Ok(());
  }
  for entry in fs::read_dir(dir).map_err(|error| format!("failed to read dir: {error}"))? {
    let entry = entry.map_err(|error| format!("failed to read dir entry: {error}"))?;
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();
    if name == ".lightscript" || name.ends_with(".tmp") {
      continue;
    }
    if path.is_dir() {
      collect_live_scene_hashes(project_dir, &path, out)?;
      continue;
    }
    if !path.is_file() || !name.ends_with(".json") {
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
    if !is_clean_scene_file_name(&name) {
      continue;
    }
    let rel = path
      .strip_prefix(project_dir)
      .map_err(|_| "scene path escaped project directory".to_string())?
      .to_string_lossy()
      .replace('\\', "/");
    let fingerprint = compute_project_meta(&path)?;
    out.insert(rel, fingerprint.hash);
  }
  Ok(())
}

fn maps_equal(a: &HashMap<String, String>, b: &HashMap<String, String>) -> bool {
  a.len() == b.len() && a.iter().all(|(key, value)| b.get(key) == Some(value))
}

fn classify_sync_status(
  local: &HashMap<String, String>,
  cloud: Option<&HashMap<String, String>>,
  last_push: &HashMap<String, String>,
) -> String {
  let Some(cloud_map) = cloud else {
    return "cloudMissing".to_string();
  };
  if maps_equal(local, cloud_map) {
    return "inSync".to_string();
  }
  let local_matches_push = maps_equal(local, last_push);
  let cloud_matches_push = maps_equal(cloud_map, last_push);
  if local_matches_push && !cloud_matches_push {
    return "cloudAhead".to_string();
  }
  if cloud_matches_push && !local_matches_push {
    return "localAhead".to_string();
  }
  // No prior push baseline: treat any difference as localAhead if cloud empty-ish,
  // otherwise diverged when both have content that differs.
  if last_push.is_empty() {
    if cloud_map.is_empty() {
      return "localAhead".to_string();
    }
    if local.is_empty() {
      return "cloudAhead".to_string();
    }
  }
  "diverged".to_string()
}

fn now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|elapsed| elapsed.as_millis() as u64)
    .unwrap_or(0)
}

fn copy_live_tree(from: &Path, to: &Path, files: &HashMap<String, String>) -> Result<(), String> {
  fs::create_dir_all(to).map_err(|error| format!("failed to create cloud project dir: {error}"))?;
  for relative in files.keys() {
    let source = resolve_project_relative(from, relative)?;
    if !source.exists() {
      continue;
    }
    let dest = to.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    ensure_parent_dir(&dest)?;
    let file_name = dest
      .file_name()
      .map(|name| name.to_string_lossy().to_string())
      .unwrap_or_else(|| "file.json".to_string());
    let temp_path = dest
      .parent()
      .unwrap_or(to)
      .join(format!("{file_name}.tmp"));
    fs::copy(&source, &temp_path).map_err(|error| format!("failed to copy {relative}: {error}"))?;
    fs::rename(&temp_path, &dest).map_err(|error| format!("failed to finalize {relative}: {error}"))?;
  }
  Ok(())
}

fn delete_extra_live_files(target: &Path, keep: &HashMap<String, String>) -> Result<(), String> {
  let existing = collect_live_file_hashes(target)?;
  for relative in existing.keys() {
    if keep.contains_key(relative) {
      continue;
    }
    let path = target.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    if path.exists() {
      fs::remove_file(&path).map_err(|error| format!("failed to remove extra {relative}: {error}"))?;
    }
  }
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncInspectResult {
  status: String,
  project_key: String,
  cloud_configured: bool,
  local_files: HashMap<String, String>,
  cloud_files: HashMap<String, String>,
  last_push_at: Option<u64>,
  last_pull_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncTransferResult {
  status: String,
  project_key: String,
  transferred: usize,
}

#[tauri::command]
fn get_cloud_mirror_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let settings = read_settings(&app)?;
  Ok(settings.cloud_mirror_path)
}

#[tauri::command]
fn set_cloud_mirror_path(app: tauri::AppHandle, cloud_mirror_path: Option<String>) -> Result<(), String> {
  let mut settings = read_settings(&app)?;
  if let Some(raw) = cloud_mirror_path.as_ref() {
    let path = PathBuf::from(raw);
    if !path.exists() || !path.is_dir() {
      return Err("cloud mirror path must be an existing directory".to_string());
    }
    if let Some(repo) = settings.repo_path.as_ref() {
      validate_distinct_library_roots(Path::new(repo), &path)?;
    }
    settings.cloud_mirror_path = Some(raw.clone());
  } else {
    settings.cloud_mirror_path = None;
  }
  write_settings(&app, &settings)
}

#[tauri::command]
fn get_sync_prefs(app: tauri::AppHandle) -> Result<SyncPrefs, String> {
  let settings = read_settings(&app)?;
  Ok(settings.sync)
}

#[tauri::command]
fn set_sync_prefs(
  app: tauri::AppHandle,
  auto_push_on_leave: bool,
  periodic_push_minutes: u32,
) -> Result<(), String> {
  let mut settings = read_settings(&app)?;
  settings.sync.auto_push_on_leave = auto_push_on_leave;
  settings.sync.periodic_push_minutes = periodic_push_minutes;
  write_settings(&app, &settings)
}

#[tauri::command]
fn inspect_project_sync(app: tauri::AppHandle, project_path: String) -> Result<SyncInspectResult, String> {
  let settings = read_settings(&app)?;
  let repo_path = repo_path_from_settings(&app)?;
  let project_dir = PathBuf::from(&project_path);
  let project_key = project_key_from_paths(&repo_path, &project_dir)?;
  let local_files = collect_live_file_hashes(&project_dir)?;
  let state = settings
    .sync_state
    .get(&project_key)
    .cloned()
    .unwrap_or_default();

  let Some(cloud_root) = cloud_mirror_path_from_settings(&settings)? else {
    return Ok(SyncInspectResult {
      status: "noCloud".to_string(),
      project_key,
      cloud_configured: false,
      local_files,
      cloud_files: HashMap::new(),
      last_push_at: state.last_push_at,
      last_pull_at: state.last_pull_at,
    });
  };

  let cloud_dir = cloud_project_dir(&cloud_root, &project_key)?;
  let cloud_files = if cloud_dir.exists() && project_json_path(&cloud_dir).exists() {
    collect_live_file_hashes(&cloud_dir)?
  } else {
    HashMap::new()
  };
  let cloud_opt = if cloud_dir.exists() && project_json_path(&cloud_dir).exists() {
    Some(&cloud_files)
  } else {
    None
  };
  let status = classify_sync_status(&local_files, cloud_opt, &state.last_push_fingerprints);
  Ok(SyncInspectResult {
    status,
    project_key,
    cloud_configured: true,
    local_files,
    cloud_files,
    last_push_at: state.last_push_at,
    last_pull_at: state.last_pull_at,
  })
}

#[tauri::command]
fn push_project_to_cloud(
  app: tauri::AppHandle,
  project_path: String,
  force: bool,
) -> Result<SyncTransferResult, String> {
  let settings = read_settings(&app)?;
  let repo_path = repo_path_from_settings(&app)?;
  let cloud_root = cloud_mirror_path_from_settings(&settings)?
    .ok_or_else(|| "尚未配置云端镜像文件夹".to_string())?;
  validate_distinct_library_roots(&repo_path, &cloud_root)?;

  let project_dir = PathBuf::from(&project_path);
  let project_key = project_key_from_paths(&repo_path, &project_dir)?;
  let local_files = collect_live_file_hashes(&project_dir)?;
  if local_files.is_empty() {
    return Err("本地作品没有可同步的文件".to_string());
  }

  let state = settings
    .sync_state
    .get(&project_key)
    .cloned()
    .unwrap_or_default();
  let cloud_dir = cloud_project_dir(&cloud_root, &project_key)?;
  let cloud_files = if cloud_dir.exists() && project_json_path(&cloud_dir).exists() {
    collect_live_file_hashes(&cloud_dir)?
  } else {
    HashMap::new()
  };
  let cloud_opt = if cloud_dir.exists() && project_json_path(&cloud_dir).exists() {
    Some(&cloud_files)
  } else {
    None
  };
  let status = classify_sync_status(&local_files, cloud_opt, &state.last_push_fingerprints);
  if !force && (status == "cloudAhead" || status == "diverged") {
    return Err(format!("sync_conflict:{status}"));
  }

  copy_live_tree(&project_dir, &cloud_dir, &local_files)?;
  delete_extra_live_files(&cloud_dir, &local_files)?;
  let transferred = local_files.len();
  let cloud_after = collect_live_file_hashes(&cloud_dir)?;

  let mut settings = read_settings(&app)?;
  settings.sync_state.insert(
    project_key.clone(),
    ProjectSyncState {
      last_push_at: Some(now_ms()),
      last_pull_at: state.last_pull_at,
      last_push_fingerprints: local_files.clone(),
      last_known_cloud_fingerprints: cloud_after,
    },
  );
  write_settings(&app, &settings)?;

  Ok(SyncTransferResult {
    status: "pushed".to_string(),
    project_key,
    transferred,
  })
}

#[tauri::command]
fn pull_project_from_cloud(
  app: tauri::AppHandle,
  project_path: String,
  force: bool,
) -> Result<SyncTransferResult, String> {
  let settings = read_settings(&app)?;
  let repo_path = repo_path_from_settings(&app)?;
  let cloud_root = cloud_mirror_path_from_settings(&settings)?
    .ok_or_else(|| "尚未配置云端镜像文件夹".to_string())?;
  validate_distinct_library_roots(&repo_path, &cloud_root)?;

  let project_dir = PathBuf::from(&project_path);
  let project_key = project_key_from_paths(&repo_path, &project_dir)?;
  let cloud_dir = cloud_project_dir(&cloud_root, &project_key)?;
  if !cloud_dir.exists() || !project_json_path(&cloud_dir).exists() {
    return Err("云端还没有此作品的镜像".to_string());
  }

  let local_files = collect_live_file_hashes(&project_dir)?;
  let cloud_files = collect_live_file_hashes(&cloud_dir)?;
  let state = settings
    .sync_state
    .get(&project_key)
    .cloned()
    .unwrap_or_default();
  let status = classify_sync_status(&local_files, Some(&cloud_files), &state.last_push_fingerprints);
  if !force && (status == "localAhead" || status == "diverged") {
    return Err(format!("sync_conflict:{status}"));
  }

  // Snapshot existing local live files before overwrite.
  for relative in local_files.keys() {
    let data_path = resolve_project_relative(&project_dir, relative)?;
    let _ = snapshot_file_before_save(&project_dir, &data_path, relative);
  }

  copy_live_tree(&cloud_dir, &project_dir, &cloud_files)?;
  delete_extra_live_files(&project_dir, &cloud_files)?;
  let transferred = cloud_files.len();
  let local_after = collect_live_file_hashes(&project_dir)?;

  let mut settings = read_settings(&app)?;
  settings.sync_state.insert(
    project_key.clone(),
    ProjectSyncState {
      last_push_at: Some(now_ms()),
      last_pull_at: Some(now_ms()),
      last_push_fingerprints: local_after.clone(),
      last_known_cloud_fingerprints: cloud_files,
    },
  );
  write_settings(&app, &settings)?;

  Ok(SyncTransferResult {
    status: "pulled".to_string(),
    project_key,
    transferred,
  })
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
      get_cloud_mirror_path,
      set_cloud_mirror_path,
      get_sync_prefs,
      set_sync_prefs,
      inspect_project_sync,
      push_project_to_cloud,
      pull_project_from_cloud,
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
