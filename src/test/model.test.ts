import { describe, expect, test } from "vitest";
import { assertProjectInvariant, createDefaultProject } from "../domain/model";

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

  test("rejects invalid dialogue block", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push({
      id: "invalid-dialogue",
      type: "dialogue",
      character: "",
      text: "hello",
    });
    expect(() => assertProjectInvariant(project)).toThrow("Dialogue block must contain character and text.");
  });
});
