import { describe, expect, test } from "vitest";
import { createDefaultProject } from "../domain/model";
import { resolveLastOpenedSelection, withLastOpenedSettings } from "../domain/selection";
import { useEditorStore } from "../state/editorStore";

describe("selection persistence", () => {
  test("stores last opened scene in last-opened record", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    const next = withLastOpenedSettings(project, script.id, scene.id);
    expect(next.settings.lastScriptId).toBe(script.id);
    expect(next.settings.lastSceneId).toBe(scene.id);
  });

  test("restores last opened scene from app-local lastOpened", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const secondScene = {
      ...script.scenes[0],
      id: "scene-2",
      title: "Scene 2",
    };
    project.scripts[0] = {
      ...script,
      scenes: [...script.scenes, secondScene],
    };

    const restored = resolveLastOpenedSelection(project, {
      lastScriptId: script.id,
      lastSceneId: secondScene.id,
    });
    expect(restored).toEqual({ scriptId: script.id, sceneId: secondScene.id });
  });

  test("falls back to first scene when saved scene no longer exists", () => {
    const project = createDefaultProject();
    const restored = resolveLastOpenedSelection(project, {
      lastScriptId: "missing-script",
      lastSceneId: "missing-scene",
    });
    expect(restored.sceneId).toBe(project.scripts[0].scenes[0].id);
  });

  test("hydrateProject opens the last saved scene", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const secondScene = {
      ...script.scenes[0],
      id: "scene-2",
      title: "Scene 2",
    };
    project.scripts[0] = {
      ...script,
      scenes: [...script.scenes, secondScene],
    };

    useEditorStore.getState().hydrateProject(project, {
      lastScriptId: script.id,
      lastSceneId: secondScene.id,
    });
    const selection = useEditorStore.getState().selection;
    expect(selection).toMatchObject({ scriptId: script.id, sceneId: secondScene.id });
    expect(useEditorStore.getState().project.settings.lastSceneId).toBeUndefined();
  });
});
