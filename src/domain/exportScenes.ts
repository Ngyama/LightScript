import type { Project, Scene } from "./model";
import { sceneToExportScene, sceneToMarkdown, sceneToPlainText } from "./model";
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
