import { describe, expect, test } from "vitest";
import {
  deleteBlockLineRange,
  getBlockRangeHighlightState,
  hasBlockLineSelection,
  normalizeBlockLineRange,
} from "../ui/editor/blockSelection";
import { createDialogueBlock, createNarrativeBlock } from "../ui/editor/inputStateMachine";

describe("blockSelection", () => {
  test("normalizes reversed line ranges", () => {
    const blocks = [createNarrativeBlock("aaa"), createNarrativeBlock("bbb")];
    expect(
      normalizeBlockLineRange(blocks, {
        anchorBlockId: blocks[1].id,
        focusBlockId: blocks[0].id,
      }),
    ).toEqual({ startIndex: 0, endIndex: 1 });
  });

  test("deletes whole blocks in range", () => {
    const blocks = [
      createNarrativeBlock("abcd"),
      createDialogueBlock(undefined, "「台词」"),
      createNarrativeBlock("efgh"),
    ];
    const result = deleteBlockLineRange(blocks, {
      anchorBlockId: blocks[0].id,
      focusBlockId: blocks[1].id,
      selectSingleLine: false,
    });
    expect(result?.blocks).toHaveLength(1);
    expect(result?.blocks[0]).toMatchObject({ text: "efgh" });
    expect(result?.insertIndex).toBe(0);
  });

  test("deletes middle lines and keeps surrounding blocks", () => {
    const blocks = [
      createNarrativeBlock("one"),
      createNarrativeBlock("two"),
      createNarrativeBlock("three"),
    ];
    const result = deleteBlockLineRange(blocks, {
      anchorBlockId: blocks[1].id,
      focusBlockId: blocks[1].id,
      selectSingleLine: true,
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks.map((block) => block.text)).toEqual(["one", "three"]);
    expect(result?.insertIndex).toBe(1);
  });

  test("highlights a single dragged line", () => {
    const blocks = [createNarrativeBlock("solo")];
    const selection = {
      anchorBlockId: blocks[0].id,
      focusBlockId: blocks[0].id,
      selectSingleLine: true,
    };
    expect(hasBlockLineSelection(blocks, selection)).toBe(true);
    expect(getBlockRangeHighlightState(blocks, selection, blocks[0].id)).toBe("full");
  });

  test("highlights every selected line", () => {
    const blocks = [
      createNarrativeBlock("line1"),
      createNarrativeBlock("line2"),
      createNarrativeBlock("line3"),
      createNarrativeBlock("line4"),
      createNarrativeBlock("line5"),
    ];
    const selection = {
      anchorBlockId: blocks[4].id,
      focusBlockId: blocks[0].id,
      selectSingleLine: false,
    };
    expect(hasBlockLineSelection(blocks, selection)).toBe(true);
    for (const block of blocks) {
      expect(getBlockRangeHighlightState(blocks, selection, block.id)).toBe("full");
    }
  });
});
