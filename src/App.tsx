import { useCallback, useEffect, useRef, useState } from "react";
import "./app.css";
import {
  assertProjectInvariant,
  createDefaultProject,
  findSceneInProject,
} from "./domain/model";
import { isExternalUpdateSaveError, planProjectFilesSave } from "./domain/projectSave";
import {
  PROJECT_META_FILE,
  projectFileSnapshot,
  sceneRelativePath,
  type ProjectFileSnapshot,
} from "./domain/projectFormat";
import {
  recordSnapshotTaken,
  shouldTakeFileSnapshot,
  type SnapshotBook,
} from "./domain/snapshotPolicy";
import { useEditorStore } from "./state/editorStore";
import {
  createProject,
  deleteProject,
  deleteProjectFile,
  getCloudMirrorPath,
  getProjectFileMeta,
  getSyncPrefs,
  listConflictCopies,
  listProjects,
  loadProjectBundle,
  pickDirectory,
  getRepoPath,
  inspectProjectSync,
  pushProjectToCloud,
  saveSyncedCopies,
  setCloudMirrorPath,
  setProjectLastOpened,
  setRepoPath,
  writeProjectFile,
  type ProjectMeta,
  type ProjectSummary,
} from "./storage/projectStorage";
import type { Scene } from "./domain/model";
import { describeSyncStatus, isSyncConflictError, syncConflictKind } from "./domain/projectSync";
import { EditorCanvas } from "./ui/canvas/EditorCanvas";
import { ExportDialog } from "./ui/floating/ExportDialog";
import { ImportDialog } from "./ui/floating/ImportDialog";
import { ModalDialog } from "./ui/floating/ModalDialog";
import { ExternalUpdateDialog } from "./ui/floating/ExternalUpdateDialog";
import { RecoveryDialog } from "./ui/floating/RecoveryDialog";
import { SettingsDialog } from "./ui/floating/SettingsDialog";
import { SyncDialog } from "./ui/floating/SyncDialog";
import { UpdateAvailableDialog } from "./ui/floating/UpdateAvailableDialog";
import { SavedStatus } from "./ui/floating/SavedStatus";
import { OrbitNavigator } from "./ui/navigation/OrbitNavigator";
import { TitleBar } from "./ui/titlebar/TitleBar";
import { checkForAppUpdate } from "./updates/appUpdater";
import type { Update } from "@tauri-apps/plugin-updater";

type AppStage = "splash" | "setupRepo" | "projectHub" | "editor";

// Linear ordering used to pick a natural transition direction: moving to a
// higher index animates "forward" (new slides in from the right), lower index
// animates "backward" (new slides in from the left).
const STAGE_ORDER: Record<AppStage, number> = {
  splash: 0,
  setupRepo: 1,
  projectHub: 2,
  editor: 3,
};

const STAGE_TRANSITION_MS = 460;

// Debounce window for auto-save. Kept a little longer than instant so a project
// folder living inside Google Drive isn't hammered with uploads on every
// keystroke (which also widens the window for cross-machine conflicts).
const AUTOSAVE_DEBOUNCE_MS = 1500;

// How often we re-check whether `project.json` was changed on disk by an
// outside process (e.g. Google Drive syncing in a newer copy).
const EXTERNAL_CHECK_INTERVAL_MS = 4000;

