import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEditorStore } from "../../state/editorStore";
import { characterChipStyle } from "../characterPalette";

const PREVIEW_CHIP_COUNT = 4;

export function GlobalCharacterBar() {
  const characters = useEditorStore((state) => state.project.characters);
  const addGlobalCharacter = useEditorStore((state) => state.addGlobalCharacter);
  const renameGlobalCharacter = useEditorStore((state) => state.renameGlobalCharacter);
  const deleteGlobalCharacter = useEditorStore((state) => state.deleteGlobalCharacter);

  const [expanded, setExpanded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const previewCharacters = characters.slice(0, PREVIEW_CHIP_COUNT);

  useEffect(() => {
    if (!expanded) {
      setIsAdding(false);
      setDraft("");
    }
  }, [expanded]);

  useEffect(() => {
    if (isAdding) {
      addInputRef.current?.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (renamingId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const commitAdd = () => {
    const value = draft.trim();
    if (value) {
      addGlobalCharacter(value);
    }
    setDraft("");
    setIsAdding(false);
  };

  const cancelAdd = () => {
    setDraft("");
    setIsAdding(false);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const value = renameDraft.trim();
    if (value) {
      renameGlobalCharacter(renamingId, value);
    }
    setRenamingId(null);
    setRenameDraft("");
  };

  const confirmDelete = () => {
    if (!pendingDeleteId) return;
    deleteGlobalCharacter(pendingDeleteId);
    setPendingDeleteId(null);
  };

  return (
    <section className={`global-character-bar${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        className="global-character-bar-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="global-character-bar-title">角色</span>
        <span className="global-character-bar-count">{characters.length}</span>
        {!expanded && previewCharacters.length > 0 && (
          <span className="global-character-bar-preview">
            {previewCharacters.map((character) => (
              <span
                key={character.id}
                className="character-chip character-chip--compact"
                style={characterChipStyle(character) as React.CSSProperties}
              >
                {character.name}
              </span>
            ))}
            {characters.length > PREVIEW_CHIP_COUNT && (
              <span className="global-character-bar-more">+{characters.length - PREVIEW_CHIP_COUNT}</span>
            )}
          </span>
        )}
        <span className="global-character-bar-chevron" aria-hidden="true">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {expanded && (
        <div className="global-character-bar-panel">
          <div className="global-character-bar-scroll">
            {characters.length === 0 && !isAdding && (
              <p className="global-character-bar-empty">暂无全局角色</p>
            )}
            {characters.map((character) => {
              const isRenaming = renamingId === character.id;
              if (isRenaming) {
                return (
                  <span
                    key={character.id}
                    className="character-chip character-chip--editing"
                    style={characterChipStyle({ name: renameDraft, color: character.color }) as React.CSSProperties}
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
                          setRenamingId(null);
                          setRenameDraft("");
                        }
                      }}
                    />
                  </span>
                );
              }
              return (
                <span
                  key={character.id}
                  className="character-chip"
                  style={characterChipStyle(character) as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="character-chip-name character-chip-name--button"
                    title={`双击重命名 ${character.name}`}
                    onDoubleClick={() => {
                      setRenamingId(character.id);
                      setRenameDraft(character.name);
                    }}
                  >
                    {character.name}
                  </button>
                  <button
                    type="button"
                    className="character-chip-remove"
                    aria-label={`删除 ${character.name}`}
                    title={`删除全局角色 ${character.name}`}
                    onClick={() => setPendingDeleteId(character.id)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {isAdding ? (
              <input
                ref={addInputRef}
                className="character-chip-input"
                value={draft}
                placeholder="名字"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitAdd}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitAdd();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelAdd();
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
        </div>
      )}

      {pendingDeleteId && (
        <div className="global-character-bar-confirm">
          <span>删除后所有 Scene 与对话中的引用将被清除。</span>
          <button type="button" onClick={() => setPendingDeleteId(null)}>
            取消
          </button>
          <button type="button" className="global-character-bar-confirm-delete" onClick={confirmDelete}>
            删除
          </button>
        </div>
      )}
    </section>
  );
}
