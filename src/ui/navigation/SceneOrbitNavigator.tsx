import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorStore } from "../../state/editorStore";
import type { Project, Script, Selection } from "../../domain/model";
import { ModalDialog } from "../floating/ModalDialog";

type OrbitItem =
  | {
      type: "script";
      scriptId: string;
      title: string;
    }
  | {
      type: "scene";
      scriptId: string;
      sceneId: string;
      scriptTitle: string;
      title: string;
    };

type OrbitContextMenuState =
  | { kind: "script"; scriptId: string; x: number; y: number }
  | { kind: "scene"; scriptId: string; sceneId: string; x: number; y: number }
  | null;

type OrbitEditingState =
  | { kind: "script"; scriptId: string }
  | { kind: "scene"; sceneId: string }
  | null;

const VISIBLE_RADIUS = 6;

function flattenProject(project: Project): OrbitItem[] {
  const items: OrbitItem[] = [];
  for (const script of project.scripts) {
    items.push({ type: "script", scriptId: script.id, title: script.title });
    for (const scene of script.scenes) {
      items.push({
        type: "scene",
        scriptId: script.id,
        sceneId: scene.id,
        scriptTitle: script.title,
        title: scene.title,
      });
    }
  }
  return items;
}

function findCurrentScript(project: Project, selection: Selection): Script | undefined {
  if (selection.sceneId) {
    const owner = project.scripts.find((script) =>
      script.scenes.some((scene) => scene.id === selection.sceneId),
    );
    if (owner) return owner;
  }
  if (selection.scriptId) {
    const direct = project.scripts.find((script) => script.id === selection.scriptId);
    if (direct) return direct;
  }
  return project.scripts[0];
}

function distanceClassName(absDistance: number): string {
  if (absDistance >= 4) return "scene-orbit-item--distance-far";
  return `scene-orbit-item--distance-${absDistance}`;
}

/** Inline rename inputs must not inherit orbit distance/selected/preview classes. */
function orbitInputClassName(item: OrbitItem): string {
  return item.type === "scene"
    ? "scene-orbit-item-input scene-orbit-item-input--scene"
    : "scene-orbit-item-input scene-orbit-item-input--script";
}

