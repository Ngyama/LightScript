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
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const roster = useMemo(
    () => normalizeSceneCharacters(scene.characters),
    [scene.characters],
  );

  useEffect(() => {
    setIsAdding(false);
    setDraft("");
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

  return (
    <div className="character-bar">
      {roster.map((name, index) => (
        <span
          key={`${scene.id}-${index}-${name}`}
          className="character-chip"
          style={characterChipStyle(name) as React.CSSProperties}
        >
          <span className="character-chip-name">{name}</span>
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
      ))}
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
