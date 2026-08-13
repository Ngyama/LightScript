import type { Project, Selection } from "./model";
import { findSceneInProject } from "./model";

export type LastOpened = {
  lastScriptId?: string;
  lastSceneId?: string;
};

/** @deprecated Prefer app-local last-opened; kept for reading legacy project.json. */
export function withLastOpenedSettings(
  project: Project,
  scriptId: string | undefined,
  sceneId: string | undefined,
): Project {
  if (!scriptId || !sceneId) {
    return project;
  }

  return {
    ...project,
    settings: {
      ...project.settings,
      lastScriptId: scriptId,
      lastSceneId: sceneId,
    },
  };
}

export function resolveLastOpenedSelection(
  project: Project,
  lastOpened?: LastOpened | null,
): Pick<Selection, "scriptId" | "sceneId"> {
  const lastSceneId =
    lastOpened?.lastSceneId?.trim() || project.settings.lastSceneId?.trim();
  if (lastSceneId) {
    const scene = findSceneInProject(project, lastSceneId);
    if (scene) {
      for (const script of project.scripts) {
        if (script.scenes.some((entry) => entry.id === lastSceneId)) {
          return { scriptId: script.id, sceneId: lastSceneId };
        }
      }
    }
  }

  const lastScriptId =
    lastOpened?.lastScriptId?.trim() || project.settings.lastScriptId?.trim();
  if (lastScriptId) {
    const script = project.scripts.find((entry) => entry.id === lastScriptId);
    const scene = script?.scenes[0];
    if (script && scene) {
      return { scriptId: script.id, sceneId: scene.id };
    }
  }

  const firstScript = project.scripts[0];
  const firstScene = firstScript?.scenes[0];
  return {
    scriptId: firstScript?.id,
    sceneId: firstScene?.id,
  };
}
