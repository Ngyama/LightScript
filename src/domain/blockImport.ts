import type { BlockType, SceneBlock } from "./model";

export type ClassifiedSegment = {
  type: BlockType;
  text: string;
};

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const CN_OPEN_DOUBLE = "\u201C"; // “
const CN_CLOSE_DOUBLE = "\u201D"; // ”

const MD_SPEAKER_LINE = /^\*\*(.+?)\*\*:\s*(.+)$/;
const MD_BLOCKQUOTE_LINE = /^>\s*(.+)$/;

const FULL_QUOTE_WRAPPERS: Array<{ pattern: RegExp; kind: "corner" | "cn-curly" | "ascii" }> = [
  { pattern: /^「([\s\S]+)」$/, kind: "corner" },
  { pattern: /^『([\s\S]+)』$/, kind: "corner" },
  {
    pattern: new RegExp(`^${CN_OPEN_DOUBLE}([\\s\\S]+)${CN_CLOSE_DOUBLE}$`),
    kind: "cn-curly",
  },
  { pattern: /^"([\s\S]+)"$/, kind: "ascii" },
];

function matchFullQuoteWrapper(text: string): { inner: string; kind: "corner" | "cn-curly" | "ascii" } | null {
  const trimmed = text.trim();
  for (const entry of FULL_QUOTE_WRAPPERS) {
    const match = trimmed.match(entry.pattern);
    if (match) {
      return { inner: match[1], kind: entry.kind };
    }
  }
  return null;
}

/** Paste path: keep 「」; convert Chinese “…” (and ASCII "...") wrappers to corner quotes. */
export function normalizePasteDialogueQuotes(text: string): string {
  const trimmed = text.trim();
  const wrapped = matchFullQuoteWrapper(trimmed);
  if (!wrapped) {
    return trimmed;
  }
  if (wrapped.kind === "corner") {
    return trimmed;
  }
  return `「${wrapped.inner}」`;
}

export function stripDialogueQuoteWrapper(text: string): string {
  const wrapped = matchFullQuoteWrapper(text);
  if (wrapped) {
    return wrapped.inner;
  }
  return text.trim();
}

export function classifyImportedLine(
  line: string,
  options?: { preserveDialogueQuotes?: boolean },
): ClassifiedSegment | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const preserveQuotes = options?.preserveDialogueQuotes === true;

  const speakerMatch = trimmed.match(MD_SPEAKER_LINE);
  if (speakerMatch) {
    const raw = speakerMatch[2].trim();
    return {
      type: "dialogue",
      text: preserveQuotes ? normalizePasteDialogueQuotes(raw) : stripDialogueQuoteWrapper(raw),
    };
  }

  const blockquoteMatch = trimmed.match(MD_BLOCKQUOTE_LINE);
  if (blockquoteMatch) {
    const raw = blockquoteMatch[1].trim();
    return {
      type: "dialogue",
      text: preserveQuotes ? normalizePasteDialogueQuotes(raw) : stripDialogueQuoteWrapper(raw),
    };
  }

  const wrapped = matchFullQuoteWrapper(trimmed);
  if (wrapped) {
    return {
      type: "dialogue",
      text: preserveQuotes ? normalizePasteDialogueQuotes(trimmed) : wrapped.inner,
    };
  }

  return { type: "narrative", text: trimmed };
}

export function splitImportText(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function buildSegmentsFromPaste(
  before: string,
  pasteLines: string[],
  after: string,
): ClassifiedSegment[] {
  if (pasteLines.length === 0) {
    return [];
  }

  if (pasteLines.length === 1) {
    const merged = `${before}${pasteLines[0]}${after}`;
    const classified = classifyImportedLine(merged, { preserveDialogueQuotes: true });
    return classified ? [classified] : [];
  }

  const segments: ClassifiedSegment[] = [];
  if (before.trim()) {
    segments.push({ type: "narrative", text: before });
  }

  for (let index = 0; index < pasteLines.length; index += 1) {
    const isLast = index === pasteLines.length - 1;
    const lineText = isLast ? `${pasteLines[index]}${after}` : pasteLines[index];
    const classified = classifyImportedLine(lineText, { preserveDialogueQuotes: true });
    if (classified) {
      segments.push(classified);
    }
  }

  return segments;
}

export function segmentToSceneBlock(segment: ClassifiedSegment, id?: string): SceneBlock {
  if (segment.type === "dialogue") {
    return {
      id: id ?? randomId(),
      type: "dialogue",
      characterId: undefined,
      text: segment.text,
    };
  }
  return {
    id: id ?? randomId(),
    type: "narrative",
    text: segment.text,
  };
}

export function insertPasteIntoBlocks(
  blocks: SceneBlock[],
  blockIndex: number,
  before: string,
  after: string,
  pasteText: string,
): { blocks: SceneBlock[]; focusBlockId: string; focusCaret: number } | null {
  const current = blocks[blockIndex];
  if (!current) {
    return null;
  }

  const pasteLines = splitImportText(pasteText);
  if (pasteLines.length === 0) {
    return null;
  }

  const segments = buildSegmentsFromPaste(before, pasteLines, after);
  if (segments.length === 0) {
    return null;
  }

  const replacement = segments.map((segment, index) =>
    segmentToSceneBlock(segment, index === 0 ? current.id : undefined),
  );

  const nextBlocks = [
    ...blocks.slice(0, blockIndex),
    ...replacement,
    ...blocks.slice(blockIndex + 1),
  ];

  const focusBlock = replacement[replacement.length - 1];
  return {
    blocks: nextBlocks,
    focusBlockId: focusBlock.id,
    focusCaret: focusBlock.text.length,
  };
}

export function parseMarkdownImport(content: string): {
  sceneTitle?: string;
  blocks: SceneBlock[];
} {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let sceneTitle: string | undefined;
  const blocks: SceneBlock[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("# ")) {
      sceneTitle = line.slice(2).trim() || undefined;
      continue;
    }

    const classified = classifyImportedLine(line);
    if (classified) {
      blocks.push(segmentToSceneBlock(classified));
    }
  }

  return { sceneTitle, blocks };
}

export function mergeImportedBlocks(
  existing: SceneBlock[],
  imported: SceneBlock[],
  mode: "replace" | "append",
): SceneBlock[] {
  if (mode === "replace") {
    return imported.length > 0 ? imported : [segmentToSceneBlock({ type: "narrative", text: "" })];
  }
  if (imported.length === 0) {
    return existing;
  }
  return [...existing, ...imported];
}
