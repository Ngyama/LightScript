import type { Project, Selection } from "./model";
import { findSceneInProject } from "./model";

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

export function resolveLastOpenedSelection(project: Project): Pick<Selection, "scriptId" | "sceneId"> {
  const lastSceneId = project.settings.lastSceneId?.trim();
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

  const lastScriptId = project.settings.lastScriptId?.trim();
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
