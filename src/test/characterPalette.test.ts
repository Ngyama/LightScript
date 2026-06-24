import { describe, expect, test } from "vitest";
import {
  angularHueDistance,
  DISTINCT_CHARACTER_HUES,
} from "../domain/characterColors";
import { ensureCharacterColors } from "../domain/characters";
import { characterChipColors, pickDistinctHue } from "../ui/characterPalette";

describe("pickDistinctHue", () => {
  test("maximizes hue separation as characters are added", () => {
    const hues: number[] = [];
    for (let i = 0; i < 5; i++) {
      hues.push(pickDistinctHue(hues));
    }
    const minGap = Math.min(
      ...hues.flatMap((hue, index) =>
        hues.slice(index + 1).map((other) => angularHueDistance(hue, other)),
      ),
    );
    expect(minGap).toBeGreaterThanOrEqual(24);
    expect(new Set(hues).size).toBe(5);
  });

  test("reuses palette only after all preset hues are taken", () => {
    const hues = [...DISTINCT_CHARACTER_HUES];
    const next = pickDistinctHue(hues);
    expect(DISTINCT_CHARACTER_HUES).not.toContain(next);
    expect(angularHueDistance(next, hues[0])).toBeGreaterThan(0);
  });
});

describe("ensureCharacterColors", () => {
  test("assigns distinct stored hues to characters missing color", () => {
    const characters = ensureCharacterColors([
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
      { id: "c", name: "Carol" },
      { id: "d", name: "Dave" },
      { id: "e", name: "Eve" },
    ]);
    const hues = characters.map((entry) => Number(entry.color));
    const minGap = Math.min(
      ...hues.flatMap((hue, index) =>
        hues.slice(index + 1).map((other) => angularHueDistance(hue, other)),
      ),
    );
    expect(minGap).toBeGreaterThanOrEqual(24);
  });

  test("keeps explicit hues and fills gaps for the rest", () => {
    const characters = ensureCharacterColors([
      { id: "a", name: "Alice", color: "12" },
      { id: "b", name: "Bob" },
      { id: "c", name: "Carol" },
    ]);
    expect(characters[0].color).toBe("12");
    expect(characters[1].color).not.toBe("12");
    expect(characters[2].color).not.toBe(characters[1].color);
  });
});

describe("characterChipColors", () => {
  test("prefers stored hue over name", () => {
    const fromColor = characterChipColors({ name: "Alice", color: "120" });
    const fromName = characterChipColors({ name: "Alice" });
    expect(fromColor?.background).toContain("120");
    expect(fromColor?.background).not.toEqual(fromName?.background);
  });
});
