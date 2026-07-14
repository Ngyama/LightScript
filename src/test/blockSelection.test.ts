import { describe, expect, test } from "vitest";
import {
  DIALOGUE_SCAFFOLD,
  deleteBlockTextRange,
  domOffsetToEditableOffset,
  editableOffsetToDomOffset,
  getBlockEditableText,
  getBlockHighlightRange,
  getBlockTextRangeText,
  hasBlockTextSelection,
  normalizeBlockTextRange,
  replaceBlockEditableText,
  shouldActivateVirtualSelection,
} from "../ui/editor/blockSelection";
import { createDialogueBlock, createNarrativeBlock } from "../ui/editor/inputStateMachine";

describe("blockSelection adapters", () => {
  test("dialogue editable text strips scaffold", () => {
    const block = createDialogueBlock("c1", "「abcdef」");
    expect(getBlockEditableText(block)).toBe("abcdef");
    expect(replaceBlockEditableText(block, "abef").text).toBe("「abef」");
    expect(replaceBlockEditableText(block, "").text).toBe(DIALOGUE_SCAFFOLD);
  });

  test("dialogue DOM offset on 「 clamps to editable 0", () => {
    const block = createDialogueBlock(undefined, "「abcdef」");
    expect(domOffsetToEditableOffset(block, 0)).toBe(0);
    expect(domOffsetToEditableOffset(block, 1)).toBe(0);
  });

  test("dialogue DOM offset on 」 clamps to editable length", () => {
    const block = createDialogueBlock(undefined, "「abcdef」");
    expect(domOffsetToEditableOffset(block, 7)).toBe(6);
    expect(domOffsetToEditableOffset(block, 8)).toBe(6);
  });

  test("editable offset maps back to dialogue DOM caret", () => {
    const block = createDialogueBlock(undefined, "「abcdef」");
    expect(editableOffsetToDomOffset(block, 0)).toBe(1);
    expect(editableOffsetToDomOffset(block, 6)).toBe(7);
    expect(editableOffsetToDomOffset(block, 3)).toBe(4);
  });
});

describe("normalizeBlockTextRange", () => {
  test("narrative same-block partial range", () => {
    const blocks = [createNarrativeBlock("abcdef")];
    const normalized = normalizeBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 2 },
      focus: { blockId: blocks[0].id, offset: 5 },
    });
    expect(normalized).toEqual({
      startBlockIndex: 0,
      startOffset: 2,
      endBlockIndex: 0,
      endOffset: 5,
    });
  });

  test("dialogue same-block editable offsets", () => {
    const blocks = [createDialogueBlock(undefined, "「abcdef」")];
    const normalized = normalizeBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 1 },
      focus: { blockId: blocks[0].id, offset: 4 },
    });
    expect(normalized).toEqual({
      startBlockIndex: 0,
      startOffset: 1,
      endBlockIndex: 0,
      endOffset: 4,
    });
  });

  test("reverse cross-block selection", () => {
    const blocks = [
      createNarrativeBlock("aaa"),
      createNarrativeBlock("bbb"),
      createNarrativeBlock("cccccc"),
    ];
    const normalized = normalizeBlockTextRange(blocks, {
      anchor: { blockId: blocks[2].id, offset: 5 },
      focus: { blockId: blocks[0].id, offset: 2 },
    });
    expect(normalized).toEqual({
      startBlockIndex: 0,
      startOffset: 2,
      endBlockIndex: 2,
      endOffset: 5,
    });
  });

  test("reverse same-block offsets", () => {
    const blocks = [createNarrativeBlock("abcdef")];
    const normalized = normalizeBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 5 },
      focus: { blockId: blocks[0].id, offset: 2 },
    });
    expect(normalized?.startOffset).toBe(2);
    expect(normalized?.endOffset).toBe(5);
  });
});

