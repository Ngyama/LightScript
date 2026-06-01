const FALLBACK_NAME = "anonymous";

function hashName(name: string): number {
  const source = name.trim().length > 0 ? name.trim() : FALLBACK_NAME;
  // FNV-1a 32-bit
  let hash = 0x811c9dc5 | 0;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // fmix32 avalanche (MurmurHash3) — ensures short inputs scatter across all 32 bits,
  // otherwise short names (e.g. "A"/"B"/"张三"/"主角") cluster into a narrow hue range.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export interface CharacterChipColors {
  background: string;
  backgroundHover: string;
  border: string;
  foreground: string;
}

export function characterChipColors(name: string | undefined | null): CharacterChipColors | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  const hue = hashName(trimmed) % 360;
  return {
    background: `hsl(${hue}, 72%, 93%)`,
    backgroundHover: `hsl(${hue}, 70%, 87%)`,
    border: `hsl(${hue}, 50%, 78%)`,
    foreground: `hsl(${hue}, 42%, 30%)`,
  };
}

export function characterChipStyle(
  name: string | undefined | null,
): Record<string, string> {
  const colors = characterChipColors(name);
  if (!colors) return {};
  return {
    "--chip-bg": colors.background,
    "--chip-bg-hover": colors.backgroundHover,
    "--chip-border": colors.border,
    "--chip-fg": colors.foreground,
  };
}
