import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilePlus, FolderPlus } from "lucide-react";
import { useEditorStore } from "../../state/editorStore";

type ContextMenuState =
  | { kind: "script"; scriptId: string; x: number; y: number }
  | { kind: "scene"; scriptId: string; sceneId: string; x: number; y: number }
  | null;

type EditingState =
  | { kind: "script"; id: string }
  | { kind: "scene"; id: string }
  | null;

export function StructureTree() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectScene = useEditorStore((state) => state.selectScene);
  const addScript = useEditorStore((state) => state.addScript);
  const addScene = useEditorStore((state) => state.addScene);
  const deleteScene = useEditorStore((state) => state.deleteScene);
  const deleteScript = useEditorStore((state) => state.deleteScript);
  const renameScript = useEditorStore((state) => state.renameScript);
  const renameScene = useEditorStore((state) => state.renameScene);

  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const closeMenu = () => setMenu(null);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    const onScroll = () => closeMenu();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const menuTarget = useMemo(() => {
    if (!menu) {
      return null;
    }
    const script = project.scripts.find((entry) => entry.id === menu.scriptId);
    if (!script) {
      return null;
    }
    if (menu.kind === "script") {
      return { kind: "script" as const, script };
    }
    const scene = script.scenes.find((entry) => entry.id === menu.sceneId);
    if (!scene) {
      return null;
    }
    return { kind: "scene" as const, script, scene };
  }, [menu, project]);

  const openScriptMenu = (event: React.MouseEvent, scriptId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind: "script", scriptId, x: event.clientX, y: event.clientY });
  };

  const openSceneMenu = (event: React.MouseEvent, scriptId: string, sceneId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind: "scene", scriptId, sceneId, x: event.clientX, y: event.clientY });
  };

  const startEditScript = (scriptId: string, currentTitle: string) => {
    closeMenu();
    setDraftTitle(currentTitle);
    setEditing({ kind: "script", id: scriptId });
  };

  const startEditScene = (sceneId: string, currentTitle: string) => {
    closeMenu();
    setDraftTitle(currentTitle);
    setEditing({ kind: "scene", id: sceneId });
  };

  const commitEdit = () => {
    if (!editing) {
      return;
    }
    const next = draftTitle.trim();
    if (next) {
      if (editing.kind === "script") {
        renameScript(editing.id, next);
      } else {
        renameScene(editing.id, next);
      }
    }
    setEditing(null);
    setDraftTitle("");
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraftTitle("");
  };

  const onEditKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  const handleAddScene = (scriptId: string) => {
    closeMenu();
    addScene(scriptId);
  };

  const handleDeleteScene = (scriptId: string, sceneId: string) => {
    closeMenu();
    const deleted = deleteScene(scriptId, sceneId);
    if (!deleted) {
      window.alert("At least one scene must remain in each script.");
    }
  };

  const handleDeleteScript = (scriptId: string) => {
    closeMenu();
    const deleted = deleteScript(scriptId);
    if (!deleted) {
      window.alert("At least one script must remain in the project.");
    }
  };

  return (
    <div className="tree">
      <ul className="tree-root">
        <li>
          <div className="tree-row">
            <div className="tree-node tree-project is-static" aria-disabled="true">
              Project
            </div>
            <button
              type="button"
              className="tree-row-add tree-row-add--script"
              onClick={() => addScript()}
              title="Add script"
              aria-label="Add script"
            >
              <FolderPlus size={14} strokeWidth={1.75} />
            </button>
          </div>
          <ul>
            {project.scripts.map((script) => {
              const isEditingScript = editing?.kind === "script" && editing.id === script.id;
              return (
                <li key={script.id}>
                  <div className="tree-row">
                    {isEditingScript ? (
                      <input
                        ref={inputRef}
                        type="text"
                        className="tree-node-input"
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={onEditKeyDown}
                        onBlur={commitEdit}
                      />
                    ) : (
                      <>
                        <div
                          className={`tree-node tree-script is-static ${
                            selection.scriptId === script.id ? "is-active" : ""
                          }`}
                          onContextMenu={(event) => openScriptMenu(event, script.id)}
                          aria-disabled="true"
                        >
                          {script.title}
                        </div>
                        <button
                          type="button"
                          className="tree-row-add tree-row-add--scene"
                          onClick={() => addScene(script.id)}
                          title="Add scene"
                          aria-label="Add scene"
                        >
                          <FilePlus size={13} strokeWidth={1.75} />
                        </button>
                      </>
                    )}
                  </div>
                  <ul>
                    {script.scenes.map((scene) => {
                      const isEditingScene = editing?.kind === "scene" && editing.id === scene.id;
                      return (
                        <li key={scene.id}>
                          <div className="tree-row">
                            {isEditingScene ? (
                              <input
                                ref={inputRef}
                                type="text"
                                className="tree-node-input tree-scene"
                                value={draftTitle}
                                onChange={(event) => setDraftTitle(event.target.value)}
                                onKeyDown={onEditKeyDown}
                                onBlur={commitEdit}
                              />
                            ) : (
                              <button
                                type="button"
                                className={`tree-node tree-scene ${
                                  selection.scriptId === script.id && selection.sceneId === scene.id
                                    ? "is-active"
                                    : ""
                                }`}
                                onClick={() => selectScene(script.id, scene.id)}
                                onContextMenu={(event) => openSceneMenu(event, script.id, scene.id)}
                              >
                                {scene.title}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </li>
      </ul>
      {menu &&
        menuTarget &&
        createPortal(
          <>
            <div
              className="tree-context-overlay"
              onMouseDown={closeMenu}
              onContextMenu={(event) => {
                event.preventDefault();
                closeMenu();
              }}
            />
            <ul
              className="tree-context-menu"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {menuTarget.kind === "script" ? (
                <>
                  <li>
                    <button type="button" onClick={() => handleAddScene(menuTarget.script.id)}>
                      New scene
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => startEditScript(menuTarget.script.id, menuTarget.script.title)}
                    >
                      Rename
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => handleDeleteScript(menuTarget.script.id)}
                    >
                      Delete
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <button
                      type="button"
                      onClick={() => startEditScene(menuTarget.scene.id, menuTarget.scene.title)}
                    >
                      Rename
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => handleDeleteScene(menuTarget.script.id, menuTarget.scene.id)}
                    >
                      Delete
                    </button>
                  </li>
                </>
              )}
            </ul>
          </>,
          document.body,
        )}
    </div>
  );
}