describe("deleteBlockTextRange", () => {
  test("same-block dialogue partial delete keeps scaffold", () => {
    const blocks = [createDialogueBlock("hero", "「abcdef」")];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 2 },
      focus: { blockId: blocks[0].id, offset: 4 },
    });
    expect(result?.blocks[0]).toMatchObject({
      type: "dialogue",
      characterId: "hero",
      text: "「abef」",
    });
    expect(result?.focusEditableOffset).toBe(2);
  });

  test("deleting all dialogue body leaves 「」", () => {
    const blocks = [createDialogueBlock(undefined, "「abcdef」")];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: { blockId: blocks[0].id, offset: 6 },
    });
    expect(result?.blocks[0].text).toBe(DIALOGUE_SCAFFOLD);
  });

  test("narrative → dialogue cross-block delete does not merge", () => {
    const blocks = [
      createNarrativeBlock("abcDEF"),
      createDialogueBlock(undefined, "「GHIjkl」"),
    ];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 3 },
      focus: { blockId: blocks[1].id, offset: 3 },
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0]).toMatchObject({ type: "narrative", text: "abc" });
    expect(result?.blocks[1]).toMatchObject({ type: "dialogue", text: "「jkl」" });
  });

  test("dialogue → narrative cross-block delete keeps characterId", () => {
    const blocks = [
      createDialogueBlock("heroine", "「abcdef」"),
      createNarrativeBlock("GHIjkl"),
    ];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 3 },
      focus: { blockId: blocks[1].id, offset: 3 },
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0]).toMatchObject({
      type: "dialogue",
      characterId: "heroine",
      text: "「abc」",
    });
    expect(result?.blocks[1]).toMatchObject({ type: "narrative", text: "jkl" });
  });

  test("dialogue → dialogue cross-block delete does not merge", () => {
    const blocks = [
      createDialogueBlock("a", "「helloXYZ」"),
      createDialogueBlock("b", "「ABCworld」"),
    ];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 5 },
      focus: { blockId: blocks[1].id, offset: 3 },
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0]).toMatchObject({
      type: "dialogue",
      characterId: "a",
      text: "「hello」",
    });
    expect(result?.blocks[1]).toMatchObject({
      type: "dialogue",
      characterId: "b",
      text: "「world」",
    });
  });

  test("narrative → narrative cross-block delete does not merge", () => {
    const blocks = [createNarrativeBlock("abcDEF"), createNarrativeBlock("GHIjkl")];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 3 },
      focus: { blockId: blocks[1].id, offset: 3 },
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks.map((block) => block.text)).toEqual(["abc", "jkl"]);
  });

  test("deletes fully covered middle blocks", () => {
    const blocks = [
      createNarrativeBlock("aaBB"),
      createNarrativeBlock("middle"),
      createDialogueBlock(undefined, "「CCdd」"),
    ];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 2 },
      focus: { blockId: blocks[2].id, offset: 2 },
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0].text).toBe("aa");
    expect(result?.blocks[1].text).toBe("「dd」");
  });

  test("startOffset 0 and endOffset at editable length", () => {
    const blocks = [
      createNarrativeBlock("one"),
      createNarrativeBlock("two"),
      createNarrativeBlock("three"),
    ];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: { blockId: blocks[2].id, offset: getBlockEditableText(blocks[2]).length },
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0].text).toBe("");
    expect(result?.blocks[1].text).toBe("");
  });

  test("always keeps at least one block", () => {
    const blocks = [createNarrativeBlock("only")];
    const result = deleteBlockTextRange(blocks, {
      anchor: { blockId: blocks[0].id, offset: 0 },
      focus: { blockId: blocks[0].id, offset: 4 },
    });
    expect(result?.blocks).toHaveLength(1);
    expect(result?.blocks[0].text).toBe("");
  });
});

describe("getBlockTextRangeText", () => {
  test("cross-block copy excludes dialogue scaffold", () => {
    const blocks = [
      createNarrativeBlock("abcDEF"),
      createDialogueBlock(undefined, "「GHIjkl」"),
    ];
    const text = getBlockTextRangeText(blocks, {
      anchor: { blockId: blocks[0].id, offset: 3 },
      focus: { blockId: blocks[1].id, offset: 3 },
    });
    expect(text).toBe("DEF\nGHI");
  });
});

describe("highlight and virtual activation", () => {
  test("highlight uses editable ranges per block", () => {
    const blocks = [
      createNarrativeBlock("abcdef"),
      createDialogueBlock(undefined, "「uvwxyz」"),
    ];
    const selection = {
      anchor: { blockId: blocks[0].id, offset: 3 },
      focus: { blockId: blocks[1].id, offset: 2 },
    };
    expect(getBlockHighlightRange(blocks, selection, blocks[0].id)).toEqual({
      type: "range",
      start: 3,
      end: 6,
    });
    expect(getBlockHighlightRange(blocks, selection, blocks[1].id)).toEqual({
      type: "range",
      start: 0,
      end: 2,
    });
  });

  test("native same-block pointer does not activate virtual selection", () => {
    expect(shouldActivateVirtualSelection("a", "a")).toBe(false);
    expect(hasBlockTextSelection([createNarrativeBlock("x")], null)).toBe(false);
  });

  test("pointer activates virtual only after entering another block", () => {
    expect(shouldActivateVirtualSelection("a", "b")).toBe(true);
  });
});
