import type { SceneBlock } from "../../domain/model";

export function computeSceneStats(blocks: SceneBlock[]): { charCount: number; lineCount: number } {
  const texts = blocks
    .filter((block): block is Extract<SceneBlock, { type: "narrative" }> => block.type === "narrative")
    .map((block) => block.text);

  if (texts.length === 0) {
    return { charCount: 0, lineCount: 0 };
  }

  const combined = texts.join("\n");
  const charCount = combined.replace(/\s/g, "").length;
  const lineCount = combined.length === 0 ? 1 : combined.split("\n").length;

  return { charCount, lineCount };
}
