import { describe, expect, test } from "vitest";
import {
  assertProjectInvariant,
  assertProjectReadyForExport,
  createDefaultProject,
  normalizeSceneCharacters,
  parseProject,
  sceneToMarkdown,
  type Scene,
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

  test("allows empty dialogue blocks during editing", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push(
      { id: "draft-empty", type: "dialogue", text: "" },
      { id: "draft-named", type: "dialogue", character: "男主", text: "" },
    );
    expect(() => assertProjectInvariant(project)).not.toThrow();
  });

  test("rejects unknown block type", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push({ id: "junk", type: "junk", text: "" } as never);
    expect(() => assertProjectInvariant(project)).toThrow(
      "Scene block type must be narrative or dialogue.",
    );
  });
});

describe("project export readiness", () => {
  test("rejects empty dialogue text when exporting", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push({
      id: "blank-dialogue",
      type: "dialogue",
      character: "男主",
      text: "",
    });
    expect(() => assertProjectReadyForExport(project)).toThrow("Dialogue block must contain text.");
  });

  test("accepts dialogue without character when text is present", () => {
    const project = createDefaultProject();
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push({
      id: "anon-dialogue",
      type: "dialogue",
      text: "嗯。",
    });
    expect(() => assertProjectReadyForExport(project)).not.toThrow();
  });
});

describe("scene character roster", () => {
  test("drops empty, whitespace-only, and duplicate names", () => {
    expect(normalizeSceneCharacters([" Alice ", "", "Bob", "Alice", "  ", null, "Bob"])).toEqual([
      "Alice",
      "Bob",
    ]);
  });

  test("returns empty array for non-array input", () => {
    expect(normalizeSceneCharacters(undefined)).toEqual([]);
    expect(normalizeSceneCharacters("Alice")).toEqual([]);
  });
});

describe("scene markdown export", () => {
  test("renders title, narrative paragraphs, and bolded dialogue speakers", () => {
    const scene: Scene = {
      id: "s1",
      title: "Opening",
      characters: ["Alice"],
      blocks: [
        { id: "n1", type: "narrative", text: "It is raining." },
        { id: "d1", type: "dialogue", character: "Alice", text: "Hello." },
        { id: "d2", type: "dialogue", text: "Anonymous murmur." },
        { id: "n2", type: "narrative", text: "  " },
        { id: "d3", type: "dialogue", character: "Bob", text: "" },
      ],
    };

    const md = sceneToMarkdown(scene);

    expect(md.startsWith("# Opening\n")).toBe(true);
    expect(md).toContain("\nIt is raining.\n");
    expect(md).toContain("\n**Alice**: Hello.\n");
    expect(md).toContain("\n> Anonymous murmur.\n");
    expect(md).not.toContain("Bob");
    expect(md.endsWith("\n")).toBe(true);
  });

  test("trims block text and skips fully empty blocks", () => {
    const scene: Scene = {
      id: "s2",
      title: "Quiet",
      characters: [],
      blocks: [
        { id: "n1", type: "narrative", text: "  margin space   " },
        { id: "n2", type: "narrative", text: "" },
      ],
    };

    expect(sceneToMarkdown(scene)).toBe("# Quiet\n\nmargin space\n");
  });
});

describe("project migration", () => {
  test("migrates legacy character block followed by dialogue into one dialogue", () => {
    const base = createDefaultProject();
    const sceneId = base.scripts[0].scenes[0].id;
    const legacy = {
      ...base,
      scripts: [
        {
          ...base.scripts[0],
          scenes: [
            {
              id: sceneId,
              title: "Scene 1",
              characters: [],
              blocks: [
                { id: "c1", type: "character", character: "男主" },
                { id: "d1", type: "dialogue", character: "", text: "你好" },
                { id: "n1", type: "action", text: "他笑了" },
              ],
            },
          ],
        },
      ],
    };

    const migrated = parseProject(JSON.stringify(legacy));
    const blocks = migrated.scripts[0].scenes[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "dialogue", character: "男主", text: "你好" });
    expect(blocks[1]).toMatchObject({ type: "narrative", text: "他笑了" });
  });

  test("converts a lone character block into an empty-text dialogue", () => {
    const base = createDefaultProject();
    const sceneId = base.scripts[0].scenes[0].id;
    const legacy = {
      ...base,
      scripts: [
        {
          ...base.scripts[0],
          scenes: [
            {
              id: sceneId,
              title: "Scene 1",
              characters: [],
              blocks: [{ id: "c1", type: "character", character: "男主" }],
            },
          ],
        },
      ],
    };

    const migrated = parseProject(JSON.stringify(legacy));
    const blocks = migrated.scripts[0].scenes[0].blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "dialogue", character: "男主", text: "" });
  });
});
