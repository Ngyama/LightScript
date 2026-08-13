import { describe, expect, test } from "vitest";
import {
  buildBackupPreview,
  formatCharDelta,
  resolveBackupDisplayName,
} from "../domain/backupDisplay";
import { createDefaultProject } from "../domain/model";
import { sceneRelativePath } from "../domain/projectFormat";

describe("backupDisplay", () => {
  test("resolves scene and project labels for writers", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    scene.title = "开场";
    expect(resolveBackupDisplayName("project.json", project)).toBe(
      "作品目录（角色 / 结构）",
    );
    expect(
      resolveBackupDisplayName(sceneRelativePath(script.id, scene.id), project),
    ).toBe("开场（正文）");
  });

  test("builds plain-text scene preview and char delta", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    scene.title = "开场";
    scene.blocks = [{ id: "1", type: "narrative", text: "你好世界" }];
    const path = sceneRelativePath(script.id, scene.id);
    const preview = buildBackupPreview(
      path,
      JSON.stringify({
        id: scene.id,
        title: "开场",
        location: "",
        outline: "",
        characterIds: [],
        blocks: scene.blocks,
      }),
      project,
    );
    expect(preview.kind).toBe("scene");
    expect(preview.plainText).toContain("你好世界");
    expect(preview.charCount).toBe(4);
    expect(formatCharDelta(4, 10)).toBe("比当前少 6 字");
    expect(formatCharDelta(10, 4)).toBe("比当前多 6 字");
  });
});