export function SceneOrbitNavigator() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectScene = useEditorStore((state) => state.selectScene);
  const addScript = useEditorStore((state) => state.addScript);
  const addScene = useEditorStore((state) => state.addScene);
  const deleteScene = useEditorStore((state) => state.deleteScene);
  const deleteScript = useEditorStore((state) => state.deleteScript);
  const renameScene = useEditorStore((state) => state.renameScene);
  const renameScript = useEditorStore((state) => state.renameScript);

  const items = useMemo(() => flattenProject(project), [project]);

  const selectedIndex = useMemo(() => {
    if (!selection.sceneId) return -1;
    return items.findIndex(
      (item) => item.type === "scene" && item.sceneId === selection.sceneId,
    );
  }, [items, selection.sceneId]);

  const [previewCenterIndex, setPreviewCenterIndex] = useState<number>(() =>
    selectedIndex >= 0 ? selectedIndex : 0,
  );

  useEffect(() => {
    if (selectedIndex >= 0) {
      setPreviewCenterIndex(selectedIndex);
    }
  }, [selectedIndex]);

  const [menu, setMenu] = useState<OrbitContextMenuState>(null);
  const [editing, setEditing] = useState<OrbitEditingState>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "scene"; scriptId: string; sceneId: string; title: string }
    | { kind: "script"; scriptId: string; title: string; sceneCount: number }
    | null
  >(null);
  const editingInputRef = useRef<HTMLInputElement | null>(null);

  const closeMenu = () => setMenu(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
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
    if (editing && editingInputRef.current) {
      editingInputRef.current.focus();
      editingInputRef.current.select();
    }
  }, [editing]);

  const currentScript = findCurrentScript(project, selection);
  const projectTitle = project.title?.trim() || "未命名作品";

  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      // Inline editing in progress — don't shift the visible window or we'd
      // unmount the input and lose the user's pending text.
      if (editing) return;
      const direction = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;
      if (direction === 0) return;
      setPreviewCenterIndex((current) => {
        let next = current + direction;
        while (next >= 0 && next < items.length && items[next]?.type !== "scene") {
          next += direction;
        }
        if (next < 0 || next >= items.length) return current;
        return next;
      });
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, [items, editing]);

  const handleMouseLeave = () => {
    if (editing) return;
    if (selectedIndex >= 0) {
      setPreviewCenterIndex(selectedIndex);
    }
  };

  const handleSceneClick = (
    item: Extract<OrbitItem, { type: "scene" }>,
    index: number,
  ) => {
    selectScene(item.scriptId, item.sceneId);
    setPreviewCenterIndex(index);
  };

  const handleProjectTitleClick = () => {
    // Reserved for future project overview screen.
  };

  const handleAddScript = () => {
    addScript();
  };

  const handleAddSceneToCurrent = () => {
    const targetScriptId = selection.scriptId ?? project.scripts[0]?.id;
    if (targetScriptId) {
      addScene(targetScriptId);
    }
  };

  const openSceneMenu = (
    event: React.MouseEvent,
    scriptId: string,
    sceneId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind: "scene", scriptId, sceneId, x: event.clientX, y: event.clientY });
  };

  const openScriptMenu = (event: React.MouseEvent, scriptId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind: "script", scriptId, x: event.clientX, y: event.clientY });
  };

  const startEditScene = (sceneId: string, currentTitle: string) => {
    closeMenu();
    setDraftTitle(currentTitle);
    setEditing({ kind: "scene", sceneId });
  };

  const startEditScript = (scriptId: string, currentTitle: string) => {
    closeMenu();
    setDraftTitle(currentTitle);
    setEditing({ kind: "script", scriptId });
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraftTitle("");
  };

  const commitEdit = () => {
    if (!editing) return;
    const next = draftTitle.trim();
    if (next) {
      if (editing.kind === "scene") {
        renameScene(editing.sceneId, next);
      } else {
        renameScript(editing.scriptId, next);
      }
    }
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

  const handleDeleteScene = (scriptId: string, sceneId: string, title: string) => {
    closeMenu();
    setPendingDelete({ kind: "scene", scriptId, sceneId, title });
  };

  const handleDeleteScript = (scriptId: string, title: string, sceneCount: number) => {
    closeMenu();
    setPendingDelete({ kind: "script", scriptId, title, sceneCount });
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete) {
      return;
    }
    if (pendingDelete.kind === "scene") {
      const ok = deleteScene(pendingDelete.scriptId, pendingDelete.sceneId);
      if (!ok) {
        setNoticeMessage("每个 Script 至少需要保留一个 Scene。");
      }
    } else {
      const ok = deleteScript(pendingDelete.scriptId);
      if (!ok) {
        setNoticeMessage("作品至少需要保留一个 Script。");
      }
    }
    setPendingDelete(null);
  };

  const handleAddSceneToScript = (scriptId: string) => {
    closeMenu();
    addScene(scriptId);
  };

  const menuTarget = useMemo(() => {
    if (!menu) return null;
    const script = project.scripts.find((entry) => entry.id === menu.scriptId);
    if (!script) return null;
    if (menu.kind === "script") {
      return { kind: "script" as const, script };
    }
    const scene = script.scenes.find((entry) => entry.id === menu.sceneId);
    if (!scene) return null;
    return { kind: "scene" as const, script, scene };
  }, [menu, project]);

  const startIndex = Math.max(0, previewCenterIndex - VISIBLE_RADIUS);
  const endIndex = Math.min(items.length, previewCenterIndex + VISIBLE_RADIUS + 1);
  const visibleItems = items.slice(startIndex, endIndex);

  const isEditingHeaderScript =
    editing?.kind === "script" && currentScript?.id === editing.scriptId;

  return (
    <div className="scene-orbit-navigator-inner" onMouseLeave={handleMouseLeave}>
      <div className="scene-orbit-header">
        <button
          type="button"
          className="scene-orbit-project-title"
          onClick={handleProjectTitleClick}
          title={projectTitle}
        >
          {projectTitle}
        </button>
        {currentScript && (
          <div className="scene-orbit-script-row">
            {isEditingHeaderScript ? (
              <input
                ref={editingInputRef}
                type="text"
                className="scene-orbit-script-title-input"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={onEditKeyDown}
                onBlur={commitEdit}
              />
            ) : (
              <>
                <div
                  className="scene-orbit-script-title"
                  title={currentScript.title}
                  onContextMenu={(event) => openScriptMenu(event, currentScript.id)}
                >
                  {currentScript.title}
                </div>
                <button
                  type="button"
                  className="scene-orbit-script-more"
                  aria-label="Script 操作"
                  title="Script 操作"
                  onClick={(event) => openScriptMenu(event, currentScript.id)}
                  onContextMenu={(event) => openScriptMenu(event, currentScript.id)}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="scene-orbit-track" ref={trackRef}>
        {visibleItems.map((item, localIdx) => {
          const index = startIndex + localIdx;
          const distance = index - previewCenterIndex;
          const absDistance = Math.abs(distance);

          const baseClasses = [
            "scene-orbit-item",
            `scene-orbit-item--${item.type}`,
            distanceClassName(absDistance),
          ];
          if (index === previewCenterIndex) {
            baseClasses.push("scene-orbit-item--preview-center");
          }
          if (item.type === "scene" && selection.sceneId === item.sceneId) {
            baseClasses.push("scene-orbit-item--selected");
          }
          const itemClassName = baseClasses.join(" ");

          if (item.type === "script") {
            // Current script edits in the header above; non-current scripts
            // edit in place at the divider.
            const isEditingThisDivider =
              editing?.kind === "script" &&
              editing.scriptId === item.scriptId &&
              currentScript?.id !== item.scriptId;

            return (
              <div
                key={`script-${item.scriptId}-${index}`}
                className="scene-orbit-row scene-orbit-row--script"
              >
                {isEditingThisDivider ? (
                  <input
                    ref={editingInputRef}
                    type="text"
                    className={orbitInputClassName(item)}
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={onEditKeyDown}
                    onBlur={commitEdit}
                  />
                ) : (
                  <>
                    <div
                      className={itemClassName}
                      onContextMenu={(event) => openScriptMenu(event, item.scriptId)}
                    >
                      <span className="scene-orbit-item-label">{item.title}</span>
                    </div>
                    <button
                      type="button"
                      className="scene-orbit-item-more"
                      aria-label="Script 操作"
                      title="Script 操作"
                      onClick={(event) => openScriptMenu(event, item.scriptId)}
                      onContextMenu={(event) => openScriptMenu(event, item.scriptId)}
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
                  </>
                )}
              </div>
            );
          }

          const isEditingThisScene =
            editing?.kind === "scene" && editing.sceneId === item.sceneId;

          return (
            <div
              key={`scene-${item.sceneId}`}
              className="scene-orbit-row scene-orbit-row--scene"
            >
              {isEditingThisScene ? (
                <input
                  ref={editingInputRef}
                  type="text"
                  className={orbitInputClassName(item)}
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={onEditKeyDown}
                  onBlur={commitEdit}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={itemClassName}
                    onClick={() => handleSceneClick(item, index)}
                    onContextMenu={(event) =>
                      openSceneMenu(event, item.scriptId, item.sceneId)
                    }
                    title={item.title}
                  >
                    <span className="scene-orbit-item-label">{item.title}</span>
                  </button>
                  <button
                    type="button"
                    className="scene-orbit-item-more"
                    aria-label="Scene 操作"
                    title="Scene 操作"
                    onClick={(event) =>
                      openSceneMenu(event, item.scriptId, item.sceneId)
                    }
                    onContextMenu={(event) =>
                      openSceneMenu(event, item.scriptId, item.sceneId)
                    }
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="scene-orbit-footer">
        <button
          type="button"
          className="scene-orbit-action"
          onClick={handleAddScript}
        >
          + Script
        </button>
        <button
          type="button"
          className="scene-orbit-action"
          onClick={handleAddSceneToCurrent}
        >
          + Scene
        </button>
      </div>

      {menu &&
        menuTarget &&
        createPortal(
          <>
            <div
              className="scene-orbit-context-overlay"
              onMouseDown={closeMenu}
              onContextMenu={(event) => {
                event.preventDefault();
                closeMenu();
              }}
            />
            <ul
              className="scene-orbit-context-menu"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {menuTarget.kind === "scene" ? (
                <>
                  <li>
                    <button
                      type="button"
                      onClick={() =>
                        startEditScene(menuTarget.scene.id, menuTarget.scene.title)
                      }
                    >
                      重命名 Scene
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() =>
                        handleDeleteScene(
                          menuTarget.script.id,
                          menuTarget.scene.id,
                          menuTarget.scene.title,
                        )
                      }
                    >
                      删除 Scene
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <button
                      type="button"
                      onClick={() =>
                        startEditScript(
                          menuTarget.script.id,
                          menuTarget.script.title,
                        )
                      }
                    >
                      重命名 Script
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => handleAddSceneToScript(menuTarget.script.id)}
                    >
                      在此 Script 下新建 Scene
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() =>
                        handleDeleteScript(
                          menuTarget.script.id,
                          menuTarget.script.title,
                          menuTarget.script.scenes.length,
                        )
                      }
                    >
                      删除 Script
                    </button>
                  </li>
                </>
              )}
            </ul>
          </>,
          document.body,
        )}
      {pendingDelete &&
        createPortal(
          <ModalDialog
            title={pendingDelete.kind === "scene" ? "删除 Scene" : "删除 Script"}
            message={
              pendingDelete.kind === "scene"
                ? `确定删除 Scene「${pendingDelete.title}」？正文文件将从作品中移除（本地备份中仍可能保留检查点）。`
                : `确定删除 Script「${pendingDelete.title}」及其下 ${pendingDelete.sceneCount} 个 Scene？正文文件将一并移除（本地备份中仍可能保留检查点）。`
            }
            confirmText="删除"
            cancelText="取消"
            variant="danger"
            onConfirm={confirmPendingDelete}
            onClose={() => setPendingDelete(null)}
          />,
          document.body,
        )}
      {noticeMessage &&
        createPortal(
          <ModalDialog
            title="无法删除"
            message={noticeMessage}
            confirmText="知道了"
            onConfirm={() => setNoticeMessage(null)}
            onClose={() => setNoticeMessage(null)}
          />,
          document.body,
        )}
    </div>
  );
}
