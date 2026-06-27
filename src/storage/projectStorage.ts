import { sanitizeExportFileName } from "../domain/exportScenes";
import { resolveProjectTitleFromPath } from "../domain/projectTitle";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Project } from "../domain/model";
import { parseProject } from "../domain/model";

export type ExportFormat = "md" | "txt" | "docx";

export interface ExportFormatInfo {
  format: ExportFormat;
  label: string;
  extension: string;
  filterName: string;
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { format: "md", label: "Markdown (.md)", extension: "md", filterName: "Markdown" },
  { format: "txt", label: "Plain Text (.txt)", extension: "txt", filterName: "Text" },
  { format: "docx", label: "Word Document (.docx)", extension: "docx", filterName: "Word Document" },
];

const LOCAL_STORAGE_KEY = "lightscript.project";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface ProjectSummary {
  name: string;
  path: string;
}

/**
 * Fingerprint of a project's `project.json` on disk. Compared against an
 * in-session baseline to detect edits made outside the app (e.g. a newer copy
 * synced in by Google Drive from another machine). `null` means detection is
 * unavailable (browser/dev runtime without the Tauri backend).
 */
export interface ProjectMeta {
  mtimeMs: number;
  size: number;
  hash: string;
}

export async function pickDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const selected = await open({
    directory: true,
    multiple: false,
  });

  if (typeof selected === "string") {
    return selected;
  }

  return null;
}

function localProjectKey(projectPath: string): string {
  return `${LOCAL_STORAGE_KEY}:${encodeURIComponent(projectPath)}`;
}

export async function getRepoPath(): Promise<string | null> {
  if (isTauriRuntime()) {
    return invoke<string | null>("get_repo_path");
  }
  return localStorage.getItem(`${LOCAL_STORAGE_KEY}.repoPath`);
}

export async function setRepoPath(repoPath: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("set_repo_path", { repoPath });
    return;
  }
  localStorage.setItem(`${LOCAL_STORAGE_KEY}.repoPath`, repoPath);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectSummary[]>("list_projects");
  }
  const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY}.projects`);
  if (!raw) {
    return [];
  }
  return JSON.parse(raw) as ProjectSummary[];
}

export async function createProject(projectName: string, project: Project): Promise<ProjectSummary> {
  const payload = JSON.stringify(project, null, 2);
  if (isTauriRuntime()) {
    return invoke<ProjectSummary>("create_project", {
      projectName,
      projectJson: payload,
    });
  }

  const repoPath = (await getRepoPath()) ?? "local-repo";
  const path = `${repoPath}/${projectName}`;
  const projects = await listProjects();
  const nextSummary: ProjectSummary = { name: projectName, path };
  const nextProjects = [...projects.filter((entry) => entry.path !== path), nextSummary];
  localStorage.setItem(`${LOCAL_STORAGE_KEY}.projects`, JSON.stringify(nextProjects));
  localStorage.setItem(localProjectKey(path), payload);
  return nextSummary;
}

export async function deleteProject(projectPath: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("delete_project", { projectPath });
    return;
  }
  const projects = await listProjects();
  const nextProjects = projects.filter((entry) => entry.path !== projectPath);
  localStorage.setItem(`${LOCAL_STORAGE_KEY}.projects`, JSON.stringify(nextProjects));
  localStorage.removeItem(localProjectKey(projectPath));
}

export async function loadProjectFromPath(projectPath: string): Promise<Project> {
  if (isTauriRuntime()) {
    const raw = await invoke<string>("load_project_from_path", { projectPath });
    const project = parseProject(raw);
    return {
      ...project,
      title: resolveProjectTitleFromPath(project.title, projectPath),
    };
  }
  const raw = localStorage.getItem(localProjectKey(projectPath));
  if (!raw) {
    throw new Error(`Project not found: ${projectPath}`);
  }
  const project = parseProject(raw);
  return {
    ...project,
    title: resolveProjectTitleFromPath(project.title, projectPath),
  };
}

export async function saveProject(
  projectPath: string,
  project: Project,
): Promise<ProjectMeta | null> {
  const payload = JSON.stringify(project, null, 2);
  if (isTauriRuntime()) {
    return invoke<ProjectMeta>("save_project_to_path", { projectPath, projectJson: payload });
  }
  localStorage.setItem(localProjectKey(projectPath), payload);
  return null;
}

/**
 * Read the current on-disk fingerprint for a project, or `null` when the
 * backend is unavailable (browser/dev runtime) or the file is missing.
 */
export async function getProjectMeta(projectPath: string): Promise<ProjectMeta | null> {
  if (isTauriRuntime()) {
    return invoke<ProjectMeta | null>("get_project_meta", { projectPath });
  }
  return null;
}

/**
 * List sibling files in the project directory that look like cloud
 * conflict copies of `project.json` (e.g. Google Drive's `project (1).json`).
 * Returns an empty array when the backend is unavailable.
 */
export async function listConflictCopies(projectPath: string): Promise<string[]> {
  if (isTauriRuntime()) {
    return invoke<string[]>("list_conflict_copies", { projectPath });
  }
  return [];
}

function sanitizeDefaultExportName(name: string): string {
  return sanitizeExportFileName(name) || "scene";
}

export async function pickImportMarkdownPath(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function readTextFile(path: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("read_text_file", { path });
  }
  throw new Error("Reading files is only available in the desktop app.");
}

export async function pickExportDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickExportSavePath(
  defaultName: string,
  format: ExportFormat,
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const info = EXPORT_FORMATS.find((entry) => entry.format === format);
  if (!info) return null;

  const safeName = sanitizeDefaultExportName(defaultName) || "scene";
  const result = await save({
    defaultPath: `${safeName}.${info.extension}`,
    filters: [{ name: info.filterName, extensions: [info.extension] }],
  });
  return typeof result === "string" ? result : null;
}

export async function writeTextExport(
  targetPath: string,
  content: string,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("write_text_export", { targetPath, content });
  }
  const key = `${LOCAL_STORAGE_KEY}.exportPreview:${encodeURIComponent(targetPath)}`;
  localStorage.setItem(key, content);
  return `browser-localStorage-preview://${targetPath}`;
}

export async function writeDocxExport(
  targetPath: string,
  sceneJson: string,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("write_docx_export", { targetPath, sceneJson });
  }
  const key = `${LOCAL_STORAGE_KEY}.exportPreview:${encodeURIComponent(targetPath)}`;
  localStorage.setItem(key, sceneJson);
  return `browser-localStorage-preview://${targetPath}`;
}
