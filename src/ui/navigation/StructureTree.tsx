import { useEditorStore } from "../../state/editorStore";

export function StructureTree() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectScript = useEditorStore((state) => state.selectScript);
  const selectScene = useEditorStore((state) => state.selectScene);
  const addScript = useEditorStore((state) => state.addScript);
  const addScene = useEditorStore((state) => state.addScene);
  const deleteScene = useEditorStore((state) => state.deleteScene);
  const renameScript = useEditorStore((state) => state.renameScript);
  const renameScene = useEditorStore((state) => state.renameScene);

  return (
    <div className="tree">
      <div className="tree-header">
        <h1>{project.title}</h1>
        <button onClick={addScript} type="button">
          + Script
        </button>
      </div>
      <ul className="tree-root">
        <li>
          <button
            type="button"
            className={`tree-node tree-project ${!selection.scriptId ? "is-active" : ""}`}
            onClick={() =>
              useEditorStore.setState({
                selection: { projectId: project.id, scriptId: undefined, sceneId: undefined },
              })
            }
          >
            Project
          </button>
          <ul>
            {project.scripts.map((script) => (
              <li key={script.id}>
                <div className="tree-row">
                  <button
                    type="button"
                    className={`tree-node ${selection.scriptId === script.id && !selection.sceneId ? "is-active" : ""}`}
                    onClick={() => selectScript(script.id)}
                  >
                    {script.title}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const nextTitle = window.prompt("Rename Script", script.title)?.trim();
                      if (nextTitle) {
                        renameScript(script.id, nextTitle);
                      }
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" className="ghost" onClick={() => addScene(script.id)}>
                    + Scene
                  </button>
                </div>
                <ul>
                  {script.scenes.map((scene) => (
                    <li key={scene.id}>
                      <div className="tree-row">
                        <button
                          type="button"
                          className={`tree-node tree-scene ${
                            selection.scriptId === script.id && selection.sceneId === scene.id ? "is-active" : ""
                          }`}
                          onClick={() => selectScene(script.id, scene.id)}
                        >
                          {scene.title}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            const nextTitle = window.prompt("Rename Scene", scene.title)?.trim();
                            if (nextTitle) {
                              renameScene(scene.id, nextTitle);
                            }
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            if (!window.confirm(`Delete scene "${scene.title}"?`)) {
                              return;
                            }
                            const deleted = deleteScene(script.id, scene.id);
                            if (!deleted) {
                              window.alert("At least one scene must remain in each script.");
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </div>
  );
}
