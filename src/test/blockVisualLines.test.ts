import { describe, expect, it } from "vitest";
import {
  computeSoftLineStarts,
  stripHardNewlines,
  visualLineIndexAt,
  visualLineRange,
} from "../ui/editor/blockVisualLines";
import type { TextMeasureContext } from "../ui/editor/blockLineMeasure";

function fixedWidthMeasure(charWidth: number, contentWidth: number): TextMeasureContext {
  return {
    contentWidth,
    measureText: (text: string) => text.length * charWidth,
  };
}

describe("stripHardNewlines", () => {
  it("removes LF, CR, and CRLF", () => {
    expect(stripHardNewlines("a\nb\r\nc\rd")).toBe("abcd");
  });

  it("leaves already-flat text unchanged", () => {
    expect(stripHardNewlines("你好世界")).toBe("你好世界");
  });
});

describe("computeSoftLineStarts", () => {
  it("keeps a short string on one line", () => {
    const measure = fixedWidthMeasure(10, 100);
    expect(computeSoftLineStarts("hello", measure)).toEqual([0]);
  });

  it("wraps when text exceeds the content width", () => {
    const measure = fixedWidthMeasure(10, 50);
    // 10 chars = 100px → wraps every 5 characters
    expect(computeSoftLineStarts("0123456789", measure)).toEqual([0, 5]);
  });

  it("wraps into multiple visual lines", () => {
    const measure = fixedWidthMeasure(10, 30);
    expect(computeSoftLineStarts("0123456789", measure)).toEqual([0, 3, 6, 9]);
  });

  it("forces a single oversized character onto its own line", () => {
    const measure = fixedWidthMeasure(100, 50);
    expect(computeSoftLineStarts("ab", measure)).toEqual([0, 1]);
  });
});

describe("visualLineIndexAt / visualLineRange", () => {
  it("maps caret offsets onto wrapped lines", () => {
    const starts = [0, 5, 10];
    expect(visualLineIndexAt(0, starts)).toBe(0);
    expect(visualLineIndexAt(4, starts)).toBe(0);
    expect(visualLineIndexAt(5, starts)).toBe(1);
    expect(visualLineIndexAt(12, starts)).toBe(2);
    expect(visualLineRange(starts, 1, 15)).toEqual({ start: 5, end: 10 });
    expect(visualLineRange(starts, 2, 15)).toEqual({ start: 10, end: 15 });
  });
});
