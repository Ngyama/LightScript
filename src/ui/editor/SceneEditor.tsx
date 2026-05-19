import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockType, DialogueBlock, NarrativeBlock, SceneBlock } from "../../domain/model";
import { useEditorStore, useSelectedScene } from "../../state/editorStore";
import { createDialogueBlock, createNarrativeBlock } from "./inputStateMachine";
import { computeSceneStats } from "./sceneStats";

const TYPE_LABEL: Record<BlockType, string> = {
  dialogue: "Dialogue",
  narrative: "Narrative",
};

const CHARACTER_SLOT_COUNT = 5;
const SPEAKER_MENU_WIDTH = 160;
const SPEAKER_MENU_MAX_HEIGHT = 220;

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
}

interface CharacterRosterProps {
  characters: string[];
  onChange: (next: string[]) => void;
}

function CharacterRoster({ characters, onChange }: CharacterRosterProps) {
  const slots = Array.from(
    { length: CHARACTER_SLOT_COUNT },
    (_, idx) => characters[idx] ?? "",
  );

  const updateSlot = (idx: number, value: string) => {
    const next = [...slots];
    next[idx] = value;
    onChange(next);
  };

  return (
    <div className="character-roster">
      <span className="character-roster-label">Characters</span>
      <div className="character-roster-slots">
        {slots.map((value, idx) => (
          <input
            key={idx}
            className="character-roster-slot"
            value={value}
            placeholder={`角色 ${idx + 1}`}
            onChange={(event) => updateSlot(idx, event.target.value)}
          />
        ))}
      </div>
    </div>
  );
}

interface SpeakerChipProps {
  value: string | undefined;
  isOpen: boolean;
  onToggle: (anchor: HTMLButtonElement | null) => void;
}

function SpeakerChip({ value, isOpen, onToggle }: SpeakerChipProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const empty = !value || value.trim().length === 0;
  const display = empty ? "未选" : value!.trim();
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`speaker-chip${empty ? " is-empty" : ""}${isOpen ? " is-open" : ""}`}
      onClick={() => onToggle(buttonRef.current)}
    >
      [{display}]
    </button>
  );
}

interface DialogueBlockRowProps {
  block: DialogueBlock;
  registerRef: (id: string, node: HTMLTextAreaElement | null) => void;
  speakerMenuOpen: boolean;
  onSpeakerToggle: (blockId: string, anchor: HTMLButtonElement | null) => void;
  onTextChange: (value: string) => void;
  onTextKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

function DialogueBlockRow({
  block,
  registerRef,
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
      <div className="block-attr-label">{TYPE_LABEL.dialogue}</div>
      <div className="block-editor-content block-editor-content-dialogue">
        <SpeakerChip
          value={block.character}
          isOpen={speakerMenuOpen}
          onToggle={(anchor) => onSpeakerToggle(block.id, anchor)}
        />
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
  const setSceneCharacters = useEditorStore((state) => state.setSceneCharacters);
  const inputRefs = useRef<Record<string, FieldElement | null>>({});
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
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
      const len = node.value.length;
      node.setSelectionRange(len, len);
    }
    setPendingFocusId(null);
  }, [pendingFocusId, blocks]);

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
    const current = blocks[index];
    const inheritedCharacter =
      current && current.type === "dialogue" ? current.character : undefined;
    const newBlock = createDialogueBlock(inheritedCharacter, "");
    const next = [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
    persistBlocks(next);
    setPendingFocusId(newBlock.id);
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
    const next = [...blocks];
    next[index] = changeBlockType(current, newType);
    persistBlocks(next);
    setPendingFocusId(current.id);
  };

  if (!scene) {
    return (
      <section className="editor-empty">
        <h2>Scene Editor</h2>
        <p>Select a Scene in the left tree.</p>
      </section>
    );
  }

  const handleSpeakerToggle = (blockId: string, anchor: HTMLButtonElement | null) => {
    if (speakerMenu && speakerMenu.blockId === blockId) {
      setSpeakerMenu(null);
      return;
    }
    if (!anchor) {
      setSpeakerMenu({ blockId, position: { top: 0, left: 0 } });
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.right - SPEAKER_MENU_WIDTH, window.innerWidth - SPEAKER_MENU_WIDTH - 8),
    );
    const top = Math.min(rect.bottom + 4, window.innerHeight - SPEAKER_MENU_MAX_HEIGHT - 8);
    setSpeakerMenu({ blockId, position: { top, left } });
  };

  const handlePickSpeaker = (blockId: string, value: string | undefined) => {
    setBlockSpeaker(blockId, value);
    setSpeakerMenu(null);
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
      <header className="scene-editor-header">
        <h2>{scene.title}</h2>
      </header>
      <CharacterRoster
        characters={scene.characters}
        onChange={(next) => setSceneCharacters(scene.id, next)}
      />
      <div className="scene-editor-body">
        <div className="scene-editor-blocks">
          {blocks.map((block, index) => {
            if (block.type === "narrative") {
              return (
                <div key={block.id} className="block-editor-row">
                  <div className="block-attr-label">{TYPE_LABEL.narrative}</div>
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
                speakerMenuOpen={speakerMenu?.blockId === block.id}
                onSpeakerToggle={handleSpeakerToggle}
                onTextChange={(value) => updateDialogueText(index, value)}
                onTextKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (block.text.trim().length > 0) {
                      insertDialogueAfter(index);
                    } else {
                      convertBlockType(index, "narrative");
                    }
                  } else if (
                    event.key === "Backspace" &&
                    event.currentTarget.value === ""
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
                    className={`speaker-empty-option${!currentSpeaker ? " is-active" : ""}`}
                    onClick={() => handlePickSpeaker(speakerMenu.blockId, undefined)}
                  >
                    （无）
                  </button>
                </li>
                {speakerOptions.length === 0 && (
                  <li>
                    <span className="speaker-menu-hint">在上方角色栏先填写角色名</span>
                  </li>
                )}
                {speakerOptions.map((option) => (
                  <li key={option}>
                    <button
                      type="button"
                      className={option === currentSpeaker ? "is-active" : ""}
                      onClick={() => handlePickSpeaker(speakerMenu.blockId, option)}
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
    </section>
  );
}
