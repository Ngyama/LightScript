import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockType, DialogueBlock, NarrativeBlock, SceneBlock } from "../../domain/model";
import { useEditorStore, useSelectedScene } from "../../state/editorStore";
import { characterChipStyle } from "../characterPalette";
import { createDialogueBlock, createNarrativeBlock } from "./inputStateMachine";
import { computeSceneStats } from "./sceneStats";

const SPEAKER_MENU_WIDTH = 160;
const SPEAKER_MENU_MAX_HEIGHT = 220;
const DIALOGUE_SCAFFOLD = "「」";
const SPEAKER_HOTKEY = "Tab";

function isDialogueEmpty(text: string): boolean {
  return text.trim().length === 0 || text === DIALOGUE_SCAFFOLD;
}

function pickNextSpeaker(
  blocks: SceneBlock[],
  newPosition: number,
  roster: string[],
): string | undefined {
  if (roster.length === 0) return undefined;
  if (roster.length === 1) return roster[0];

  let lastSpeaker: string | undefined;
  let lastIdx = -1;
  for (let i = newPosition - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "dialogue" && block.character && block.character.trim().length > 0) {
      lastSpeaker = block.character;
      lastIdx = i;
      break;
    }
  }
  if (!lastSpeaker) return undefined;

  for (let i = lastIdx - 1; i >= 0; i--) {
    const block = blocks[i];
    if (
      block.type === "dialogue" &&
      block.character &&
      block.character.trim().length > 0 &&
      block.character !== lastSpeaker
    ) {
      return block.character;
    }
  }
  return undefined;
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

function changeBlockType(block: SceneBlock, newType: BlockType): SceneBlock {
  if (block.type === newType) return block;
  if (newType === "dialogue") {
    const narrative = block as NarrativeBlock;
    return { id: narrative.id, type: "dialogue", character: undefined, text: narrative.text };
  }
  const dialogue = block as DialogueBlock;
  return { id: dialogue.id, type: "narrative", text: dialogue.text };
}

function measureCaretLeft(element: FieldElement): number {
  const cs = window.getComputedStyle(element);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const fontParts = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily]
    .filter(Boolean)
    .join(" ");
  ctx.font = fontParts;
  const caretIndex = element.selectionEnd ?? element.value.length;
  const value = element.value;
  const lineStart = value.lastIndexOf("\n", caretIndex - 1) + 1;
  const sliced = value.slice(lineStart, caretIndex);
  const paddingLeft = parseFloat(cs.paddingLeft || "0");
  return paddingLeft + ctx.measureText(sliced).width;
}

