export type SyncStatus =
  | "noCloud"
  | "cloudMissing"
  | "inSync"
  | "localAhead"
  | "cloudAhead"
  | "diverged"
  | "pushed"
  | "pulled";

export type SyncInspectResult = {
  status: SyncStatus | string;
  projectKey: string;
  cloudConfigured: boolean;
  localFiles: Record<string, string>;
  cloudFiles: Record<string, string>;
  lastPushAt: number | null;
  lastPullAt: number | null;
};

export type SyncTransferResult = {
  status: string;
  projectKey: string;
  transferred: number;
};

export type SyncPrefs = {
  autoPushOnLeave: boolean;
  periodicPushMinutes: number;
};

export function isSyncConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("sync_conflict:");
}

export function syncConflictKind(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const marker = "sync_conflict:";
  const index = message.indexOf(marker);
  if (index < 0) {
    return null;
  }
  return message.slice(index + marker.length).trim();
}

export function describeSyncStatus(status: string): string {
  switch (status) {
    case "noCloud":
      return "未配置云端镜像";
    case "cloudMissing":
      return "云端尚无此作品";
    case "inSync":
      return "已与云端一致";
    case "localAhead":
      return "有本地修改未推送";
    case "cloudAhead":
      return "云端有更新可拉取";
    case "diverged":
      return "本地与云端都有变更";
    default:
      return status;
  }
}
