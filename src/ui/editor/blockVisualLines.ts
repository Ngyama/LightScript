import {
  createTextMeasureContext,
  textFitsLineWidth,
  type TextMeasureContext,
} from "./blockLineMeasure";

/** Blocks never store intentional hard breaks — soft wrap is display-only. */
export function stripHardNewlines(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "");
}

/**
 * Start offsets of each soft-wrapped visual line (always includes 0).
 * Breaks mid-content when the next character would exceed the content width,
 * matching `overflow-wrap: anywhere` / break-word layout for CJK-heavy text.
 */
export function computeSoftLineStarts(text: string, measure: TextMeasureContext): number[] {
  if (!text) {
    return [0];
  }
  if (measure.contentWidth <= 0) {
    return [0];
  }

  const starts: number[] = [0];
  let lineStart = 0;
  let i = 1;
  while (i <= text.length) {
    if (textFitsLineWidth(text.slice(lineStart, i), measure)) {
      i += 1;
      continue;
    }
    if (i - 1 === lineStart) {
      // Single glyph wider than the line: keep it on this line, then start the next
      // only when more text remains (avoid a trailing empty visual line).
      if (i < text.length) {
        starts.push(i);
      }
      lineStart = i;
      i += 1;
    } else {
      starts.push(i - 1);
      lineStart = i - 1;
    }
  }
  return starts;
}

export function softLineStartsForElement(text: string, element: HTMLElement): number[] {
  const measure = createTextMeasureContext(element);
  if (!measure) {
    return [0];
  }
  return computeSoftLineStarts(text, measure);
}

export function visualLineIndexAt(caret: number, lineStarts: number[]): number {
  let index = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i]! <= caret) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

export function visualLineRange(
  lineStarts: number[],
  lineIndex: number,
  textLength: number,
): { start: number; end: number } {
  const start = lineStarts[lineIndex] ?? 0;
  const end = lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1]! : textLength;
  return { start, end };
}

export function isCaretAtFirstVisualLine(element: HTMLTextAreaElement): boolean {
  const caret = element.selectionStart ?? 0;
  const starts = softLineStartsForElement(element.value, element);
  return visualLineIndexAt(caret, starts) === 0;
}

export function isCaretAtLastVisualLine(element: HTMLTextAreaElement): boolean {
  const caret = element.selectionEnd ?? element.value.length;
  const starts = softLineStartsForElement(element.value, element);
  return visualLineIndexAt(caret, starts) === starts.length - 1;
}

export function measureCaretLeftOnVisualLine(
  element: HTMLTextAreaElement,
  measureText: (text: string) => number,
  paddingLeft: number,
): number {
  const caret = element.selectionEnd ?? element.value.length;
  const starts = softLineStartsForElement(element.value, element);
  const lineIndex = visualLineIndexAt(caret, starts);
  const lineStart = starts[lineIndex] ?? 0;
  return paddingLeft + measureText(element.value.slice(lineStart, caret));
}
