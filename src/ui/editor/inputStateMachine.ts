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

export function createDialogueBlock(characterId?: string, text = ""): DialogueBlock {
  return {
    id: randomId(),
    type: "dialogue",
    characterId: characterId?.trim() ? characterId : undefined,
    text,
  };
}

function uniquePushId(list: string[], value: string): void {
  if (!value.trim()) {
    return;
  }
  if (!list.includes(value)) {
    list.push(value);
  }
}

export function collectSceneCharacterIds(
  blocks: SceneBlock[],
  seedCharacterIds: string[],
): string[] {
  const characterIds: string[] = [];
  for (const value of seedCharacterIds) {
    uniquePushId(characterIds, value.trim());
  }

  for (const block of blocks) {
    if (block.type === "dialogue" && block.characterId) {
      uniquePushId(characterIds, block.characterId.trim());
    }
  }
  return characterIds;
}

export function predictNextCharacterId(
  blocks: SceneBlock[],
  sceneCharacterIds: string[],
  globalCharacterIds: string[],
): string[] {
  const dialogueSpeakers = blocks
    .filter((block): block is DialogueBlock => block.type === "dialogue")
    .map((block) => (block.characterId ?? "").trim())
    .filter((id) => id.length > 0);

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

  for (const characterId of sceneCharacterIds) {
    candidates.push(characterId);
  }
  for (const characterId of globalCharacterIds) {
    candidates.push(characterId);
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
