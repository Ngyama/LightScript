import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateProgress = {
  /** 0âE00 when content length is known; otherwise null while downloading. */
  percent: number | null;
  status: "idle" | "checking" | "available" | "downloading" | "restarting" | "upToDate" | "error";
  message?: string;
  update?: Update | null;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppVersion(): Promise<string> {
  if (!isTauriRuntime()) {
    return "0.1.7";
  }
  try {
    return await getVersion();
  } catch {
    return "0.1.7";
  }
}

export async function checkForAppUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return check();
}

export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (percent: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let contentLength: number | undefined;

  await update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? undefined;
        onProgress?.(contentLength ? 0 : null);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (contentLength && contentLength > 0) {
          onProgress?.(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        } else {
          onProgress?.(null);
        }
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });

  await relaunch();
}

export function formatUpdateError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim() ? error.message : String(error);
  if (/404|not found|failed to fetch|error sending request|timed out/i.test(message)) {
    return "ććŞćžĺ°ĺŻç¨ć´ć°EĺŻč˝ĺ°ćŞĺĺ¸EźćEĺ˝ĺçŚťçşżEE;
  }
  return message;
}
