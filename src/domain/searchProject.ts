import type { Project } from "./model";

export type SearchField = "outline" | "narrative" | "dialogue";

export interface SearchMatch {
  id: string;
  scriptId: string;
  scriptTitle: string;
  sceneId: string;
  sceneTitle: string;
  field: SearchField;
  blockId?: string;
  text: string;
  matchStart: number;
  matchEnd: number;
}

const MAX_RESULTS = 120;
const SNIPPET_RADIUS = 36;

function findOccurrences(text: string, query: string): Array<{ start: number; end: number }> {
  const needle = query.trim();
  if (!needle) return [];

  const haystack = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const results: Array<{ start: number; end: number }> = [];
  let pos = 0;

  while (pos < haystack.length && results.length < MAX_RESULTS) {
    const index = haystack.indexOf(lowerNeedle, pos);
    if (index === -1) break;
    results.push({ start: index, end: index + needle.length });
    pos = index + lowerNeedle.length;
  }

  return results;
}

export function buildSearchSnippet(
  text: string,
  matchStart: number,
  matchEnd: number,
  radius = SNIPPET_RADIUS,
): { before: string; match: string; after: string } {
  const sliceStart = Math.max(0, matchStart - radius);
  const sliceEnd = Math.min(text.length, matchEnd + radius);
  const before = `${sliceStart > 0 ? "…" : ""}${text.slice(sliceStart, matchStart)}`;
  const match = text.slice(matchStart, matchEnd);
  const after = `${text.slice(matchEnd, sliceEnd)}${sliceEnd < text.length ? "…" : ""}`;
  return { before, match, after };
}

function pushMatches(
  results: SearchMatch[],
  options: {
    scriptId: string;
    scriptTitle: string;
    sceneId: string;
    sceneTitle: string;
    field: SearchField;
    blockId?: string;
    text: string;
    query: string;
  },
): void {
  const { scriptId, scriptTitle, sceneId, sceneTitle, field, blockId, text, query } = options;
  for (const { start, end } of findOccurrences(text, query)) {
    if (results.length >= MAX_RESULTS) return;
    results.push({
      id: `${scriptId}:${sceneId}:${field}:${blockId ?? "outline"}:${start}`,
      scriptId,
      scriptTitle,
      sceneId,
      sceneTitle,
      field,
      blockId,
      text,
      matchStart: start,
      matchEnd: end,
    });
  }
}

export function searchProjectText(project: Project, query: string): SearchMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: SearchMatch[] = [];

  for (const script of project.scripts) {
    for (const scene of script.scenes) {
      if (scene.outline.trim()) {
        pushMatches(results, {
          scriptId: script.id,
          scriptTitle: script.title,
          sceneId: scene.id,
          sceneTitle: scene.title,
          field: "outline",
          text: scene.outline,
          query: trimmed,
        });
      }

      for (const block of scene.blocks) {
        const text = block.text;
        if (!text.trim()) continue;

        if (block.type === "narrative") {
          pushMatches(results, {
            scriptId: script.id,
            scriptTitle: script.title,
            sceneId: scene.id,
            sceneTitle: scene.title,
            field: "narrative",
            blockId: block.id,
            text,
            query: trimmed,
          });
          continue;
        }

        pushMatches(results, {
          scriptId: script.id,
          scriptTitle: script.title,
          sceneId: scene.id,
          sceneTitle: scene.title,
          field: "dialogue",
          blockId: block.id,
          text,
          query: trimmed,
        });
      }
    }
  }

  return results;
}

export function searchFieldLabel(field: SearchField): string {
  if (field === "outline") return "大纲";
  if (field === "narrative") return "旁白";
  return "台词";
}
