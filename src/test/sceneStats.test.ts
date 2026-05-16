import { describe, expect, it } from "vitest";
import { computeSceneStats } from "../ui/editor/sceneStats";
import { createNarrativeBlock } from "../ui/editor/inputStateMachine";

describe("computeSceneStats", () => {
  it("counts characters without whitespace and lines across blocks", () => {
    const blocks = [
      { ...createNarrativeBlock(), text: "hello world" },
      { ...createNarrativeBlock(), text: "第二行" },
    ];
    expect(computeSceneStats(blocks)).toEqual({ charCount: 13, lineCount: 2 });
  });

  it("returns one line for a single empty block", () => {
    expect(computeSceneStats([createNarrativeBlock()])).toEqual({ charCount: 0, lineCount: 1 });
  });

  it("returns zero when there are no narrative blocks", () => {
    expect(computeSceneStats([])).toEqual({ charCount: 0, lineCount: 0 });
  });
});
