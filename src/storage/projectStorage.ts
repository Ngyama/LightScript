import { sanitizeExportFileName } from "../domain/exportScenes";
import {
  assembleProjectFromMetaAndScenes,
  isLegacyMonolithicProjectJson,
  listProjectFileEntries,
  PROJECT_META_FILE,
  projectFileSnapshot,
  sceneRelativePath,
  type ProjectFileSnapshot,
} from "../domain/projectFormat";
import { resolveProjectTitleFromPath } from "../domain/projectTitle";
import type { LastOpened } from "../domain/selection";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Project } from "../domain/model";
import { assertProjectInvariant, parseProject } from "../domain/model";

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
 * Fingerprint of a project file on disk. Compared against an in-session baseline
 * to detect edits made outside the app (e.g. Google Drive sync).
 */
export interface ProjectMeta {
  mtimeMs: number;
  size: number;
  hash: string;
}

export type LoadedProjectBundle = {
  project: Project;
  fileSnapshot: ProjectFileSnapshot;
  fileMetas: Record<string, ProjectMeta | null>;
  lastOpened: LastOpened | null;
  migrated: boolean;
};

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

function localLastOpenedKey(projectPath: string): string {
  return `${LOCAL_STORAGE_KEY}.lastOpened:${encodeURIComponent(projectPath)}`;
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

async function writeAllProjectFiles(
  projectPath: string,
  project: Project,
  baselines: Record<string, string | null | undefined> = {},
): Promise<Record<string, ProjectMeta | null>> {
  const metas: Record<string, ProjectMeta | null> = {};
  const entries = listProjectFileEntries(project);
  // Write scene files before meta so a crash mid-migration never leaves a
  // catalog pointing at missing scenes.
  const ordered = [
    ...entries.filter((entry) => entry.relativePath !== PROJECT_META_FILE),
    ...entries.filter((entry) => entry.relativePath === PROJECT_META_FILE),
  ];
  for (const entry of ordered) {
    const meta = await writeProjectFile(
      projectPath,
      entry.relativePath,
      entry.payload,
      baselines[entry.relativePath] ?? null,
    );
    metas[entry.relativePath] = meta;
  }
  return metas;
}

export async function createProject(projectName: string, project: Project): Promise<ProjectSummary> {
  if (isTauriRuntime()) {
    const summary = await invoke<ProjectSummary>("create_project", { projectName });
    await writeAllProjectFiles(summary.path, project);
    return summary;
  }

  const repoPath = (await getRepoPath()) ?? "local-repo";
  const path = `${repoPath}/${projectName}`;
  const projects = await listProjects();
  const nextSummary: ProjectSummary = { name: projectName, path };
  const nextProjects = [...projects.filter((entry) => entry.path !== path), nextSummary];
  localStorage.setItem(`${LOCAL_STORAGE_KEY}.projects`, JSON.stringify(nextProjects));
  localStorage.setItem(localProjectKey(path), JSON.stringify(project, null, 2));
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
  localStorage.removeItem(localLastOpenedKey(projectPath));
}

export async function writeProjectFile(
  projectPath: string,
  relativePath: string,
  contents: string,
  expectedHash: string | null = null,
  takeSnapshot: boolean = false,
): Promise<ProjectMeta | null> {
  if (isTauriRuntime()) {
    return invoke<ProjectMeta>("write_project_file", {
      projectPath,
      relativePath,
      contents,
      expectedHash,
      takeSnapshot,
    });
  }
  const root = JSON.parse(localStorage.getItem(localProjectKey(projectPath)) ?? "{}") as Record<
    string,
    string
  >;
  // Browser fallback keeps a map of relativePath -> payload under one key when split;
  // for simplicity store assembled project only in browser mode.
  void root;
  void relativePath;
  void contents;
  void expectedHash;
  void takeSnapshot;
  return null;
}

export async function readProjectFile(
  projectPath: string,
  relativePath: string,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("read_project_file", { projectPath, relativePath });
  }
  throw new Error(`Reading ${relativePath} is only available in the desktop app.`);
}

export async function deleteProjectFile(
  projectPath: string,
  relativePath: string,
  expectedHash: string | null = null,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("delete_project_file", {
      projectPath,
      relativePath,
      expectedHash,
    });
  }
}

export async function getProjectFileMeta(
  projectPath: string,
  relativePath: string,
): Promise<ProjectMeta | null> {
  if (isTauriRuntime()) {
    return invoke<ProjectMeta | null>("get_project_file_meta", { projectPath, relativePath });
  }
  return null;
}

export async function getProjectLastOpened(projectPath: string): Promise<LastOpened | null> {
  if (isTauriRuntime()) {
    const raw = await invoke<{
      lastScriptId?: string | null;
      lastSceneId?: string | null;
    } | null>("get_project_last_opened", { projectPath });
    if (!raw) {
      return null;
    }
    return {
      lastScriptId: raw.lastScriptId ?? undefined,
      lastSceneId: raw.lastSceneId ?? undefined,
    };
  }
  const stored = localStorage.getItem(localLastOpenedKey(projectPath));
  return stored ? (JSON.parse(stored) as LastOpened) : null;
}

export async function setProjectLastOpened(
  projectPath: string,
  lastOpened: LastOpened,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("set_project_last_opened", {
      projectPath,
      lastScriptId: lastOpened.lastScriptId ?? null,
      lastSceneId: lastOpened.lastSceneId ?? null,
    });
    return;
  }
  localStorage.setItem(localLastOpenedKey(projectPath), JSON.stringify(lastOpened));
}

