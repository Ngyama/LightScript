import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import type { Character, Scene } from "../../domain/model";
import { characterChipStyle } from "../characterPalette";

interface CharacterBarProps {
  scene: Scene;
}

export function CharacterBar({ scene }: CharacterBarProps) {
  const project = useEditorStore((state) => state.project);
  const addCharacterToCurrentScene = useEditorStore((state) => state.addCharacterToCurrentScene);
  const removeCharacterFromCurrentScene = useEditorStore(
    (state) => state.removeCharacterFromCurrentScene,
  );

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const enabledCharacters = useMemo(() => {
    const byId = new Map(project.characters.map((entry) => [entry.id, entry]));
    const result: Character[] = [];
    for (const id of scene.characterIds) {
      const character = byId.get(id);
      if (character) result.push(character);
    }
    return result;
  }, [project.characters, scene.characterIds]);

  const availableCharacters = useMemo(() => {
    const enabled = new Set(scene.characterIds);
    return project.characters.filter((entry) => !enabled.has(entry.id));
  }, [project.characters, scene.characterIds]);

  useEffect(() => {
    setIsPickerOpen(false);
  }, [scene.id]);

  useEffect(() => {
    if (!isPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isPickerOpen]);

  return (
    <div className="character-bar">
      {enabledCharacters.map((character) => (
        <span
          key={`${scene.id}-${character.id}`}
          className="character-chip"
          style={characterChipStyle(character.name) as React.CSSProperties}
        >
          <span className="character-chip-name">{character.name}</span>
          <button
            type="button"
            className="character-chip-remove"
            aria-label={`Remove ${character.name} from scene`}
            title={`从本 Scene 移除 ${character.name}`}
            onClick={() => removeCharacterFromCurrentScene(character.id)}
          >
            ×
          </button>
        </span>
      ))}
      <div className="character-bar-picker" ref={pickerRef}>
        {isPickerOpen ? (
          <div className="character-bar-picker-menu">
            {project.characters.length === 0 && (
              <p className="character-bar-picker-hint">请先在顶部全局角色栏创建角色</p>
            )}
            {availableCharacters.length > 0 && (
              <ul className="character-bar-picker-list">
                {availableCharacters.map((character) => (
                  <li key={character.id}>
                    <button
                      type="button"
                      className="character-bar-picker-option"
                      onClick={() => {
                        addCharacterToCurrentScene(character.id);
                        setIsPickerOpen(false);
                      }}
                    >
                      {character.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {project.characters.length > 0 && availableCharacters.length === 0 && (
              <p className="character-bar-picker-hint">全局角色已全部加入本 Scene</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="character-chip-add"
            onClick={() => setIsPickerOpen(true)}
          >
            + 加角色
          </button>
        )}
      </div>
    </div>
  );
}
