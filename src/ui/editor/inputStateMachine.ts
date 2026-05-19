import type { DialogueBlock, NarrativeBlock, SceneBlock } from "../../domain/model";

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createNarrativeBlock(text = ""): NarrativeBlock {
  return {
    id: randomId(),
    type: "narrative",
    text,
  };
}

export function createDialogueBlock(character?: string, text = ""): DialogueBlock {
  return {
    id: randomId(),
    type: "dialogue",
    character: character?.trim() ? character : undefined,
    text,
  };
}

function uniquePush(list: string[], value: string): void {
  if (!value.trim()) {
    return;
  }
  if (!list.includes(value)) {
    list.push(value);
  }
}

export function collectSceneCharacters(blocks: SceneBlock[], seedCharacters: string[]): string[] {
  const characters: string[] = [];
  for (const value of seedCharacters) {
    uniquePush(characters, value.trim());
  }

  for (const block of blocks) {
    if (block.type === "dialogue" && block.character) {
      uniquePush(characters, block.character.trim());
    }
  }
  return characters;
}

export function predictNextCharacter(
  blocks: SceneBlock[],
  sceneCharacters: string[],
  globalCharacters: string[],
): string[] {
  const dialogueSpeakers = blocks
    .filter((block): block is DialogueBlock => block.type === "dialogue")
    .map((block) => (block.character ?? "").trim())
    .filter((name) => name.length > 0);

  const candidates: string[] = [];
  const lastSpeaker = dialogueSpeakers.at(-1);

  if (lastSpeaker) {
    const opposingSpeaker = [...dialogueSpeakers].reverse().find((speaker) => speaker !== lastSpeaker);
    if (opposingSpeaker) {
      candidates.push(opposingSpeaker);
    }

    if (dialogueSpeakers.length >= 3) {
      const a = dialogueSpeakers[dialogueSpeakers.length - 3];
      const b = dialogueSpeakers[dialogueSpeakers.length - 2];
      const c = dialogueSpeakers[dialogueSpeakers.length - 1];
      if (a === c && b !== c) {
        candidates.push(b);
      }
    }

    if (dialogueSpeakers.length >= 2) {
      const previous = dialogueSpeakers[dialogueSpeakers.length - 2];
      if (previous !== lastSpeaker) {
        candidates.push(previous);
      }
    }
  }

  for (const character of sceneCharacters) {
    candidates.push(character);
  }
  for (const character of globalCharacters) {
    candidates.push(character);
  }

  const unique: string[] = [];
  for (const value of candidates) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }

  return unique;
}
