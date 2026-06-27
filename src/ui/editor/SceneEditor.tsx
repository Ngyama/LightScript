import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockType, Character, DialogueBlock, NarrativeBlock, SceneBlock } from "../../domain/model";
import { insertPasteIntoBlocks } from "../../domain/blockImport";
import { getCharacterName } from "../../domain/model";
import { applyTextSelection } from "../../domain/navigation";
import {
  useCurrentSceneCharacters,
  useEditorStore,
  useSelectedScene,
} from "../../state/editorStore";
import { characterChipStyle } from "../characterPalette";
import {
  textFitsBlockLineWidth,
  truncateToBlockLineWidth,
} from "./blockLineMeasure";
import { createDialogueBlock, createNarrativeBlock } from "./inputStateMachine";
import { computeSceneStats } from "./sceneStats";

const SPEAKER_MENU_WIDTH = 160;
const SPEAKER_MENU_MAX_HEIGHT = 220;
const DIALOGUE_SCAFFOLD = "「」";
const SPEAKER_HOTKEY = "Tab";

function isPlainTabKey(event: React.KeyboardEvent | KeyboardEvent): boolean {
  return (
    event.key === SPEAKER_HOTKEY &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

function canOpenSpeakerMenu(isQuoteMode: boolean, sceneCharacterCount: number): boolean {
  return !isQuoteMode && sceneCharacterCount >= 2;
}

/** Keep focus in the block field unless plain Tab opens the speaker menu. */
function handleEditorTabKey(
  event: React.KeyboardEvent,
  options: { allowSpeakerHotkey: boolean; onSpeakerHotkey?: () => void },
): void {
  if (event.key !== SPEAKER_HOTKEY) return;
  if (options.allowSpeakerHotkey && isPlainTabKey(event)) {
    event.preventDefault();
    options.onSpeakerHotkey?.();
    return;
  }
  event.preventDefault();
}

function isDialogueEmpty(text: string): boolean {
  return text.trim().length === 0 || text === DIALOGUE_SCAFFOLD;
}

function pickNextSpeakerId(
  blocks: SceneBlock[],
  newPosition: number,
  rosterIds: string[],
): string | undefined {
  if (rosterIds.length === 0) return undefined;
  if (rosterIds.length === 1) return rosterIds[0];

  let lastSpeakerId: string | undefined;
  let lastIdx = -1;
  for (let i = newPosition - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "dialogue" && block.characterId) {
      lastSpeakerId = block.characterId;
      lastIdx = i;
      break;
    }
  }
  if (!lastSpeakerId) return undefined;

  for (let i = lastIdx - 1; i >= 0; i--) {
    const block = blocks[i];
    if (
      block.type === "dialogue" &&
      block.characterId &&
      block.characterId !== lastSpeakerId
    ) {
      return block.characterId;
    }
  }
  return undefined;
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

function changeBlockType(block: SceneBlock, newType: BlockType): SceneBlock {
  if (block.type === newType) return block;
  if (newType === "dialogue") {
    const narrative = block as NarrativeBlock;
    return { id: narrative.id, type: "dialogue", characterId: undefined, text: narrative.text };
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
  displayName: string | undefined;
  color?: string;
  isOpen: boolean;
  onToggle: (anchor: HTMLButtonElement | null) => void;
  registerAnchor?: (node: HTMLButtonElement | null) => void;
}

function SpeakerChip({ displayName, color, isOpen, onToggle, registerAnchor }: SpeakerChipProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const empty = !displayName || displayName.trim().length === 0;
  const display = empty ? "未选" : displayName.trim();
  const colorStyle = empty
    ? undefined
    : (characterChipStyle({ name: displayName, color }) as React.CSSProperties);
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

interface PendingFocus {
  blockId: string;
  caret: number;
}

interface NarrativeBlockRowProps {
  block: NarrativeBlock;
  registerRef: (id: string, node: HTMLInputElement | null) => void;
  onTextChange: (value: string) => void;
  onPaste: (input: HTMLInputElement, event: React.ClipboardEvent<HTMLInputElement>) => void;
  onEnter: (input: HTMLInputElement) => void;
  onBackspaceEmpty: () => boolean;
  onArrowUp: (input: HTMLInputElement) => boolean;
  onArrowDown: (input: HTMLInputElement) => boolean;
}

function NarrativeBlockRow({
  block,
  registerRef,
  onTextChange,
  onPaste,
  onEnter,
  onBackspaceEmpty,
  onArrowUp,
  onArrowDown,
}: NarrativeBlockRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;

  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;

    const clampIfNeeded = (): void => {
      const fitted = truncateToBlockLineWidth(block.text, node);
      if (fitted !== block.text) {
        onTextChangeRef.current(fitted);
      }
    };

    clampIfNeeded();
    const observer = new ResizeObserver(clampIfNeeded);
    observer.observe(node);
    return () => observer.disconnect();
  }, [block.text]);

  const tryCommitText = (value: string, input: HTMLInputElement): void => {
    if (composingRef.current) {
      onTextChange(value);
      return;
    }
    if (!textFitsBlockLineWidth(value, input)) return;
    onTextChange(value);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    if (composingRef.current) {
      return;
    }
    onPaste(event.currentTarget, event);
  };

  return (
    <div className="block-editor-row">
      <div className="block-editor-gutter" aria-hidden="true" />
      <div className="block-editor-content">
        <input
          ref={(node) => {
            inputRef.current = node;
            registerRef(block.id, node);
          }}
          className="block-input block-input-single-line"
          value={block.text}
          onChange={(event) => tryCommitText(event.target.value, event.target)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const fitted = truncateToBlockLineWidth(event.currentTarget.value, event.currentTarget);
            onTextChange(fitted);
          }}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onEnter(event.currentTarget);
            } else if (event.key === "Backspace" && event.currentTarget.value === "") {
              if (onBackspaceEmpty()) {
                event.preventDefault();
              }
            } else if (event.key === "ArrowUp") {
              if (onArrowUp(event.currentTarget)) {
                event.preventDefault();
              }
            } else if (event.key === "ArrowDown") {
              if (onArrowDown(event.currentTarget)) {
                event.preventDefault();
              }
            } else {
              handleEditorTabKey(event, { allowSpeakerHotkey: false });
            }
          }}
        />
      </div>
    </div>
  );
}