function findClosestCaretIndexInRange(
  element: FieldElement,
  targetX: number,
  start: number,
  end: number,
): number {
  const cs = window.getComputedStyle(element);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return start;
  const fontParts = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily]
    .filter(Boolean)
    .join(" ");
  ctx.font = fontParts;
  const paddingLeft = parseFloat(cs.paddingLeft || "0");
  const text = element.value;
  let bestIdx = start;
  let bestDelta = Math.abs(paddingLeft - targetX);
  for (let i = start + 1; i <= end; i++) {
    const slice = text.slice(start, i);
    const width = paddingLeft + ctx.measureText(slice).width;
    const delta = Math.abs(width - targetX);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function focusElementAtCaretX(
  element: FieldElement,
  targetX: number,
  position: "first-line" | "last-line" | "any" = "any",
): void {
  element.focus();
  const value = element.value;
  let lineStart = 0;
  let lineEnd = value.length;
  if (element.tagName === "TEXTAREA" && value.includes("\n")) {
    if (position === "first-line") {
      lineEnd = value.indexOf("\n");
    } else if (position === "last-line") {
      lineStart = value.lastIndexOf("\n") + 1;
    }
  }
  const idx = findClosestCaretIndexInRange(element, targetX, lineStart, lineEnd);
  element.setSelectionRange(idx, idx);
}

function isCaretAtFirstLogicalLine(textarea: HTMLTextAreaElement): boolean {
  const pos = textarea.selectionStart ?? 0;
  return textarea.value.slice(0, pos).indexOf("\n") === -1;
}

function isCaretAtLastLogicalLine(textarea: HTMLTextAreaElement): boolean {
  const pos = textarea.selectionEnd ?? textarea.value.length;
  return textarea.value.slice(pos).indexOf("\n") === -1;
}

interface SpeakerMenuState {
  blockId: string;
  position: { top: number; left: number };
  highlight: number;
}

interface SpeakerChipProps {
  value: string | undefined;
  isOpen: boolean;
  onToggle: (anchor: HTMLButtonElement | null) => void;
  registerAnchor?: (node: HTMLButtonElement | null) => void;
}

function SpeakerChip({ value, isOpen, onToggle, registerAnchor }: SpeakerChipProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const empty = !value || value.trim().length === 0;
  const display = empty ? "未选" : value!.trim();
  const colorStyle = empty ? undefined : (characterChipStyle(value) as React.CSSProperties);
  return (
    <button
      ref={(node) => {
        buttonRef.current = node;
        registerAnchor?.(node);
      }}
      type="button"
      className={`speaker-chip${empty ? " is-empty" : ""}${isOpen ? " is-open" : ""}`}
      style={colorStyle}
      onClick={() => onToggle(buttonRef.current)}
    >
      {display}
    </button>
  );
}

interface DialogueBlockRowProps {
  block: DialogueBlock;
  registerRef: (id: string, node: HTMLTextAreaElement | null) => void;
  registerChipAnchor: (id: string, node: HTMLButtonElement | null) => void;
  speakerMenuOpen: boolean;
  onSpeakerToggle: (blockId: string, anchor: HTMLButtonElement | null) => void;
  onTextChange: (value: string) => void;
  onTextKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

function DialogueBlockRow({
  block,
  registerRef,
  registerChipAnchor,
  speakerMenuOpen,
  onSpeakerToggle,
  onTextChange,
  onTextKeyDown,
}: DialogueBlockRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [block.text]);

  return (
    <div className="block-editor-row">
      <div className="block-editor-gutter">
        <SpeakerChip
          value={block.character}
          isOpen={speakerMenuOpen}
          onToggle={(anchor) => onSpeakerToggle(block.id, anchor)}
          registerAnchor={(node) => registerChipAnchor(block.id, node)}
        />
      </div>
      <div className="block-editor-content">
        <textarea
          ref={(node) => {
            textareaRef.current = node;
            registerRef(block.id, node);
          }}
          className="block-input block-input-textarea"
          rows={1}
          value={block.text}
          placeholder="台词内容"
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onTextKeyDown}
        />
      </div>
    </div>
  );
}

