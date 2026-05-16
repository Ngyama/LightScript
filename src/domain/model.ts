export type BlockType = "character" | "dialogue" | "narrative";

export interface CharacterBlock {
  id: string;
  type: "character";
  character: string;
}

export interface NarrativeBlock {
  id: string;
  type: "narrative";
  text: string;
}

export interface DialogueBlock {
  id: string;
  type: "dialogue";
  character: string;
  text: string;
}

export type SceneBlock = CharacterBlock | NarrativeBlock | DialogueBlock;

export interface Scene {
  id: string;
  title: string;
  characters: string[];
  blocks: SceneBlock[];
}

export interface Script {
  id: string;
  title: string;
  scenes: Scene[];
}

export interface Character {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  title: string;
  worldbuilding?: string;
  scripts: Script[];
  characters: Character[];
  settings: {
    enableDialogueShortcut: boolean;
  };
}

export interface Selection {
  projectId: string;
  scriptId?: string;
  sceneId?: string;
}

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createDefaultProject(): Project {
  const introScene: Scene = {
    id: randomId(),
    title: "Scene 1",
    characters: [],
    blocks: [{ id: randomId(), type: "narrative", text: "" }],
  };

  const openingScript: Script = {
    id: randomId(),
    title: "Script 1",
    scenes: [introScene],
  };

  return {
    id: randomId(),
    title: "Untitled Project",
    worldbuilding: "",
    scripts: [openingScript],
    characters: [],
    settings: {
      enableDialogueShortcut: true,
    },
  };
}

function assertValidBlock(block: SceneBlock): void {
  if (block.type === "character") {
    if (typeof block.character !== "string") {
      throw new Error("Character block character must be string.");
    }
  }
  if (block.type === "narrative" && typeof block.text !== "string") {
    throw new Error("Narrative block text must be string.");
  }
  if (block.type === "dialogue") {
    if (typeof block.character !== "string" || typeof block.text !== "string") {
      throw new Error("Dialogue block fields must be string.");
    }
  }
}

function assertBlockReadyForExport(block: SceneBlock): void {
  if (block.type === "character" && block.character.trim().length === 0) {
    throw new Error("Character block must contain character.");
  }
  if (block.type === "dialogue") {
    if (block.character.trim().length === 0 || block.text.trim().length === 0) {
      throw new Error("Dialogue block must contain character and text.");
    }
  }
}

export function assertProjectInvariant(project: Project): void {
  if (project.scripts.length === 0) {
    throw new Error("Project must contain at least one script.");
  }

  const seenScriptIds = new Set<string>();
  const seenSceneIds = new Set<string>();

  for (const script of project.scripts) {
    if (seenScriptIds.has(script.id)) {
      throw new Error("Duplicate script id.");
    }
    seenScriptIds.add(script.id);

    if (!Array.isArray(script.scenes)) {
      throw new Error("Script scenes must be a linear array.");
    }

    for (const scene of script.scenes) {
      if (seenSceneIds.has(scene.id)) {
        throw new Error("Duplicate scene id.");
      }
      seenSceneIds.add(scene.id);
      for (const block of scene.blocks) {
        if (block.type !== "character" && block.type !== "narrative" && block.type !== "dialogue") {
          throw new Error("Scene block type must be character, narrative or dialogue.");
        }
        assertValidBlock(block);
      }
    }
  }
}

export function assertProjectReadyForExport(project: Project): void {
  assertProjectInvariant(project);
  for (const script of project.scripts) {
    for (const scene of script.scenes) {
      for (const block of scene.blocks) {
        assertBlockReadyForExport(block);
      }
    }
  }
}

export function toDialogueText(character: string, text: string): string {
  return `${character}：“${text}”`;
}

export function parseProject(raw: string): Project {
  const parsed = JSON.parse(raw) as Project;
  // Backward compatibility for previously saved "action" blocks.
  for (const script of parsed.scripts ?? []) {
    for (const scene of script.scenes ?? []) {
      if (!Array.isArray(scene.characters)) {
        scene.characters = [];
      }
      scene.blocks = scene.blocks.map((block) => {
        if ((block as { type?: string }).type === "action") {
          return {
            ...block,
            type: "narrative",
          } as SceneBlock;
        }
        return block;
      });
    }
  }
  assertProjectInvariant(parsed);
  return parsed;
}
