import { useEffect, useMemo, useRef, useState } from "react";
import type { SceneBlock } from "../../domain/model";
import { useEditorStore, useSelectedScene } from "../../state/editorStore";
import { createNarrativeBlock } from "./inputStateMachine";

export function SceneEditor() {
  const scene = useSelectedScene();
  const setSceneBlocks = useEditorStore((state) => state.setSceneBlocks);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const blocks = useMemo<SceneBlock[]>(() => {
    if (!scene) {
      return [];
    }
    return scene.blocks.length > 0 ? scene.blocks : [createNarrativeBlock()];
  }, [scene]);

  useEffect(() => {
    if (!scene) {
      return;
    }
    if (scene.blocks.length === 0) {
      setSceneBlocks(scene.id, [createNarrativeBlock()], scene.characters);
    }
  }, [scene, setSceneBlocks]);

  useEffect(() => {
    if (!pendingFocusId) {
      return;
    }
    inputRefs.current[pendingFocusId]?.focus();
    setPendingFocusId(null);
  }, [pendingFocusId, blocks]);

  if (!scene) {
    return (
      <section className="editor-empty">
        <h2>Scene Editor</h2>
        <p>Select a Scene in the left tree.</p>
      </section>
    );
  }

  const persistBlocks = (nextBlocks: SceneBlock[]) => {
    setSceneBlocks(scene.id, nextBlocks, scene.characters);
  };

  const updateNarrativeText = (index: number, value: string) => {
    const current = blocks[index];
    if (!current || current.type !== "narrative") {
      return;
    }
    const nextBlocks = [...blocks];
    nextBlocks[index] = { ...current, text: value };
    persistBlocks(nextBlocks);
  };

  const insertNarrativeAfter = (index: number) => {
    const nextBlock = createNarrativeBlock();
    const nextBlocks = [...blocks.slice(0, index + 1), nextBlock, ...blocks.slice(index + 1)];
    persistBlocks(nextBlocks);
    setPendingFocusId(nextBlock.id);
  };

  return (
    <section className="scene-editor">
      <header className="scene-editor-header">
        <h2>{scene.title}</h2>
      </header>
      <div className="scene-editor-blocks">
        {blocks.map((block, index) => {
          if (block.type !== "narrative") {
            return null;
          }
          return (
            <div key={block.id} className="block-editor-row block-editor-narrative">
              <div className="block-editor-content">
                <input
                  ref={(node) => {
                    inputRefs.current[block.id] = node;
                  }}
                  className="block-input"
                  value={block.text}
                  placeholder="narrative"
                  onChange={(event) => updateNarrativeText(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      insertNarrativeAfter(index);
                    }
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
