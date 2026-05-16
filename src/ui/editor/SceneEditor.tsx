import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockType, SceneBlock } from "../../domain/model";
import { useEditorStore, useSelectedScene } from "../../state/editorStore";
import { createNarrativeBlock } from "./inputStateMachine";
import { computeSceneStats } from "./sceneStats";

const TYPE_LABEL: Record<BlockType, string> = {
  character: "Character",
  dialogue: "Dialogue",
  narrative: "Narrative",
};

const SELECTOR_OPTIONS: BlockType[] = ["character", "dialogue", "narrative"];

const SELECTOR_WIDTH = 200;
const SELECTOR_HEIGHT_APPROX = 140;

function getBlockText(block: SceneBlock): string {
  if (block.type === "character") return block.character;
  return block.text;
}

function setBlockText(block: SceneBlock, value: string): SceneBlock {
  if (block.type === "character") return { ...block, character: value };
  if (block.type === "dialogue") return { ...block, text: value };
  return { ...block, text: value };
}

function changeBlockType(block: SceneBlock, newType: BlockType): SceneBlock {
  if (block.type === newType) return block;
  const text = getBlockText(block);
  if (newType === "character") {
    return { id: block.id, type: "character", character: text };
  }
  if (newType === "dialogue") {
    return { id: block.id, type: "dialogue", character: "", text };
  }
  return { id: block.id, type: "narrative", text };
}

function measureCaretLeft(input: HTMLInputElement): number {
  const cs = window.getComputedStyle(input);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const fontParts = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily]
    .filter(Boolean)
    .join(" ");
  ctx.font = fontParts;
  const caretIndex = input.selectionEnd ?? input.value.length;
  const sliced = input.value.slice(0, caretIndex);
  const paddingLeft = parseFloat(cs.paddingLeft || "0");
  return paddingLeft + ctx.measureText(sliced).width;
}

interface SelectorState {
  targetBlockId: string;
  position: { top: number; left: number };
  highlight: number;
}

export function SceneEditor() {
  const scene = useSelectedScene();
  const setSceneBlocks = useEditorStore((state) => state.setSceneBlocks);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [pendingSelectorForId, setPendingSelectorForId] = useState<string | null>(null);
  const [selector, setSelector] = useState<SelectorState | null>(null);

  const blocks = useMemo<SceneBlock[]>(() => {
    if (!scene) return [];
    return scene.blocks.length > 0 ? scene.blocks : [createNarrativeBlock()];
  }, [scene]);

  const { charCount, lineCount } = useMemo(() => computeSceneStats(blocks), [blocks]);

  useEffect(() => {
    if (!scene) return;
    if (scene.blocks.length === 0) {
      setSceneBlocks(scene.id, [createNarrativeBlock()], scene.characters);
    }
  }, [scene, setSceneBlocks]);

  useEffect(() => {
    if (!pendingFocusId) return;
    const node = inputRefs.current[pendingFocusId];
    if (node) {
      node.focus();
      const len = node.value.length;
      node.setSelectionRange(len, len);
    }
    setPendingFocusId(null);
  }, [pendingFocusId, blocks]);

  useEffect(() => {
    if (!pendingSelectorForId) return;
    const node = inputRefs.current[pendingSelectorForId];
    if (!node) return;
    node.focus();
    const rect = node.getBoundingClientRect();
    const caretLeft = measureCaretLeft(node);
    const left = Math.max(
      8,
      Math.min(rect.left + caretLeft + 8, window.innerWidth - SELECTOR_WIDTH - 8),
    );
    const top = Math.min(rect.top, window.innerHeight - SELECTOR_HEIGHT_APPROX - 8);
    setSelector({
      targetBlockId: pendingSelectorForId,
      position: { top, left },
      highlight: 0,
    });
    setPendingSelectorForId(null);
  }, [pendingSelectorForId, blocks]);

  const persistBlocks = (nextBlocks: SceneBlock[]) => {
    if (!scene) return;
    setSceneBlocks(scene.id, nextBlocks, scene.characters);
  };

  const confirmSelectorRef = useRef<(forcedIndex?: number) => void>(() => {});
  confirmSelectorRef.current = (forcedIndex) => {
    if (!selector) return;
    const idx = forcedIndex ?? selector.highlight;
    const type = SELECTOR_OPTIONS[idx];
    const targetIdx = blocks.findIndex((b) => b.id === selector.targetBlockId);
    if (targetIdx === -1) {
      setSelector(null);
      return;
    }
    const target = blocks[targetIdx];
    if (target.type === type) {
      setSelector(null);
      return;
    }
    const next = [...blocks];
    next[targetIdx] = changeBlockType(target, type);
    persistBlocks(next);
    setSelector(null);
  };

  const isSelectorOpen = selector !== null;

  useEffect(() => {
    if (!isSelectorOpen) return;
    const handler = (event: KeyboardEvent) => {
      const handled = ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "ArrowDown") {
        setSelector((curr) =>
          curr ? { ...curr, highlight: (curr.highlight + 1) % SELECTOR_OPTIONS.length } : curr,
        );
      } else if (event.key === "ArrowUp") {
        setSelector((curr) =>
          curr
            ? {
                ...curr,
                highlight:
                  (curr.highlight - 1 + SELECTOR_OPTIONS.length) % SELECTOR_OPTIONS.length,
              }
            : curr,
        );
      } else if (event.key === "Enter") {
        confirmSelectorRef.current();
      } else if (event.key === "Escape") {
        setSelector(null);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isSelectorOpen]);

  if (!scene) {
    return (
      <section className="editor-empty">
        <h2>Scene Editor</h2>
        <p>Select a Scene in the left tree.</p>
      </section>
    );
  }

  const updateBlockText = (index: number, value: string) => {
    const current = blocks[index];
    if (!current) return;
    const next = [...blocks];
    next[index] = setBlockText(current, value);
    persistBlocks(next);
  };

  const insertNewLineAfter = (index: number) => {
    const newBlock = createNarrativeBlock();
    const next = [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
    persistBlocks(next);
    setPendingSelectorForId(newBlock.id);
  };

  return (
    <section className="scene-editor">
      <header className="scene-editor-header">
        <h2>{scene.title}</h2>
      </header>
      <div className="scene-editor-body">
        <div className="scene-editor-blocks">
          {blocks.map((block, index) => (
            <div key={block.id} className="block-editor-row">
              <div className="block-attr-label">{TYPE_LABEL[block.type]}</div>
              <div className="block-editor-content">
                <input
                  ref={(node) => {
                    inputRefs.current[block.id] = node;
                  }}
                  className="block-input"
                  value={getBlockText(block)}
                  onChange={(event) => updateBlockText(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !isSelectorOpen) {
                      event.preventDefault();
                      insertNewLineAfter(index);
                    }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <footer className="scene-editor-stats" aria-live="polite">
          <span>{charCount} 字</span>
          <span>{lineCount} 行</span>
        </footer>
      </div>
      {selector && (
        <>
          <div className="selector-overlay" onMouseDown={() => setSelector(null)} />
          <ul
            className="block-type-selector"
            role="listbox"
            style={{ top: selector.position.top, left: selector.position.left }}
          >
            {SELECTOR_OPTIONS.map((type, idx) => (
              <li key={type}>
                <button
                  type="button"
                  className={idx === selector.highlight ? "is-active" : ""}
                  onMouseEnter={() =>
                    setSelector((curr) => (curr ? { ...curr, highlight: idx } : curr))
                  }
                  onClick={() => confirmSelectorRef.current(idx)}
                >
                  <span className="selector-index">{idx + 1}.</span>
                  <span>{TYPE_LABEL[type]}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
