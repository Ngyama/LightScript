import { create } from "zustand";
import {
  assertProjectInvariant,
  createDefaultProject,
  normalizeSceneCharacters,
  type Project,
  type Scene,
  type SceneBlock,
  type Selection,
} from "../domain/model";

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const defaultProject = createDefaultProject();
const defaultSelection: Selection = {
  projectId: defaultProject.id,
  scriptId: defaultProject.scripts[0]?.id,
  sceneId: defaultProject.scripts[0]?.scenes[0]?.id,
};

type EditorState = {
  project: Project;
  selection: Selection;
  isHydrated: boolean;
  setHydrated: (hydrated: boolean) => void;
  hydrateProject: (project: Project) => void;
  updateProjectTitle: (title: string) => void;
  selectScript: (scriptId: string) => void;
  selectScene: (scriptId: string, sceneId: string) => void;
  addScript: () => void;
  addScene: (scriptId: string) => void;
  deleteScene: (scriptId: string, sceneId: string) => boolean;
  deleteScript: (scriptId: string) => boolean;
  renameScript: (scriptId: string, title: string) => void;
  renameScene: (sceneId: string, title: string) => void;
  setSceneBlocks: (sceneId: string, blocks: SceneBlock[], sceneCharacters?: string[]) => void;
  setSceneCharacters: (sceneId: string, characters: string[]) => void;
  renameSceneCharacter: (sceneId: string, oldName: string, newName: string) => boolean;
};

function findScene(project: Project, sceneId?: string): Scene | undefined {
  for (const script of project.scripts) {
    const scene = script.scenes.find((entry) => entry.id === sceneId);
    if (scene) {
      return scene;
    }
  }
  return undefined;
}

function withInvariant(project: Project): Project {
  assertProjectInvariant(project);
  return project;
}

