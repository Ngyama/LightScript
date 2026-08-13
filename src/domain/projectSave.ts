import type { Project } from "./model";
import {
  listProjectFileEntries,
  projectFileSnapshot,
  removedProjectFiles,
  type ProjectFileSnapshot,
} from "./projectFormat";

/** Backend returns this when an on-disk hash no longer matches. */
export const EXTERNAL_UPDATE_SAVE_ERROR = "external_update";

export type FileSavePlan =
  | { action: "skip-clean"; relativePath: string; payload: string }
  | { action: "skip-external"; relativePath: string; payload: string }
  | { action: "write"; relativePath: string; payload: string; expectedHash: string | null }
  | { action: "delete"; relativePath: string; expectedHash: string | null };

export type ProjectFilesSavePlan = {
  /** True when every file is skip-clean and there are no deletes. */
  allClean: boolean;
  /** True when any file hit skip-external. */
  hasExternal: boolean;
  writes: Extract<FileSavePlan, { action: "write" }>[];
  deletes: Extract<FileSavePlan, { action: "delete" }>[];
};

export function planSingleFileSave(args: {
  relativePath: string;
  savedPayload: string | null | undefined;
  nextPayload: string;
  baselineHash: string | null | undefined;
  diskHash: string | null | undefined;
}): FileSavePlan {
  if (args.savedPayload != null && args.savedPayload === args.nextPayload) {
    return {
      action: "skip-clean",
      relativePath: args.relativePath,
      payload: args.nextPayload,
    };
  }

  const baselineHash = args.baselineHash ?? null;
  const diskHash = args.diskHash ?? null;
  if (baselineHash !== null && diskHash !== null && baselineHash !== diskHash) {
    return {
      action: "skip-external",
      relativePath: args.relativePath,
      payload: args.nextPayload,
    };
  }

  return {
    action: "write",
    relativePath: args.relativePath,
    payload: args.nextPayload,
    expectedHash: baselineHash,
  };
}

/**
 * Diff in-memory project against last saved per-file snapshots and plan writes/deletes.
 * Does not include last-opened (that lives in app-local settings).
 */
export function planProjectFilesSave(args: {
  project: Project;
  savedSnapshot: ProjectFileSnapshot | null;
  baselineHashes: Record<string, string | null | undefined>;
  diskHashes: Record<string, string | null | undefined>;
}): ProjectFilesSavePlan {
  const nextSnapshot = projectFileSnapshot(args.project);
  const previousSnapshot = args.savedSnapshot ?? {};
  const writes: Extract<FileSavePlan, { action: "write" }>[] = [];
  const deletes: Extract<FileSavePlan, { action: "delete" }>[] = [];
  let allClean = true;
  let hasExternal = false;

  for (const entry of listProjectFileEntries(args.project)) {
    const plan = planSingleFileSave({
      relativePath: entry.relativePath,
      savedPayload: previousSnapshot[entry.relativePath],
      nextPayload: entry.payload,
      baselineHash: args.baselineHashes[entry.relativePath],
      diskHash: args.diskHashes[entry.relativePath],
    });
    if (plan.action === "skip-clean") {
      continue;
    }
    allClean = false;
    if (plan.action === "skip-external") {
      hasExternal = true;
      continue;
    }
    if (plan.action === "write") {
      writes.push(plan);
    }
  }

  if (hasExternal) {
    return { allClean: false, hasExternal: true, writes: [], deletes: [] };
  }

  // Scenes before meta so a crash mid-save never leaves catalog pointing at missing bodies.
  writes.sort((a, b) => {
    const aMeta = a.relativePath === "project.json" ? 1 : 0;
    const bMeta = b.relativePath === "project.json" ? 1 : 0;
    return aMeta - bMeta;
  });

  for (const relativePath of removedProjectFiles(previousSnapshot, nextSnapshot)) {
    allClean = false;
    const baselineHash = args.baselineHashes[relativePath] ?? null;
    const diskHash = args.diskHashes[relativePath] ?? null;
    if (baselineHash !== null && diskHash !== null && baselineHash !== diskHash) {
      return { allClean: false, hasExternal: true, writes: [], deletes: [] };
    }
    deletes.push({
      action: "delete",
      relativePath,
      expectedHash: baselineHash,
    });
  }

  return { allClean, hasExternal: false, writes, deletes };
}

export function isExternalUpdateSaveError(error: unknown): boolean {
  if (typeof error === "string") {
    return error === EXTERNAL_UPDATE_SAVE_ERROR || error.includes(EXTERNAL_UPDATE_SAVE_ERROR);
  }
  if (error instanceof Error) {
    return (
      error.message === EXTERNAL_UPDATE_SAVE_ERROR ||
      error.message.includes(EXTERNAL_UPDATE_SAVE_ERROR)
    );
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    return message === EXTERNAL_UPDATE_SAVE_ERROR || message.includes(EXTERNAL_UPDATE_SAVE_ERROR);
  }
  return false;
}
