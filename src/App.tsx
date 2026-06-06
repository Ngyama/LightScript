import { useEffect, useRef, useState } from "react";
import { Download, Home, Settings } from "lucide-react";
import "./app.css";
import {
  assertProjectInvariant,
  createDefaultProject,
  findSceneInProject,
} from "./domain/model";
import { useEditorStore } from "./state/editorStore";
import {
  createProject,
  deleteProject,
  getRepoPath,
  listProjects,
  loadProjectFromPath,
  pickDirectory,
  saveProject,
  setRepoPath,
  type ProjectSummary,
} from "./storage/projectStorage";
import type { Scene } from "./domain/model";
import { EditorCanvas } from "./ui/canvas/EditorCanvas";
import { ExportDialog } from "./ui/floating/ExportDialog";
import { FloatingActionBar } from "./ui/floating/FloatingActionBar";
import { FloatingActionButton } from "./ui/floating/FloatingActionButton";
import { ModalDialog } from "./ui/floating/ModalDialog";
import { SettingsDialog } from "./ui/floating/SettingsDialog";
import { SavedStatus } from "./ui/floating/SavedStatus";
import { OrbitNavigator } from "./ui/navigation/OrbitNavigator";
import { TitleBar } from "./ui/titlebar/TitleBar";

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

export default function App() {
  const project = useEditorStore((state) => state.project);
  const hydrateProject = useEditorStore((state) => state.hydrateProject);
  const isHydrated = useEditorStore((state) => state.isHydrated);
  const setHydrated = useEditorStore((state) => state.setHydrated);

  const [saveInfo, setSaveInfo] = useState("Not saved yet");
  const [stage, setStage] = useState<AppStage>("splash");
  const [exportTargetScene, setExportTargetScene] = useState<Scene | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [repoPath, setRepoPathInput] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

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
    if (!isHydrated || stage !== "editor" || !activeProjectPath) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void saveProject(activeProjectPath, project)
        .then(() => {
          setSaveInfo(`Saved at ${new Date().toLocaleTimeString()}`);
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Auto-save failed.");
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [activeProjectPath, isHydrated, project, stage]);

  const refreshProjectList = async () => {
    const projects = await listProjects();
    setProjectList(projects);
  };

  const handleRepoSave = async () => {
    const trimmedPath = repoPath.trim();
    if (!trimmedPath) {
      setErrorMessage("Repository path cannot be empty.");
      return;
    }
    try {
      await setRepoPath(trimmedPath);
      setErrorMessage(null);
      setRepoPathInput(trimmedPath);
      await refreshProjectList();
      setStage("projectHub");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save repository path.");
    }
  };

  const handleBrowseRepoPath = async () => {
    try {
      const selected = await pickDirectory();
      if (selected) {
        setRepoPathInput(selected);
        setErrorMessage(null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to open directory picker.");
    }
  };

  const handleOpenProject = async (summary: ProjectSummary) => {
    try {
      const loadedProject = await loadProjectFromPath(summary.path);
      assertProjectInvariant(loadedProject);
      hydrateProject(loadedProject);
      setActiveProjectPath(summary.path);
      setSaveInfo(`Opened ${summary.name}`);
      setErrorMessage(null);
      setStage("editor");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to open project.");
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

  const handleHub = () => setStage("projectHub");

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
        <FloatingActionBar>
          <FloatingActionButton icon={Download} label="Export" onClick={handleExport} />
          <FloatingActionButton icon={Home} label="Hub" onClick={handleHub} />
          <FloatingActionButton icon={Settings} label="Settings" onClick={handleSettings} />
        </FloatingActionBar>
        <SavedStatus text={saveInfo} />
        {errorMessage && <p className="error global-error">{errorMessage}</p>}
        {exportTargetScene && (
          <ExportDialog
            scene={exportTargetScene}
            onClose={() => setExportTargetScene(null)}
            onComplete={(savedPath, format) => {
              setErrorMessage(null);
              setSaveInfo(`Exported as .${format} → ${savedPath}`);
            }}
            onError={(message) => setErrorMessage(message)}
          />
        )}
        {isSettingsOpen && <SettingsDialog onClose={() => setIsSettingsOpen(false)} />}
      </div>
    );
  };

  return (
    <div className="app-frame">
      <TitleBar title={titleBarLabel} />
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
