import type { Character, DialogueBlock, Project, Scene, SceneBlock } from "./model";
import {
  formatCharacterHue,
  parseCharacterHue,
  pickDistinctHue,
} from "./characterColors";

function normalizeSceneOutline(outline: unknown): string {
  return typeof outline === "string" ? outline : "";
}

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function collectCharacterHues(characters: readonly Character[]): number[] {
  const hues: number[] = [];
  for (const character of characters) {
    const hue = parseCharacterHue(character.color);
    if (hue !== null) {
      hues.push(hue);
    }
  }
  return hues;
}

export function ensureCharacterColors(characters: Character[]): Character[] {
  const usedHues: number[] = [];
  return characters.map((character) => {
    const parsed = parseCharacterHue(character.color);
    if (parsed !== null) {
      const color = formatCharacterHue(parsed);
      usedHues.push(parsed);
      return color === character.color ? character : { ...character, color };
    }
    const hue = pickDistinctHue(usedHues);
    usedHues.push(hue);
    return { ...character, color: formatCharacterHue(hue) };
  });
}

export function createCharacter(
  name: string,
  options?: { id?: string; existingCharacters?: readonly Character[] },
): Character {
  const id = options?.id ?? randomId();
  const trimmed = name.trim();
  const hue = pickDistinctHue(collectCharacterHues(options?.existingCharacters ?? []));
  return { id, name: trimmed, color: formatCharacterHue(hue) };
}

export function getCharacterById(project: Project, characterId?: string): Character | undefined {
  if (!characterId) return undefined;
  return project.characters.find((entry) => entry.id === characterId);
}

export function getCharacterName(project: Project, characterId?: string): string | undefined {
  const character = getCharacterById(project, characterId);
  const name = character?.name.trim();
  return name || undefined;
}

export function getSceneCharacters(project: Project, scene: Scene): Character[] {
  const result: Character[] = [];
  const seen = new Set<string>();
  for (const id of scene.characterIds) {
    if (seen.has(id)) continue;
    const character = getCharacterById(project, id);
    if (!character) continue;
    seen.add(id);
    result.push(character);
  }
  return result;
}

export function normalizeCharacterIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function normalizeProjectCharacters(characters: unknown): Character[] {
  if (!Array.isArray(characters)) {
    return [];
  }
  const seenIds = new Set<string>();
  const result: Character[] = [];
  for (const raw of characters) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Partial<Character>;
    if (typeof entry.id !== "string" || typeof entry.name !== "string") continue;
    const id = entry.id.trim();
    const name = entry.name.trim();
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    const character: Character = { id, name };
    if (typeof entry.color === "string" && entry.color.trim()) {
      character.color = entry.color.trim();
    }
    if (typeof entry.memo === "string" && entry.memo.trim()) {
      character.memo = entry.memo.trim();
    }
    result.push(character);
  }
  return ensureCharacterColors(result);
}

interface NameRegistry {
  characters: Character[];
  nameToId: Map<string, string>;
}

function createNameRegistry(characters: Character[]): NameRegistry {
  const nameToId = new Map<string, string>();
  for (const character of characters) {
    const key = character.name.trim();
    if (!key || nameToId.has(key)) continue;
    nameToId.set(key, character.id);
  }
  return { characters: [...characters], nameToId };
}

function ensureNameInRegistry(registry: NameRegistry, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Character name cannot be empty.");
  }
  const existing = registry.nameToId.get(trimmed);
  if (existing) return existing;
  const created = createCharacter(trimmed, { existingCharacters: registry.characters });
  registry.characters.push(created);
  registry.nameToId.set(trimmed, created.id);
  return created.id;
}

function uniquePushId(list: string[], id: string): void {
  if (!id || list.includes(id)) return;
  list.push(id);
}

interface LegacySceneShape {
  characters?: unknown;
  characterIds?: unknown;
}

interface LegacyDialogueShape {
  character?: unknown;
  characterId?: unknown;
}

