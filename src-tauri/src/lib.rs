use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
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
    let name = match fs::read_to_string(&project_file)
      .ok()
      .and_then(|content| serde_json::from_str::<Value>(&content).ok())
      .and_then(|json| json["title"].as_str().map(ToString::to_string))
    {
      Some(title) if !title.trim().is_empty() => title,
      _ => directory_name,
    };

    results.push(ProjectSummary {
      name,
      path: path.to_string_lossy().to_string(),
    });
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

#[tauri::command]
fn save_project_to_path(project_path: String, project_json: String) -> Result<(), String> {
  serde_json::from_str::<Value>(&project_json).map_err(|error| format!("invalid project json: {error}"))?;
  let project_dir = PathBuf::from(project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err("project path does not exist or is not a directory".to_string());
  }
  let data_path = project_json_path(&project_dir);
  let temp_path = project_dir.join("project.json.tmp");
  fs::write(&temp_path, project_json).map_err(|error| format!("failed to write temp project: {error}"))?;
  fs::rename(&temp_path, &data_path).map_err(|error| format!("failed to finalize project write: {error}"))?;
  Ok(())
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

#[tauri::command]
fn export_project_tree(project_path: String, project_json: String) -> Result<String, String> {
  let project: Value =
    serde_json::from_str(&project_json).map_err(|error| format!("invalid project json: {error}"))?;
  let project_title = project["title"].as_str().unwrap_or("project");
  let project_folder_name = sanitize_name(project_title);

  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|error| format!("failed to read system time: {error}"))?
    .as_secs();

  let export_root = PathBuf::from(project_path)
    .join("exports")
    .join(format!("{project_folder_name}_{timestamp}"));

  fs::create_dir_all(&export_root).map_err(|error| format!("failed to create export root: {error}"))?;
  let scripts = project["scripts"]
    .as_array()
    .ok_or_else(|| "project.scripts must be an array".to_string())?;

  for script in scripts {
    let script_title = sanitize_name(script["title"].as_str().unwrap_or("script"));
    let script_dir = export_root.join(script_title);
    fs::create_dir_all(&script_dir).map_err(|error| format!("failed to create script dir: {error}"))?;

    let scenes = script["scenes"]
      .as_array()
      .ok_or_else(|| "script.scenes must be an array".to_string())?;

    for scene in scenes {
      let scene_title = sanitize_name(scene["title"].as_str().unwrap_or("scene"));
      let scene_path = script_dir.join(format!("{scene_title}.json"));
      let content =
        serde_json::to_string_pretty(scene).map_err(|error| format!("failed to serialize scene: {error}"))?;
      fs::write(scene_path, content).map_err(|error| format!("failed to write scene file: {error}"))?;
    }
  }

  Ok(export_root.to_string_lossy().to_string())
}

#[tauri::command]
fn export_scene_markdown(
  project_path: String,
  scene_title: String,
  content: String,
) -> Result<String, String> {
  let project_dir = PathBuf::from(&project_path);
  if !project_dir.exists() || !project_dir.is_dir() {
    return Err(format!("project path does not exist: {project_path}"));
  }

  let exports_dir = project_dir.join("exports");
  fs::create_dir_all(&exports_dir)
    .map_err(|error| format!("failed to create exports dir: {error}"))?;

  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|error| format!("failed to read system time: {error}"))?
    .as_secs();

  let safe_title = sanitize_name(&scene_title);
  let file_name = format!("{safe_title}_{timestamp}.md");
  let file_path = exports_dir.join(file_name);
  fs::write(&file_path, content)
    .map_err(|error| format!("failed to write scene markdown: {error}"))?;

  Ok(file_path.to_string_lossy().to_string())
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
      load_project_from_path,
      export_project_tree,
      export_scene_markdown
    ])
    .setup(|app| {
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
