import type { SceneBlock } from "../../domain/model";
import { createNarrativeBlock } from "./inputStateMachine";

export type BlockLineSelection = {
  anchorBlockId: string;
  focusBlockId: string;
  /** Whole-line selection when anchor and focus are the same block, or multi-block range. */
  selectSingleLine: boolean;
};

export type NormalizedBlockLineRange = {
  startIndex: number;
  endIndex: number;
};

export function findBlockIndex(blocks: SceneBlock[], blockId: string): number {
  return blocks.findIndex((block) => block.id === blockId);
}

export function normalizeBlockLineRange(
  blocks: SceneBlock[],
  selection: Pick<BlockLineSelection, "anchorBlockId" | "focusBlockId">,
): NormalizedBlockLineRange | null {
  const anchorIndex = findBlockIndex(blocks, selection.anchorBlockId);
  const focusIndex = findBlockIndex(blocks, selection.focusBlockId);
  if (anchorIndex === -1 || focusIndex === -1) {
    return null;
  }

  if (anchorIndex <= focusIndex) {
    return { startIndex: anchorIndex, endIndex: focusIndex };
  }
  return { startIndex: focusIndex, endIndex: anchorIndex };
}

export function hasBlockLineSelection(
  blocks: SceneBlock[],
  selection: BlockLineSelection | null,
): boolean {
  if (!selection) {
    return false;
  }
  const normalized = normalizeBlockLineRange(blocks, selection);
  if (!normalized) {
    return false;
  }
  if (normalized.startIndex !== normalized.endIndex) {
    return true;
  }
  return selection.selectSingleLine;
}

export function getBlockRangeHighlightState(
  blocks: SceneBlock[],
  selection: BlockLineSelection | null,
  blockId: string,
): "none" | "full" {
  if (!hasBlockLineSelection(blocks, selection)) {
    return "none";
  }
  const normalized = normalizeBlockLineRange(blocks, selection!);
  if (!normalized) {
    return "none";
  }

  const index = findBlockIndex(blocks, blockId);
  if (index === -1) {
    return "none";
  }

  return index >= normalized.startIndex && index <= normalized.endIndex ? "full" : "none";
}

export function deleteBlockLineRange(
  blocks: SceneBlock[],
  selection: BlockLineSelection,
): { blocks: SceneBlock[]; focusBlockId: string; focusCaret: number; insertIndex: number } | null {
  if (!hasBlockLineSelection(blocks, selection)) {
    return null;
  }

  const normalized = normalizeBlockLineRange(blocks, selection);
  if (!normalized) {
    return null;
  }

  const { startIndex, endIndex } = normalized;
  const removeCount = endIndex - startIndex + 1;
  if (removeCount <= 0) {
    return null;
  }

  if (blocks.length <= 1 && removeCount >= 1) {
    return null;
  }

  if (removeCount >= blocks.length) {
    const fallback = createNarrativeBlock("");
    return { blocks: [fallback], focusBlockId: fallback.id, focusCaret: 0, insertIndex: 0 };
  }

  const nextBlocks = [...blocks.slice(0, startIndex), ...blocks.slice(endIndex + 1)];
  const focusIndex = Math.min(startIndex, nextBlocks.length - 1);
  const focusBlock = nextBlocks[focusIndex];

  return {
    blocks: nextBlocks,
    focusBlockId: focusBlock.id,
    focusCaret: focusBlock.text.length,
    insertIndex: startIndex,
  };
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

export function hitTestBlockField(
  blocks: SceneBlock[],
  inputRefs: Record<string, FieldElement | null>,
  clientX: number,
  clientY: number,
): { blockId: string } | null {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element) {
    return null;
  }

  let node: Element | null = element;
  while (node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      for (const block of blocks) {
        if (inputRefs[block.id] === node) {
          return { blockId: block.id };
        }
      }
    }
    node = node.parentElement;
  }

  return null;
}
