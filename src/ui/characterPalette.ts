import {
  characterChipColorsFromHue,
  parseCharacterHue,
  type CharacterChipColors,
} from "../domain/characterColors";

export type { CharacterChipColors } from "../domain/characterColors";
export {
  DISTINCT_CHARACTER_HUES,
  angularHueDistance,
  formatCharacterHue,
  parseCharacterHue,
  pickDistinctHue,
} from "../domain/characterColors";

export interface CharacterChipSource {
  name?: string | null;
  color?: string | null;
}

export function characterChipColors(
  source: CharacterChipSource | string | null | undefined,
): CharacterChipColors | null {
  const normalized: CharacterChipSource =
    typeof source === "string" ? { name: source } : (source ?? {});
  const hue = parseCharacterHue(normalized.color);
  if (hue !== null) {
    return characterChipColorsFromHue(hue);
  }
  const trimmed = (normalized.name ?? "").trim();
  if (!trimmed) return null;
  return characterChipColorsFromHue(hashName(trimmed) % 360);
}

export function characterChipStyle(
  source: CharacterChipSource | string | null | undefined,
): Record<string, string> {
  const colors = characterChipColors(source);
  if (!colors) return {};
  return {
    "--chip-bg": colors.background,
    "--chip-bg-hover": colors.backgroundHover,
    "--chip-border": colors.border,
    "--chip-fg": colors.foreground,
  };
}

const FALLBACK_NAME = "anonymous";

/** Legacy name-only fallback when no stored hue is available. */
function hashName(name: string): number {
  const source = name.trim().length > 0 ? name.trim() : FALLBACK_NAME;
  let hash = 0x811c9dc5 | 0;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
