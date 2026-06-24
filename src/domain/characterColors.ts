/** Hand-picked hues spaced ~30° apart for maximum contrast at low character counts. */
export const DISTINCT_CHARACTER_HUES = [
  12, 36, 62, 98, 132, 168, 198, 228, 258, 288, 318, 348,
] as const;

export function angularHueDistance(a: number, b: number): number {
  const diff = Math.abs((a % 360) - (b % 360));
  return Math.min(diff, 360 - diff);
}

export function parseCharacterHue(color: string | undefined | null): number | null {
  if (!color) return null;
  const trimmed = color.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return ((Math.round(value) % 360) + 360) % 360;
}

export function formatCharacterHue(hue: number): string {
  return String(((Math.round(hue) % 360) + 360) % 360);
}

/** Pick the palette hue farthest from hues already in use. */
export function pickDistinctHue(usedHues: readonly number[]): number {
  const used = usedHues.map((hue) => ((Math.round(hue) % 360) + 360) % 360);

  let bestPaletteHue: number | null = null;
  let bestPaletteScore = -1;
  for (const candidate of DISTINCT_CHARACTER_HUES) {
    if (used.includes(candidate)) continue;
    const score =
      used.length === 0
        ? 180
        : Math.min(...used.map((hue) => angularHueDistance(candidate, hue)));
    if (score > bestPaletteScore) {
      bestPaletteScore = score;
      bestPaletteHue = candidate;
    }
  }
  if (bestPaletteHue !== null) {
    return bestPaletteHue;
  }

  let bestHue = 0;
  let bestScore = -1;
  for (let candidate = 0; candidate < 360; candidate += 3) {
    const score =
      used.length === 0
        ? 180
        : Math.min(...used.map((hue) => angularHueDistance(candidate, hue)));
    if (score > bestScore) {
      bestScore = score;
      bestHue = candidate;
    }
  }
  return bestHue;
}

export interface CharacterChipColors {
  background: string;
  backgroundHover: string;
  border: string;
  foreground: string;
}

export function characterChipColorsFromHue(hue: number): CharacterChipColors {
  const normalized = ((Math.round(hue) % 360) + 360) % 360;
  return {
    background: `hsl(${normalized}, 72%, 93%)`,
    backgroundHover: `hsl(${normalized}, 70%, 87%)`,
    border: `hsl(${normalized}, 50%, 78%)`,
    foreground: `hsl(${normalized}, 42%, 30%)`,
  };
}