async function migrateLegacyProject(
  projectPath: string,
  legacyRaw: string,
): Promise<Project> {
  const project = parseProject(legacyRaw);
  assertProjectInvariant(project);
  // Backup monolithic file, then write split layout and replace project.json.
  await writeAllProjectFiles(projectPath, project);
  return project;
}

async function loadSplitProject(projectPath: string, metaRaw: string): Promise<Project> {
  const meta = JSON.parse(metaRaw) as {
    scripts?: Array<{ id: string; sceneIds?: string[] }>;
  };
  const scenesByPath: Record<string, string> = {};
  for (const script of meta.scripts ?? []) {
    for (const sceneId of script.sceneIds ?? []) {
      const relativePath = sceneRelativePath(script.id, sceneId);
      scenesByPath[relativePath] = await readProjectFile(projectPath, relativePath);
    }
  }
  const assembled = assembleProjectFromMetaAndScenes(metaRaw, scenesByPath);
  // Re-parse through parseProject for character normalization / invariants.
  return parseProject(JSON.stringify(assembled));
}

export async function loadProjectBundle(projectPath: string): Promise<LoadedProjectBundle> {
  if (!isTauriRuntime()) {
    const raw = localStorage.getItem(localProjectKey(projectPath));
    if (!raw) {
      throw new Error(`Project not found: ${projectPath}`);
    }
    const project = parseProject(raw);
    const titled = {
      ...project,
      title: resolveProjectTitleFromPath(project.title, projectPath),
    };
    return {
      project: titled,
      fileSnapshot: projectFileSnapshot(titled),
      fileMetas: {},
      lastOpened: await getProjectLastOpened(projectPath),
      migrated: false,
    };
  }

  const metaRaw = await invoke<string>("load_project_from_path", { projectPath });
  const parsedMeta = JSON.parse(metaRaw) as unknown;
  let project: Project;
  let migrated = false;

  if (isLegacyMonolithicProjectJson(parsedMeta)) {
    project = await migrateLegacyProject(projectPath, metaRaw);
    migrated = true;
  } else {
    project = await loadSplitProject(projectPath, metaRaw);
  }

  project = {
    ...project,
    title: resolveProjectTitleFromPath(project.title, projectPath),
  };
  assertProjectInvariant(project);

  const fileSnapshot = projectFileSnapshot(project);
  const fileMetas: Record<string, ProjectMeta | null> = {};
  for (const relativePath of Object.keys(fileSnapshot)) {
    fileMetas[relativePath] = await getProjectFileMeta(projectPath, relativePath);
  }

  let lastOpened = await getProjectLastOpened(projectPath);
  // One-time lift of legacy last-opened out of project.json into app settings.
  if (
    !lastOpened?.lastSceneId &&
    (project.settings.lastScriptId || project.settings.lastSceneId)
  ) {
    lastOpened = {
      lastScriptId: project.settings.lastScriptId,
      lastSceneId: project.settings.lastSceneId,
    };
    await setProjectLastOpened(projectPath, lastOpened);
  }

  // Strip last-opened from in-memory synced settings.
  project = {
    ...project,
    settings: { writingMode: project.settings.writingMode },
  };

  return { project, fileSnapshot, fileMetas, lastOpened, migrated };
}

export async function loadProjectFromPath(projectPath: string): Promise<Project> {
  const bundle = await loadProjectBundle(projectPath);
  return bundle.project;
}

/** @deprecated Prefer per-file writes via writeProjectFile. */
export async function saveProject(
  projectPath: string,
  project: Project,
  expectedHash: string | null = null,
): Promise<ProjectMeta | null> {
  if (isTauriRuntime()) {
    await writeAllProjectFiles(projectPath, project, {
      [PROJECT_META_FILE]: expectedHash,
    });
    return getProjectFileMeta(projectPath, PROJECT_META_FILE);
  }
  localStorage.setItem(localProjectKey(projectPath), JSON.stringify(project, null, 2));
  return null;
}

export async function saveProjectPayload(
  projectPath: string,
  projectJson: string,
  expectedHash: string | null = null,
): Promise<ProjectMeta | null> {
  return writeProjectFile(projectPath, PROJECT_META_FILE, projectJson, expectedHash);
}

export async function getProjectMeta(projectPath: string): Promise<ProjectMeta | null> {
  return getProjectFileMeta(projectPath, PROJECT_META_FILE);
}

export async function listConflictCopies(projectPath: string): Promise<string[]> {
  if (isTauriRuntime()) {
    return invoke<string[]>("list_conflict_copies", { projectPath });
  }
  return [];
}

export type ProjectBackupEntry = {
  fileName: string;
  originalRelativePath: string;
  mtimeMs: number;
  size: number;
};

export async function listProjectBackups(projectPath: string): Promise<ProjectBackupEntry[]> {
  if (isTauriRuntime()) {
    return invoke<ProjectBackupEntry[]>("list_project_backups", { projectPath });
  }
  return [];
}

export async function readProjectBackup(
  projectPath: string,
  fileName: string,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("read_project_backup", { projectPath, fileName });
  }
  throw new Error("备份功能仅在桌面端可用。");
}

export async function restoreProjectBackup(
  projectPath: string,
  fileName: string,
  asCopy: boolean,
): Promise<{ restoredRelativePath: string }> {
  if (isTauriRuntime()) {
    return invoke<{ restoredRelativePath: string }>("restore_project_backup", {
      projectPath,
      fileName,
      asCopy,
    });
  }
  throw new Error("备份功能仅在桌面端可用。");
}

export async function saveSyncedCopies(
  projectPath: string,
  relativePaths: string[],
): Promise<string[]> {
  if (isTauriRuntime()) {
    return invoke<string[]>("save_synced_copies", { projectPath, relativePaths });
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
