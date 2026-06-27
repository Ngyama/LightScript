import { describe, expect, test } from "vitest";
import {
  isGenericProjectTitle,
  projectFolderNameFromPath,
  resolveProjectTitleFromPath,
} from "../domain/projectTitle";

describe("projectTitle", () => {
  test("detects generic placeholder titles", () => {
    expect(isGenericProjectTitle("Untitled Project")).toBe(true);
    expect(isGenericProjectTitle(" untitled ")).toBe(true);
    expect(isGenericProjectTitle("ProjectA")).toBe(false);
  });

  test("extracts folder name from path", () => {
    expect(projectFolderNameFromPath("G:\\Google Drive\\ProjectA")).toBe("ProjectA");
    expect(projectFolderNameFromPath("/Users/me/Drive/ProjectA/")).toBe("ProjectA");
  });

  test("prefers folder name over generic json title", () => {
    expect(resolveProjectTitleFromPath("Untitled Project", "G:\\Drive\\ProjectA")).toBe(
      "ProjectA",
    );
    expect(resolveProjectTitleFromPath("My Novel", "G:\\Drive\\ProjectA")).toBe("My Novel");
  });
});
