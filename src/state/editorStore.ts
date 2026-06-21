import { create } from "zustand";
import {
  assertProjectInvariant,
  createDefaultProject,
  ensureGlobalCharacterInProject,
  getSceneCharacters,
  normalizeCharacterIds,
  type Character,
  type Project,
  type Scene,
  type SceneBlock,
  type Selection,
} from "../domain/model";
import { navigationTargetFromSearchMatch, type NavigationTarget } from "../domain/navigation";
import type { SearchMatch } from "../domain/searchProject";

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const defaultProject = createDefaultProject();
const defaultSelection: Selection = {
  projectId: defaultProject.id,
  scriptId: defaultProject.scripts[0]?.id,
  sceneId: defaultProject.scripts[0]?.scenes[0]?.id,
};

type GlobalCharacterPatch = Partial<Pick<Character, "name" | "color" | "memo">>;

type EditorState = {
  project: Project;
  selection: Selection;
  navigationTarget: NavigationTarget | null;
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
  updateSceneOutline: (sceneId: string, outline: string) => void;
  setSceneBlocks: (sceneId: string, blocks: SceneBlock[]) => void;
  addGlobalCharacter: (name: string) => string | undefined;
  renameGlobalCharacter: (characterId: string, name: string) => void;
  deleteGlobalCharacter: (characterId: string) => void;
  updateGlobalCharacter: (characterId: string, patch: GlobalCharacterPatch) => void;
  ensureGlobalCharacter: (name: string) => string;
  addCharacterToCurrentScene: (characterId: string) => void;
  removeCharacterFromCurrentScene: (characterId: string) => void;
  createAndAddCharacterToCurrentScene: (name: string) => void;
  updateDialogueCharacter: (blockId: string, characterId?: string) => void;
  navigateToSearchMatch: (match: SearchMatch) => void;
  clearNavigationTarget: () => void;
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

function mapScenes(
  project: Project,
  sceneId: string | undefined,
  mapper: (scene: Scene) => Scene,
): Project {
  return {
    ...project,
    scripts: project.scripts.map((script) => ({
      ...script,
      scenes: script.scenes.map((scene) =>
        scene.id === sceneId ? mapper(scene) : scene,
      ),
    })),
  };
}

function clearCharacterFromProject(project: Project, characterId: string): Project {
  return {
    ...project,
    characters: project.characters.filter((entry) => entry.id !== characterId),
    scripts: project.scripts.map((script) => ({
      ...script,
      scenes: script.scenes.map((scene) => ({
        ...scene,
        characterIds: scene.characterIds.filter((id) => id !== characterId),
        blocks: scene.blocks.map((block) => {
          if (block.type !== "dialogue" || block.characterId !== characterId) {
            return block;
          }
          return { ...block, characterId: undefined };
        }),
      })),
    })),
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: defaultProject,
  selection: defaultSelection,
  navigationTarget: null,
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
            scenes: [{ id: newSceneId, title: "Scene 1", outline: "", characterIds: [], blocks: [] }],
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
              outline: "",
              characterIds: [],
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
  updateSceneOutline: (sceneId, outline) =>
    set((state) => ({
      project: withInvariant({
        ...state.project,
        scripts: state.project.scripts.map((script) => ({
          ...script,
          scenes: script.scenes.map((scene) =>
            scene.id === sceneId ? { ...scene, outline } : scene,
          ),
        })),
      }),
    })),
  setSceneBlocks: (sceneId, blocks) =>
    set((state) => ({
      project: withInvariant(
        mapScenes(state.project, sceneId, (scene) => ({
          ...scene,
          blocks,
        })),
      ),
    })),
  addGlobalCharacter: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    let createdId: string | undefined;
    set((state) => {
      const { project, characterId } = ensureGlobalCharacterInProject(state.project, trimmed);
      createdId = characterId;
      return { project: withInvariant(project) };
    });
    return createdId;
  },
  renameGlobalCharacter: (characterId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => ({
      project: withInvariant({
        ...state.project,
        characters: state.project.characters.map((entry) =>
          entry.id === characterId ? { ...entry, name: trimmed } : entry,
        ),
      }),
    }));
  },
  deleteGlobalCharacter: (characterId) =>
    set((state) => ({
      project: withInvariant(clearCharacterFromProject(state.project, characterId)),
    })),
  updateGlobalCharacter: (characterId, patch) =>
    set((state) => ({
      project: withInvariant({
        ...state.project,
        characters: state.project.characters.map((entry) => {
          if (entry.id !== characterId) return entry;
          const next: Character = { ...entry };
          if (patch.name !== undefined) {
            const trimmed = patch.name.trim();
            if (!trimmed) return entry;
            next.name = trimmed;
          }
          if (patch.color !== undefined) {
            const trimmed = patch.color.trim();
            if (trimmed) next.color = trimmed;
            else delete next.color;
          }
          if (patch.memo !== undefined) {
            const trimmed = patch.memo.trim();
            if (trimmed) next.memo = trimmed;
            else delete next.memo;
          }
          return next;
        }),
      }),
    })),
  ensureGlobalCharacter: (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Character name cannot be empty.");
    }
    const existing = get().project.characters.find((entry) => entry.name.trim() === trimmed);
    if (existing) return existing.id;
    const id = get().addGlobalCharacter(trimmed);
    if (!id) {
      throw new Error("Failed to create character.");
    }
    return id;
  },
  addCharacterToCurrentScene: (characterId) =>
    set((state) => {
      const sceneId = state.selection.sceneId;
      if (!sceneId) return state;
      if (!state.project.characters.some((entry) => entry.id === characterId)) {
        return state;
      }
      return {
        project: withInvariant(
          mapScenes(state.project, sceneId, (scene) => {
            if (scene.characterIds.includes(characterId)) return scene;
            return {
              ...scene,
              characterIds: [...scene.characterIds, characterId],
            };
          }),
        ),
      };
    }),
  removeCharacterFromCurrentScene: (characterId) =>
    set((state) => {
      const sceneId = state.selection.sceneId;
      if (!sceneId) return state;
      return {
        project: withInvariant(
          mapScenes(state.project, sceneId, (scene) => ({
            ...scene,
            characterIds: scene.characterIds.filter((id) => id !== characterId),
            blocks: scene.blocks.map((block) => {
              if (block.type !== "dialogue" || block.characterId !== characterId) {
                return block;
              }
              return { ...block, characterId: undefined };
            }),
          })),
        ),
      };
    }),
  createAndAddCharacterToCurrentScene: (name) => {
    const characterId = get().ensureGlobalCharacter(name);
    get().addCharacterToCurrentScene(characterId);
  },
  updateDialogueCharacter: (blockId, characterId) =>
    set((state) => {
      const sceneId = state.selection.sceneId;
      if (!sceneId) return state;

      let nextProject = state.project;
      if (characterId && !nextProject.characters.some((entry) => entry.id === characterId)) {
        return state;
      }

      const scene = findScene(nextProject, sceneId);
      if (!scene) return state;

      if (characterId && !scene.characterIds.includes(characterId)) {
        nextProject = mapScenes(nextProject, sceneId, (current) => ({
          ...current,
          characterIds: normalizeCharacterIds([...current.characterIds, characterId]),
        }));
      }

      nextProject = mapScenes(nextProject, sceneId, (current) => ({
        ...current,
        blocks: current.blocks.map((block) => {
          if (block.id !== blockId || block.type !== "dialogue") return block;
          return {
            ...block,
            characterId: characterId && characterId.trim() ? characterId : undefined,
          };
        }),
      }));

      return { project: withInvariant(nextProject) };
    }),
  navigateToSearchMatch: (match) =>
    set((state) => ({
      selection: {
        projectId: state.project.id,
        scriptId: match.scriptId,
        sceneId: match.sceneId,
      },
      navigationTarget: navigationTargetFromSearchMatch(match),
    })),
  clearNavigationTarget: () => set({ navigationTarget: null }),
}));

export function useSelectedScene(): Scene | undefined {
  const project = useEditorStore((state) => state.project);
  const sceneId = useEditorStore((state) => state.selection.sceneId);
  return findScene(project, sceneId);
}

export function useCurrentSceneCharacters(): Character[] {
  const project = useEditorStore((state) => state.project);
  const scene = useSelectedScene();
  if (!scene) return [];
  return getSceneCharacters(project, scene);
}

export function getCurrentProject(): Project {
  return useEditorStore.getState().project;
}