interface DialogueBlockRowProps {
  block: DialogueBlock;
  showSpeaker: boolean;
  speakerName: string | undefined;
  speakerColor?: string;
  registerRef: (id: string, node: HTMLTextAreaElement | null) => void;
  registerChipAnchor: (id: string, node: HTMLButtonElement | null) => void;
  speakerMenuOpen: boolean;
  onSpeakerToggle: (blockId: string, anchor: HTMLButtonElement | null) => void;
  onTextChange: (value: string) => void;
  onPaste: (textarea: HTMLTextAreaElement, event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

function DialogueBlockRow({
  block,
  showSpeaker,
  speakerName,
  speakerColor,
  registerRef,
  registerChipAnchor,
  speakerMenuOpen,
  onSpeakerToggle,
  onTextChange,
  onPaste,
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
      <div className="block-editor-gutter" aria-hidden={!showSpeaker}>
        {showSpeaker ? (
          <SpeakerChip
            displayName={speakerName}
            color={speakerColor}
            isOpen={speakerMenuOpen}
            onToggle={(anchor) => onSpeakerToggle(block.id, anchor)}
            registerAnchor={(node) => registerChipAnchor(block.id, node)}
          />
        ) : null}
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
          onPaste={(event) => onPaste(event.currentTarget, event)}
          onKeyDown={onTextKeyDown}
        />
      </div>
    </div>
  );
}

export function SceneEditor() {
  const scene = useSelectedScene();
  const project = useEditorStore((state) => state.project);
  const setSceneBlocks = useEditorStore((state) => state.setSceneBlocks);
  const updateDialogueCharacter = useEditorStore((state) => state.updateDialogueCharacter);
  const navigationTarget = useEditorStore((state) => state.navigationTarget);
  const clearNavigationTarget = useEditorStore((state) => state.clearNavigationTarget);
  const sceneCharacters = useCurrentSceneCharacters();
  const isQuoteMode = project.settings.writingMode === "quote";
  const inputRefs = useRef<Record<string, FieldElement | null>>({});
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const [pendingSpeakerMenuForId, setPendingSpeakerMenuForId] = useState<string | null>(null);
  const [speakerMenu, setSpeakerMenu] = useState<SpeakerMenuState | null>(null);

  const blocks = useMemo<SceneBlock[]>(() => {
    if (!scene) return [];
    return scene.blocks.length > 0 ? scene.blocks : [createNarrativeBlock()];
  }, [scene]);

  const { charCount, lineCount } = useMemo(() => computeSceneStats(blocks), [blocks]);

  const rosterIds = useMemo(
    () => sceneCharacters.map((character) => character.id),
    [sceneCharacters],
  );

  useEffect(() => {
    if (!scene) return;
    if (scene.blocks.length === 0) {
      setSceneBlocks(scene.id, [createNarrativeBlock()]);
    }
  }, [scene, setSceneBlocks]);

  useEffect(() => {
    if (!isQuoteMode) return;
    setSpeakerMenu(null);
    setPendingSpeakerMenuForId(null);
  }, [isQuoteMode]);

  useEffect(() => {
    if (!pendingFocus) return;
    const node = inputRefs.current[pendingFocus.blockId];
    if (node) {
      node.focus();
      if (node.value === DIALOGUE_SCAFFOLD) {
        node.setSelectionRange(1, 1);
      } else {
        const caret = Math.min(pendingFocus.caret, node.value.length);
        node.setSelectionRange(caret, caret);
      }
    }
    setPendingFocus(null);
  }, [pendingFocus, blocks]);

  useEffect(() => {
    if (!scene || !navigationTarget || navigationTarget.kind !== "block") return;
    if (navigationTarget.sceneId !== scene.id) return;

    const { blockId, matchStart, matchEnd } = navigationTarget;

    const focusTarget = (): boolean => {
      const node = inputRefs.current[blockId];
      if (!node) return false;
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.focus();
      if (node.value === DIALOGUE_SCAFFOLD && matchStart === 0 && matchEnd === 0) {
        node.setSelectionRange(1, 1);
      } else {
        applyTextSelection(node, matchStart, matchEnd);
      }
      clearNavigationTarget();
      return true;
    };

    if (focusTarget()) return;

    const frame = window.requestAnimationFrame(() => {
      if (!focusTarget()) {
        window.setTimeout(() => {
          focusTarget();
        }, 0);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationTarget, scene, blocks, clearNavigationTarget]);

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
    let highlight = sceneCharacters.length > 0 ? 1 : 0;
    if (block?.type === "dialogue" && block.characterId) {
      const idx = rosterIds.indexOf(block.characterId);
      if (idx >= 0) highlight = idx + 1;
    }
    setSpeakerMenu({ blockId, position: { top, left }, highlight });
    setPendingSpeakerMenuForId(null);
  }, [pendingSpeakerMenuForId, blocks, rosterIds, sceneCharacters.length]);

  useEffect(() => {
    if (!speakerMenu) return;
    const totalItems = sceneCharacters.length + 1;
    const handler = (event: KeyboardEvent) => {
      const isNumber = /^[1-9]$/.test(event.key);
      if (isNumber) {
        const n = parseInt(event.key, 10);
        if (n >= 1 && n <= sceneCharacters.length) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          setBlockSpeaker(speakerMenu.blockId, sceneCharacters[n - 1]?.id);
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
        const characterId = idx === 0 ? undefined : sceneCharacters[idx - 1]?.id;
        setBlockSpeaker(speakerMenu.blockId, characterId);
        setSpeakerMenu(null);
      } else if (event.key === "Escape" || event.key === "Tab") {
        setSpeakerMenu(null);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakerMenu, sceneCharacters, blocks]);

  const persistBlocks = (nextBlocks: SceneBlock[]) => {
    if (!scene) return;
    setSceneBlocks(scene.id, nextBlocks);
  };

  const handleBlockPaste = (
    blockIndex: number,
    field: FieldElement,
    event: React.ClipboardEvent<FieldElement>,
  ): void => {
    const pasteText = event.clipboardData.getData("text/plain");
    if (!pasteText) {
      return;
    }

    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    const before = field.value.slice(0, start);
    const after = field.value.slice(end);

    const result = insertPasteIntoBlocks(blocks, blockIndex, before, after, pasteText);
    if (!result) {
      return;
    }

    event.preventDefault();
    persistBlocks(result.blocks);
    setPendingFocus({ blockId: result.focusBlockId, caret: result.focusCaret });
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

  const setBlockSpeaker = (blockId: string, characterId: string | undefined) => {
    updateDialogueCharacter(blockId, characterId);
  };

  const insertNarrativeAfter = (index: number, initialText = "") => {
    const newBlock = createNarrativeBlock(initialText);
    const next = [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
    persistBlocks(next);
    setPendingFocus({ blockId: newBlock.id, caret: initialText.length });
  };

  const splitNarrativeAt = (index: number, caretPos: number) => {
    const current = blocks[index];
    if (!current || current.type !== "narrative") return;
    const before = current.text.slice(0, caretPos);
    const after = current.text.slice(caretPos);
    const newBlock = createNarrativeBlock(after);
    const next = [...blocks];
    next[index] = { ...current, text: before };
    next.splice(index + 1, 0, newBlock);
    persistBlocks(next);
    setPendingFocus({ blockId: newBlock.id, caret: 0 });
  };

  const handleNarrativeEnter = (index: number, input: HTMLInputElement) => {
    const value = input.value;
    if (value.trim().length === 0) {
      convertBlockType(index, "dialogue");
      return;
    }
    const caret = input.selectionStart ?? value.length;
    if (caret < value.length) {
      splitNarrativeAt(index, caret);
      return;
    }
    insertNarrativeAfter(index);
  };

  const insertDialogueAfter = (index: number) => {
    const nextSpeakerId = isQuoteMode
      ? undefined
      : pickNextSpeakerId(blocks, index + 1, rosterIds);
    const newBlock = createDialogueBlock(nextSpeakerId, DIALOGUE_SCAFFOLD);
    const next = [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
    persistBlocks(next);
    setPendingFocus({ blockId: newBlock.id, caret: 1 });
    if (!isQuoteMode && !nextSpeakerId && sceneCharacters.length >= 2) {
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
      const caret =
        focusBlock.type === "dialogue" && focusBlock.text === DIALOGUE_SCAFFOLD
          ? 1
          : focusBlock.text.length;
      setPendingFocus({ blockId: focusBlock.id, caret });
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
    if (!isQuoteMode && newType === "dialogue" && nextBlock.type === "dialogue") {
      const auto = pickNextSpeakerId(blocks, index, rosterIds);
      if (auto) {
        nextBlock = { ...nextBlock, characterId: auto };
      } else if (sceneCharacters.length >= 2) {
        autoOpenMenu = true;
      }
    } else if (isQuoteMode && newType === "dialogue" && nextBlock.type === "dialogue") {
      nextBlock = { ...nextBlock, characterId: undefined };
    }

    const next = [...blocks];
    next[index] = nextBlock;
    persistBlocks(next);
    const focusCaret =
      nextBlock.type === "dialogue" && nextBlock.text === DIALOGUE_SCAFFOLD
        ? 1
        : nextBlock.text.length;
    setPendingFocus({ blockId: current.id, caret: focusCaret });
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
    if (block?.type === "dialogue" && block.characterId) {
      const idx = rosterIds.indexOf(block.characterId);
      if (idx >= 0) return idx + 1;
    }
    return sceneCharacters.length > 0 ? 1 : 0;
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

  const handlePickSpeaker = (blockId: string, characterId: string | undefined) => {
    setBlockSpeaker(blockId, characterId);
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
                <NarrativeBlockRow
                  key={block.id}
                  block={block}
                  registerRef={registerRef}
                  onTextChange={(value) => updateNarrativeText(index, value)}
                  onPaste={(input, event) => handleBlockPaste(index, input, event)}
                  onEnter={(input) => handleNarrativeEnter(index, input)}
                  onBackspaceEmpty={() => deleteBlockAt(index)}
                  onArrowUp={(input) => focusFromCurrent(input, "prev", index)}
                  onArrowDown={(input) => focusFromCurrent(input, "next", index)}
                />
              );
            }

            const speakerName = getCharacterName(project, block.characterId);
            const speaker = project.characters.find((entry) => entry.id === block.characterId);

            return (
              <DialogueBlockRow
                key={block.id}
                block={block}
                showSpeaker={!isQuoteMode}
                speakerName={speakerName}
                speakerColor={speaker?.color}
                registerRef={registerRef}
                registerChipAnchor={registerChipAnchor}
                speakerMenuOpen={speakerMenu?.blockId === block.id}
                onSpeakerToggle={handleSpeakerToggle}
                onTextChange={(value) => updateDialogueText(index, value)}
                onPaste={(textarea, event) => handleBlockPaste(index, textarea, event)}
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
                  } else {
                    handleEditorTabKey(event, {
                      allowSpeakerHotkey: canOpenSpeakerMenu(isQuoteMode, sceneCharacters.length),
                      onSpeakerHotkey: () => {
                        const anchor = chipRefs.current[block.id];
                        if (anchor) {
                          openSpeakerMenuForBlock(block.id, anchor);
                        } else {
                          setPendingSpeakerMenuForId(block.id);
                        }
                      },
                    });
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
      {speakerMenu && !isQuoteMode &&
        (() => {
          const targetBlock = blocks.find((b) => b.id === speakerMenu.blockId);
          if (!targetBlock || targetBlock.type !== "dialogue") return null;
          const currentSpeakerId = targetBlock.characterId;
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
                      !currentSpeakerId ? "is-current" : "",
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
                {sceneCharacters.length === 0 && (
                  <li>
                    <span className="speaker-menu-hint">先在 Scene 角色栏添加角色</span>
                  </li>
                )}
                {sceneCharacters.map((character: Character, idx) => {
                  const highlightIdx = idx + 1;
                  const isHighlight = speakerMenu.highlight === highlightIdx;
                  const isCurrent = character.id === currentSpeakerId;
                  return (
                    <li key={character.id}>
                      <button
                        type="button"
                        className={[isCurrent ? "is-current" : "", isHighlight ? "is-active" : ""]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => handlePickSpeaker(speakerMenu.blockId, character.id)}
                        onMouseEnter={() =>
                          setSpeakerMenu((curr) =>
                            curr ? { ...curr, highlight: highlightIdx } : curr,
                          )
                        }
                      >
                        <span className="speaker-menu-index">{idx + 1}</span>
                        {character.name}
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
