export type BlockType = "dialogue" | "narrative";

export interface NarrativeBlock {
  id: string;
  type: "narrative";
  text: string;
}

export interface DialogueBlock {
  id: string;
  type: "dialogue";
  character?: string;
  text: string;
}

export type SceneBlock = NarrativeBlock | DialogueBlock;

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
    if (block.character !== undefined && typeof block.character !== "string") {
      throw new Error("Dialogue block character must be string when present.");
    }
  }
}

function assertBlockReadyForExport(block: SceneBlock): void {
  if (block.type === "dialogue" && block.text.trim().length === 0) {
    throw new Error("Dialogue block must contain text.");
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
        if (block.type !== "narrative" && block.type !== "dialogue") {
          throw new Error("Scene block type must be narrative or dialogue.");
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

export function normalizeSceneCharacters(characters: unknown): string[] {
  if (!Array.isArray(characters)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of characters) {
    if (typeof raw !== "string") {
      continue;
    }
    const value = raw.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function toDialogueText(character: string | undefined, text: string): string {
  const speaker = character?.trim();
  if (!speaker) {
    return `“${text}”`;
  }
  return `${speaker}：“${text}”`;
}

export function sceneToPlainText(scene: Scene): string {
  const lines: string[] = [scene.title];

  for (const block of scene.blocks) {
    const text = block.text.trim();
    if (!text) continue;

    if (block.type === "narrative") {
      lines.push("", text);
      continue;
    }

    const speaker = block.character?.trim();
    lines.push("");
    if (speaker) {
      lines.push(`${speaker}：“${text}”`);
    } else {
      lines.push(`“${text}”`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function sceneToMarkdown(scene: Scene): string {
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
    const speaker = block.character?.trim();
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
  text?: unknown;
}

function migrateLegacyBlocks(rawBlocks: unknown): SceneBlock[] {
  const list = Array.isArray(rawBlocks) ? (rawBlocks as LegacyBlock[]) : [];
  const result: SceneBlock[] = [];

  for (let i = 0; i < list.length; i++) {
    const block = list[i] ?? {};
    const id = typeof block.id === "string" ? block.id : randomId();
    const text = typeof block.text === "string" ? block.text : "";
    const character = typeof block.character === "string" ? block.character : "";

    if (block.type === "action" || block.type === "narrative") {
      result.push({ id, type: "narrative", text });
      continue;
    }

    if (block.type === "character") {
      const next = list[i + 1] ?? {};
      const nextCharacter = typeof next.character === "string" ? next.character : "";
      const nextText = typeof next.text === "string" ? next.text : "";
      if (next.type === "dialogue") {
        const mergedCharacter = character || nextCharacter;
        result.push({
          id: typeof next.id === "string" ? next.id : id,
          type: "dialogue",
          character: mergedCharacter || undefined,
          text: nextText,
        });
        i += 1;
      } else {
        result.push({
          id,
          type: "dialogue",
          character: character || undefined,
          text: "",
        });
      }
      continue;
    }

    if (block.type === "dialogue") {
      result.push({
        id,
        type: "dialogue",
        character: character || undefined,
        text,
      });
      continue;
    }

    result.push({ id, type: "narrative", text });
  }

  return result;
}

export function parseProject(raw: string): Project {
  const parsed = JSON.parse(raw) as Project;
  for (const script of parsed.scripts ?? []) {
    for (const scene of script.scenes ?? []) {
      scene.characters = normalizeSceneCharacters(scene.characters);
      scene.blocks = migrateLegacyBlocks(scene.blocks);
    }
  }
  assertProjectInvariant(parsed);
  return parsed;
}
