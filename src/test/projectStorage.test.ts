import { describe, expect, test } from "vitest";
import { createDefaultProject } from "../domain/model";
import { projectToExportEntries } from "../storage/projectStorage";

describe("project export mapping", () => {
  test("generates scene json entries", () => {
    const project = createDefaultProject();
    const entries = projectToExportEntries(project);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].relativePath).toContain("Script");
    expect(entries[0].relativePath).toContain(".json");
    expect(entries[0].content).toContain('"blocks"');
  });
});
