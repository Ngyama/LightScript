import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import type { Scene } from "../../domain/model";

interface CharacterBarProps {
  scene: Scene;
}

export function CharacterBar({ scene }: CharacterBarProps) {
  const setSceneCharacters = useEditorStore((state) => state.setSceneCharacters);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const persistCharacters = (next: string[]) => {
    setSceneCharacters(scene.id, next);
  };

  const commitDraft = () => {
    const value = draft.trim();
    if (value && !scene.characters.includes(value)) {
      persistCharacters([...scene.characters, value]);
    }
    setDraft("");
    setIsAdding(false);
  };

  const cancelDraft = () => {
    setDraft("");
    setIsAdding(false);
  };

  const removeCharacter = (name: string) => {
    persistCharacters(scene.characters.filter((entry) => entry !== name));
  };

  return (
    <div className="character-bar">
      {scene.characters.map((name) => (
        <span key={name} className="character-chip">
          <span className="character-chip-name">{name}</span>
          <button
            type="button"
            className="character-chip-remove"
            aria-label={`Remove ${name}`}
            title={`Remove ${name}`}
            onClick={() => removeCharacter(name)}
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
