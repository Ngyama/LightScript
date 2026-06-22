import { describe, expect, it } from "vitest";
import {
  textFitsLineWidth,
  truncateToLineWidth,
  type TextMeasureContext,
} from "../ui/editor/blockLineMeasure";

function fixedWidthMeasure(charWidth: number, contentWidth: number): TextMeasureContext {
  return {
    contentWidth,
    measureText: (text: string) => text.length * charWidth,
  };
}

describe("blockLineMeasure", () => {
  it("accepts text within the line width", () => {
    const measure = fixedWidthMeasure(10, 100);
    expect(textFitsLineWidth("hello", measure)).toBe(true);
    expect(textFitsLineWidth("0123456789", measure)).toBe(true);
  });

  it("rejects text wider than the line", () => {
    const measure = fixedWidthMeasure(10, 100);
    expect(textFitsLineWidth("01234567890", measure)).toBe(false);
  });

  it("truncates overflow text to the longest fitting prefix", () => {
    const measure = fixedWidthMeasure(10, 100);
    expect(truncateToLineWidth("01234567890", measure)).toBe("0123456789");
  });
});
