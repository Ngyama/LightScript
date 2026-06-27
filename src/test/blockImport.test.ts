import { describe, expect, test } from "vitest";
import {
  buildSegmentsFromPaste,
  classifyImportedLine,
  insertPasteIntoBlocks,
  parseMarkdownImport,
  splitImportText,
} from "../domain/blockImport";
import { createNarrativeBlock } from "../ui/editor/inputStateMachine";

describe("blockImport", () => {
  test("classifies quoted lines as dialogue without speaker", () => {
    expect(classifyImportedLine("「你来了。」")).toEqual({
      type: "dialogue",
      text: "你来了。",
    });
    expect(
      classifyImportedLine("\u201C你来了。\u201D", { preserveDialogueQuotes: true }),
    ).toEqual({
      type: "dialogue",
      text: "「你来了。」",
    });
    expect(classifyImportedLine("天色渐暗。")).toEqual({
      type: "narrative",
      text: "天色渐暗。",
    });
  });

  test("classifies markdown speaker lines as dialogue text only", () => {
    expect(classifyImportedLine("**甲**: 你好")).toEqual({
      type: "dialogue",
      text: "你好",
    });
    expect(classifyImportedLine("**甲**: 「你好」")).toEqual({
      type: "dialogue",
      text: "你好",
    });
    expect(classifyImportedLine("> 台词一行")).toEqual({
      type: "dialogue",
      text: "台词一行",
    });
  });

  test("splits paste text into trimmed non-empty lines", () => {
    expect(splitImportText("a\n\nb\r\nc")).toEqual(["a", "b", "c"]);
  });

  test("builds multiline paste segments with prefix and suffix", () => {
    expect(buildSegmentsFromPaste("前缀，", ["「你好。」", "他又走了。"], "")).toEqual([
      { type: "narrative", text: "前缀，" },
      { type: "dialogue", text: "「你好。」" },
      { type: "narrative", text: "他又走了。" },
    ]);
  });

  test("inserts pasted lines at cursor as multiple blocks", () => {
    const blocks = [createNarrativeBlock("开头")];
    const result = insertPasteIntoBlocks(blocks, 0, "开头", "", "「台词。」\n旁白。");
    expect(result?.blocks).toHaveLength(3);
    expect(result?.blocks[0]).toMatchObject({ type: "narrative", text: "开头" });
    expect(result?.blocks[1]).toMatchObject({ type: "dialogue", text: "「台词。」" });
    expect(result?.blocks[2]).toMatchObject({ type: "narrative", text: "旁白。" });
  });

  test("parses markdown export shape", () => {
    const parsed = parseMarkdownImport(`# Scene 2

天色渐暗。

> 你来了。

**甲**: 嗯。`);
    expect(parsed.sceneTitle).toBe("Scene 2");
    expect(parsed.blocks).toEqual([
      { id: expect.any(String), type: "narrative", text: "天色渐暗。" },
      { id: expect.any(String), type: "dialogue", characterId: undefined, text: "你来了。" },
      { id: expect.any(String), type: "dialogue", characterId: undefined, text: "嗯。" },
    ]);
  });
});
