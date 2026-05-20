import type { SceneBlock } from "../../domain/model";

function textForStats(block: SceneBlock): string {
  if (block.type === "narrative") return block.text;
  return block.text.replace(/[「」]/g, "");
}

export function computeSceneStats(blocks: SceneBlock[]): { charCount: number; lineCount: number } {
  if (blocks.length === 0) {
    return { charCount: 0, lineCount: 0 };
  }

  const combined = blocks.map(textForStats).join("\n");
  const charCount = combined.replace(/\s/g, "").length;
  const lineCount = combined.length === 0 ? 1 : combined.split("\n").length;

  return { charCount, lineCount };
}
