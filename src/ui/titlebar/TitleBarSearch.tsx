import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSearchSnippet,
  searchFieldLabel,
  searchProjectText,
  type SearchMatch,
} from "../../domain/searchProject";
import { useEditorStore } from "../../state/editorStore";

export function TitleBarSearch() {
  const project = useEditorStore((state) => state.project);
  const navigateToSearchMatch = useEditorStore((state) => state.navigateToSearchMatch);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchProjectText(project, query), [project, query]);
  const showPanel = isOpen && query.trim().length > 0;

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, results.length]);

  useEffect(() => {
    if (!showPanel) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showPanel]);

  const activateMatch = (match: SearchMatch) => {
    navigateToSearchMatch(match);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (!showPanel || results.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((index) => (index + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const match = results[highlightIndex];
      if (match) activateMatch(match);
    }
  };

  return (
    <div className="title-bar-search" ref={containerRef}>
      <input
        ref={inputRef}
        type="search"
        className="title-bar-search-input"
        value={query}
        placeholder="搜索项目内容…"
        aria-label="搜索项目内容"
        aria-expanded={showPanel}
        aria-controls="title-bar-search-results"
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {showPanel && (
        <div id="title-bar-search-results" className="title-bar-search-panel" role="listbox">
          {results.length === 0 ? (
            <p className="title-bar-search-empty">没有匹配的内容</p>
          ) : (
            <ul className="title-bar-search-list">
              {results.map((match, index) => {
                const snippet = buildSearchSnippet(match.text, match.matchStart, match.matchEnd);
                const isActive = index === highlightIndex;
                return (
                  <li key={match.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`title-bar-search-item${isActive ? " is-active" : ""}`}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => activateMatch(match)}
                    >
                      <span className="title-bar-search-item-meta">
                        {match.scriptTitle} · {match.sceneTitle} · {searchFieldLabel(match.field)}
                      </span>
                      <span className="title-bar-search-item-snippet">
                        {snippet.before}
                        <mark>{snippet.match}</mark>
                        {snippet.after}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