export function SceneEditor() {
  const scene = useSelectedScene();
  const setSceneBlocks = useEditorStore((state) => state.setSceneBlocks);
  const inputRefs = useRef<Record<string, FieldElement | null>>({});
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [pendingSpeakerMenuForId, setPendingSpeakerMenuForId] = useState<string | null>(null);
  const [speakerMenu, setSpeakerMenu] = useState<SpeakerMenuState | null>(null);

  const blocks = useMemo<SceneBlock[]>(() => {
    if (!scene) return [];
    return scene.blocks.length > 0 ? scene.blocks : [createNarrativeBlock()];
  }, [scene]);

  const { charCount, lineCount } = useMemo(() => computeSceneStats(blocks), [blocks]);

  const speakerOptions = useMemo<string[]>(() => {
    if (!scene) return [];
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of scene.characters) {
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      list.push(value);
    }
    return list;
  }, [scene]);

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
      if (node.value === DIALOGUE_SCAFFOLD) {
        node.setSelectionRange(1, 1);
      } else {
        const len = node.value.length;
        node.setSelectionRange(len, len);
      }
    }
    setPendingFocusId(null);
  }, [pendingFocusId, blocks]);

  useEffect(() => {
    if (!pendingSpeakerMenuForId) return;
    const anchor = chipRefs.current[pendingSpeakerMenuForId];
    if (!anchor) return;
    const blockId = pendingSpeakerMenuForId;
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.right - SPEAKER_MENU_WIDTH, window.innerWidth - SPEAKER_MENU_WIDTH - 8),
    );
    const top = Math.min(rect.bottom + 4, window.innerHeight - SPEAKER_MENU_MAX_HEIGHT - 8);
    const block = blocks.find((b) => b.id === blockId);
    let highlight = speakerOptions.length > 0 ? 1 : 0;
    if (block?.type === "dialogue" && block.character) {
      const idx = speakerOptions.indexOf(block.character);
      if (idx >= 0) highlight = idx + 1;
    }
    setSpeakerMenu({ blockId, position: { top, left }, highlight });
    setPendingSpeakerMenuForId(null);
  }, [pendingSpeakerMenuForId, blocks, speakerOptions]);

  useEffect(() => {
    if (!speakerMenu) return;
    const totalItems = speakerOptions.length + 1;
    const handler = (event: KeyboardEvent) => {
      const isNumber = /^[1-9]$/.test(event.key);
      if (isNumber) {
        const n = parseInt(event.key, 10);
        if (n >= 1 && n <= speakerOptions.length) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          setBlockSpeaker(speakerMenu.blockId, speakerOptions[n - 1]);
          setSpeakerMenu(null);
        }
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "ArrowDown") {
        setSpeakerMenu((curr) =>
          curr ? { ...curr, highlight: (curr.highlight + 1) % totalItems } : curr,
        );
      } else if (event.key === "ArrowUp") {
        setSpeakerMenu((curr) =>
          curr ? { ...curr, highlight: (curr.highlight - 1 + totalItems) % totalItems } : curr,
        );
      } else if (event.key === "Enter") {
        const idx = speakerMenu.highlight;
        const value = idx === 0 ? undefined : speakerOptions[idx - 1];
        setBlockSpeaker(speakerMenu.blockId, value);
        setSpeakerMenu(null);
      } else if (event.key === "Escape" || event.key === "Tab") {
        setSpeakerMenu(null);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakerMenu, speakerOptions, blocks]);

  const persistBlocks = (nextBlocks: SceneBlock[]) => {
    if (!scene) return;
    setSceneBlocks(scene.id, nextBlocks, scene.characters);
  };

  const registerRef = (id: string, node: FieldElement | null) => {
    inputRefs.current[id] = node;
  };

  const updateNarrativeText = (index: number, value: string) => {
    const current = blocks[index];
    if (!current || current.type !== "narrative") return;
    const next = [...blocks];
    next[index] = { ...current, text: value };
    persistBlocks(next);
  };

  const updateDialogueText = (index: number, value: string) => {
    const current = blocks[index];
    if (!current || current.type !== "dialogue") return;
    const next = [...blocks];
    next[index] = { ...current, text: value };
    persistBlocks(next);
  };

  const setBlockSpeaker = (blockId: string, character: string | undefined) => {
    const next = blocks.map((block) => {
      if (block.id !== blockId || block.type !== "dialogue") return block;
      return { ...block, character: character && character.trim().length > 0 ? character : undefined };
    });
    persistBlocks(next);
  };

  const insertNarrativeAfter = (index: number) => {
    const newBlock = createNarrativeBlock();
    const next = [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
    persistBlocks(next);
    setPendingFocusId(newBlock.id);
  };

  const insertDialogueAfter = (index: number) => {
    const nextSpeaker = pickNextSpeaker(blocks, index + 1, speakerOptions);
    const newBlock = createDialogueBlock(nextSpeaker, DIALOGUE_SCAFFOLD);
    const next = [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
    persistBlocks(next);
    setPendingFocusId(newBlock.id);
    if (!nextSpeaker && speakerOptions.length >= 2) {
      setPendingSpeakerMenuForId(newBlock.id);
    }
  };

  const deleteBlockAt = (index: number): boolean => {
    if (blocks.length <= 1) return false;
    const next = [...blocks.slice(0, index), ...blocks.slice(index + 1)];
    persistBlocks(next);
    const focusIndex = index > 0 ? index - 1 : 0;
    const focusBlock = next[focusIndex];
    if (focusBlock) {
      setPendingFocusId(focusBlock.id);
    }
    return true;
  };

  const convertBlockType = (index: number, newType: BlockType) => {
    const current = blocks[index];
    if (!current || current.type === newType) return;
    let nextBlock = changeBlockType(current, newType);
    if (
      newType === "dialogue" &&
      nextBlock.type === "dialogue" &&
      nextBlock.text.trim().length === 0
    ) {
      nextBlock = { ...nextBlock, text: DIALOGUE_SCAFFOLD };
    } else if (
      newType === "narrative" &&
      nextBlock.type === "narrative" &&
      nextBlock.text === DIALOGUE_SCAFFOLD
    ) {
      nextBlock = { ...nextBlock, text: "" };
    }

    let autoOpenMenu = false;
    if (newType === "dialogue" && nextBlock.type === "dialogue") {
      const auto = pickNextSpeaker(blocks, index, speakerOptions);
      if (auto) {
        nextBlock = { ...nextBlock, character: auto };
      } else if (speakerOptions.length >= 2) {
        autoOpenMenu = true;
      }
    }

    const next = [...blocks];
    next[index] = nextBlock;
    persistBlocks(next);
    setPendingFocusId(current.id);
    if (autoOpenMenu) {
      setPendingSpeakerMenuForId(current.id);
    }
  };

  if (!scene) {
    return (
      <section className="editor-empty">
        <h2>Scene Editor</h2>
        <p>Select a Scene in the left tree.</p>
      </section>
    );
  }

  const initialHighlightForBlock = (blockId: string): number => {
    const block = blocks.find((b) => b.id === blockId);
    if (block?.type === "dialogue" && block.character) {
      const idx = speakerOptions.indexOf(block.character);
      if (idx >= 0) return idx + 1;
    }
    return speakerOptions.length > 0 ? 1 : 0;
  };

  const openSpeakerMenuForBlock = (blockId: string, anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.right - SPEAKER_MENU_WIDTH, window.innerWidth - SPEAKER_MENU_WIDTH - 8),
    );
    const top = Math.min(rect.bottom + 4, window.innerHeight - SPEAKER_MENU_MAX_HEIGHT - 8);
    setSpeakerMenu({
      blockId,
      position: { top, left },
      highlight: initialHighlightForBlock(blockId),
    });
  };

  const handleSpeakerToggle = (blockId: string, anchor: HTMLButtonElement | null) => {
    if (speakerMenu && speakerMenu.blockId === blockId) {
      setSpeakerMenu(null);
      return;
    }
    if (!anchor) {
      setSpeakerMenu({
        blockId,
        position: { top: 0, left: 0 },
        highlight: initialHighlightForBlock(blockId),
      });
      return;
    }
    openSpeakerMenuForBlock(blockId, anchor);
  };

  const handlePickSpeaker = (blockId: string, value: string | undefined) => {
    setBlockSpeaker(blockId, value);
    setSpeakerMenu(null);
  };

  const registerChipAnchor = (id: string, node: HTMLButtonElement | null) => {
    chipRefs.current[id] = node;
  };

  const focusFromCurrent = (
    current: FieldElement,
    direction: "prev" | "next",
    blockIndex: number,
  ) => {
    const caretX = measureCaretLeft(current);
    let target: SceneBlock | null = null;
    let position: "first-line" | "last-line" | "any" = "any";

    if (direction === "prev") {
      if (blockIndex > 0) {
        target = blocks[blockIndex - 1];
        if (target.type === "dialogue") position = "last-line";
      }
    } else if (direction === "next") {
      if (blockIndex < blocks.length - 1) {
        target = blocks[blockIndex + 1];
        if (target.type === "dialogue") position = "first-line";
      }
    }

    if (!target) return false;
    const node = inputRefs.current[target.id];
    if (!node) return false;
    focusElementAtCaretX(node, caretX, position);
    return true;
  };

  return (
    <section className="scene-editor">
      <div className="scene-editor-body">
        <div className="scene-editor-blocks">
          {blocks.map((block, index) => {
            if (block.type === "narrative") {
              return (
                <div key={block.id} className="block-editor-row">
                  <div className="block-editor-gutter" aria-hidden="true" />
                  <div className="block-editor-content">
                    <input
                      ref={(node) => registerRef(block.id, node)}
                      className="block-input"
                      value={block.text}
                      onChange={(event) => updateNarrativeText(index, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (event.currentTarget.value.trim().length > 0) {
                            insertNarrativeAfter(index);
                          } else {
                            convertBlockType(index, "dialogue");
                          }
                        } else if (
                          event.key === "Backspace" &&
                          event.currentTarget.value === ""
                        ) {
                          if (deleteBlockAt(index)) {
                            event.preventDefault();
                          }
                        } else if (event.key === "ArrowUp") {
                          if (focusFromCurrent(event.currentTarget, "prev", index)) {
                            event.preventDefault();
                          }
                        } else if (event.key === "ArrowDown") {
                          if (focusFromCurrent(event.currentTarget, "next", index)) {
                            event.preventDefault();
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              );
            }

            return (
              <DialogueBlockRow
                key={block.id}
                block={block}
                registerRef={registerRef}
                registerChipAnchor={registerChipAnchor}
                speakerMenuOpen={speakerMenu?.blockId === block.id}
                onSpeakerToggle={handleSpeakerToggle}
                onTextChange={(value) => updateDialogueText(index, value)}
                onTextKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (isDialogueEmpty(event.currentTarget.value)) {
                      convertBlockType(index, "narrative");
                    } else {
                      insertDialogueAfter(index);
                    }
                  } else if (
                    event.key === "Backspace" &&
                    isDialogueEmpty(event.currentTarget.value)
                  ) {
                    if (deleteBlockAt(index)) {
                      event.preventDefault();
                    }
                  } else if (event.key === "ArrowUp") {
                    if (isCaretAtFirstLogicalLine(event.currentTarget)) {
                      if (focusFromCurrent(event.currentTarget, "prev", index)) {
                        event.preventDefault();
                      }
                    }
                  } else if (event.key === "ArrowDown") {
                    if (isCaretAtLastLogicalLine(event.currentTarget)) {
                      if (focusFromCurrent(event.currentTarget, "next", index)) {
                        event.preventDefault();
                      }
                    }
                  } else if (
                    event.key === SPEAKER_HOTKEY &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    !event.shiftKey &&
                    speakerOptions.length >= 2
                  ) {
                    event.preventDefault();
                    const anchor = chipRefs.current[block.id];
                    if (anchor) {
                      openSpeakerMenuForBlock(block.id, anchor);
                    } else {
                      setPendingSpeakerMenuForId(block.id);
                    }
                  }
                }}
              />
            );
          })}
        </div>
        <footer className="scene-editor-stats" aria-live="polite">
          <span>{charCount} 字</span>
          <span>{lineCount} 行</span>
        </footer>
      </div>
      {speakerMenu &&
        (() => {
          const targetBlock = blocks.find((b) => b.id === speakerMenu.blockId);
          if (!targetBlock || targetBlock.type !== "dialogue") return null;
          const currentSpeaker = targetBlock.character;
          const emptyHighlighted = speakerMenu.highlight === 0;
          return (
            <>
              <div className="selector-overlay" onMouseDown={() => setSpeakerMenu(null)} />
              <ul
                className="speaker-menu"
                style={{ top: speakerMenu.position.top, left: speakerMenu.position.left }}
              >
                <li>
                  <button
                    type="button"
                    className={[
                      "speaker-empty-option",
                      !currentSpeaker ? "is-current" : "",
                      emptyHighlighted ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => handlePickSpeaker(speakerMenu.blockId, undefined)}
                    onMouseEnter={() =>
                      setSpeakerMenu((curr) => (curr ? { ...curr, highlight: 0 } : curr))
                    }
                  >
                    <span className="speaker-menu-index">·</span>
                    （无）
                  </button>
                </li>
                {speakerOptions.length === 0 && (
                  <li>
                    <span className="speaker-menu-hint">在上方角色栏先填写角色名</span>
                  </li>
                )}
                {speakerOptions.map((option, idx) => {
                  const highlightIdx = idx + 1;
                  const isHighlight = speakerMenu.highlight === highlightIdx;
                  const isCurrent = option === currentSpeaker;
                  return (
                    <li key={option}>
                      <button
                        type="button"
                        className={[isCurrent ? "is-current" : "", isHighlight ? "is-active" : ""]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => handlePickSpeaker(speakerMenu.blockId, option)}
                        onMouseEnter={() =>
                          setSpeakerMenu((curr) =>
                            curr ? { ...curr, highlight: highlightIdx } : curr,
                          )
                        }
                      >
                        <span className="speaker-menu-index">{idx + 1}</span>
                        {option}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          );
        })()}
    </section>
  );
}
