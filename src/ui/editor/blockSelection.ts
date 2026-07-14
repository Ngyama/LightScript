import type { SceneBlock } from "../../domain/model";
import { createNarrativeBlock } from "./inputStateMachine";

export const DIALOGUE_OPEN = "「";
export const DIALOGUE_CLOSE = "」";
export const DIALOGUE_SCAFFOLD = `${DIALOGUE_OPEN}${DIALOGUE_CLOSE}`;

export type BlockTextPoint = {
  blockId: string;
  /** Editable content offset (dialogue body only; excludes 「」). */
  offset: number;
};

export type BlockTextSelection = {
  anchor: BlockTextPoint;
  focus: BlockTextPoint;
};

export type NormalizedBlockTextRange = {
  startBlockIndex: number;
  startOffset: number;
  endBlockIndex: number;
  endOffset: number;
};

export type BlockHighlight =
  | { type: "none" }
  | { type: "range"; start: number; end: number };

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

export function findBlockIndex(blocks: SceneBlock[], blockId: string): number {
  return blocks.findIndex((block) => block.id === blockId);
}

export function hasDialogueScaffold(text: string): boolean {
  return text.startsWith(DIALOGUE_OPEN) && text.endsWith(DIALOGUE_CLOSE) && text.length >= 2;
}

export function getBlockEditableText(block: SceneBlock): string {
  if (block.type === "dialogue" && hasDialogueScaffold(block.text)) {
    return block.text.slice(1, -1);
  }
  return block.text;
}

export function replaceBlockEditableText(block: SceneBlock, editableText: string): SceneBlock {
  if (block.type === "dialogue") {
    return { ...block, text: `${DIALOGUE_OPEN}${editableText}${DIALOGUE_CLOSE}` };
  }
  return { ...block, text: editableText };
}

export function domOffsetToEditableOffset(block: SceneBlock, domOffset: number): number {
  const editable = getBlockEditableText(block);
  if (block.type === "dialogue" && hasDialogueScaffold(block.text)) {
    return Math.max(0, Math.min(editable.length, domOffset - 1));
  }
  return Math.max(0, Math.min(editable.length, domOffset));
}

export function editableOffsetToDomOffset(block: SceneBlock, editableOffset: number): number {
  const editable = getBlockEditableText(block);
  const clamped = Math.max(0, Math.min(editable.length, editableOffset));
  if (block.type === "dialogue" && hasDialogueScaffold(block.text)) {
    return clamped + 1;
  }
  return clamped;
}

export function clampEditableOffset(block: SceneBlock, offset: number): number {
  const editable = getBlockEditableText(block);
  return Math.max(0, Math.min(editable.length, offset));
}

export function normalizeBlockTextRange(
  blocks: SceneBlock[],
  selection: BlockTextSelection,
): NormalizedBlockTextRange | null {
  const anchorIndex = findBlockIndex(blocks, selection.anchor.blockId);
  const focusIndex = findBlockIndex(blocks, selection.focus.blockId);
  if (anchorIndex === -1 || focusIndex === -1) {
    return null;
  }

  const anchorOffset = clampEditableOffset(blocks[anchorIndex], selection.anchor.offset);
  const focusOffset = clampEditableOffset(blocks[focusIndex], selection.focus.offset);

  if (anchorIndex < focusIndex) {
    return {
      startBlockIndex: anchorIndex,
      startOffset: anchorOffset,
      endBlockIndex: focusIndex,
      endOffset: focusOffset,
    };
  }
  if (anchorIndex > focusIndex) {
    return {
      startBlockIndex: focusIndex,
      startOffset: focusOffset,
      endBlockIndex: anchorIndex,
      endOffset: anchorOffset,
    };
  }

  const startOffset = Math.min(anchorOffset, focusOffset);
  const endOffset = Math.max(anchorOffset, focusOffset);
  return {
    startBlockIndex: anchorIndex,
    startOffset,
    endBlockIndex: focusIndex,
    endOffset,
  };
}

export function hasBlockTextSelection(
  blocks: SceneBlock[],
  selection: BlockTextSelection | null,
): boolean {
  if (!selection) {
    return false;
  }
  const normalized = normalizeBlockTextRange(blocks, selection);
  if (!normalized) {
    return false;
  }
  if (normalized.startBlockIndex !== normalized.endBlockIndex) {
    return true;
  }
  return normalized.startOffset !== normalized.endOffset;
}

/** True once the pointer has moved onto a different block than the press target. */
export function shouldActivateVirtualSelection(
  anchorBlockId: string,
  focusBlockId: string,
): boolean {
  return anchorBlockId !== focusBlockId;
}

