import { describe, expect, test } from "vitest";
import type { SceneBlock } from "../domain/model";
import {
  canRedo,
  canUndo,
  createSceneHistoryStack,
  pushSceneHistory,
  redoSceneHistory,
  undoSceneHistory,
} from "../domain/sceneHistory";

const block = (text: string): SceneBlock => ({
  id: "b1",
  type: "narrative",
  text,
});

describe("sceneHistory", () => {
  test("undo restores previous blocks and enables redo", () => {
    let stack = createSceneHistoryStack();
    const a = [block("a")];
    const b = [block("b")];
    stack = pushSceneHistory(stack, a, "structural", 1000);
    const undone = undoSceneHistory(stack, b);
    expect(undone?.blocks).toEqual(a);
    expect(canRedo(undone!.stack)).toBe(true);
    const redone = redoSceneHistory(undone!.stack, undone!.blocks);
    expect(redone?.blocks).toEqual(b);
  });

  test("coalesces rapid typing into one undo step", () => {
    let stack = createSceneHistoryStack();
    stack = pushSceneHistory(stack, [block("")], "typing", 1000);
    stack = pushSceneHistory(stack, [block("h")], "typing", 1100);
    stack = pushSceneHistory(stack, [block("he")], "typing", 1200);
    expect(stack.past).toHaveLength(1);
    const undone = undoSceneHistory(stack, [block("hel")]);
    expect(undone?.blocks).toEqual([block("")]);
  });

  test("structural push after typing starts a new entry", () => {
    let stack = createSceneHistoryStack();
    stack = pushSceneHistory(stack, [block("")], "typing", 1000);
    stack = pushSceneHistory(stack, [block("hi")], "typing", 1100);
    stack = pushSceneHistory(stack, [block("hi")], "structural", 1200);
    expect(stack.past).toHaveLength(2);
  });

  test("undo on empty stack returns null", () => {
    expect(undoSceneHistory(createSceneHistoryStack(), [block("x")])).toBeNull();
    expect(canUndo(createSceneHistoryStack())).toBe(false);
  });
});
