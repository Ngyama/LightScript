import { describe, expect, test } from "vitest";
import {
  collectSceneCharacters,
  createCharacterBlock,
  createDialogueBlock,
  createNarrativeBlock,
  predictNextCharacter,
  stateAfterEnter,
  updateBlockFromInput,
} from "../ui/editor/inputStateMachine";

describe("input state machine", () => {
  test("updates dialogue block as spoken text", () => {
    const result = updateBlockFromInput(createDialogueBlock("男主", ""), "你好");
    expect(result.block).toMatchObject({
      type: "dialogue",
      character: "男主",
      text: "你好",
    });
    expect(result.state.mode).toBe("dialogue");
  });

  test("updates narrative block as plain text", () => {
    const result = updateBlockFromInput(createNarrativeBlock(""), "他走进教室");
    expect(result.block).toMatchObject({
      type: "narrative",
      text: "他走进教室",
    });
  });

  test("enter after dialogue returns character mode", () => {
    const dialogue = createDialogueBlock("女主", "你来了");
    expect(stateAfterEnter(dialogue).mode).toBe("character");
  });

  test("enter after character returns dialogue mode", () => {
    expect(stateAfterEnter(createCharacterBlock("男主")).mode).toBe("dialogue");
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

  test("collects character list from blocks", () => {
    const result = collectSceneCharacters(
      [createCharacterBlock("男主"), createDialogueBlock("女主", "你好")],
      ["老师"],
    );
    expect(result).toEqual(["老师", "男主", "女主"]);
  });

  test("enter after narrative keeps narrative mode", () => {
    expect(stateAfterEnter(createNarrativeBlock("他停下脚步")).mode).toBe("narrative");
  });
});
