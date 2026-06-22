import { describe, expect, test } from "vitest";
import {
  assertProjectInvariant,
  assertProjectReadyForExport,
  createDefaultProject,
  getCharacterName,
  parseProject,
  sceneToMarkdown,
  sceneToPlainText,
} from "../domain/model";
import {
  migrateProjectCharacters,
} from "../domain/characters";
import { useEditorStore } from "../state/editorStore";

function legacyProject(overrides: Record<string, unknown> = {}) {
  const base = createDefaultProject();
  const sceneId = base.scripts[0].scenes[0].id;
  return {
    ...base,
    characters: [],
    scripts: [
      {
        ...base.scripts[0],
        scenes: [
          {
            id: sceneId,
            title: "Scene 1",
            characters: ["A", "B"],
            blocks: [
              { id: "d1", type: "dialogue", character: "A", text: "Hello" },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("project invariant", () => {
  test("accepts default project", () => {
    const project = createDefaultProject();
    expect(() => assertProjectInvariant(project)).not.toThrow();
    expect(project.characters).toEqual([]);
    expect(project.scripts[0].scenes[0].characterIds).toEqual([]);
  });

  test("rejects empty script list", () => {
    const project = createDefaultProject();
    project.scripts = [];
    expect(() => assertProjectInvariant(project)).toThrow("Project must contain at least one script.");
  });

  test("allows empty dialogue blocks during editing", () => {
    const project = createDefaultProject();
    const hero = project.characters[0] ?? { id: "hero", name: "男主" };
    if (project.characters.length === 0) {
      project.characters.push(hero);
      project.scripts[0].scenes[0].characterIds.push(hero.id);
    }
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push(
      { id: "draft-empty", type: "dialogue", text: "" },
      { id: "draft-named", type: "dialogue", characterId: hero.id, text: "" },
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
    const heroId = "hero-1";
    project.characters.push({ id: heroId, name: "男主" });
    project.scripts[0].scenes[0].characterIds.push(heroId);
    const firstScene = project.scripts[0].scenes[0];
    firstScene.blocks.push({
      id: "blank-dialogue",
      type: "dialogue",
      characterId: heroId,
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

describe("character migration", () => {
  test("migrates scene.characters and dialogue.character into global ids", () => {
    const migrated = parseProject(JSON.stringify(legacyProject()));
    const scene = migrated.scripts[0].scenes[0];
    const a = migrated.characters.find((entry) => entry.name === "A");
    const b = migrated.characters.find((entry) => entry.name === "B");

    expect(migrated.characters).toHaveLength(2);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(scene.characterIds).toEqual(expect.arrayContaining([a!.id, b!.id]));
    expect(scene.blocks[0]).toMatchObject({ type: "dialogue", characterId: a!.id, text: "Hello" });
    expect((scene.blocks[0] as { character?: string }).character).toBeUndefined();
  });

  test("creates dialogue-only character and adds it to scene roster", () => {
    const migrated = parseProject(
      JSON.stringify(
        legacyProject({
          scripts: [
            {
              ...createDefaultProject().scripts[0],
              scenes: [
                {
                  id: createDefaultProject().scripts[0].scenes[0].id,
                  title: "Scene 1",
                  characters: ["A"],
                  blocks: [{ id: "d1", type: "dialogue", character: "B", text: "Hi" }],
                },
              ],
            },
          ],
        }),
      ),
    );
    const scene = migrated.scripts[0].scenes[0];
    const a = migrated.characters.find((entry) => entry.name === "A");
    const b = migrated.characters.find((entry) => entry.name === "B");

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(scene.characterIds).toEqual(expect.arrayContaining([a!.id, b!.id]));
    expect(scene.blocks[0]).toMatchObject({ characterId: b!.id });
  });

  test("deduplicates global characters by trimmed name", () => {
    const migrated = parseProject(
      JSON.stringify(
        legacyProject({
          scripts: [
            {
              ...createDefaultProject().scripts[0],
              scenes: [
                {
                  id: createDefaultProject().scripts[0].scenes[0].id,
                  title: "Scene 1",
                  characters: [" Alice ", "Alice"],
                  blocks: [],
                },
              ],
            },
          ],
        }),
      ),
    );
    expect(migrated.characters).toHaveLength(1);
    expect(migrated.characters[0]?.name).toBe("Alice");
  });

  test("clears invalid dialogue characterId references", () => {
    const project = createDefaultProject();
    project.scripts[0].scenes[0].blocks = [
      {
        id: "d1",
        type: "dialogue",
        characterId: "missing-id",
        text: "oops",
      },
    ];
    const normalized = migrateProjectCharacters(project);
    const block = normalized.scripts[0].scenes[0].blocks[0];
    expect(block.type).toBe("dialogue");
    if (block.type === "dialogue") {
      expect(block.characterId).toBeUndefined();
    }
  });
});

describe("scene export", () => {
  test("renders title, narrative paragraphs, and bolded dialogue speakers", () => {
    const project = createDefaultProject();
    const aliceId = "alice-id";
    const bobId = "bob-id";
    project.characters.push(
      { id: aliceId, name: "Alice" },
      { id: bobId, name: "Bob" },
    );
    const scene = project.scripts[0].scenes[0];
    scene.characterIds = [aliceId, bobId];
    scene.blocks = [
      { id: "n1", type: "narrative", text: "It is raining." },
      { id: "d1", type: "dialogue", characterId: aliceId, text: "Hello." },
      { id: "d2", type: "dialogue", text: "Anonymous murmur." },
      { id: "n2", type: "narrative", text: "  " },
      { id: "d3", type: "dialogue", characterId: bobId, text: "" },
    ];

    const md = sceneToMarkdown(scene, project);

    expect(md.startsWith("# Opening\n") || md.startsWith("# Scene 1\n")).toBe(true);
    expect(md).toContain("\nIt is raining.\n");
    expect(md).toContain("\n**Alice**: Hello.\n");
    expect(md).toContain("\n> Anonymous murmur.\n");
    expect(md).not.toContain("Bob");
    expect(md.endsWith("\n")).toBe(true);
  });

  test("plain text export resolves character names", () => {
    const project = createDefaultProject();
    const heroId = "hero";
    project.characters.push({ id: heroId, name: "男主" });
    const scene = project.scripts[0].scenes[0];
    scene.characterIds = [heroId];
    scene.blocks = [{ id: "d1", type: "dialogue", characterId: heroId, text: "你好" }];

    const text = sceneToPlainText(scene, project);
    expect(text).toContain("男主：“你好”");
    expect(getCharacterName(project, heroId)).toBe("男主");
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
    const hero = migrated.characters.find((entry) => entry.name === "男主");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "dialogue", characterId: hero?.id, text: "你好" });
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
    const hero = migrated.characters.find((entry) => entry.name === "男主");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "dialogue", characterId: hero?.id, text: "" });
  });
});

describe("project settings", () => {
  test("parseProject defaults missing writingMode to character", () => {
    const project = createDefaultProject();
    const raw = JSON.stringify({ ...project, settings: {} });
    const parsed = parseProject(raw);
    expect(parsed.settings.writingMode).toBe("character");
  });

  test("parseProject preserves quote writingMode", () => {
    const project = createDefaultProject();
    const raw = JSON.stringify({ ...project, settings: { writingMode: "quote" } });
    const parsed = parseProject(raw);
    expect(parsed.settings.writingMode).toBe("quote");
  });
});

describe("editor store character actions", () => {
  test("deleteGlobalCharacter clears scene rosters and dialogue references", () => {
    const project = createDefaultProject();
    const scene = project.scripts[0].scenes[0];
    const heroId = "hero";
    const friendId = "friend";
    project.characters.push(
      { id: heroId, name: "男主" },
      { id: friendId, name: "女主" },
    );
    scene.characterIds = [heroId, friendId];
    scene.blocks = [
      { id: "d1", type: "dialogue", characterId: heroId, text: "A" },
      { id: "d2", type: "dialogue", characterId: friendId, text: "B" },
    ];

    useEditorStore.getState().hydrateProject(project);
    useEditorStore.getState().deleteGlobalCharacter(heroId);

    const next = useEditorStore.getState().project;
    const nextScene = next.scripts[0].scenes[0];
    expect(next.characters.some((entry) => entry.id === heroId)).toBe(false);
    expect(nextScene.characterIds).not.toContain(heroId);
    expect(nextScene.blocks[0]).toMatchObject({ characterId: undefined });
    expect(nextScene.blocks[1]).toMatchObject({ characterId: friendId });
  });

  test("removeCharacterFromCurrentScene only affects current scene", () => {
    const project = createDefaultProject();
    const scene = project.scripts[0].scenes[0];
    const heroId = "hero";
    project.characters.push({ id: heroId, name: "男主" });
    scene.characterIds = [heroId];
    scene.blocks = [{ id: "d1", type: "dialogue", characterId: heroId, text: "A" }];

    useEditorStore.getState().hydrateProject(project);
    useEditorStore.getState().selectScene(project.scripts[0].id, scene.id);
    useEditorStore.getState().removeCharacterFromCurrentScene(heroId);

    const next = useEditorStore.getState().project;
    expect(next.characters.some((entry) => entry.id === heroId)).toBe(true);
    expect(next.scripts[0].scenes[0].characterIds).not.toContain(heroId);
    expect(next.scripts[0].scenes[0].blocks[0]).toMatchObject({ characterId: undefined });
  });

  test("setWritingMode updates project settings", () => {
    const project = createDefaultProject();
    useEditorStore.getState().hydrateProject(project);
    expect(useEditorStore.getState().project.settings.writingMode).toBe("character");

    useEditorStore.getState().setWritingMode("quote");
    expect(useEditorStore.getState().project.settings.writingMode).toBe("quote");
  });
});
