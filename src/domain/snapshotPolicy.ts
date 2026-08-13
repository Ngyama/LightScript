import { isProjectMetaPath } from "./projectFormat";
import type { SceneBlock } from "./model";

/**
 * After edits settle, wait this long before taking an idle checkpoint snapshot.
 * Time alone never re-snapshots unchanged content — staring at a scene for an
 * hour still yields at most one idle snapshot for that stretch of work.
 */
export const SNAPSHOT_IDLE_MS = 3 * 60 * 1000;

/** Absolute char-count delta (scenes) that forces a snapshot. */
export const SNAPSHOT_MIN_CHAR_DELTA = 200;

/** Absolute payload-byte delta (project.json) that forces a snapshot. */
export const SNAPSHOT_META_BYTE_DELTA = 200;

export type SnapshotBookEntry = {
  atMs: number;
  /** Scene: char count. Meta: JSON payload length. */
  metric: number;
  /** Fingerprint of the last snapshotted payload (detects equal-length edits). */
  fingerprint: string;
};

export type SnapshotBook = Record<string, SnapshotBookEntry>;

export function countSceneBlocksChars(blocks: SceneBlock[]): number {
  if (blocks.length === 0) {
    return 0;
  }
  const combined = blocks
    .map((block) =>
      block.type === "narrative" ? block.text : block.text.replace(/[「」]/g, ""),
    )
    .join("\n");
  return combined.replace(/\s/g, "").length;
}

export function contentMetric(relativePath: string, payload: string): number {
  if (isProjectMetaPath(relativePath)) {
    return payload.length;
  }
  try {
    const parsed = JSON.parse(payload) as { blocks?: SceneBlock[] };
    if (Array.isArray(parsed.blocks)) {
      return countSceneBlocksChars(parsed.blocks);
    }
  } catch {
    // fall through
  }
  return payload.length;
}

/** Stable non-crypto fingerprint so equal-length rewrites are not treated as “no change”. */
export function payloadFingerprint(payload: string): string {
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = Math.imul(hash, 33) ^ payload.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function meaningfulDeltaThreshold(relativePath: string, previousMetric: number): number {
  if (isProjectMetaPath(relativePath)) {
    return SNAPSHOT_META_BYTE_DELTA;
  }
  return Math.max(SNAPSHOT_MIN_CHAR_DELTA, Math.floor(previousMetric * 0.05));
}

/**
 * Decide whether to copy the on-disk file into the per-scene snapshot ring
 * before overwriting it. Live autosave stays frequent; this only gates `.bak`.
 *
 * Idle rule: ≥3 minutes since last snapshot AND content actually changed
 * (fingerprint differs). Identical payloads never get another time-based snapshot.
 * Equal-length rewrites count as a real change and can pass the idle gate.
 */
export function shouldTakeFileSnapshot(args: {
  relativePath: string;
  nextPayload: string;
  previous: SnapshotBookEntry | null | undefined;
  nowMs?: number;
}): boolean {
  const nowMs = args.nowMs ?? Date.now();
  if (!args.previous) {
    // First overwrite after open: keep the opened version.
    return true;
  }

  const nextFingerprint = payloadFingerprint(args.nextPayload);
  if (args.previous.fingerprint === nextFingerprint) {
    return false;
  }

  const nextMetric = contentMetric(args.relativePath, args.nextPayload);
  const delta = Math.abs(nextMetric - args.previous.metric);
  const threshold = meaningfulDeltaThreshold(args.relativePath, args.previous.metric);
  if (delta >= threshold) {
    return true;
  }

  // Small edits and equal-length rewrites: one checkpoint after idle.
  return nowMs - args.previous.atMs >= SNAPSHOT_IDLE_MS;
}

export function recordSnapshotTaken(
  book: SnapshotBook,
  relativePath: string,
  nextPayload: string,
  nowMs: number = Date.now(),
): void {
  book[relativePath] = {
    atMs: nowMs,
    metric: contentMetric(relativePath, nextPayload),
    fingerprint: payloadFingerprint(nextPayload),
  };
}
