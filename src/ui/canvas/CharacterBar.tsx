import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeSceneCharacters } from "../../domain/model";
import { useEditorStore } from "../../state/editorStore";
import type { Scene } from "../../domain/model";
import { characterChipStyle } from "../characterPalette";

interface CharacterBarProps {
  scene: Scene;
}

function rosterEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function CharacterBar({ scene }: CharacterBarProps) {
  const setSceneCharacters = useEditorStore((state) => state.setSceneCharacters);
  const renameSceneCharacter = useEditorStore((state) => state.renameSceneCharacter);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const roster = useMemo(
    () => normalizeSceneCharacters(scene.characters),
    [scene.characters],
  );

  useEffect(() => {
    setIsAdding(false);
    setDraft("");
    setRenamingName(null);
    setRenameDraft("");
  }, [scene.id]);

  useEffect(() => {
    if (!rosterEquals(roster, scene.characters)) {
      setSceneCharacters(scene.id, roster);
    }
  }, [roster, scene.characters, scene.id, setSceneCharacters]);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (renamingName !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingName]);

  // If the name being edited disappears from the roster (e.g. removed elsewhere),
  // exit edit mode so we don't keep a dangling input.
  useEffect(() => {
    if (renamingName !== null && !roster.includes(renamingName)) {
      setRenamingName(null);
      setRenameDraft("");
    }
  }, [renamingName, roster]);

  const persistCharacters = (next: string[]) => {
    setSceneCharacters(scene.id, normalizeSceneCharacters(next));
  };

  const commitDraft = () => {
    const value = draft.trim();
    if (value && !roster.includes(value)) {
      persistCharacters([...roster, value]);
    }
    setDraft("");
    setIsAdding(false);
  };

  const cancelDraft = () => {
    setDraft("");
    setIsAdding(false);
  };

  const removeCharacterAt = (index: number) => {
    persistCharacters(roster.filter((_, entryIndex) => entryIndex !== index));
  };

  const startRename = (name: string) => {
    setRenamingName(name);
    setRenameDraft(name);
  };

  const cancelRename = () => {
    setRenamingName(null);
    setRenameDraft("");
  };

  const commitRename = () => {
    if (renamingName === null) return;
    const next = renameDraft.trim();
    if (next && next !== renamingName) {
      renameSceneCharacter(scene.id, renamingName, next);
    }
    setRenamingName(null);
    setRenameDraft("");
  };

  return (
    <div className="character-bar">
      {roster.map((name, index) => {
        const isRenaming = renamingName === name;
        if (isRenaming) {
          return (
            <span
              key={`${scene.id}-${index}-${name}-editing`}
              className="character-chip character-chip--editing"
              style={characterChipStyle(name) as React.CSSProperties}
            >
              <input
                ref={renameInputRef}
                className="character-chip-input character-chip-input--rename"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
              />
            </span>
          );
        }
        return (
          <span
            key={`${scene.id}-${index}-${name}`}
            className="character-chip"
            style={characterChipStyle(name) as React.CSSProperties}
          >
            <button
              type="button"
              className="character-chip-name character-chip-name--button"
              title={`双击重命名 ${name}`}
              onDoubleClick={() => startRename(name)}
            >
              {name}
            </button>
            <button
              type="button"
              className="character-chip-remove"
              aria-label={`Remove ${name}`}
              title={`Remove ${name}`}
              onClick={() => removeCharacterAt(index)}
            >
              ×
            </button>
          </span>
        );
      })}
      {isAdding ? (
        <input
          ref={inputRef}
          className="character-chip-input"
          value={draft}
          placeholder="名字"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelDraft();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="character-chip-add"
          onClick={() => setIsAdding(true)}
        >
          + 加角色
        </button>
      )}
    </div>
  );
}
