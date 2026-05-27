import { useEffect, useState } from "react";
import { Download, Home } from "lucide-react";
import "./app.css";
import { assertProjectInvariant, createDefaultProject } from "./domain/model";
import { useEditorStore } from "./state/editorStore";
import {
  createProject,
  deleteProject,
  exportProjectTree,
  getRepoPath,
  listProjects,
  loadProjectFromPath,
  pickDirectory,
  saveProject,
  setRepoPath,
  type ProjectSummary,
} from "./storage/projectStorage";
import { EditorCanvas } from "./ui/canvas/EditorCanvas";
import { FloatingActionBar } from "./ui/floating/FloatingActionBar";
import { FloatingActionButton } from "./ui/floating/FloatingActionButton";
import { SavedStatus } from "./ui/floating/SavedStatus";
import { OrbitNavigator } from "./ui/navigation/OrbitNavigator";

type AppStage = "loading" | "setupRepo" | "projectHub" | "editor";

export default function App() {
  const project = useEditorStore((state) => state.project);
  const hydrateProject = useEditorStore((state) => state.hydrateProject);
  const isHydrated = useEditorStore((state) => state.isHydrated);
  const setHydrated = useEditorStore((state) => state.setHydrated);

  const [saveInfo, setSaveInfo] = useState("Not saved yet");
  const [stage, setStage] = useState<AppStage>("loading");
  const [repoPath, setRepoPathInput] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("Initializing...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const savedRepoPath = await getRepoPath();
        if (cancelled) {
          return;
        }

        if (!savedRepoPath) {
          setStage("setupRepo");
          setLoadingMessage("Set your repository path first.");
        } else {
          setRepoPathInput(savedRepoPath);
          const projects = await listProjects();
          if (cancelled) {
            return;
          }
          setProjectList(projects);
          setStage("projectHub");
          setLoadingMessage("Select or create a project.");
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to initialize app.");
        setStage("setupRepo");
      } finally {
        setHydrated(true);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [setHydrated]);

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

  const handleDeleteProject = async (summary: ProjectSummary) => {
    const confirmed = window.confirm(`Delete project "${summary.name}"? This will remove its folder from disk.`);
    if (!confirmed) {
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
      await handleOpenProject(summary);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create project.");
    }
  };

  if (stage === "loading") {
    return (
      <div className="startup-screen">
        <div className="startup-card">
          <h1>LightScript</h1>
          <p>{loadingMessage}</p>
        </div>
      </div>
    );
  }

  if (stage === "setupRepo") {
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

  if (stage === "projectHub") {
    return (
      <div className="startup-screen">
        <div className="startup-card project-hub">
          <h1>Project Hub</h1>
          <p>Repository: {repoPath}</p>
          <div className="create-project">
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="New Project Name"
            />
            <button type="button" onClick={handleCreateProject}>
              Create Project
            </button>
          </div>
          <div className="project-list">
            {projectList.length === 0 && <p>No project found. Create your first one.</p>}
            {projectList.map((entry) => (
              <div key={entry.path} className="project-item-row">
                <button type="button" className="project-item" onClick={() => handleOpenProject(entry)}>
                  <span>{entry.name}</span>
                  <small>{entry.path}</small>
                </button>
                <button
                  type="button"
                  className="project-delete"
                  onClick={() => {
                    void handleDeleteProject(entry);
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="ghost-secondary" onClick={() => setStage("setupRepo")}>
            Change Repository Path
          </button>
          {errorMessage && <p className="error">{errorMessage}</p>}
        </div>
      </div>
    );
  }

  const handleExport = () => {
    if (!activeProjectPath) return;
    void exportProjectTree(activeProjectPath, project).then((path) =>
      setSaveInfo(`Exported to ${path}`),
    );
  };

  const handleHub = () => setStage("projectHub");

  return (
    <div className="app-shell">
      <EditorCanvas />
      <OrbitNavigator />
      <FloatingActionBar>
        <FloatingActionButton icon={Download} label="Export" onClick={handleExport} />
        <FloatingActionButton icon={Home} label="Hub" onClick={handleHub} />
      </FloatingActionBar>
      <SavedStatus text={saveInfo} />
      {errorMessage && <p className="error global-error">{errorMessage}</p>}
    </div>
  );
}
