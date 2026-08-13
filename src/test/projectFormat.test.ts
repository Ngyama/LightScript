import { describe, expect, test } from "vitest";
import { createDefaultProject } from "../domain/model";
import {
  assembleProjectFromMetaAndScenes,
  isLegacyMonolithicProjectJson,
  listProjectFileEntries,
  PROJECT_FORMAT_VERSION,
  PROJECT_META_FILE,
  projectFileSnapshot,
  projectMetaPayload,
  removedProjectFiles,
  sceneFilePayload,
  sceneRelativePath,
} from "../domain/projectFormat";
import { planProjectFilesSave } from "../domain/projectSave";

describe("projectFormat", () => {
  test("detects legacy monolithic project json", () => {
    const project = createDefaultProject();
    expect(isLegacyMonolithicProjectJson(project)).toBe(true);
    expect(
      isLegacyMonolithicProjectJson({
        formatVersion: PROJECT_FORMAT_VERSION,
        scripts: [{ id: "s1", title: "S", sceneIds: ["a"] }],
      }),
    ).toBe(false);
  });

  test("splits project into meta + scene files", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    const entries = listProjectFileEntries(project);
    expect(entries.some((entry) => entry.relativePath === PROJECT_META_FILE)).toBe(true);
    expect(
      entries.some(
        (entry) => entry.relativePath === sceneRelativePath(script.id, scene.id),
      ),
    ).toBe(true);

    const meta = JSON.parse(projectMetaPayload(project)) as {
      formatVersion: number;
      settings: { writingMode: string; lastSceneId?: string };
      scripts: Array<{ sceneIds: string[]; scenes?: unknown }>;
    };
    expect(meta.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(meta.settings.lastSceneId).toBeUndefined();
    expect(meta.scripts[0]?.sceneIds).toEqual([scene.id]);
    expect(meta.scripts[0]?.scenes).toBeUndefined();
  });

  test("round-trips via assemble", () => {
    const project = createDefaultProject();
    project.title = "Round Trip";
    project.scripts[0].scenes[0].blocks = [
      { id: "b1", type: "narrative", text: "Hello" },
    ];
    const snapshot = projectFileSnapshot(project);
    const assembled = assembleProjectFromMetaAndScenes(
      snapshot[PROJECT_META_FILE],
      Object.fromEntries(
        Object.entries(snapshot).filter(([path]) => path !== PROJECT_META_FILE),
      ),
    );
    expect(assembled.title).toBe("Round Trip");
    expect(assembled.scripts[0].scenes[0].blocks[0]?.text).toBe("Hello");
    expect(assembled.settings.writingMode).toBe("character");
  });

  test("removedProjectFiles lists deleted scenes only", () => {
    const project = createDefaultProject();
    const previous = projectFileSnapshot(project);
    const script = project.scripts[0];
    const scene = script.scenes[0];
    const next = { ...previous };
    delete next[sceneRelativePath(script.id, scene.id)];
    expect(removedProjectFiles(previous, next)).toEqual([
      sceneRelativePath(script.id, scene.id),
    ]);
  });
});

describe("planProjectFilesSave", () => {
  test("skips when snapshot matches", () => {
    const project = createDefaultProject();
    const saved = projectFileSnapshot(project);
    const hashes = Object.fromEntries(Object.keys(saved).map((path) => [path, "h"]));
    const plan = planProjectFilesSave({
      project,
      savedSnapshot: saved,
      baselineHashes: hashes,
      diskHashes: hashes,
    });
    expect(plan.allClean).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });

  test("writes only dirty scene file", () => {
    const project = createDefaultProject();
    const saved = projectFileSnapshot(project);
    const hashes = Object.fromEntries(Object.keys(saved).map((path) => [path, "h"]));
    const script = project.scripts[0];
    const scene = script.scenes[0];
    const scenePath = sceneRelativePath(script.id, scene.id);
    const edited = {
      ...project,
      scripts: [
        {
          ...script,
          scenes: [
            {
              ...scene,
              blocks: [{ id: "n1", type: "narrative" as const, text: "Changed" }],
            },
          ],
        },
      ],
    };
    const plan = planProjectFilesSave({
      project: edited,
      savedSnapshot: saved,
      baselineHashes: hashes,
      diskHashes: hashes,
    });
    expect(plan.hasExternal).toBe(false);
    expect(plan.writes.map((write) => write.relativePath)).toEqual([scenePath]);
    expect(plan.writes[0]?.payload).toBe(sceneFilePayload(edited.scripts[0].scenes[0]));
  });

  test("writes scenes before project meta when both dirty", () => {
    const project = createDefaultProject();
    const saved = projectFileSnapshot(project);
    const hashes = Object.fromEntries(Object.keys(saved).map((path) => [path, "h"]));
    const script = project.scripts[0];
    const scene = script.scenes[0];
    const edited = {
      ...project,
      title: "Renamed",
      scripts: [
        {
          ...script,
          scenes: [
            {
              ...scene,
              blocks: [{ id: "n1", type: "narrative" as const, text: "Changed" }],
            },
          ],
        },
      ],
    };
    const plan = planProjectFilesSave({
      project: edited,
      savedSnapshot: saved,
      baselineHashes: hashes,
      diskHashes: hashes,
    });
    expect(plan.writes.map((write) => write.relativePath)).toEqual([
      sceneRelativePath(script.id, scene.id),
      PROJECT_META_FILE,
    ]);
  });

  test("blocks writes when disk hash drifted", () => {
    const project = createDefaultProject();
    const saved = projectFileSnapshot(project);
    const edited = { ...project, title: "New" };
    const plan = planProjectFilesSave({
      project: edited,
      savedSnapshot: saved,
      baselineHashes: { [PROJECT_META_FILE]: "open" },
      diskHashes: { [PROJECT_META_FILE]: "drive" },
    });
    expect(plan.hasExternal).toBe(true);
    expect(plan.writes).toHaveLength(0);
  });
});
