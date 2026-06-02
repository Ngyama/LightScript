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

export interface ExportFileEntry {
  relativePath: string;
  content: string;
}

export interface ProjectSummary {
  name: string;
  path: string;
}

export function projectToExportEntries(project: Project): ExportFileEntry[] {
  const entries: ExportFileEntry[] = [];
  for (const script of project.scripts) {
    for (const scene of script.scenes) {
      entries.push({
        relativePath: `${script.title}/${scene.title}.json`,
        content: JSON.stringify(scene, null, 2),
      });
    }
  }
  return entries;
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
    return parseProject(raw);
  }
  const raw = localStorage.getItem(localProjectKey(projectPath));
  if (!raw) {
    throw new Error(`Project not found: ${projectPath}`);
  }
  return parseProject(raw);
}

export async function saveProject(projectPath: string, project: Project): Promise<void> {
  const payload = JSON.stringify(project, null, 2);
  if (isTauriRuntime()) {
    await invoke("save_project_to_path", { projectPath, projectJson: payload });
    return;
  }
  localStorage.setItem(localProjectKey(projectPath), payload);
}

export async function exportProjectTree(projectPath: string, project: Project): Promise<string> {
  const payload = JSON.stringify(project, null, 2);
  if (isTauriRuntime()) {
    return invoke<string>("export_project_tree", { projectPath, projectJson: payload });
  }

  const entries = projectToExportEntries(project);
  localStorage.setItem(`${localProjectKey(projectPath)}.exportPreview`, JSON.stringify(entries, null, 2));
  return "browser-localStorage-preview";
}

export async function exportSceneMarkdown(
  projectPath: string,
  sceneTitle: string,
  content: string,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("export_scene_markdown", {
      projectPath,
      sceneTitle,
      content,
    });
  }

  const key = `${localProjectKey(projectPath)}.sceneExport.${encodeURIComponent(sceneTitle)}`;
  localStorage.setItem(key, content);
  return `browser-localStorage-preview://${sceneTitle}.md`;
}

function sanitizeDefaultExportName(name: string): string {
  // Mirror src-tauri/sanitize_name's invalid set so the suggested filename
  // doesn't get rejected by Windows.
  const trimmed = name.trim();
  if (!trimmed) return "scene";
  return trimmed
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 0x20 || '<>:"/\\|?*'.includes(char)) return "_";
      return char;
    })
    .join("")
    .replace(/\.+$/u, "");
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
