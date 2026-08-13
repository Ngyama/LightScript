import { describe, expect, test } from "vitest";
import {
  describeSyncStatus,
  isSyncConflictError,
  syncConflictKind,
} from "../domain/projectSync";

describe("projectSync helpers", () => {
  test("parses conflict errors", () => {
    expect(isSyncConflictError(new Error("sync_conflict:diverged"))).toBe(true);
    expect(syncConflictKind(new Error("sync_conflict:cloudAhead"))).toBe("cloudAhead");
    expect(describeSyncStatus("localAhead")).toContain("未推送");
  });
});
