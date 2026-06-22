export type TextMeasureContext = {
  contentWidth: number;
  measureText: (text: string) => number;
};

export function createTextMeasureContext(element: HTMLElement): TextMeasureContext | null {
  const cs = window.getComputedStyle(element);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const fontParts = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily]
    .filter(Boolean)
    .join(" ");
  ctx.font = fontParts;

  const paddingLeft = parseFloat(cs.paddingLeft || "0");
  const paddingRight = parseFloat(cs.paddingRight || "0");
  const contentWidth = element.clientWidth - paddingLeft - paddingRight;

  return {
    contentWidth: Math.max(contentWidth, 0),
    measureText: (text: string) => ctx.measureText(text).width,
  };
}

export function textFitsLineWidth(text: string, measure: TextMeasureContext): boolean {
  if (!text) return true;
  if (measure.contentWidth <= 0) return true;
  return measure.measureText(text) <= measure.contentWidth;
}

/** Longest prefix of `text` that fits within the line width. */
export function truncateToLineWidth(text: string, measure: TextMeasureContext): string {
  if (!text || textFitsLineWidth(text, measure)) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (textFitsLineWidth(text.slice(0, mid), measure)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}

export function textFitsBlockLineWidth(text: string, element: HTMLElement): boolean {
  const measure = createTextMeasureContext(element);
  if (!measure) return true;
  return textFitsLineWidth(text, measure);
}

export function truncateToBlockLineWidth(text: string, element: HTMLElement): string {
  const measure = createTextMeasureContext(element);
  if (!measure) return text;
  return truncateToLineWidth(text, measure);
}
