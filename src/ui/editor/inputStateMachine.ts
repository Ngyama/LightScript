import type { SceneBlock } from "../../domain/model";

export interface EditorState {
  mode: "character" | "dialogue" | "narrative";
  currentCharacter?: string;
}

export type InsertBlockType = "character" | "dialogue" | "narrative";

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createNarrativeBlock(text = ""): SceneBlock {
  return {
    id: randomId(),
    type: "narrative",
    text,
  };
}

export function createCharacterBlock(character = ""): SceneBlock {
  return {
    id: randomId(),
    type: "character",
    character,
  };
}

export function createDialogueBlock(character = "", text = ""): SceneBlock {
  return {
    id: randomId(),
    type: "dialogue",
    character,
    text,
  };
}

export function createBlockByType(type: InsertBlockType, characterHint?: string): SceneBlock {
  if (type === "character") {
    return createCharacterBlock(characterHint ?? "");
  }
  if (type === "dialogue") {
    return createDialogueBlock(characterHint ?? "", "");
  }
  return createNarrativeBlock();
}

export function blockToInputValue(block: SceneBlock): string {
  if (block.type === "character") {
    return block.character;
  }
  if (block.type === "dialogue") {
    return block.text;
  }
  return block.text;
}

export function updateBlockFromInput(block: SceneBlock, rawInput: string): { block: SceneBlock; state: EditorState } {
  const normalizedInput = rawInput.replace(/\r/g, "");
  if (block.type === "character") {
    const character = normalizedInput.trim();
    return {
      block: {
        ...block,
        character,
      },
      state: {
        mode: "character",
        currentCharacter: character || undefined,
      },
    };
  }

  if (block.type === "dialogue") {
    return {
      block: {
        ...block,
        text: normalizedInput,
      },
      state: {
        mode: "dialogue",
        currentCharacter: block.character,
      },
    };
  }

  return {
    block: {
      text: normalizedInput,
      id: block.id,
      type: "narrative",
    },
    state: {
      mode: "narrative",
    },
  };
}

export function stateAfterEnter(lastBlock: SceneBlock | undefined): EditorState {
  if (lastBlock?.type === "dialogue") {
    return {
      mode: "character",
      currentCharacter: lastBlock.character,
    };
  }
  if (lastBlock?.type === "character") {
    return {
      mode: "dialogue",
      currentCharacter: lastBlock.character,
    };
  }
  return { mode: "narrative" };
}

export function autoNextType(currentType: InsertBlockType): InsertBlockType {
  if (currentType === "character") {
    return "dialogue";
  }
  if (currentType === "dialogue") {
    return "character";
  }
  return "narrative";
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
    if (block.type === "character") {
      uniquePush(characters, block.character.trim());
    }
    if (block.type === "dialogue") {
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
    .filter((block): block is Extract<SceneBlock, { type: "dialogue" }> => block.type === "dialogue")
    .map((block) => block.character.trim())
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