export function getBlockHighlightRange(
  blocks: SceneBlock[],
  selection: BlockTextSelection | null,
  blockId: string,
): BlockHighlight {
  if (!hasBlockTextSelection(blocks, selection)) {
    return { type: "none" };
  }
  const normalized = normalizeBlockTextRange(blocks, selection!);
  if (!normalized) {
    return { type: "none" };
  }

  const index = findBlockIndex(blocks, blockId);
  if (index === -1) {
    return { type: "none" };
  }
  if (index < normalized.startBlockIndex || index > normalized.endBlockIndex) {
    return { type: "none" };
  }

  const editableLength = getBlockEditableText(blocks[index]).length;
  if (normalized.startBlockIndex === normalized.endBlockIndex) {
    return {
      type: "range",
      start: normalized.startOffset,
      end: normalized.endOffset,
    };
  }
  if (index === normalized.startBlockIndex) {
    return { type: "range", start: normalized.startOffset, end: editableLength };
  }
  if (index === normalized.endBlockIndex) {
    return { type: "range", start: 0, end: normalized.endOffset };
  }
  return { type: "range", start: 0, end: editableLength };
}

export function getBlockTextRangeText(
  blocks: SceneBlock[],
  selection: BlockTextSelection,
): string | null {
  if (!hasBlockTextSelection(blocks, selection)) {
    return null;
  }
  const normalized = normalizeBlockTextRange(blocks, selection);
  if (!normalized) {
    return null;
  }

  const parts: string[] = [];
  for (let index = normalized.startBlockIndex; index <= normalized.endBlockIndex; index += 1) {
    const editable = getBlockEditableText(blocks[index]);
    if (normalized.startBlockIndex === normalized.endBlockIndex) {
      parts.push(editable.slice(normalized.startOffset, normalized.endOffset));
      continue;
    }
    if (index === normalized.startBlockIndex) {
      parts.push(editable.slice(normalized.startOffset));
      continue;
    }
    if (index === normalized.endBlockIndex) {
      parts.push(editable.slice(0, normalized.endOffset));
      continue;
    }
    parts.push(editable);
  }
  return parts.join("\n");
}

export function deleteBlockTextRange(
  blocks: SceneBlock[],
  selection: BlockTextSelection,
): {
  blocks: SceneBlock[];
  focusBlockId: string;
  focusEditableOffset: number;
} | null {
  if (!hasBlockTextSelection(blocks, selection)) {
    return null;
  }
  const normalized = normalizeBlockTextRange(blocks, selection);
  if (!normalized) {
    return null;
  }

  const { startBlockIndex, startOffset, endBlockIndex, endOffset } = normalized;

  if (startBlockIndex === endBlockIndex) {
    const block = blocks[startBlockIndex];
    const editable = getBlockEditableText(block);
    const nextEditable = `${editable.slice(0, startOffset)}${editable.slice(endOffset)}`;
    const nextBlock = replaceBlockEditableText(block, nextEditable);
    const nextBlocks = [...blocks];
    nextBlocks[startBlockIndex] = nextBlock;
    return {
      blocks: nextBlocks,
      focusBlockId: nextBlock.id,
      focusEditableOffset: startOffset,
    };
  }

  const startBlock = blocks[startBlockIndex];
  const endBlock = blocks[endBlockIndex];
  const startEditable = getBlockEditableText(startBlock);
  const endEditable = getBlockEditableText(endBlock);
  const nextStart = replaceBlockEditableText(startBlock, startEditable.slice(0, startOffset));
  const nextEnd = replaceBlockEditableText(endBlock, endEditable.slice(endOffset));

  const nextBlocks = [
    ...blocks.slice(0, startBlockIndex),
    nextStart,
    nextEnd,
    ...blocks.slice(endBlockIndex + 1),
  ];

  if (nextBlocks.length === 0) {
    const fallback = createNarrativeBlock("");
    return {
      blocks: [fallback],
      focusBlockId: fallback.id,
      focusEditableOffset: 0,
    };
  }

  return {
    blocks: nextBlocks,
    focusBlockId: nextStart.id,
    focusEditableOffset: startOffset,
  };
}

export function insertEditableTextAt(
  block: SceneBlock,
  editableOffset: number,
  text: string,
): SceneBlock {
  const editable = getBlockEditableText(block);
  const offset = clampEditableOffset(block, editableOffset);
  return replaceBlockEditableText(
    block,
    `${editable.slice(0, offset)}${text}${editable.slice(offset)}`,
  );
}

/** Convert editable before/after into raw field spans for insertPasteIntoBlocks. */
export function toPasteFieldSlices(
  block: SceneBlock,
  editableBefore: string,
  editableAfter: string,
): { before: string; after: string } {
  if (block.type === "dialogue") {
    return {
      before: `${DIALOGUE_OPEN}${editableBefore}`,
      after: `${editableAfter}${DIALOGUE_CLOSE}`,
    };
  }
  return { before: editableBefore, after: editableAfter };
}

