import { describe, expect, test } from "vitest";
import { isExternalUpdateSaveError, planSingleFileSave } from "../domain/projectSave";

describe("planSingleFileSave", () => {
  test("skips clean payloads", () => {
    const plan = planSingleFileSave({
      relativePath: "project.json",
      savedPayload: "{}",
      nextPayload: "{}",
      baselineHash: "a",
      diskHash: "a",
    });
    expect(plan.action).toBe("skip-clean");
  });

  test("detects external drift", () => {
    const plan = planSingleFileSave({
      relativePath: "project.json",
      savedPayload: "{}",
      nextPayload: "{ }",
      baselineHash: "a",
      diskHash: "b",
    });
    expect(plan.action).toBe("skip-external");
  });

  test("writes with expected hash", () => {
    const plan = planSingleFileSave({
      relativePath: "project.json",
      savedPayload: "{}",
      nextPayload: "{ }",
      baselineHash: "a",
      diskHash: "a",
    });
    expect(plan).toEqual({
      action: "write",
      relativePath: "project.json",
      payload: "{ }",
      expectedHash: "a",
    });
  });
});

describe("isExternalUpdateSaveError", () => {
  test("detects the stable backend error token", () => {
    expect(isExternalUpdateSaveError(new Error("external_update"))).toBe(true);
    expect(isExternalUpdateSaveError(new Error("auto-save failed"))).toBe(false);
  });
});
