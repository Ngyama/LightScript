import type { Project, Scene } from "./model";
import { sceneToExportScene, sceneToMarkdown, sceneToPlainText } from "./model";
import type { ExportScene } from "./characters";
import type { ExportFormat } from "../storage/projectStorage";

export interface SceneExportItem {
  scriptId: string;
  scriptTitle: string;
  scene: Scene;
}

export function sanitizeExportFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
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

export function buildBatchExportFileBase(scriptTitle: string, sceneTitle: string): string {
  const script = sanitizeExportFileName(scriptTitle) || "script";
  const scene = sanitizeExportFileName(sceneTitle) || "scene";
  return `${script} - ${scene}`;
}

/** Default save name when multiple scenes are merged into one file. */
export function buildMergedExportFileBase(
  selectedItems: SceneExportItem[],
  projectTitle: string,
): string {
  if (selectedItems.length === 0) {
    return sanitizeExportFileName(projectTitle) || "merged-scenes";
  }
  const scriptTitles = new Set(
    selectedItems.map((item) => item.scriptTitle.trim()).filter(Boolean),
  );
  if (scriptTitles.size === 1) {
    const only = [...scriptTitles][0];
    return sanitizeExportFileName(only) || "script";
  }
  return sanitizeExportFileName(projectTitle) || "merged-scenes";
}

export function uniqueExportBaseName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base} (${index})`)) {
    index += 1;
  }
  const unique = `${base} (${index})`;
  used.add(unique);
  return unique;
}

export function joinExportPath(directory: string, fileName: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[/\\]+$/, "")}${separator}${fileName}`;
}

export function listSceneExportItems(project: Project): SceneExportItem[] {
  return project.scripts.flatMap((script) =>
    script.scenes.map((scene) => ({
      scriptId: script.id,
      scriptTitle: script.title,
      scene,
    })),
  );
}

/** Selected items in project order (scripts → scenes). */
export function filterSelectedExportItems(
  items: SceneExportItem[],
  selectedSceneIds: ReadonlySet<string>,
): SceneExportItem[] {
  return items.filter((item) => selectedSceneIds.has(item.scene.id));
}

export function sceneIdsForScript(project: Project, scriptId: string): string[] {
  const script = project.scripts.find((entry) => entry.id === scriptId);
  if (!script) return [];
  return script.scenes.map((scene) => scene.id);
}

export function renderSceneExportContent(
  scene: Scene,
  project: Project,
  format: ExportFormat,
): string {
  if (format === "md") return sceneToMarkdown(scene, project);
  if (format === "txt") return sceneToPlainText(scene, project);
  return JSON.stringify(sceneToExportScene(scene, project));
}

export function mergeScenesToMarkdown(scenes: Scene[], project: Project): string {
  return scenes
    .map((scene) => sceneToMarkdown(scene, project).trimEnd())
    .filter((chunk) => chunk.length > 0)
    .join("\n\n")
    .concat("\n");
}

export function mergeScenesToPlainText(scenes: Scene[], project: Project): string {
  return scenes
    .map((scene) => sceneToPlainText(scene, project).trimEnd())
    .filter((chunk) => chunk.length > 0)
    .join("\n\n")
    .concat("\n");
}

export function mergeScenesToDocxPayload(
  scenes: Scene[],
  project: Project,
): { scenes: ExportScene[] } {
  return {
    scenes: scenes.map((scene) => sceneToExportScene(scene, project)),
  };
}

export function renderMergedExportContent(
  scenes: Scene[],
  project: Project,
  format: ExportFormat,
): string {
  if (format === "md") return mergeScenesToMarkdown(scenes, project);
  if (format === "txt") return mergeScenesToPlainText(scenes, project);
  return JSON.stringify(mergeScenesToDocxPayload(scenes, project));
}