function readLegacySceneNames(scene: LegacySceneShape): string[] {
  if (!Array.isArray(scene.characters)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of scene.characters) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function resolveDialogueCharacterId(
  registry: NameRegistry,
  block: LegacyDialogueShape,
  validIds: Set<string>,
): string | undefined {
  if (typeof block.characterId === "string") {
    const id = block.characterId.trim();
    if (id && validIds.has(id)) {
      return id;
    }
  }
  if (typeof block.character === "string") {
    const name = block.character.trim();
    if (name) {
      return ensureNameInRegistry(registry, name);
    }
  }
  return undefined;
}

function stripDialogueBlock(block: DialogueBlock): DialogueBlock {
  const next: DialogueBlock = {
    id: block.id,
    type: "dialogue",
    text: block.text,
  };
  if (block.characterId) {
    next.characterId = block.characterId;
  }
  return next;
}

export function migrateProjectCharacters(project: Project): Project {
  const registry = createNameRegistry(normalizeProjectCharacters(project.characters));
  const validIds = () => new Set(registry.characters.map((entry) => entry.id));

  const scripts = project.scripts.map((script) => ({
    ...script,
    scenes: script.scenes.map((scene) => {
      const legacyNames = readLegacySceneNames(scene as LegacySceneShape);
      const characterIds = normalizeCharacterIds((scene as LegacySceneShape).characterIds);

      for (const name of legacyNames) {
        uniquePushId(characterIds, ensureNameInRegistry(registry, name));
      }

      const blocks: SceneBlock[] = scene.blocks.map((block) => {
        if (block.type !== "dialogue") {
          return block;
        }
        const legacy = block as DialogueBlock & LegacyDialogueShape;
        let characterId = resolveDialogueCharacterId(registry, legacy, validIds());
        if (characterId) {
          uniquePushId(characterIds, characterId);
        } else if (typeof legacy.character === "string") {
          const name = legacy.character.trim();
          if (name) {
            characterId = ensureNameInRegistry(registry, name);
            uniquePushId(characterIds, characterId);
          }
        }
        return stripDialogueBlock({
          ...legacy,
          characterId,
        });
      });

      return {
        id: scene.id,
        title: scene.title,
        outline: normalizeSceneOutline(scene.outline),
        characterIds,
        blocks,
      };
    }),
  }));

  return normalizeProjectCharacterReferences({
    ...project,
    characters: registry.characters,
    scripts,
  });
}

export function normalizeProjectCharacterReferences(project: Project): Project {
  const characters = normalizeProjectCharacters(project.characters);
  const validIds = new Set(characters.map((entry) => entry.id));

  const scripts = project.scripts.map((script) => ({
    ...script,
    scenes: script.scenes.map((scene) => {
      const characterIds = normalizeCharacterIds(scene.characterIds).filter((id) =>
        validIds.has(id),
      );
      const characterIdSet = new Set(characterIds);
      const blocks = scene.blocks.map((block) => {
        if (block.type !== "dialogue") return block;
        const characterId =
          block.characterId && validIds.has(block.characterId) ? block.characterId : undefined;
        if (characterId) {
          characterIdSet.add(characterId);
        }
        return stripDialogueBlock({ ...block, characterId });
      });
      return {
        id: scene.id,
        title: scene.title,
        outline: normalizeSceneOutline(scene.outline),
        characterIds: normalizeCharacterIds([...characterIdSet]),
        blocks,
      };
    }),
  }));

  return { ...project, characters, scripts };
}

export function ensureGlobalCharacterInProject(project: Project, name: string): {
  project: Project;
  characterId: string;
} {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Character name cannot be empty.");
  }
  const existing = project.characters.find((entry) => entry.name.trim() === trimmed);
  if (existing) {
    return { project, characterId: existing.id };
  }
  const created = createCharacter(trimmed, { existingCharacters: project.characters });
  return {
    project: {
      ...project,
      characters: [...project.characters, created],
    },
    characterId: created.id,
  };
}

export interface ExportDialogueBlock {
  id: string;
  type: "dialogue";
  text: string;
  character?: string;
}

export interface ExportScene {
  id: string;
  title: string;
  blocks: Array<
    | { id: string; type: "narrative"; text: string }
    | ExportDialogueBlock
  >;
}

/** Resolve characterId to display names for docx export payload. */
export function sceneToExportScene(scene: Scene, project: Project): ExportScene {
  return {
    id: scene.id,
    title: scene.title,
    blocks: scene.blocks.map((block) => {
      if (block.type === "narrative") {
        return block;
      }
      const speaker = getCharacterName(project, block.characterId);
      return {
        id: block.id,
        type: "dialogue" as const,
        text: block.text,
        ...(speaker ? { character: speaker } : {}),
      };
    }),
  };
}