export const useEditorStore = create<EditorState>((set) => ({
  project: defaultProject,
  selection: defaultSelection,
  isHydrated: false,
  setHydrated: (hydrated) => set({ isHydrated: hydrated }),
  hydrateProject: (project) => {
    const validated = withInvariant(project);
    const firstScript = validated.scripts[0];
    const firstScene = firstScript.scenes[0];
    set({
      project: validated,
      selection: {
        projectId: validated.id,
        scriptId: firstScript.id,
        sceneId: firstScene.id,
      },
      isHydrated: true,
    });
  },
  updateProjectTitle: (title) =>
    set((state) => ({
      project: withInvariant({
        ...state.project,
        title: title.trim() || "Untitled Project",
      }),
    })),
  selectScript: (scriptId) =>
    set((state) => {
      const script = state.project.scripts.find((entry) => entry.id === scriptId);
      if (!script) {
        return state;
      }
      return {
        selection: {
          projectId: state.project.id,
          scriptId,
          sceneId: undefined,
        },
      };
    }),
  selectScene: (scriptId, sceneId) =>
    set((state) => ({
      selection: {
        projectId: state.project.id,
        scriptId,
        sceneId,
      },
    })),
  addScript: () =>
    set((state) => {
      const newSceneId = randomId();
      const newScriptId = randomId();
      const updated = withInvariant({
        ...state.project,
        scripts: [
          ...state.project.scripts,
          {
            id: newScriptId,
            title: `Script ${state.project.scripts.length + 1}`,
            scenes: [{ id: newSceneId, title: "Scene 1", characters: [], blocks: [] }],
          },
        ],
      });
      return {
        project: updated,
        selection: {
          projectId: state.project.id,
          scriptId: newScriptId,
          sceneId: newSceneId,
        },
      };
    }),
  addScene: (scriptId) =>
    set((state) => {
      const updatedScripts = state.project.scripts.map((script) => {
        if (script.id !== scriptId) {
          return script;
        }
        return {
          ...script,
          scenes: [
            ...script.scenes,
            {
              id: randomId(),
              title: `Scene ${script.scenes.length + 1}`,
              characters: [],
              blocks: [],
            },
          ],
        };
      });
      const updatedProject = withInvariant({ ...state.project, scripts: updatedScripts });
      const script = updatedProject.scripts.find((entry) => entry.id === scriptId);
      const lastScene = script?.scenes[script.scenes.length - 1];
      if (!lastScene) {
        return state;
      }
      return {
        project: updatedProject,
        selection: {
          projectId: state.project.id,
          scriptId,
          sceneId: lastScene.id,
        },
      };
    }),
  deleteScene: (scriptId, sceneId) => {
    let deleted = false;
    set((state) => {
      const targetScript = state.project.scripts.find((script) => script.id === scriptId);
      if (!targetScript || targetScript.scenes.length <= 1) {
        return state;
      }

      const nextScripts = state.project.scripts.map((script) => {
        if (script.id !== scriptId) {
          return script;
        }
        const nextScenes = script.scenes.filter((scene) => scene.id !== sceneId);
        if (nextScenes.length !== script.scenes.length) {
          deleted = true;
        }
        return {
          ...script,
          scenes: nextScenes,
        };
      });

      if (!deleted) {
        return state;
      }

      const updatedProject = withInvariant({ ...state.project, scripts: nextScripts });
      const updatedScript = updatedProject.scripts.find((script) => script.id === scriptId);
      const fallbackScene = updatedScript?.scenes[0];

      return {
        project: updatedProject,
        selection: {
          projectId: state.project.id,
          scriptId,
          sceneId: fallbackScene?.id,
        },
      };
    });
    return deleted;
  },
  deleteScript: (scriptId) => {
    let deleted = false;
    set((state) => {
      if (state.project.scripts.length <= 1) {
        return state;
      }
      const targetIdx = state.project.scripts.findIndex((script) => script.id === scriptId);
      if (targetIdx === -1) {
        return state;
      }
      const nextScripts = [
        ...state.project.scripts.slice(0, targetIdx),
        ...state.project.scripts.slice(targetIdx + 1),
      ];
      const updatedProject = withInvariant({ ...state.project, scripts: nextScripts });
      deleted = true;

      const wasSelected = state.selection.scriptId === scriptId;
      if (!wasSelected) {
        return { project: updatedProject };
      }

      const fallbackIdx = Math.min(targetIdx, nextScripts.length - 1);
      const fallbackScript = nextScripts[fallbackIdx];
      const fallbackScene = fallbackScript?.scenes[0];
      return {
        project: updatedProject,
        selection: {
          projectId: state.project.id,
          scriptId: fallbackScript?.id,
          sceneId: fallbackScene?.id,
        },
      };
    });
    return deleted;
  },
  renameScript: (scriptId, title) =>
    set((state) => ({
      project: withInvariant({
        ...state.project,
        scripts: state.project.scripts.map((script) =>
          script.id === scriptId ? { ...script, title: title.trim() || script.title } : script,
        ),
      }),
    })),
  renameScene: (sceneId, title) =>
    set((state) => ({
      project: withInvariant({
        ...state.project,
        scripts: state.project.scripts.map((script) => ({
          ...script,
          scenes: script.scenes.map((scene) =>
            scene.id === sceneId ? { ...scene, title: title.trim() || scene.title } : scene,
          ),
        })),
      }),
    })),
  setSceneBlocks: (sceneId, blocks, sceneCharacters) =>
    set((state) => ({
      project: withInvariant({
        ...state.project,
        scripts: state.project.scripts.map((script) => ({
          ...script,
          scenes: script.scenes.map((scene) =>
            scene.id === sceneId
              ? {
                  ...scene,
                  blocks,
                  characters: normalizeSceneCharacters(sceneCharacters ?? scene.characters),
                }
              : scene,
          ),
        })),
      }),
    })),
  setSceneCharacters: (sceneId, characters) =>
    set((state) => ({
      project: withInvariant({
        ...state.project,
        scripts: state.project.scripts.map((script) => ({
          ...script,
          scenes: script.scenes.map((scene) =>
            scene.id === sceneId
              ? { ...scene, characters: normalizeSceneCharacters(characters) }
              : scene,
          ),
        })),
      }),
    })),
  renameSceneCharacter: (sceneId, oldName, newName) => {
    const before = oldName.trim();
    const after = newName.trim();
    if (!before || !after) return false;
    if (before === after) return true;
    let applied = false;
    set((state) => {
      const updatedScripts = state.project.scripts.map((script) => ({
        ...script,
        scenes: script.scenes.map((scene) => {
          if (scene.id !== sceneId) return scene;
          // Skip if old name isn't present, or new name collides with another
          // existing roster entry (collisions would be silently merged by the
          // normalizer; refuse instead so the user can pick a unique name).
          const hasOld = scene.characters.includes(before);
          const collides =
            scene.characters.some((entry) => entry === after) && after !== before;
          if (!hasOld || collides) return scene;
          const nextCharacters = normalizeSceneCharacters(
            scene.characters.map((entry) => (entry === before ? after : entry)),
          );
          const nextBlocks: SceneBlock[] = scene.blocks.map((block) => {
            if (block.type === "dialogue" && block.character === before) {
              return { ...block, character: after };
            }
            return block;
          });
          applied = true;
          return { ...scene, characters: nextCharacters, blocks: nextBlocks };
        }),
      }));
      if (!applied) return state;
      return { project: withInvariant({ ...state.project, scripts: updatedScripts }) };
    });
    return applied;
  },
}));

export function useSelectedScene(): Scene | undefined {
  const project = useEditorStore((state) => state.project);
  const sceneId = useEditorStore((state) => state.selection.sceneId);
  return findScene(project, sceneId);
}

export function getCurrentProject(): Project {
  return useEditorStore.getState().project;
}
