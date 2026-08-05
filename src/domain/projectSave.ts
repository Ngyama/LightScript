import type { Project } from "./model";
import { withLastOpenedSettings } from "./selection";

/** Rust `save_project_to_path` returns this when the on-disk hash no longer matches. */
export const EXTERNAL_UPDATE_SAVE_ERROR = "external_update";

export function projectSavePayload(
  project: Project,
  scriptId: string | undefined,
  sceneId: string | undefined,
): string {
  return JSON.stringify(withLastOpenedSettings(project, scriptId, sceneId), null, 2);
}

export type ProjectSavePlan =
  | { action: "skip-clean"; payload: string }
  | { action: "skip-external"; payload: string }
  | { action: "write"; payload: string; expectedHash: string | null };

/**
 * Decide whether a project write should proceed.
 *
 * - skip-clean: memory matches the last successful save / open snapshot → do not touch disk
 * - skip-external: disk hash drifted from our baseline → do not overwrite; surface reload UI
 * - write: proceed, optionally with an expected hash for backend compare-and-swap
 */
export function planProjectSave(args: {
  savedPayload: string | null;
  project: Project;
  scriptId: string | undefined;
  sceneId: string | undefined;
  baselineHash: string | null;
  diskHash: string | null;
}): ProjectSavePlan {
  const payload = projectSavePayload(args.project, args.scriptId, args.sceneId);

  if (args.savedPayload !== null && args.savedPayload === payload) {
    return { action: "skip-clean", payload };
  }

  if (
    args.baselineHash !== null &&
    args.diskHash !== null &&
    args.baselineHash !== args.diskHash
  ) {
    return { action: "skip-external", payload };
  }

  return {
    action: "write",
    payload,
    expectedHash: args.baselineHash,
  };
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