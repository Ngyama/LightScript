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
import { useEditorStore } from "./state/editorStore";
import {
  createProject,
  deleteProject,
  deleteProjectFile,
  getProjectFileMeta,
  listConflictCopies,
  listProjects,
  loadProjectBundle,
  pickDirectory,
  getRepoPath,
  setProjectLastOpened,
  setRepoPath,
  writeProjectFile,
  type ProjectMeta,
  type ProjectSummary,
} from "./storage/projectStorage";
import type { Scene } from "./domain/model";
import { EditorCanvas } from "./ui/canvas/EditorCanvas";
import { ExportDialog } from "./ui/floating/ExportDialog";
import { ImportDialog } from "./ui/floating/ImportDialog";
import { ModalDialog } from "./ui/floating/ModalDialog";
import { SettingsDialog } from "./ui/floating/SettingsDialog";
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

  const [saveInfo, setSaveInfo] = useState("Not saved yet");
  const [stage, setStage] = useState<AppStage>("splash");
  const [exportTargetScene, setExportTargetScene] = useState<Scene | null>(null);
  const [importTargetScene, setImportTargetScene] = useState<Scene | null>(null);
  const selection = useEditorStore((state) => state.selection);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [repoPath, setRepoPathInput] = useState("");
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
  // True while an auto-save write is in flight, so the poller doesn't mistake
  // our own half-written file for an external change.
  const isSavingRef = useRef(false);

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
          const meta = await writeProjectFile(
            activeProjectPath,
            write.relativePath,
            write.payload,
            write.expectedHash,
          );
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
          setSaveInfo(`Saved at ${new Date().toLocaleTimeString()}`);
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
  // animates in. Driven purely off `stage` via a ref so the timer is never
  // cancelled by an unrelated re-render.
  const [prevStage, setPrevStage] = useState<AppStage | null>(null);
  const [transitionDir, setTransitionDir] = useState<"forward" | "backward">("forward");
  const lastStageRef = useRef<AppStage>(stage);

  useEffect(() => {
    const previous = lastStageRef.current;
    if (previous === stage) return;
    setTransitionDir(STAGE_ORDER[stage] >= STAGE_ORDER[previous] ? "forward" : "backward");
    setPrevStage(previous);
    lastStageRef.current = stage;
    const timer = window.setTimeout(() => setPrevStage(null), STAGE_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

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
          const projects = await listProjects();
          if (cancelled) return;
          setProjectList(projects);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to initialize app.");
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
          setErrorMessage(error instanceof Error ? error.message : "Auto-save failed.");
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
        return;
      }
      isSavingRef.current = true;
      void persistProjectIfNeeded({ silent: true })
        .catch(() => {
          // Flush failures are non-fatal; the next autosave or open will retry.
        })
        .finally(() => {
          isSavingRef.current = false;
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

  const refreshProjectList = async () => {
    const projects = await listProjects();
    setProjectList(projects);
  };

  const applyRepoPathChange = async (nextPath: string): Promise<boolean> => {
    const trimmedPath = nextPath.trim();
    if (!trimmedPath) {
      setErrorMessage("Repository path cannot be empty.");
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
      setErrorMessage(error instanceof Error ? error.message : "Failed to save repository path.");
      return false;
    }
  };

  const handleRepoSave = async () => {
    const ok = await applyRepoPathChange(repoPath);
    if (ok) {
      setStage("projectHub");
    }
  };

  const handleBrowseRepoPath = async () => {
    try {
      const selected = await pickDirectory();
      if (selected) {
        await applyRepoPathChange(selected);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to open directory picker.");
    }
  };

  const handleOpenProject = async (summary: ProjectSummary) => {
    try {
      const bundle = await loadProjectBundle(summary.path);
      assertProjectInvariant(bundle.project);
      hydrateProject(bundle.project, bundle.lastOpened);
      captureSavedSnapshot(bundle.fileSnapshot, bundle.fileMetas);
      setExternalUpdate(false);
      applyConflictCopies(await listConflictCopies(summary.path));
      setActiveProjectPath(summary.path);
      setSaveInfo(
        bundle.migrated
          ? `Opened ${summary.name} (migrated to scene files)`
          : `Opened ${summary.name}`,
      );
      setErrorMessage(null);
      setStage("editor");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to open project.");
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
      setExternalUpdate(false);
      setSaveInfo(`Reloaded at ${new Date().toLocaleTimeString()}`);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to reload project.");
    }
  };

  const handleKeepLocal = async () => {
    // User chose to keep their in-memory version. Adopt current on-disk
    // fingerprints as the new baseline so we stop prompting; the next auto-save
    // will overwrite the synced copy (last-write-wins, as designed).
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
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete project.");
    }
  };

  const handleCreateProject = async () => {
    const trimmedName = newProjectName.trim();
    if (!trimmedName) {
      setErrorMessage("Project name cannot be empty.");
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
      setErrorMessage(error instanceof Error ? error.message : "Failed to create project.");
    }
  };

  const handleSplashEnterHub = async () => {
    setErrorMessage(null);
    // If repo isn't set yet, route to setup; once saved that flow auto-advances
    // back to the hub.
    if (!repoPath.trim()) {
      setStage("setupRepo");
      return;
    }
    // Refresh in case projects were created/deleted out-of-band since bootstrap.
    try {
      await refreshProjectList();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to list projects.");
    }
    setStage("projectHub");
  };

  const handleImport = () => {
    if (!activeProjectPath) return;
    const { selection } = useEditorStore.getState();
    const scene = findSceneInProject(project, selection.sceneId);
    if (!scene) {
      setErrorMessage("No scene is currently selected.");
      return;
    }
    setImportTargetScene(scene);
  };

  const handleExport = () => {
    if (!activeProjectPath) return;
    const { selection } = useEditorStore.getState();
    const scene = findSceneInProject(project, selection.sceneId);
    if (!scene) {
      setErrorMessage("No scene is currently selected.");
      return;
    }
    // Snapshot the scene at open time so the dialog isn't affected if the
    // user navigates around (or edits) while it's open.
    setExportTargetScene(scene);
  };

  const handleHub = () => {
    if (activeProjectPath && !externalUpdate) {
      void persistProjectIfNeeded({ silent: true }).catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to save before leaving editor.");
      });
    }
    setStage("projectHub");
  };

  const handleSettings = () => setIsSettingsOpen(true);

  const titleBarLabel = stage === "editor" ? project.title || "Untitled" : "LightScript";

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
              Project Hub
            </button>
          {errorMessage && <p className="error splash-error">{errorMessage}</p>}
        </div>
      );
    }

    if (currentStage === "setupRepo") {
      return (
        <div className="startup-screen">
          <div className="startup-card">
            <h1>Set Repository Path</h1>
            <p>Choose one local folder as the root for all your projects. You only need to set it once.</p>
            <p className="startup-hint">
              To sync across devices, point this to a folder inside your Google
              Drive (Drive for desktop). LightScript will detect when another
              device syncs in changes and offer to reload.
            </p>
            <input
              value={repoPath}
              onChange={(event) => setRepoPathInput(event.target.value)}
              placeholder="D:\\WritingRepo"
            />
            <button type="button" onClick={handleBrowseRepoPath}>
              Browse Directory
            </button>
            <button type="button" onClick={handleRepoSave}>
              Save Repository Path
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
                onClick={handleBrowseRepoPath}
                title="Browse for a different repository folder"
              >
                Browse Directory
              </button>
              <div className="hub-topbar-path" title={repoPath}>
                {repoPath || "No repository selected"}
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
                      placeholder="Project name"
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
                    title="Create a new project"
                  >
                    <span className="hub-tile-new-plus" aria-hidden="true">+</span>
                    <span className="hub-tile-new-label">New Project</span>
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
                      aria-label={`Delete ${entry.name}`}
                      title={`Delete ${entry.name}`}
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
                  No project yet. Click + above to create your first one.
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
                { label: "Import", onClick: handleImport },
                { label: "Export", onClick: handleExport },
                { label: "Hub", onClick: handleHub },
                { label: "Settings", onClick: handleSettings },
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
                {conflictCopies.length} possible conflict{" "}
                {conflictCopies.length === 1 ? "copy" : "copies"} detected
              </strong>
              <span className="conflict-banner-detail">
                Google Drive kept an extra copy because two devices edited this
                project at once. LightScript reads <code>project.json</code> and
                scene files under <code>scripts/</code>; review and remove these
                in your file manager to avoid losing edits: {conflictCopies.join(", ")}
              </span>
            </div>
            <button
              type="button"
              className="conflict-banner-dismiss"
              onClick={() => setConflictDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        )}
        {externalUpdate && stage === "editor" && (
          <ModalDialog
            title="External update detected"
            message="This project's file on disk changed outside LightScript (for example, Google Drive synced in a newer copy from another device). Reload to load the latest version, or keep editing this copy and overwrite it on the next save."
            confirmText="Reload"
            cancelText="Keep my version"
            onConfirm={() => {
              void handleReloadExternal();
            }}
            onClose={() => {
              void handleKeepLocal();
            }}
          />
        )}
        {pendingDelete && (
          <ModalDialog
            title="Delete project"
            message={`“${pendingDelete.name}” and its folder on disk will be permanently removed. This cannot be undone.`}
            confirmText="Delete"
            cancelText="Cancel"
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
