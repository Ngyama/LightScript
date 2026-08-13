import { describe, expect, test } from "vitest";
import { PROJECT_META_FILE, sceneRelativePath } from "../domain/projectFormat";
import { createDefaultProject } from "../domain/model";
import {
  SNAPSHOT_IDLE_MS,
  SNAPSHOT_MIN_CHAR_DELTA,
  recordSnapshotTaken,
  shouldTakeFileSnapshot,
  type SnapshotBook,
} from "../domain/snapshotPolicy";

describe("snapshotPolicy", () => {
  test("first overwrite always snapshots", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    const path = sceneRelativePath(script.id, scene.id);
    const payload = JSON.stringify({ blocks: scene.blocks });
    expect(
      shouldTakeFileSnapshot({
        relativePath: path,
        nextPayload: payload,
        previous: null,
      }),
    ).toBe(true);
  });

  test("skips small edits inside idle window", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    scene.blocks = [{ id: "1", type: "narrative", text: "你好世界" }];
    const path = sceneRelativePath(script.id, scene.id);
    const book: SnapshotBook = {};
    const base = JSON.stringify({ blocks: scene.blocks });
    recordSnapshotTaken(book, path, base, 1_000);
    scene.blocks = [{ id: "1", type: "narrative", text: "你好世界啊" }];
    const next = JSON.stringify({ blocks: scene.blocks });
    expect(
      shouldTakeFileSnapshot({
        relativePath: path,
        nextPayload: next,
        previous: book[path],
        nowMs: 1_000 + 30_000,
      }),
    ).toBe(false);
  });

  test("unchanged content never re-snapshots no matter how long idle", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    scene.blocks = [{ id: "1", type: "narrative", text: "你好世界" }];
    const path = sceneRelativePath(script.id, scene.id);
    const book: SnapshotBook = {};
    const payload = JSON.stringify({ blocks: scene.blocks });
    recordSnapshotTaken(book, path, payload, 1_000);

    expect(
      shouldTakeFileSnapshot({
        relativePath: path,
        nextPayload: payload,
        previous: book[path],
        nowMs: 1_000 + SNAPSHOT_IDLE_MS,
      }),
    ).toBe(false);
    expect(
      shouldTakeFileSnapshot({
        relativePath: path,
        nextPayload: payload,
        previous: book[path],
        nowMs: 1_000 + SNAPSHOT_IDLE_MS * 20,
      }),
    ).toBe(false);
  });

  test("small edit after idle takes one snapshot then stays quiet while staring", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    scene.blocks = [{ id: "1", type: "narrative", text: "你好世界" }];
    const path = sceneRelativePath(script.id, scene.id);
    const book: SnapshotBook = {};
    recordSnapshotTaken(book, path, JSON.stringify({ blocks: scene.blocks }), 1_000);

    scene.blocks = [{ id: "1", type: "narrative", text: "你好世界啊" }];
    const next = JSON.stringify({ blocks: scene.blocks });
    expect(
      shouldTakeFileSnapshot({
        relativePath: path,
        nextPayload: next,
        previous: book[path],
        nowMs: 1_000 + SNAPSHOT_IDLE_MS,
      }),
    ).toBe(true);

    recordSnapshotTaken(book, path, next, 1_000 + SNAPSHOT_IDLE_MS);
    expect(
      shouldTakeFileSnapshot({
        relativePath: path,
        nextPayload: next,
        previous: book[path],
        nowMs: 1_000 + SNAPSHOT_IDLE_MS * 10,
      }),
    ).toBe(false);
  });

  test("large char delta snapshots immediately", () => {
    const project = createDefaultProject();
    const script = project.scripts[0];
    const scene = script.scenes[0];
    scene.blocks = [{ id: "1", type: "narrative", text: "a".repeat(10) }];
    const path = sceneRelativePath(script.id, scene.id);
    const book: SnapshotBook = {};
    recordSnapshotTaken(book, path, JSON.stringify({ blocks: scene.blocks }), 1_000);

    const big = [{ id: "1", type: "narrative" as const, text: "a".repeat(10 + SNAPSHOT_MIN_CHAR_DELTA) }];
    expect(
      shouldTakeFileSnapshot({
        relativePath: path,
        nextPayload: JSON.stringify({ blocks: big }),
        previous: book[path],
        nowMs: 1_000 + 1_000,
      }),
    ).toBe(true);
  });

  test("project meta uses byte delta", () => {
    const book: SnapshotBook = {};
    const small = "{\"title\":\"a\"}";
    recordSnapshotTaken(book, PROJECT_META_FILE, small, 1_000);
    expect(
      shouldTakeFileSnapshot({
        relativePath: PROJECT_META_FILE,
        nextPayload: small + "x".repeat(50),
        previous: book[PROJECT_META_FILE],
        nowMs: 1_000 + 1_000,
      }),
    ).toBe(false);
    expect(
      shouldTakeFileSnapshot({
        relativePath: PROJECT_META_FILE,
        nextPayload: small + "x".repeat(250),
        previous: book[PROJECT_META_FILE],
        nowMs: 1_000 + 1_000,
      }),
    ).toBe(true);
  });
});
