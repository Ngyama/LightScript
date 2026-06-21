import { describe, expect, test } from "vitest";
import { createDefaultProject } from "../domain/model";
import { buildSearchSnippet, searchProjectText } from "../domain/searchProject";

describe("searchProjectText", () => {
  test("finds matches in dialogue, narrative, and outline text", () => {
    const project = createDefaultProject();
    const scene = project.scripts[0].scenes[0];
    scene.outline = "主角登场";
    scene.blocks = [
      { id: "n1", type: "narrative", text: "雨夜，街道空无一人。" },
      { id: "d1", type: "dialogue", characterId: undefined, text: "你好，世界。" },
    ];

    const results = searchProjectText(project, "世界");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((entry) => entry.field === "dialogue" && entry.blockId === "d1")).toBe(true);
  });

  test("does not search character names separately from dialogue text", () => {
    const project = createDefaultProject();
    project.characters.push({ id: "hero", name: "男主" });
    const scene = project.scripts[0].scenes[0];
    scene.blocks = [
      { id: "d1", type: "dialogue", characterId: "hero", text: "早安。" },
    ];

    const results = searchProjectText(project, "男主");
    expect(results).toHaveLength(0);
  });

  test("returns snippet parts around the match", () => {
    const text = "这是一段很长的文本，用来测试搜索片段。";
    const matchStart = text.indexOf("文本");
    const snippet = buildSearchSnippet(text, matchStart, matchStart + 2);
    expect(snippet.match).toBe("文本");
    expect(snippet.before.length).toBeGreaterThan(0);
    expect(snippet.after.length).toBeGreaterThan(0);
  });
});
