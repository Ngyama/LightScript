import { describe, expect, test } from "vitest";
import {
  assertProjectInvariant,
  assertProjectReadyForExport,
  createDefaultProject,
} from "../domain/model";

describe("project invariant", () => {
  test("accepts default project", () => {
    const project = createDefaultProject();
    expect(() => assertProjectInvariant(project)).not.toThrow();
  });

  test("rejects empty script list", () => {
    const project = createDefaultProject();
    project.scripts = [];
    expect(() => assertProjectInvariant(project)).toThrow("Project must contain at least one script.");
  });

  test("allows empty character/dialogue blocks during editing", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push(
      { id: "draft-character", type: "character", character: "" },
      { id: "draft-dialogue", type: "dialogue", character: "", text: "" },
    );
    expect(() => assertProjectInvariant(project)).not.toThrow();
  });
});

describe("project export readiness", () => {
  test("rejects empty character block when exporting", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push({ id: "blank-character", type: "character", character: "" });
    expect(() => assertProjectReadyForExport(project)).toThrow(
      "Character block must contain character.",
    );
  });

  test("rejects empty dialogue block when exporting", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push({
      id: "blank-dialogue",
      type: "dialogue",
      character: "",
      text: "hello",
    });
    expect(() => assertProjectReadyForExport(project)).toThrow(
      "Dialogue block must contain character and text.",
    );
  });
});
