import { describe, expect, it } from "vitest";
import { computeSceneStats } from "../ui/editor/sceneStats";
import { createDialogueBlock, createNarrativeBlock } from "../ui/editor/inputStateMachine";

describe("computeSceneStats", () => {
  it("counts characters without whitespace and lines across narrative blocks", () => {
    const blocks = [
      { ...createNarrativeBlock(), text: "hello world" },
      { ...createNarrativeBlock(), text: "第二行" },
    ];
    expect(computeSceneStats(blocks)).toEqual({ charCount: 13, lineCount: 2 });
  });

  it("returns one line for a single empty block", () => {
    expect(computeSceneStats([createNarrativeBlock()])).toEqual({ charCount: 0, lineCount: 1 });
  });

  it("returns zero when blocks list is empty", () => {
    expect(computeSceneStats([])).toEqual({ charCount: 0, lineCount: 0 });
  });

  it("counts dialogue text but strips the 「」 brackets", () => {
    const blocks = [
      { ...createDialogueBlock("A"), text: "「你好」" },
      { ...createDialogueBlock("B"), text: "「世界」" },
    ];
    expect(computeSceneStats(blocks)).toEqual({ charCount: 4, lineCount: 2 });
  });

  it("treats an empty dialogue scaffold 「」 as 0 chars but 1 line", () => {
    expect(computeSceneStats([{ ...createDialogueBlock("A"), text: "「」" }])).toEqual({
      charCount: 0,
      lineCount: 1,
    });
  });

  it("mixes narrative and dialogue blocks", () => {
    const blocks = [
      { ...createNarrativeBlock(), text: "夜色下街灯亮起。" },
      { ...createDialogueBlock("A"), text: "「真冷啊」" },
      { ...createDialogueBlock("B"), text: "「快回家吧」" },
    ];
    expect(computeSceneStats(blocks)).toEqual({ charCount: 15, lineCount: 3 });
  });

  it("counts inner newlines inside dialogue text", () => {
    const blocks = [{ ...createDialogueBlock("A"), text: "「第一行\n第二行」" }];
    expect(computeSceneStats(blocks)).toEqual({ charCount: 6, lineCount: 2 });
  });
});
