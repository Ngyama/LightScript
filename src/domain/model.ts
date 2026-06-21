import {
  getCharacterName,
  migrateProjectCharacters,
  normalizeCharacterIds,
  normalizeProjectCharacterReferences,
  normalizeProjectCharacters,
} from "./characters";

export type BlockType = "dialogue" | "narrative";

export interface NarrativeBlock {
  id: string;
  type: "narrative";
  text: string;
}

export interface DialogueBlock {
  id: string;
  type: "dialogue";
  characterId?: string;
  text: string;
}

export type SceneBlock = NarrativeBlock | DialogueBlock;

export interface Scene {
  id: string;
  title: string;
  characterIds: string[];
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
  color?: string;
  memo?: string;
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
    characterIds: [],
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

function assertValidBlock(block: SceneBlock, validCharacterIds: Set<string>): void {
  if (block.type === "narrative") {
    if (typeof block.text !== "string") {
      throw new Error("Narrative block text must be string.");
    }
    return;
  }
  if (block.type === "dialogue") {
    if (typeof block.text !== "string") {
      throw new Error("Dialogue block text must be string.");
    }
    if (block.characterId !== undefined) {
      if (typeof block.characterId !== "string") {
        throw new Error("Dialogue block characterId must be string when present.");
      }
      if (!validCharacterIds.has(block.characterId)) {
        throw new Error("Dialogue block characterId must reference a project character.");
      }
    }
  }
}

function assertBlockReadyForExport(block: SceneBlock): void {
  if (block.type === "dialogue" && block.text.trim().length === 0) {
    throw new Error("Dialogue block must contain text.");
  }
}

export function assertProjectInvariant(project: Project): void {
  if (!Array.isArray(project.characters)) {
    throw new Error("Project characters must be an array.");
  }

  const validCharacterIds = new Set<string>();
  for (const character of project.characters) {
    if (typeof character.id !== "string" || typeof character.name !== "string") {
      throw new Error("Project character must have string id and name.");
    }
    if (!character.id.trim() || !character.name.trim()) {
      throw new Error("Project character id and name cannot be empty.");
    }
    if (validCharacterIds.has(character.id)) {
      throw new Error("Duplicate project character id.");
    }
    validCharacterIds.add(character.id);
  }

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

      if (!Array.isArray(scene.characterIds)) {
        throw new Error("Scene characterIds must be an array.");
      }

      const seenSceneCharacterIds = new Set<string>();
      for (const characterId of scene.characterIds) {
        if (typeof characterId !== "string" || !characterId.trim()) {
          throw new Error("Scene characterIds entries must be non-empty strings.");
        }
        if (!validCharacterIds.has(characterId)) {
          throw new Error("Scene characterIds must reference project characters.");
        }
        if (seenSceneCharacterIds.has(characterId)) {
          throw new Error("Duplicate scene character id.");
        }
        seenSceneCharacterIds.add(characterId);
      }

      for (const block of scene.blocks) {
        if (block.type !== "narrative" && block.type !== "dialogue") {
          throw new Error("Scene block type must be narrative or dialogue.");
        }
        assertValidBlock(block, validCharacterIds);
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

export function toDialogueText(speaker: string | undefined, text: string): string {
  const name = speaker?.trim();
  if (!name) {
    return `“${text}”`;
  }
  return `${name}：“${text}”`;
}

export function sceneToPlainText(scene: Scene, project: Project): string {
  const lines: string[] = [scene.title];

  for (const block of scene.blocks) {
    const text = block.text.trim();
    if (!text) continue;

    if (block.type === "narrative") {
      lines.push("", text);
      continue;
    }

    const speaker = getCharacterName(project, block.characterId);
    lines.push("");
    if (speaker) {
      lines.push(`${speaker}：“${text}”`);
    } else {
      lines.push(`“${text}”`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function sceneToMarkdown(scene: Scene, project: Project): string {
  const lines: string[] = [`# ${scene.title}`];

  for (const block of scene.blocks) {
    if (block.type === "narrative") {
      const text = block.text.trim();
      if (!text) continue;
      lines.push("", text);
      continue;
    }

    const text = block.text.trim();
    if (!text) continue;
    const speaker = getCharacterName(project, block.characterId);
    lines.push("");
    if (speaker) {
      lines.push(`**${speaker}**: ${text}`);
    } else {
      lines.push(`> ${text}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function findSceneInProject(project: Project, sceneId: string | undefined): Scene | undefined {
  if (!sceneId) return undefined;
  for (const script of project.scripts) {
    const scene = script.scenes.find((entry) => entry.id === sceneId);
    if (scene) return scene;
  }
  return undefined;
}

interface LegacyBlock {
  id?: string;
  type?: string;
  character?: unknown;
  characterId?: unknown;
  text?: unknown;
}

/** Dialogue block during parse — may still carry legacy `character` name until migration. */
type MigratingDialogueBlock = DialogueBlock & { character?: string };

function createMigratingDialogue(
  id: string,
  text: string,
  legacyCharacter: string,
  legacyCharacterId?: string,
): MigratingDialogueBlock {
  const block: MigratingDialogueBlock = { id, type: "dialogue", text };
  if (legacyCharacterId) {
    block.characterId = legacyCharacterId;
  } else if (legacyCharacter) {
    block.character = legacyCharacter;
  }
  return block;
}

function migrateLegacyBlocks(rawBlocks: unknown): SceneBlock[] {
  const list = Array.isArray(rawBlocks) ? (rawBlocks as LegacyBlock[]) : [];
  const result: SceneBlock[] = [];

  for (let i = 0; i < list.length; i++) {
    const block = list[i] ?? {};
    const id = typeof block.id === "string" ? block.id : randomId();
    const text = typeof block.text === "string" ? block.text : "";
    const legacyCharacter = typeof block.character === "string" ? block.character : "";
    const legacyCharacterId =
      typeof block.characterId === "string" ? block.characterId.trim() : undefined;

    if (block.type === "action" || block.type === "narrative") {
      result.push({ id, type: "narrative", text });
      continue;
    }

    if (block.type === "character") {
      const next = list[i + 1] ?? {};
      const nextCharacter = typeof next.character === "string" ? next.character : "";
      const nextText = typeof next.text === "string" ? next.text : "";
      const nextCharacterId =
        typeof next.characterId === "string" ? next.characterId.trim() : undefined;
      if (next.type === "dialogue") {
        result.push(
          createMigratingDialogue(
            typeof next.id === "string" ? next.id : id,
            nextText,
            legacyCharacter || nextCharacter,
            nextCharacterId,
          ),
        );
        i += 1;
      } else {
        result.push(createMigratingDialogue(id, "", legacyCharacter, legacyCharacterId));
      }
      continue;
    }

    if (block.type === "dialogue") {
      result.push(createMigratingDialogue(id, text, legacyCharacter, legacyCharacterId));
      continue;
    }

    result.push({ id, type: "narrative", text });
  }

  return result;
}

interface RawProject extends Omit<Project, "characters" | "scripts"> {
  characters?: unknown;
  scripts?: Array<{
    id: string;
    title: string;
    scenes?: Array<Scene & { characters?: unknown }>;
  }>;
}

export function parseProject(raw: string): Project {
  const parsed = JSON.parse(raw) as RawProject;
  const scripts = (parsed.scripts ?? []).map((script) => ({
    ...script,
    scenes: (script.scenes ?? []).map((scene) => {
      const legacyScene = scene as Scene & { characters?: unknown };
      const characterIds = normalizeCharacterIds(legacyScene.characterIds);
      const blocks = migrateLegacyBlocks(scene.blocks);
      const migratingScene: Scene & { characters?: unknown } = {
        id: scene.id,
        title: scene.title,
        characterIds,
        blocks,
      };
      if (Array.isArray(legacyScene.characters)) {
        migratingScene.characters = legacyScene.characters;
      }
      return migratingScene;
    }),
  }));

  const interim: Project & { scripts: Array<{ scenes: Array<Scene & { characters?: unknown }> }> } =
    {
      id: parsed.id,
      title: parsed.title,
      worldbuilding: parsed.worldbuilding,
      scripts,
      characters: normalizeProjectCharacters(parsed.characters),
      settings: parsed.settings ?? { enableDialogueShortcut: true },
    };

  const migrated = migrateProjectCharacters(interim);
  const normalized = normalizeProjectCharacterReferences(migrated);
  assertProjectInvariant(normalized);
  return normalized;
}

export {
  getCharacterName,
  getSceneCharacters,
  ensureGlobalCharacterInProject,
  migrateProjectCharacters,
  normalizeCharacterIds,
  normalizeProjectCharacterReferences,
  normalizeProjectCharacters,
  sceneToExportScene,
} from "./characters";
