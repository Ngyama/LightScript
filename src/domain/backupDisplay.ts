import type { Project, Scene, SceneBlock } from "./model";
import { countSceneBlocksChars } from "./snapshotPolicy";

const SCENE_PATH_RE = /^scripts\/([^/]+)\/scenes\/([^/]+)\.json$/i;

function countSceneChars(blocks: SceneBlock[]): number {
  return countSceneBlocksChars(blocks);
}

export function parseSceneBackupPath(
  relativePath: string,
): { scriptId: string; sceneId: string } | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const match = SCENE_PATH_RE.exec(normalized);
  if (!match) {
    return null;
  }
  return { scriptId: match[1], sceneId: match[2] };
}

export function resolveBackupDisplayName(
  relativePath: string,
  project: Project | null | undefined,
): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "project.json" || normalized.toLowerCase() === "project.json") {
    return "作品目录（角色 / 结构）";
  }
  const parsed = parseSceneBackupPath(normalized);
  if (!parsed || !project) {
    return "未知文件";
  }
  for (const script of project.scripts) {
    if (script.id !== parsed.scriptId) {
      continue;
    }
    const scene = script.scenes.find((entry) => entry.id === parsed.sceneId);
    if (scene) {
      return `${scene.title || "未命名 Scene"}（正文）`;
    }
    return `${script.title || "未命名 Script"} · 已删除的 Scene`;
  }
  return "未知 Scene（正文）";
}

function blocksToPlainPreview(blocks: SceneBlock[], project: Project | null): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) {
      continue;
    }
    if (block.type === "narrative") {
      lines.push(text);
      continue;
    }
    const speaker =
      block.characterId && project
        ? project.characters.find((c) => c.id === block.characterId)?.name
        : undefined;
    lines.push(speaker ? `${speaker}：${text}` : text);
  }
  return lines.join("\n\n");
}

export type BackupPreview = {
  kind: "scene" | "project" | "raw";
  title: string;
  plainText: string;
  charCount: number | null;
};

export function buildBackupPreview(
  relativePath: string,
  rawContent: string,
  project: Project | null,
): BackupPreview {
  const displayName = resolveBackupDisplayName(relativePath, project);
  try {
    const parsed = JSON.parse(rawContent) as Partial<Scene> & {
      title?: string;
      scripts?: unknown;
      blocks?: SceneBlock[];
    };
    const scenePath = parseSceneBackupPath(relativePath);
    if (scenePath && Array.isArray(parsed.blocks)) {
      const statsChars = countSceneChars(parsed.blocks);
      const plain = blocksToPlainPreview(parsed.blocks, project);
      return {
        kind: "scene",
        title: typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title
          : displayName,
        plainText: plain || "（此快照正文为空）",
        charCount: statsChars,
      };
    }
    if (relativePath.replace(/\\/g, "/").endsWith("project.json")) {
      const scriptCount = Array.isArray(parsed.scripts) ? parsed.scripts.length : 0;
      const characterCount = Array.isArray(
        (parsed as { characters?: unknown }).characters,
      )
        ? ((parsed as { characters: unknown[] }).characters.length)
        : 0;
      return {
        kind: "project",
        title: typeof parsed.title === "string" ? parsed.title : displayName,
        plainText: `作品：${typeof parsed.title === "string" ? parsed.title : "（无标题）"}\nScript 数：${scriptCount}\n角色数：${characterCount}`,
        charCount: null,
      };
    }
  } catch {
    // fall through to raw
  }
  return {
    kind: "raw",
    title: displayName,
    plainText: rawContent.slice(0, 4000),
    charCount: null,
  };
}

export function formatCharDelta(backupChars: number | null, currentChars: number | null): string | null {
  if (backupChars === null || currentChars === null) {
    return null;
  }
  const delta = backupChars - currentChars;
  if (delta === 0) {
    return "与当前字数相同";
  }
  if (delta > 0) {
    return `比当前多 ${delta} 字`;
  }
  return `比当前少 ${Math.abs(delta)} 字`;
}

export function currentSceneCharCount(
  project: Project | null,
  relativePath: string,
): number | null {
  if (!project) {
    return null;
  }
  const parsed = parseSceneBackupPath(relativePath);
  if (!parsed) {
    return null;
  }
  for (const script of project.scripts) {
    if (script.id !== parsed.scriptId) {
      continue;
    }
    const scene = script.scenes.find((entry) => entry.id === parsed.sceneId);
    if (!scene) {
      return null;
    }
    return countSceneChars(scene.blocks);
  }
  return null;
}
