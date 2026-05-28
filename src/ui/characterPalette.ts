const FALLBACK_NAME = "anonymous";

function hashName(name: string): number {
  const source = name.trim().length > 0 ? name.trim() : FALLBACK_NAME;
  let hash = 5381;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
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
