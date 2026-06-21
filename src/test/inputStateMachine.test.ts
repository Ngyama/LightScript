import { describe, expect, test } from "vitest";
import {
  collectSceneCharacterIds,
  createDialogueBlock,
  createNarrativeBlock,
  predictNextCharacterId,
} from "../ui/editor/inputStateMachine";

describe("input state machine", () => {
  test("creates narrative block with given text", () => {
    const block = createNarrativeBlock("他走进教室");
    expect(block).toMatchObject({ type: "narrative", text: "他走进教室" });
  });

  test("creates dialogue block with optional characterId", () => {
    const withSpeaker = createDialogueBlock("hero-id", "你好");
    expect(withSpeaker).toMatchObject({ type: "dialogue", characterId: "hero-id", text: "你好" });

    const withoutSpeaker = createDialogueBlock(undefined, "嗯");
    expect(withoutSpeaker.type).toBe("dialogue");
    expect(withoutSpeaker.characterId).toBeUndefined();
    expect(withoutSpeaker.text).toBe("嗯");

    const blank = createDialogueBlock("   ", "");
    expect(blank.characterId).toBeUndefined();
  });

  test("predicts opposing speaker first", () => {
    const suggestions = predictNextCharacterId(
      [
        createDialogueBlock("hero", "A"),
        createDialogueBlock("heroine", "B"),
        createDialogueBlock("hero", "C"),
      ],
      ["hero", "heroine", "teacher"],
      ["narrator"],
    );
    expect(suggestions[0]).toBe("heroine");
  });

  test("collects character ids from dialogue blocks", () => {
    const result = collectSceneCharacterIds(
      [
        createDialogueBlock("hero", "你好"),
        createDialogueBlock("heroine", "你也好"),
        createDialogueBlock(undefined, "..."),
      ],
      ["teacher"],
    );
    expect(result).toEqual(["teacher", "hero", "heroine"]);
  });
});
