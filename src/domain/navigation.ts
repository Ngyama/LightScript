import type { SearchMatch } from "./searchProject";

export type NavigationTarget =
  | {
      kind: "block";
      scriptId: string;
      sceneId: string;
      blockId: string;
      matchStart: number;
      matchEnd: number;
    }
  | {
      kind: "outline";
      scriptId: string;
      sceneId: string;
      matchStart: number;
      matchEnd: number;
    };

export function navigationTargetFromSearchMatch(match: SearchMatch): NavigationTarget {
  if (match.field === "outline") {
    return {
      kind: "outline",
      scriptId: match.scriptId,
      sceneId: match.sceneId,
      matchStart: match.matchStart,
      matchEnd: match.matchEnd,
    };
  }

  if (!match.blockId) {
    throw new Error("Search match for block field must include blockId.");
  }

  return {
    kind: "block",
    scriptId: match.scriptId,
    sceneId: match.sceneId,
    blockId: match.blockId,
    matchStart: match.matchStart,
    matchEnd: match.matchEnd,
  };
}

export function applyTextSelection(
  element: HTMLInputElement | HTMLTextAreaElement,
  matchStart: number,
  matchEnd: number,
): void {
  const start = Math.max(0, Math.min(matchStart, element.value.length));
  const end = Math.max(start, Math.min(matchEnd, element.value.length));
  element.setSelectionRange(start, end);
}
