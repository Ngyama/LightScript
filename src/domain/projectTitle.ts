const GENERIC_PROJECT_TITLES = new Set(["", "untitled", "untitled project"]);

export function isGenericProjectTitle(title: string | undefined | null): boolean {
  const normalized = title?.trim().toLowerCase() ?? "";
  return GENERIC_PROJECT_TITLES.has(normalized);
}

export function projectFolderNameFromPath(projectPath: string): string {
  const trimmed = projectPath.trim().replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]/).filter(Boolean);
  return segments.at(-1)?.trim() ?? "";
}

/** Prefer a meaningful folder name when JSON still has a placeholder title. */
export function resolveProjectTitleFromPath(
  title: string | undefined,
  projectPath: string,
): string {
  const trimmedTitle = title?.trim() ?? "";
  if (trimmedTitle && !isGenericProjectTitle(trimmedTitle)) {
    return trimmedTitle;
  }

  const folderName = projectFolderNameFromPath(projectPath);
  if (folderName) {
    return folderName;
  }

  return trimmedTitle || "Untitled Project";
}