export default function App() {
  const project = useEditorStore((state) => state.project);
  const hydrateProject = useEditorStore((state) => state.hydrateProject);
  const isHydrated = useEditorStore((state) => state.isHydrated);
  const setHydrated = useEditorStore((state) => state.setHydrated);

  const [saveInfo, setSaveInfo] = useState("尚未保存");
  const [stage, setStage] = useState<AppStage>("splash");
  const [exportTargetScene, setExportTargetScene] = useState<Scene | null>(null);
  const [importTargetScene, setImportTargetScene] = useState<Scene | null>(null);
  const selection = useEditorStore((state) => state.selection);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [isSyncOpen, setIsSyncOpen] = useState(false);
  const [repoPath, setRepoPathInput] = useState("");
  const [cloudMirrorPath, setCloudMirrorPathInput] = useState("");
  const [autoPushOnLeave, setAutoPushOnLeave] = useState(true);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [conflictCopies, setConflictCopies] = useState<string[]>([]);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const updateCheckedRef = useRef(false);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  // Joined key of the last detected conflict-copy set, so a freshly appearing
  // copy re-surfaces the banner even after a previous dismissal.
  const conflictKeyRef = useRef("");

  // Per-file fingerprints we consider "ours". Auto-save refreshes them after
  // writing so our own writes never look like an external change.
  const baselineHashesRef = useRef<Record<string, string>>({});
  // Serialized payloads from the last successful open/save, keyed by relative path.
  const savedSnapshotRef = useRef<ProjectFileSnapshot>({});
  // Per-file last `.bak` snapshot book (idle + char-delta gates).
  const snapshotBookRef = useRef<SnapshotBook>({});
  // True while an auto-save write is in flight, so the poller doesn't mistake
  // our own half-written file for an external change.
  const isSavingRef = useRef(false);
  /** If flush is requested while a save is in flight, run one more save after. */
  const pendingFlushRef = useRef(false);

  const captureSavedSnapshot = useCallback((snapshot?: ProjectFileSnapshot, metas?: Record<string, ProjectMeta | null>) => {
    const nextSnapshot = snapshot ?? projectFileSnapshot(useEditorStore.getState().project);
    savedSnapshotRef.current = nextSnapshot;
    if (metas) {
      const hashes: Record<string, string> = {};
      for (const [path, meta] of Object.entries(metas)) {
        if (meta?.hash) {
          hashes[path] = meta.hash;
        }
      }
      baselineHashesRef.current = hashes;
    }
  }, []);

  const persistLastOpened = useCallback(async () => {
    if (!activeProjectPath) {
      return;
    }
    const { selection: currentSelection } = useEditorStore.getState();
    await setProjectLastOpened(activeProjectPath, {
      lastScriptId: currentSelection.scriptId,
      lastSceneId: currentSelection.sceneId,
    });
  }, [activeProjectPath]);

  const persistProjectIfNeeded = useCallback(
    async (options?: { silent?: boolean }): Promise<"saved" | "skipped" | "external" | "error"> => {
      if (!activeProjectPath || externalUpdate) {
        return "skipped";
      }
      const { project: currentProject } = useEditorStore.getState();
      const nextSnapshot = projectFileSnapshot(currentProject);
      const paths = new Set([
        ...Object.keys(savedSnapshotRef.current),
        ...Object.keys(nextSnapshot),
      ]);
      const diskHashes: Record<string, string | null> = {};
      await Promise.all(
        [...paths].map(async (relativePath) => {
          const meta = await getProjectFileMeta(activeProjectPath, relativePath);
          diskHashes[relativePath] = meta?.hash ?? null;
        }),
      );

      const plan = planProjectFilesSave({
        project: currentProject,
        savedSnapshot: savedSnapshotRef.current,
        baselineHashes: baselineHashesRef.current,
        diskHashes,
      });

      if (plan.hasExternal) {
        setExternalUpdate(true);
        return "external";
      }
      if (plan.allClean) {
        await persistLastOpened();
        return "skipped";
      }

      try {
        for (const write of plan.writes) {
          const takeSnapshot = shouldTakeFileSnapshot({
            relativePath: write.relativePath,
            nextPayload: write.payload,
            previous: snapshotBookRef.current[write.relativePath],
          });
          const meta = await writeProjectFile(
            activeProjectPath,
            write.relativePath,
            write.payload,
            write.expectedHash,
            takeSnapshot,
          );
          if (takeSnapshot) {
            recordSnapshotTaken(
              snapshotBookRef.current,
              write.relativePath,
              write.payload,
            );
          }
          if (meta?.hash) {
            baselineHashesRef.current[write.relativePath] = meta.hash;
          }
        }
        for (const del of plan.deletes) {
          await deleteProjectFile(activeProjectPath, del.relativePath, del.expectedHash);
          delete baselineHashesRef.current[del.relativePath];
        }
        savedSnapshotRef.current = nextSnapshot;
        for (const path of Object.keys(baselineHashesRef.current)) {
          if (nextSnapshot[path] === undefined) {
            delete baselineHashesRef.current[path];
          }
        }

        await persistLastOpened();
        if (!options?.silent) {
          setSaveInfo(`已保存 · ${new Date().toLocaleTimeString()}`);
        }
        return "saved";
      } catch (error) {
        if (isExternalUpdateSaveError(error)) {
          setExternalUpdate(true);
          return "external";
        }
        throw error;
      }
    },
    [activeProjectPath, externalUpdate, persistLastOpened],
  );

  const applyConflictCopies = useCallback((copies: string[]) => {
    const key = copies.join("\u0000");
    if (key !== conflictKeyRef.current) {
      conflictKeyRef.current = key;
      // A new (or newly cleared) set of copies un-dismisses the banner.
      setConflictDismissed(false);
    }
    setConflictCopies(copies);
  }, []);

  // Cross-fade/slide transition between stages. We keep the outgoing stage
  // mounted for one animation cycle so it can animate out while the new one
  // animates in. prevStage must be set in the same render as stage — setting
  // it in an effect leaves one frame with only the new stage (editor flashes
  // twice when leaving: unmount → remount as exit layer).
  const [prevStage, setPrevStage] = useState<AppStage | null>(null);
  const [transitionDir, setTransitionDir] = useState<"forward" | "backward">("forward");
  const lastStageRef = useRef<AppStage>(stage);
  const stageTransitionTimerRef = useRef<number | null>(null);

  const navigateStage = useCallback((next: AppStage) => {
    const previous = lastStageRef.current;
    if (previous === next) {
      return;
    }
    setTransitionDir(STAGE_ORDER[next] >= STAGE_ORDER[previous] ? "forward" : "backward");
    setPrevStage(previous);
    setStage(next);
    lastStageRef.current = next;
    if (stageTransitionTimerRef.current !== null) {
      window.clearTimeout(stageTransitionTimerRef.current);
    }
    stageTransitionTimerRef.current = window.setTimeout(() => {
      setPrevStage(null);
      stageTransitionTimerRef.current = null;
    }, STAGE_TRANSITION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (stageTransitionTimerRef.current !== null) {
        window.clearTimeout(stageTransitionTimerRef.current);
      }
    };
  }, []);

  // Quiet background update check once the splash screen is gone.
  useEffect(() => {
    if (stage === "splash" || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const update = await checkForAppUpdate();
        if (!cancelled && update) {
          setPendingUpdate(update);
        }
      } catch {
        // No release yet, offline, or unsigned local build — stay quiet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // Bootstrap pre-loads repo path + project list in the background so the
  // hub can render instantly when the user clicks through from the splash.
  // The stage stays at "splash" until the user explicitly proceeds.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const savedRepoPath = await getRepoPath();
        if (cancelled) return;
        if (savedRepoPath) {
          setRepoPathInput(savedRepoPath);
          const [projects, cloud, prefs] = await Promise.all([
            listProjects(),
            getCloudMirrorPath(),
            getSyncPrefs(),
          ]);
          if (cancelled) return;
          setProjectList(projects);
          setCloudMirrorPathInput(cloud ?? "");
          setAutoPushOnLeave(prefs.autoPushOnLeave);
        } else {
          const [cloud, prefs] = await Promise.all([getCloudMirrorPath(), getSyncPrefs()]);
          if (cancelled) return;
          setCloudMirrorPathInput(cloud ?? "");
          setAutoPushOnLeave(prefs.autoPushOnLeave);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "初始化失败。");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [setHydrated]);

  useEffect(() => {
    if (isCreatingProject) {
      newProjectInputRef.current?.focus();
      newProjectInputRef.current?.select();
    }
  }, [isCreatingProject]);

  useEffect(() => {
    // Hold off auto-saving while an external update is waiting for the user's
    // decision, otherwise we'd silently overwrite the incoming changes.
    if (!isHydrated || stage !== "editor" || !activeProjectPath || externalUpdate) {
      return;
    }
    const timeout = window.setTimeout(() => {
      isSavingRef.current = true;
      void persistProjectIfNeeded()
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "自动保存失败。");
        })
        .finally(() => {
          isSavingRef.current = false;
        });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [activeProjectPath, externalUpdate, isHydrated, persistProjectIfNeeded, project, selection, stage]);

  useEffect(() => {
    if (!isHydrated || stage !== "editor" || !activeProjectPath || externalUpdate) {
      return;
    }

    const flushSave = (): void => {
      if (isSavingRef.current) {
        pendingFlushRef.current = true;
        return;
      }
      isSavingRef.current = true;
      void persistProjectIfNeeded({ silent: true })
        .catch(() => {
          // Flush failures are non-fatal; the next autosave or open will retry.
        })
        .finally(() => {
          isSavingRef.current = false;
          if (pendingFlushRef.current) {
            pendingFlushRef.current = false;
            flushSave();
          }
        });
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        flushSave();
      }
    };

    window.addEventListener("beforeunload", flushSave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushSave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeProjectPath, externalUpdate, isHydrated, persistProjectIfNeeded, stage]);

  // Poll project.json + the active scene file for external Drive updates.
  useEffect(() => {
    if (!isHydrated || stage !== "editor" || !activeProjectPath || externalUpdate) {
      return;
    }
    let cancelled = false;
    const interval = window.setInterval(() => {
      if (isSavingRef.current) {
        return;
      }
      const { selection: currentSelection } = useEditorStore.getState();
      const watched = [PROJECT_META_FILE];
      if (currentSelection.scriptId && currentSelection.sceneId) {
        watched.push(sceneRelativePath(currentSelection.scriptId, currentSelection.sceneId));
      }
      void Promise.all(
        watched.map(async (relativePath) => {
          const meta = await getProjectFileMeta(activeProjectPath, relativePath);
          if (cancelled || !meta) {
            return;
          }
          const baseline = baselineHashesRef.current[relativePath];
          if (baseline && meta.hash !== baseline) {
            setExternalUpdate(true);
          }
        }),
      ).catch(() => {
        // Transient read errors (e.g. file mid-sync) are ignored; the next
        // tick will retry.
      });
      void listConflictCopies(activeProjectPath)
        .then((copies) => {
          if (!cancelled) {
            applyConflictCopies(copies);
          }
        })
        .catch(() => {
          // Ignore; retried on the next tick.
        });
    }, EXTERNAL_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeProjectPath, applyConflictCopies, externalUpdate, isHydrated, stage]);

  // When the user focuses another scene, refresh that file's baseline so a
  // Drive update to an inactive scene is noticed before the next edit/save.
  useEffect(() => {
    if (!isHydrated || stage !== "editor" || !activeProjectPath || externalUpdate) {
      return;
    }
    if (!selection.scriptId || !selection.sceneId) {
      return;
    }
    const relativePath = sceneRelativePath(selection.scriptId, selection.sceneId);
    let cancelled = false;
    void getProjectFileMeta(activeProjectPath, relativePath)
      .then((meta) => {
        if (cancelled || !meta) {
          return;
        }
        const baseline = baselineHashesRef.current[relativePath];
        if (baseline && meta.hash !== baseline) {
          setExternalUpdate(true);
          return;
        }
        // First time visiting this scene in-session, or file matches: adopt disk hash.
        if (!baseline || meta.hash === baseline) {
          baselineHashesRef.current[relativePath] = meta.hash;
        }
      })
      .catch(() => {
        // Ignore transient read errors.
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeProjectPath,
    externalUpdate,
    isHydrated,
    selection.sceneId,
    selection.scriptId,
    stage,
  ]);

  const refreshProjectList = async () => {
    const projects = await listProjects();
    setProjectList(projects);
  };

  const applyRepoPathChange = async (nextPath: string): Promise<boolean> => {
    const trimmedPath = nextPath.trim();
    if (!trimmedPath) {
      setErrorMessage("本地作品库路径不能为空。");
      return false;
    }
    try {
      await setRepoPath(trimmedPath);
      setErrorMessage(null);
      setRepoPathInput(trimmedPath);
      setActiveProjectPath(null);
      await refreshProjectList();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法保存本地作品库路径。");
      return false;
    }
  };

  const handleRepoSave = async () => {
    const ok = await applyRepoPathChange(repoPath);
    if (!ok) {
      return;
    }
    const cloud = cloudMirrorPath.trim();
    if (cloud) {
      try {
        await setCloudMirrorPath(cloud);
        setCloudMirrorPathInput(cloud);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "无法保存云端镜像路径。");
        return;
      }
    }
    navigateStage("projectHub");
  };

  const handleBrowseRepoPath = async () => {
    try {
      const selected = await pickDirectory();
      if (selected) {
        await applyRepoPathChange(selected);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法打开文件夹选择器。");
    }
  };

  const handleBrowseCloudPath = async () => {
    try {
      const selected = await pickDirectory();
      if (!selected) {
        return;
      }
      await setCloudMirrorPath(selected);
      setCloudMirrorPathInput(selected);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法设置云端镜像。");
    }
  };

  const maybeAutoPush = async (projectPath: string) => {
    if (!autoPushOnLeave || !cloudMirrorPath.trim()) {
      return;
    }
    try {
      await pushProjectToCloud(projectPath, false);
      setSaveInfo("已自动同步到云端");
    } catch (error) {
      if (isSyncConflictError(error)) {
        const kind = syncConflictKind(error) ?? "diverged";
        setErrorMessage(
          `离开时未能自动同步（${describeSyncStatus(kind)}）。请重新打开作品后使用顶栏「同步」。`,
        );
        return;
      }
      setErrorMessage(
        error instanceof Error
          ? `离开时未能自动同步：${error.message}`
          : "离开时未能自动同步。请稍后手动同步。",
      );
    }
  };

  const leaveToHub = async () => {
    const leavingPath = activeProjectPath;
    if (leavingPath && !externalUpdate) {
      try {
        const started = Date.now();
        while (isSavingRef.current && Date.now() - started < 8000) {
          await new Promise((resolve) => window.setTimeout(resolve, 40));
        }
        isSavingRef.current = true;
        try {
          await persistProjectIfNeeded({ silent: true });
        } finally {
          isSavingRef.current = false;
        }
        if (pendingFlushRef.current) {
          pendingFlushRef.current = false;
          isSavingRef.current = true;
          try {
            await persistProjectIfNeeded({ silent: true });
          } finally {
            isSavingRef.current = false;
          }
        }
        await maybeAutoPush(leavingPath);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "离开前保存失败。");
      }
    }
    navigateStage("projectHub");
  };

  const handleHub = () => {
    void leaveToHub();
  };

  const handleOpenProject = async (summary: ProjectSummary) => {
    try {
      const bundle = await loadProjectBundle(summary.path);
      assertProjectInvariant(bundle.project);
      hydrateProject(bundle.project, bundle.lastOpened);
      captureSavedSnapshot(bundle.fileSnapshot, bundle.fileMetas);
      snapshotBookRef.current = {};
      setExternalUpdate(false);
      applyConflictCopies(await listConflictCopies(summary.path));
      setActiveProjectPath(summary.path);
      setSaveInfo(
        bundle.migrated
          ? `已打开 ${summary.name}（已迁移为分 Scene 存储）`
          : `已打开 ${summary.name}`,
      );
      setErrorMessage(null);
      navigateStage("editor");
      void inspectAndHintCloud(summary.path);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开作品失败。");
    }
  };

  const inspectAndHintCloud = async (projectPath: string) => {
    if (!cloudMirrorPath.trim()) {
      return;
    }
    try {
      const info = await inspectProjectSync(projectPath);
      if (info.status === "cloudAhead" || info.status === "diverged") {
        setSaveInfo(`同步提示：${describeSyncStatus(info.status)}（可点顶栏「同步」）`);
      }
    } catch {
      // ignore
    }
  };

  const handleReloadExternal = async () => {
    if (!activeProjectPath) {
      setExternalUpdate(false);
      return;
    }
    try {
      const bundle = await loadProjectBundle(activeProjectPath);
      assertProjectInvariant(bundle.project);
      hydrateProject(bundle.project, bundle.lastOpened);
      captureSavedSnapshot(bundle.fileSnapshot, bundle.fileMetas);
      snapshotBookRef.current = {};
      setExternalUpdate(false);
      setSaveInfo(`已加载同步版本 · ${new Date().toLocaleTimeString()}`);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载同步版本失败。");
    }
  };

  const handleKeepLocal = async () => {
    // Keep this version: adopt current on-disk fingerprints as baseline so the
    // next autosave can overwrite synced files with in-memory content.
    if (activeProjectPath) {
      try {
        const paths = Object.keys(savedSnapshotRef.current);
        await Promise.all(
          paths.map(async (relativePath) => {
            const meta = await getProjectFileMeta(activeProjectPath, relativePath);
            if (meta?.hash) {
              baselineHashesRef.current[relativePath] = meta.hash;
            }
          }),
        );
      } catch {
        // Ignore; a failed refresh just means we may prompt again later.
      }
    }
    setExternalUpdate(false);
  };

  const handleSaveBoth = async () => {
    if (!activeProjectPath) {
      setExternalUpdate(false);
      return;
    }
    try {
      const drifted: string[] = [];
      for (const relativePath of Object.keys(savedSnapshotRef.current)) {
        const meta = await getProjectFileMeta(activeProjectPath, relativePath);
        const baseline = baselineHashesRef.current[relativePath];
        if (meta?.hash && baseline && meta.hash !== baseline) {
          drifted.push(relativePath);
        }
      }
      // Always include active scene + meta if present on disk.
      if (!drifted.includes(PROJECT_META_FILE)) {
        drifted.push(PROJECT_META_FILE);
      }
      const written = await saveSyncedCopies(activeProjectPath, drifted);
      await handleKeepLocal();
      setSaveInfo(
        written.length > 0
          ? `已另存同步副本（${written.length} 个）到 .lightscript/saved-both`
          : "已保留当前编辑内容——未找到可另存的同步文件",
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "两个都保留失败。");
    }
  };

  const handleConfirmDelete = async () => {
    const summary = pendingDelete;
    setPendingDelete(null);
    if (!summary) {
      return;
    }
    try {
      await deleteProject(summary.path);
      if (activeProjectPath === summary.path) {
        setActiveProjectPath(null);
      }
      await refreshProjectList();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除作品失败。");
    }
  };

  const handleCreateProject = async () => {
    const trimmedName = newProjectName.trim();
    if (!trimmedName) {
      setErrorMessage("作品名称不能为空。");
      return;
    }

    try {
      const created = createDefaultProject();
      created.title = trimmedName;
      const summary = await createProject(trimmedName, created);
      await refreshProjectList();
      setNewProjectName("");
      setIsCreatingProject(false);
      await handleOpenProject(summary);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建作品失败。");
    }
  };

  const handleSplashEnterHub = async () => {
    setErrorMessage(null);
    // If repo isn't set yet, route to setup; once saved that flow auto-advances
    // back to the hub.
    if (!repoPath.trim()) {
      navigateStage("setupRepo");
      return;
    }
    // Refresh in case projects were created/deleted out-of-band since bootstrap.
    try {
      await refreshProjectList();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法列出作品。");
    }
    navigateStage("projectHub");
  };

  const handleImport = () => {
    if (!activeProjectPath) return;
    const { selection } = useEditorStore.getState();
    const scene = findSceneInProject(project, selection.sceneId);
    if (!scene) {
      setErrorMessage("当前没有选中的 Scene。");
      return;
    }
    setImportTargetScene(scene);
  };

  const handleExport = () => {
    if (!activeProjectPath) return;
    const { selection } = useEditorStore.getState();
    const scene = findSceneInProject(project, selection.sceneId);
    if (!scene) {
      setErrorMessage("当前没有选中的 Scene。");
      return;
    }
    // Snapshot the scene at open time so the dialog isn't affected if the
    // user navigates around (or edits) while it's open.
    setExportTargetScene(scene);
  };

  const handleSettings = () => setIsSettingsOpen(true);

  const titleBarLabel = stage === "editor" ? project.title || "未命名作品" : "LightScript";

  const renderStageContent = (currentStage: AppStage) => {
    if (currentStage === "splash") {
      return (
        <div className="splash-screen">
            <h1 className="splash-title">Light Script</h1>
            <button
              type="button"
              className="splash-cta"
              onClick={() => {
                void handleSplashEnterHub();
              }}
              disabled={!isHydrated}
            >
              进入作品库
            </button>
          {errorMessage && <p className="error splash-error">{errorMessage}</p>}
        </div>
      );
    }

    if (currentStage === "setupRepo") {
      return (
        <div className="startup-screen">
          <div className="startup-card">
            <h1>设置本地作品库</h1>
            <p>
              选择本机磁盘上的一个文件夹作为唯一工作台。自动保存与快照都写在这里。
            </p>
            <p className="startup-hint">
              请不要把作品库直接建在 Google Drive 里。需要多设备时，在下方（或之后在设置里）绑定云端镜像文件夹，再用「同步」推送。
            </p>
            <input
              value={repoPath}
              onChange={(event) => setRepoPathInput(event.target.value)}
              placeholder="D:\\Writing\\LightScriptLibrary"
            />
            <button type="button" onClick={() => void handleBrowseRepoPath()}>
              选择本地文件夹
            </button>
            <p className="startup-hint">云端镜像（可选）</p>
            <input
              value={cloudMirrorPath}
              onChange={(event) => setCloudMirrorPathInput(event.target.value)}
              placeholder="G:\\My Drive\\LightScriptMirror"
            />
            <button type="button" onClick={() => void handleBrowseCloudPath()}>
              选择云端文件夹
            </button>
            <button type="button" onClick={() => void handleRepoSave()}>
              保存并进入作品库
            </button>
            {errorMessage && <p className="error">{errorMessage}</p>}
          </div>
        </div>
      );
    }

    if (currentStage === "projectHub") {
      const startCreateTile = () => {
        setNewProjectName("");
        setIsCreatingProject(true);
      };
      const cancelCreateTile = () => {
        setNewProjectName("");
        setIsCreatingProject(false);
      };

      return (
        <div className="hub-screen">
            <div className="hub-topbar">
              <button
                type="button"
                className="hub-topbar-button"
                onClick={() => void handleBrowseRepoPath()}
                title="更改本地作品库文件夹"
              >
                本地库
              </button>
              <button
                type="button"
                className="hub-topbar-button"
                onClick={() => void handleBrowseCloudPath()}
                title="绑定或更换云端镜像文件夹"
              >
                云端
              </button>
              <div className="hub-topbar-path" title={repoPath}>
                {repoPath || "未选择本地作品库"}
                {cloudMirrorPath ? ` · 云：${cloudMirrorPath}` : " · 未绑云端"}
              </div>
            </div>

            <div className="hub-content">
              <div className="hub-grid">
                {isCreatingProject ? (
                  <div className="hub-tile hub-tile--new is-editing">
                    <input
                      ref={newProjectInputRef}
                      className="hub-tile-new-input"
                      value={newProjectName}
                      placeholder="作品名称"
                      onChange={(event) => setNewProjectName(event.target.value)}
                      onBlur={() => {
                        if (newProjectName.trim()) {
                          void handleCreateProject();
                        } else {
                          cancelCreateTile();
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleCreateProject();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelCreateTile();
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="hub-tile hub-tile--new"
                    onClick={startCreateTile}
                    title="创建新作品"
                  >
                    <span className="hub-tile-new-plus" aria-hidden="true">+</span>
                    <span className="hub-tile-new-label">新建作品</span>
                  </button>
                )}
                {projectList.map((entry) => (
                  <div key={entry.path} className="hub-tile-wrapper">
                    <button
                      type="button"
                      className="hub-tile"
                      onClick={() => {
                        void handleOpenProject(entry);
                      }}
                      title={entry.path}
                    >
                      <span className="hub-tile-name">{entry.name}</span>
                      <span className="hub-tile-path">{entry.path}</span>
                    </button>
                    <button
                      type="button"
                      className="hub-tile-delete"
                      aria-label={`删除 ${entry.name}`}
                      title={`删除 ${entry.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDelete(entry);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {projectList.length === 0 && !isCreatingProject && (
                <p className="hub-empty-hint">
                  还没有作品。点击上方 + 创建第一部。
                </p>
              )}
            </div>

          {errorMessage && <p className="error hub-error">{errorMessage}</p>}
        </div>
      );
    }

    return (
      <div className="app-shell">
        <EditorCanvas />
        <OrbitNavigator />
        <SavedStatus text={saveInfo} />
        {errorMessage && <p className="error global-error">{errorMessage}</p>}
        {exportTargetScene && (
          <ExportDialog
            scene={exportTargetScene}
            project={project}
            currentScriptId={selection.scriptId}
            onClose={() => setExportTargetScene(null)}
            onComplete={(message) => {
              setErrorMessage(null);
              setSaveInfo(message);
            }}
            onError={(message) => setErrorMessage(message)}
          />
        )}
        {importTargetScene && (
          <ImportDialog
            scene={importTargetScene}
            onClose={() => setImportTargetScene(null)}
            onComplete={(message) => {
              setErrorMessage(null);
              setSaveInfo(message);
            }}
            onError={(message) => setErrorMessage(message)}
          />
        )}
        {isSettingsOpen && (
          <SettingsDialog
            onClose={() => setIsSettingsOpen(false)}
            onUpdateAvailable={(update) => setPendingUpdate(update)}
            onLibraryPathsChanged={async () => {
              const [repo, cloud, prefs] = await Promise.all([
                getRepoPath(),
                getCloudMirrorPath(),
                getSyncPrefs(),
              ]);
              setRepoPathInput(repo ?? "");
              setCloudMirrorPathInput(cloud ?? "");
              setAutoPushOnLeave(prefs.autoPushOnLeave);
              if (repo) {
                await refreshProjectList();
              }
            }}
          />
        )}
        {isSyncOpen && activeProjectPath && (
          <SyncDialog
            projectPath={activeProjectPath}
            projectName={project.title || "未命名作品"}
            onClose={() => setIsSyncOpen(false)}
            onPulled={async () => {
              const bundle = await loadProjectBundle(activeProjectPath);
              assertProjectInvariant(bundle.project);
              hydrateProject(bundle.project, bundle.lastOpened);
              captureSavedSnapshot(bundle.fileSnapshot, bundle.fileMetas);
              snapshotBookRef.current = {};
            }}
            onMessage={(message) => {
              setErrorMessage(null);
              setSaveInfo(message);
            }}
            onError={(message) => setErrorMessage(message)}
          />
        )}
        {pendingUpdate && (
          <UpdateAvailableDialog
            update={pendingUpdate}
            onClose={() => setPendingUpdate(null)}
          />
        )}
      </div>
    );
  };

  return (
    <div className="app-frame">
      <TitleBar
        title={titleBarLabel}
        showSearch={stage === "editor"}
        actions={
          stage === "editor"
            ? [
                { label: "导入", onClick: handleImport },
                { label: "导出", onClick: handleExport },
                {
                  label: "同步",
                  onClick: () => setIsSyncOpen(true),
                },
                {
                  label: "备份与恢复",
                  onClick: () => setIsRecoveryOpen(true),
                },
                { label: "作品库", onClick: handleHub },
                { label: "设置", onClick: handleSettings },
              ]
            : undefined
        }
      />
      <div className="app-body">
        <div className="stage-stack">
          {prevStage && (
            <div
              key={prevStage}
              className={`stage-layer stage-exit stage-${transitionDir}`}
            >
              {renderStageContent(prevStage)}
            </div>
          )}
          <div
            key={stage}
            className={`stage-layer stage-enter stage-${transitionDir}`}
          >
            {renderStageContent(stage)}
          </div>
        </div>
        {stage === "editor" && conflictCopies.length > 0 && !conflictDismissed && (
          <div className="conflict-banner" role="alert">
            <div className="conflict-banner-body">
              <strong>
                发现 {conflictCopies.length} 个其他版本文件
              </strong>
              <span className="conflict-banner-detail">
                可能是两台设备同时编辑时，Google Drive 留下的额外副本。LightScript
                会读取 <code>project.json</code> 与 <code>scripts/</code>{" "}
                下的 Scene 文件。请在文件管理器中查看：
                {conflictCopies.join(", ")}
              </span>
            </div>
            <button
              type="button"
              className="conflict-banner-dismiss"
              onClick={() => setConflictDismissed(true)}
            >
              知道了
            </button>
          </div>
        )}
        {externalUpdate && stage === "editor" && (
          <ExternalUpdateDialog
            onUseSynced={() => {
              void handleReloadExternal();
            }}
            onKeepThis={() => {
              void handleKeepLocal();
            }}
            onSaveBoth={() => {
              void handleSaveBoth();
            }}
          />
        )}
        {isRecoveryOpen && activeProjectPath && (
          <RecoveryDialog
            projectPath={activeProjectPath}
            onClose={() => setIsRecoveryOpen(false)}
            onRestored={(message, options) => {
              setErrorMessage(null);
              setSaveInfo(message);
              if (options?.reload) {
                void handleReloadExternal().then(() => {
                  setSaveInfo(message);
                });
              }
            }}
            onError={(message) => setErrorMessage(message)}
          />
        )}
        {pendingDelete && (
          <ModalDialog
            title="删除作品"
            message={`「${pendingDelete.name}」及其磁盘上的文件夹将被永久删除，无法撤销。`}
            confirmText="删除"
            cancelText="取消"
            variant="danger"
            onConfirm={() => {
              void handleConfirmDelete();
            }}
            onClose={() => setPendingDelete(null)}
          />
        )}
      </div>
    </div>
  );
}
