import { useEditorStore } from "../../state/editorStore";

const MAX_VISIBLE_DOTS = 12;

export function CollapsedOrbitRail() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectScene = useEditorStore((state) => state.selectScene);

  const flatScenes: { scriptId: string; sceneId: string; title: string }[] = [];
  for (const script of project.scripts) {
    for (const scene of script.scenes) {
      flatScenes.push({ scriptId: script.id, sceneId: scene.id, title: scene.title });
    }
  }

  const visible = flatScenes.slice(0, MAX_VISIBLE_DOTS);
  const overflow = flatScenes.length - visible.length;

  return (
    <div className="orbit-collapsed-rail" aria-hidden="false">
      {visible.map((entry) => {
        const isActive = selection.sceneId === entry.sceneId;
        return (
          <button
            key={entry.sceneId}
            type="button"
            className={`orbit-dot${isActive ? " is-active" : ""}`}
            aria-label={entry.title}
            title={entry.title}
            onClick={() => selectScene(entry.scriptId, entry.sceneId)}
          />
        );
      })}
      {overflow > 0 && <span className="orbit-overflow">+{overflow}</span>}
    </div>
  );
}
