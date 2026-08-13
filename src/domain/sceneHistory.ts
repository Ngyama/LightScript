import type { SceneBlock } from "./model";

const DEFAULT_LIMIT = 80;
const TYPING_COALESCE_MS = 800;

export type HistoryPushKind = "typing" | "structural";

export type SceneHistoryStack = {
  past: SceneBlock[][];
  future: SceneBlock[][];
  lastKind: HistoryPushKind | null;
  lastPushAt: number;
};

export function createSceneHistoryStack(): SceneHistoryStack {
  return {
    past: [],
    future: [],
    lastKind: null,
    lastPushAt: 0,
  };
}

export function cloneSceneBlocks(blocks: SceneBlock[]): SceneBlock[] {
  return structuredClone(blocks);
}

export function sceneBlocksEqual(a: SceneBlock[], b: SceneBlock[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Record `before` as a recoverable state prior to applying a new blocks array.
 * Typing pushes coalesce into the same past entry within TYPING_COALESCE_MS.
 */
export function pushSceneHistory(
  stack: SceneHistoryStack,
  before: SceneBlock[],
  kind: HistoryPushKind,
  now = Date.now(),
  limit = DEFAULT_LIMIT,
): SceneHistoryStack {
  const snapshot = cloneSceneBlocks(before);
  const canCoalesce =
    kind === "typing" &&
    stack.lastKind === "typing" &&
    now - stack.lastPushAt <= TYPING_COALESCE_MS &&
    stack.past.length > 0;

  if (canCoalesce) {
    return {
      ...stack,
      future: [],
      lastKind: "typing",
      lastPushAt: now,
    };
  }

  const past = [...stack.past, snapshot];
  while (past.length > limit) {
    past.shift();
  }
  return {
    past,
    future: [],
    lastKind: kind,
    lastPushAt: now,
  };
}

export function undoSceneHistory(
  stack: SceneHistoryStack,
  current: SceneBlock[],
): { stack: SceneHistoryStack; blocks: SceneBlock[] } | null {
  if (stack.past.length === 0) {
    return null;
  }
  const past = [...stack.past];
  const previous = past.pop()!;
  return {
    blocks: previous,
    stack: {
      past,
      future: [...stack.future, cloneSceneBlocks(current)],
      lastKind: null,
      lastPushAt: 0,
    },
  };
}

export function redoSceneHistory(
  stack: SceneHistoryStack,
  current: SceneBlock[],
): { stack: SceneHistoryStack; blocks: SceneBlock[] } | null {
  if (stack.future.length === 0) {
    return null;
  }
  const future = [...stack.future];
  const next = future.pop()!;
  return {
    blocks: next,
    stack: {
      past: [...stack.past, cloneSceneBlocks(current)],
      future,
      lastKind: null,
      lastPushAt: 0,
    },
  };
}

export function canUndo(stack: SceneHistoryStack): boolean {
  return stack.past.length > 0;
}

export function canRedo(stack: SceneHistoryStack): boolean {
  return stack.future.length > 0;
}
