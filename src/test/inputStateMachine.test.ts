import { describe, expect, test } from "vitest";
import {
  collectSceneCharacters,
  createDialogueBlock,
  createNarrativeBlock,
  predictNextCharacter,
} from "../ui/editor/inputStateMachine";

describe("input state machine", () => {
  test("creates narrative block with given text", () => {
    const block = createNarrativeBlock("他走进教室");
    expect(block).toMatchObject({ type: "narrative", text: "他走进教室" });
  });

  test("creates dialogue block with optional character", () => {
    const withSpeaker = createDialogueBlock("男主", "你好");
    expect(withSpeaker).toMatchObject({ type: "dialogue", character: "男主", text: "你好" });

    const withoutSpeaker = createDialogueBlock(undefined, "嗯");
    expect(withoutSpeaker.type).toBe("dialogue");
    expect(withoutSpeaker.character).toBeUndefined();
    expect(withoutSpeaker.text).toBe("嗯");

    const blank = createDialogueBlock("   ", "");
    expect(blank.character).toBeUndefined();
  });

  test("predicts opposing speaker first", () => {
    const suggestions = predictNextCharacter(
      [
        createDialogueBlock("男主", "A"),
        createDialogueBlock("女主", "B"),
        createDialogueBlock("男主", "C"),
      ],
      ["男主", "女主", "老师"],
      ["旁白"],
    );
    expect(suggestions[0]).toBe("女主");
  });

  test("collects character list from dialogue blocks", () => {
    const result = collectSceneCharacters(
      [
        createDialogueBlock("男主", "你好"),
        createDialogueBlock("女主", "你也好"),
        createDialogueBlock(undefined, "..."),
      ],
      ["老师"],
    );
    expect(result).toEqual(["老师", "男主", "女主"]);
  });
});
