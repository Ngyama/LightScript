import type { Project, Scene, Script } from "./model";

export const PROJECT_FORMAT_VERSION = 2;
export const PROJECT_META_FILE = "project.json";

export type ProjectFileEntry = {
  relativePath: string;
  payload: string;
};

export type ProjectFileSnapshot = Record<string, string>;

export function sceneRelativePath(scriptId: string, sceneId: string): string {
  return `scripts/${scriptId}/scenes/${sceneId}.json`;
}

export function isProjectMetaPath(relativePath: string): boolean {
  return relativePath === PROJECT_META_FILE || relativePath.replace(/\\/g, "/") === PROJECT_META_FILE;
}

/** Detect legacy monolithic project.json (scenes embedded with blocks). */
export function isLegacyMonolithicProjectJson(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const root = raw as {
    formatVersion?: unknown;
    scripts?: unknown;
  };
  if (root.formatVersion === PROJECT_FORMAT_VERSION) {
    return false;
  }
  if (!Array.isArray(root.scripts)) {
    return false;
  }
  for (const script of root.scripts) {
    if (!script || typeof script !== "object") {
      continue;
    }
    const scenes = (script as { scenes?: unknown }).scenes;
    if (!Array.isArray(scenes)) {
      continue;
    }
    for (const scene of scenes) {
      if (scene && typeof scene === "object" && "blocks" in scene) {
        return true;
      }
    }
  }
  // Empty or catalog-only without formatVersion still treated as legacy if no sceneIds.
  for (const script of root.scripts) {
    if (!script || typeof script !== "object") {
      continue;
    }
    const entry = script as { sceneIds?: unknown; scenes?: unknown };
    if (Array.isArray(entry.sceneIds)) {
      return false;
    }
    if (Array.isArray(entry.scenes)) {
      return true;
    }
  }
  return root.formatVersion !== PROJECT_FORMAT_VERSION;
}

export function sceneFilePayload(scene: Scene): string {
  return JSON.stringify(
    {
      id: scene.id,
      title: scene.title,
      location: scene.location,
      outline: scene.outline,
      characterIds: scene.characterIds,
      blocks: scene.blocks,
    },
    null,
    2,
  );
}

/**
 * Synced project.json body: catalog + characters + writingMode.
 * Does not include scene bodies or last-opened pointers.
 */
export function projectMetaPayload(project: Project): string {
  return JSON.stringify(
    {
      formatVersion: PROJECT_FORMAT_VERSION,
      id: project.id,
      title: project.title,
      worldbuilding: project.worldbuilding ?? "",
      characters: project.characters,
      settings: {
        writingMode: project.settings.writingMode,
      },
      scripts: project.scripts.map((script) => ({
        id: script.id,
        title: script.title,
        sceneIds: script.scenes.map((scene) => scene.id),
      })),
    },
    null,
    2,
  );
}

export function listProjectFileEntries(project: Project): ProjectFileEntry[] {
  const entries: ProjectFileEntry[] = [
    { relativePath: PROJECT_META_FILE, payload: projectMetaPayload(project) },
  ];
  for (const script of project.scripts) {
    for (const scene of script.scenes) {
      entries.push({
        relativePath: sceneRelativePath(script.id, scene.id),
        payload: sceneFilePayload(scene),
      });
    }
  }
  return entries;
}

export function projectFileSnapshot(project: Project): ProjectFileSnapshot {
  const snapshot: ProjectFileSnapshot = {};
  for (const entry of listProjectFileEntries(project)) {
    snapshot[entry.relativePath] = entry.payload;
  }
  return snapshot;
}

export function parseSceneFile(raw: string): Scene {
  const parsed = JSON.parse(raw) as Partial<Scene>;
  if (typeof parsed.id !== "string" || !parsed.id.trim()) {
    throw new Error("Scene file must have a string id.");
  }
  if (typeof parsed.title !== "string") {
    throw new Error("Scene file must have a string title.");
  }
  return {
    id: parsed.id,
    title: parsed.title,
    location: typeof parsed.location === "string" ? parsed.location : "",
    outline: typeof parsed.outline === "string" ? parsed.outline : "",
    characterIds: Array.isArray(parsed.characterIds)
      ? parsed.characterIds.filter((id): id is string => typeof id === "string")
      : [],
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
  };
}

type MetaScript = {
  id: string;
  title: string;
  sceneIds?: string[];
  scenes?: Scene[];
};

type MetaDocument = {
  formatVersion?: number;
  id: string;
  title: string;
  worldbuilding?: string;
  characters?: Project["characters"];
  settings?: Project["settings"];
  scripts: MetaScript[];
};

export function assembleProjectFromMetaAndScenes(
  metaRaw: string,
  scenesByPath: Record<string, string>,
): Project {
  const meta = JSON.parse(metaRaw) as MetaDocument;
  const scripts: Script[] = (meta.scripts ?? []).map((script) => {
    const sceneIds =
      Array.isArray(script.sceneIds) && script.sceneIds.length > 0
        ? script.sceneIds
        : (script.scenes ?? []).map((scene) => scene.id);

    const scenes: Scene[] = sceneIds.map((sceneId) => {
      const relativePath = sceneRelativePath(script.id, sceneId);
      const raw = scenesByPath[relativePath];
      if (!raw) {
        throw new Error(`Missing scene file: ${relativePath}`);
      }
      const scene = parseSceneFile(raw);
      if (scene.id !== sceneId) {
        return { ...scene, id: sceneId };
      }
      return scene;
    });

    return {
      id: script.id,
      title: script.title,
      scenes,
    };
  });

  return {
    id: meta.id,
    title: meta.title,
    worldbuilding: meta.worldbuilding ?? "",
    characters: Array.isArray(meta.characters) ? meta.characters : [],
    settings: {
      writingMode: meta.settings?.writingMode === "quote" ? "quote" : "character",
    },
    scripts,
  };
}

/** Paths that exist in `previous` but not in `next` (scene files removed). */
export function removedProjectFiles(
  previous: ProjectFileSnapshot,
  next: ProjectFileSnapshot,
): string[] {
  return Object.keys(previous).filter(
    (path) => path !== PROJECT_META_FILE && next[path] === undefined,
  );
}
