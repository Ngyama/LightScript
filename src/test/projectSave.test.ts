import { describe, expect, test } from "vitest";
import { createDefaultProject } from "../domain/model";
import {
  isExternalUpdateSaveError,
  planProjectSave,
  projectSavePayload,
} from "../domain/projectSave";
import { withLastOpenedSettings } from "../domain/selection";

describe("planProjectSave", () => {
  test("skips write when payload matches the saved snapshot", () => {
    const project = createDefaultProject();
    const scriptId = project.scripts[0].id;
    const sceneId = project.scripts[0].scenes[0].id;
    const savedPayload = projectSavePayload(project, scriptId, sceneId);

    const plan = planProjectSave({
      savedPayload,
      project,
      scriptId,
      sceneId,
      baselineHash: "abc",
      diskHash: "abc",
    });

    expect(plan.action).toBe("skip-clean");
  });

  test("skips write when disk hash drifted from baseline", () => {
    const project = createDefaultProject();
    const scriptId = project.scripts[0].id;
    const sceneId = project.scripts[0].scenes[0].id;
    const savedPayload = projectSavePayload(project, scriptId, sceneId);
    const edited = {
      ...project,
      title: "Edited title",
    };

    const plan = planProjectSave({
      savedPayload,
      project: edited,
      scriptId,
      sceneId,
      baselineHash: "open-hash",
      diskHash: "drive-hash",
    });

    expect(plan.action).toBe("skip-external");
  });

  test("writes dirty payload with expected baseline hash", () => {
    const project = createDefaultProject();
    const scriptId = project.scripts[0].id;
    const sceneId = project.scripts[0].scenes[0].id;
    const savedPayload = projectSavePayload(project, scriptId, sceneId);
    const edited = withLastOpenedSettings(
      { ...project, title: "Edited title" },
      scriptId,
      sceneId,
    );

    const plan = planProjectSave({
      savedPayload,
      project: edited,
      scriptId,
      sceneId,
      baselineHash: "open-hash",
      diskHash: "open-hash",
    });

    expect(plan).toEqual({
      action: "write",
      payload: projectSavePayload(edited, scriptId, sceneId),
      expectedHash: "open-hash",
    });
  });

  test("treats missing saved snapshot as dirty and allows write", () => {
    const project = createDefaultProject();
    const scriptId = project.scripts[0].id;
    const sceneId = project.scripts[0].scenes[0].id;

    const plan = planProjectSave({
      savedPayload: null,
      project,
      scriptId,
      sceneId,
      baselineHash: null,
      diskHash: null,
    });

    expect(plan.action).toBe("write");
    if (plan.action === "write") {
      expect(plan.expectedHash).toBeNull();
    }
  });
});

describe("isExternalUpdateSaveError", () => {
  test("detects the stable backend error token", () => {
    expect(isExternalUpdateSaveError(new Error("external_update"))).toBe(true);
    expect(isExternalUpdateSaveError(new Error("auto-save failed"))).toBe(false);
  });
});