export function measureCaretLeft(element: FieldElement): number {
  const cs = window.getComputedStyle(element);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const fontParts = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily]
    .filter(Boolean)
    .join(" ");
  ctx.font = fontParts;
  const caretIndex = element.selectionEnd ?? element.value.length;
  const value = element.value;
  const lineStart = value.lastIndexOf("\n", caretIndex - 1) + 1;
  const sliced = value.slice(lineStart, caretIndex);
  const paddingLeft = parseFloat(cs.paddingLeft || "0");
  return paddingLeft + ctx.measureText(sliced).width;
}

export function findClosestCaretIndexInRange(
  element: FieldElement,
  targetX: number,
  start: number,
  end: number,
): number {
  const cs = window.getComputedStyle(element);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return start;
  const fontParts = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily]
    .filter(Boolean)
    .join(" ");
  ctx.font = fontParts;
  const paddingLeft = parseFloat(cs.paddingLeft || "0");
  const text = element.value;
  let bestIdx = start;
  let bestDelta = Math.abs(paddingLeft - targetX);
  for (let i = start + 1; i <= end; i++) {
    const slice = text.slice(start, i);
    const width = paddingLeft + ctx.measureText(slice).width;
    const delta = Math.abs(width - targetX);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function caretDomOffsetFromPoint(
  element: FieldElement,
  clientX: number,
  clientY: number,
): number {
  const rect = element.getBoundingClientRect();
  const cs = window.getComputedStyle(element);
  const paddingLeft = parseFloat(cs.paddingLeft || "0");
  const paddingTop = parseFloat(cs.paddingTop || "0");
  const fontSize = parseFloat(cs.fontSize || "16");
  const lineHeightRaw = cs.lineHeight;
  const lineHeight =
    lineHeightRaw === "normal" || !lineHeightRaw ? fontSize * 1.6 : parseFloat(lineHeightRaw);
  const x = clientX - rect.left;
  const y = clientY - rect.top - paddingTop + element.scrollTop;
  const value = element.value;

  if (element.tagName === "TEXTAREA" && value.includes("\n")) {
    const lines = value.split("\n");
    let lineIndex = Math.floor(Math.max(0, y) / Math.max(lineHeight, 1));
    lineIndex = Math.max(0, Math.min(lines.length - 1, lineIndex));
    let start = 0;
    for (let i = 0; i < lineIndex; i += 1) {
      start += lines[i].length + 1;
    }
    const end = start + lines[lineIndex].length;
    return findClosestCaretIndexInRange(element, Math.max(paddingLeft, x), start, end);
  }

  return findClosestCaretIndexInRange(element, Math.max(paddingLeft, x), 0, value.length);
}

export function hitTestBlockField(
  blocks: SceneBlock[],
  inputRefs: Record<string, FieldElement | null>,
  clientX: number,
  clientY: number,
): { blockId: string } | null {
  const point = hitTestBlockTextPoint(blocks, inputRefs, clientX, clientY);
  return point ? { blockId: point.blockId } : null;
}

export function hitTestBlockTextPoint(
  blocks: SceneBlock[],
  inputRefs: Record<string, FieldElement | null>,
  clientX: number,
  clientY: number,
): BlockTextPoint | null {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element) {
    return null;
  }

  let node: Element | null = element;
  while (node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      for (const block of blocks) {
        if (inputRefs[block.id] === node) {
          const domOffset = caretDomOffsetFromPoint(node, clientX, clientY);
          return {
            blockId: block.id,
            offset: domOffsetToEditableOffset(block, domOffset),
          };
        }
      }
    }
    node = node.parentElement;
  }

  // Fall back to nearest field by vertical position when the pointer sits in gutters/padding.
  let best: { blockId: string; distance: number; offset: number } | null = null;
  for (const block of blocks) {
    const field = inputRefs[block.id];
    if (!field) continue;
    const rect = field.getBoundingClientRect();
    if (clientY < rect.top - 8 || clientY > rect.bottom + 8) {
      continue;
    }
    const midY = (rect.top + rect.bottom) / 2;
    const distance = Math.abs(clientY - midY);
    const domOffset = caretDomOffsetFromPoint(field, clientX, clientY);
    const offset = domOffsetToEditableOffset(block, domOffset);
    if (!best || distance < best.distance) {
      best = { blockId: block.id, distance, offset };
    }
  }
  return best ? { blockId: best.blockId, offset: best.offset } : null;
}

export function readEditableOffsetFromField(
  block: SceneBlock,
  field: FieldElement,
  prefer: "start" | "end" = "start",
): number {
  const domOffset =
    prefer === "end"
      ? (field.selectionEnd ?? field.value.length)
      : (field.selectionStart ?? 0);
  return domOffsetToEditableOffset(block, domOffset);
}
