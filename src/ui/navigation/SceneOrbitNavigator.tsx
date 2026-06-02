import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import type { Project, Script, Selection } from "../../domain/model";

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

export function SceneOrbitNavigator() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectScene = useEditorStore((state) => state.selectScene);
  const addScript = useEditorStore((state) => state.addScript);
  const addScene = useEditorStore((state) => state.addScene);

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

  const currentScript = findCurrentScript(project, selection);
  const projectTitle = project.title?.trim() || "Untitled";

  const trackRef = useRef<HTMLDivElement>(null);

  // Native wheel listener (non-passive) so preventDefault actually works and
  // wheel inside the rail never bubbles up as page scroll.
  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;
      if (direction === 0) return;
      setPreviewCenterIndex((current) => {
        let next = current + direction;
        // Skip script dividers so the center always lands on a scene.
        while (next >= 0 && next < items.length && items[next]?.type !== "scene") {
          next += direction;
        }
        if (next < 0 || next >= items.length) return current;
        return next;
      });
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, [items]);

  const handleMouseLeave = () => {
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

  const handleAddScene = () => {
    const targetScriptId = selection.scriptId ?? project.scripts[0]?.id;
    if (targetScriptId) {
      addScene(targetScriptId);
    }
  };

  const startIndex = Math.max(0, previewCenterIndex - VISIBLE_RADIUS);
  const endIndex = Math.min(items.length, previewCenterIndex + VISIBLE_RADIUS + 1);
  const visibleItems = items.slice(startIndex, endIndex);

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
          <div className="scene-orbit-script-title" title={currentScript.title}>
            {currentScript.title}
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
          const className = baseClasses.join(" ");

          if (item.type === "script") {
            return (
              <div
                key={`script-${item.scriptId}-${index}`}
                className={className}
                aria-hidden="true"
              >
                <span className="scene-orbit-item-label">{item.title}</span>
              </div>
            );
          }

          return (
            <button
              key={`scene-${item.sceneId}`}
              type="button"
              className={className}
              onClick={() => handleSceneClick(item, index)}
              title={item.title}
            >
              <span className="scene-orbit-item-label">{item.title}</span>
            </button>
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
          onClick={handleAddScene}
        >
          + Scene
        </button>
      </div>
    </div>
  );
}
