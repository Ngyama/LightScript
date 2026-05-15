import { useEditorStore } from "../../state/editorStore";

export function SelectionMetaPanel() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectedScript = project.scripts.find((script) => script.id === selection.scriptId);

  if (!selection.scriptId) {
    return (
      <section className="meta-panel">
        <h2>Project</h2>
        <p>Manage structure in the left tree. Only Scene nodes can open the writing editor.</p>
      </section>
    );
  }

  if (selection.scriptId && !selection.sceneId) {
    return (
      <section className="meta-panel">
        <h2>{selectedScript?.title ?? "Script"}</h2>
        <p>Script is a structural container. Select a Scene to write content.</p>
      </section>
    );
  }

  return (
    <section className="meta-panel">
      <h2>No Scene Selected</h2>
      <p>Select a Scene from the left tree to start writing.</p>
    </section>
  );
}
