import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../domain/model";
import { createDialogueBlock, createNarrativeBlock } from "../ui/editor/inputStateMachine";
import {
  buildBatchExportFileBase,
  buildMergedExportFileBase,
  filterSelectedExportItems,
  listSceneExportItems,
  mergeScenesToDocxPayload,
  mergeScenesToMarkdown,
  mergeScenesToPlainText,
  uniqueExportBaseName,
} from "../domain/exportScenes";

describe("exportScenes", () => {
  it("lists every scene with its parent script", () => {
    const project = createDefaultProject();
    const items = listSceneExportItems(project);
    expect(items).toHaveLength(1);
    expect(items[0]?.scene.title).toBe("Scene 1");
    expect(items[0]?.scriptTitle).toBeTruthy();
  });

  it("builds stable batch file bases from script and scene titles", () => {
    expect(buildBatchExportFileBase("第一章", "开场")).toBe("第一章 - 开场");
  });

  it("deduplicates colliding export base names", () => {
    const used = new Set<string>();
    expect(uniqueExportBaseName("Scene 1", used)).toBe("Scene 1");
    expect(uniqueExportBaseName("Scene 1", used)).toBe("Scene 1 (2)");
  });

  it("filters selected scenes in project order", () => {
    const project = createDefaultProject();
    const script = project.scripts[0]!;
    script.scenes.push({
      id: "s2",
      title: "Scene 2",
      location: "",
      outline: "",
      characterIds: [],
      blocks: [createNarrativeBlock("二")],
    });
    const items = listSceneExportItems(project);
    const selected = filterSelectedExportItems(items, new Set(["s2", script.scenes[0]!.id]));
    expect(selected.map((item) => item.scene.title)).toEqual(["Scene 1", "Scene 2"]);
  });

  it("names merged export after the shared script title", () => {
    const project = createDefaultProject();
    const items = listSceneExportItems(project);
    expect(buildMergedExportFileBase(items, "My Project")).toBe(
      items[0]!.scriptTitle.trim() || "script",
    );
  });

  it("merges markdown scenes with titles preserved", () => {
    const project = createDefaultProject();
    const heroId = project.characters[0]?.id;
    const sceneA = {
      id: "a",
      title: "开场",
      location: "",
      outline: "",
      characterIds: [] as string[],
      blocks: [createNarrativeBlock("天亮了。")],
    };
    const sceneB = {
      id: "b",
      title: "对峙",
      location: "",
      outline: "",
      characterIds: heroId ? [heroId] : [],
      blocks: [createDialogueBlock(heroId, "站住！")],
    };
    const md = mergeScenesToMarkdown([sceneA, sceneB], project);
    expect(md).toContain("# 开场");
    expect(md).toContain("天亮了。");
    expect(md).toContain("# 对峙");
    expect(md).toContain("站住！");
  });

  it("merges plain text scenes", () => {
    const project = createDefaultProject();
    const sceneA = {
      id: "a",
      title: "A",
      location: "",
      outline: "",
      characterIds: [] as string[],
      blocks: [createNarrativeBlock("one")],
    };
    const sceneB = {
      id: "b",
      title: "B",
      location: "",
      outline: "",
      characterIds: [] as string[],
      blocks: [createNarrativeBlock("two")],
    };
    const text = mergeScenesToPlainText([sceneA, sceneB], project);
    expect(text).toContain("A\n\none");
    expect(text).toContain("B\n\ntwo");
  });

  it("builds a multi-scene docx payload", () => {
    const project = createDefaultProject();
    const scenes = project.scripts[0]!.scenes;
    const payload = mergeScenesToDocxPayload(scenes, project);
    expect(payload.scenes).toHaveLength(scenes.length);
    expect(payload.scenes[0]?.title).toBe(scenes[0]!.title);
  });
});
