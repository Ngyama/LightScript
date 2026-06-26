import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../domain/model";
import {
  buildBatchExportFileBase,
  listSceneExportItems,
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
});
