import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildBackupPreview,
  currentSceneCharCount,
  formatCharDelta,
  resolveBackupDisplayName,
} from "../../domain/backupDisplay";
import { PROJECT_META_FILE, sceneRelativePath } from "../../domain/projectFormat";
import type { Project } from "../../domain/model";
import { useEditorStore } from "../../state/editorStore";
import type { ProjectBackupEntry } from "../../storage/projectStorage";
import {
  listProjectBackups,
  readProjectBackup,
  restoreProjectBackup,
} from "../../storage/projectStorage";

type RecoveryDialogProps = {
  projectPath: string;
  onClose: () => void;
  onRestored: (message: string, options?: { reload?: boolean }) => void;
  onError: (message: string) => void;
};

type TreeNode = {
  relativePath: string;
  label: string;
  count: number;
};

function formatBackupTime(mtimeMs: number): string {
  const when = new Date(mtimeMs);
  if (Number.isNaN(when.getTime())) {
    return "未知时间";
  }
  const now = new Date();
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThatDay = new Date(
    when.getFullYear(),
    when.getMonth(),
    when.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfToday - startOfThatDay) / 86_400_000);
  if (dayDiff === 0) {
    return `今天 ${time}`;
  }
  if (dayDiff === 1) {
    return `昨天 ${time}`;
  }
  if (dayDiff > 1 && dayDiff < 7) {
    return `${dayDiff} 天前 ${time}`;
  }
  return when.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countForPath(
  byPath: Map<string, ProjectBackupEntry[]>,
  relativePath: string,
): number {
  return byPath.get(relativePath)?.length ?? 0;
}

function buildKnownPaths(project: Project | null): Set<string> {
  const known = new Set<string>([PROJECT_META_FILE]);
  if (!project) {
    return known;
  }
  for (const script of project.scripts) {
    for (const scene of script.scenes) {
      known.add(sceneRelativePath(script.id, scene.id));
    }
  }
  return known;
}

export function RecoveryDialog({
  projectPath,
  onClose,
  onRestored,
  onError,
}: RecoveryDialogProps) {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const [entries, setEntries] = useState<ProjectBackupEntry[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(() => new Set());
  const [orphansExpanded, setOrphansExpanded] = useState(false);
  const initializedRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const currentScenePath =
    selection.scriptId && selection.sceneId
      ? sceneRelativePath(selection.scriptId, selection.sceneId)
      : null;

  useEffect(() => {
    let cancelled = false;
    void listProjectBackups(projectPath)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
      })
      .catch((error) => {
        if (!cancelled) {
          onErrorRef.current(
            error instanceof Error ? error.message : "无法读取备份列表。",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    const firstScript = project?.scripts[0];
    const firstScene = firstScript?.scenes[0];
    const initial =
      currentScenePath ??
      (firstScript && firstScene
        ? sceneRelativePath(firstScript.id, firstScene.id)
        : PROJECT_META_FILE);
    setSelectedGroup(initial);
    if (selection.scriptId) {
      setExpandedScripts(new Set([selection.scriptId]));
    } else if (firstScript?.id) {
      setExpandedScripts(new Set([firstScript.id]));
    }
  }, [currentScenePath, project, selection.scriptId]);

  useEffect(() => {
    if (!selectedGroup) {
      setSelected(null);
      return;
    }
    const first = entries.find((entry) => entry.originalRelativePath === selectedGroup);
    setSelected(first?.fileName ?? null);
  }, [selectedGroup, entries]);

  useEffect(() => {
    if (!selected) {
      setRawContent("");
      return;
    }
    let cancelled = false;
    void readProjectBackup(projectPath, selected)
      .then((content) => {
        if (!cancelled) {
          setRawContent(content);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRawContent("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, selected]);

  const entriesByPath = useMemo(() => {
    const map = new Map<string, ProjectBackupEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.originalRelativePath) ?? [];
      list.push(entry);
      map.set(entry.originalRelativePath, list);
    }
    return map;
  }, [entries]);

  const knownPaths = useMemo(() => buildKnownPaths(project), [project]);

  const catalogNode: TreeNode = useMemo(
    () => ({
      relativePath: PROJECT_META_FILE,
      label: "作品目录（角色 / 结构）",
      count: countForPath(entriesByPath, PROJECT_META_FILE),
    }),
    [entriesByPath],
  );

  const scriptBranches = useMemo(() => {
    if (!project) {
      return [];
    }
    return project.scripts.map((script) => ({
      scriptId: script.id,
      title: script.title || "未命名 Script",
      scenes: script.scenes.map((scene) => {
        const relativePath = sceneRelativePath(script.id, scene.id);
        return {
          relativePath,
          label: scene.title || "未命名 Scene",
          count: countForPath(entriesByPath, relativePath),
        } satisfies TreeNode;
      }),
    }));
  }, [project, entriesByPath]);

  const orphanNodes: TreeNode[] = useMemo(() => {
    const orphans: TreeNode[] = [];
    for (const [relativePath, items] of entriesByPath) {
      if (knownPaths.has(relativePath)) {
        continue;
      }
      orphans.push({
        relativePath,
        label: resolveBackupDisplayName(relativePath, project),
        count: items.length,
      });
    }
    orphans.sort((a, b) => a.label.localeCompare(b.label, "zh"));
    return orphans;
  }, [entriesByPath, knownPaths, project]);

  const groupEntries = useMemo(() => {
    if (!selectedGroup) {
      return [];
    }
    return entriesByPath.get(selectedGroup) ?? [];
  }, [entriesByPath, selectedGroup]);

  const selectedEntry = entries.find((entry) => entry.fileName === selected) ?? null;

  const preview = useMemo(() => {
    if (!selectedEntry || !rawContent) {
      return null;
    }
    return buildBackupPreview(selectedEntry.originalRelativePath, rawContent, project);
  }, [selectedEntry, rawContent, project]);

  const charDelta = useMemo(() => {
    if (!selectedEntry || !preview) {
      return null;
    }
    const current = currentSceneCharCount(project, selectedEntry.originalRelativePath);
    return formatCharDelta(preview.charCount, current);
  }, [selectedEntry, preview, project]);

  const selectedLabel = selectedGroup
    ? resolveBackupDisplayName(selectedGroup, project)
    : "";

  const handleSelectGroup = (relativePath: string) => {
    setSelectedGroup(relativePath);
  };

  const toggleScript = (scriptId: string) => {
    setExpandedScripts((prev) => {
      const next = new Set(prev);
      if (next.has(scriptId)) {
        next.delete(scriptId);
      } else {
        next.add(scriptId);
      }
      return next;
    });
  };

  const handleRestore = async (asCopy: boolean) => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await restoreProjectBackup(projectPath, selected, asCopy);
      const label = selectedEntry
        ? resolveBackupDisplayName(selectedEntry.originalRelativePath, project)
        : result.restoredRelativePath;
      if (asCopy) {
        onRestored(
          `已另存为副本：${result.restoredRelativePath}（未加入作品结构；需要时可手动处理该文件）。`,
          { reload: false },
        );
      } else if (result.catalogUpdated) {
        onRestored(`已恢复「${label}」，并已重新加入作品结构。`, { reload: true });
      } else {
        onRestored(
          `已恢复「${label}」。若编辑器未更新，将自动重新加载作品。`,
          { reload: true },
        );
      }
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "恢复备份失败。");
    } finally {
      setBusy(false);
    }
  };

  const renderTreeButton = (node: TreeNode, indent: boolean) => (
    <button
      key={node.relativePath}
      type="button"
      className={`recovery-tree-item${indent ? " is-scene" : ""}${
        selectedGroup === node.relativePath ? " is-selected" : ""
      }${node.count === 0 ? " is-empty" : ""}`}
      onClick={() => handleSelectGroup(node.relativePath)}
      title={node.relativePath}
    >
      <span className="recovery-tree-label">{node.label}</span>
      {node.count > 0 ? (
        <span className="recovery-tree-count">{node.count}</span>
      ) : (
        <span className="recovery-tree-count is-zero">0</span>
      )}
    </button>
  );

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal-dialog recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="recovery-dialog-title" className="modal-dialog-title">
          备份与恢复
        </h2>
        <p className="modal-dialog-message">
          左侧与作品结构同步。有改动后停手约 3 分钟会留检查点（含字数不变的润色）；内容完全没变时不会因发呆反复追加。恢复 Scene
          正文时会写回文件，并在需要时把该 Scene 重新挂回对应 Script；「另存为副本」不会加入结构。
        </p>
        <div className="recovery-layout">
          <div className="recovery-tree" aria-label="作品结构">
            {renderTreeButton(catalogNode, false)}
            {scriptBranches.map((branch) => {
              const expanded = expandedScripts.has(branch.scriptId);
              const branchCount = branch.scenes.reduce((sum, scene) => sum + scene.count, 0);
              return (
                <div key={branch.scriptId} className="recovery-tree-branch">
                  <button
                    type="button"
                    className="recovery-tree-script"
                    onClick={() => toggleScript(branch.scriptId)}
                    aria-expanded={expanded}
                  >
                    <span className="recovery-tree-caret">{expanded ? "▾" : "▸"}</span>
                    <span className="recovery-tree-label">{branch.title}</span>
                    {branchCount > 0 && (
                      <span className="recovery-tree-count">{branchCount}</span>
                    )}
                  </button>
                  {expanded && (
                    <div className="recovery-tree-scenes">
                      {branch.scenes.map((scene) => renderTreeButton(scene, true))}
                    </div>
                  )}
                </div>
              );
            })}
            {orphanNodes.length > 0 && (
              <div className="recovery-tree-branch recovery-tree-branch--orphan">
                <button
                  type="button"
                  className="recovery-tree-script"
                  onClick={() => setOrphansExpanded((value) => !value)}
                  aria-expanded={orphansExpanded}
                >
                  <span className="recovery-tree-caret">{orphansExpanded ? "▾" : "▸"}</span>
                  <span className="recovery-tree-label">不在结构中的快照</span>
                  <span className="recovery-tree-count">
                    {orphanNodes.reduce((sum, node) => sum + node.count, 0)}
                  </span>
                </button>
                {orphansExpanded && (
                  <div className="recovery-tree-scenes">
                    {orphanNodes.map((node) => renderTreeButton(node, true))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="recovery-list-pane">
            {groupEntries.length === 0 ? (
              <p className="recovery-empty">
                {selectedGroup
                  ? `「${selectedLabel}」还没有快照。`
                  : "请选择左侧的 Scene 或作品目录。"}
              </p>
            ) : (
              <ul className="recovery-list">
                {groupEntries.map((entry) => (
                  <li key={entry.fileName}>
                    <button
                      type="button"
                      className={`recovery-list-item${selected === entry.fileName ? " is-selected" : ""}`}
                      onClick={() => setSelected(entry.fileName)}
                      title={entry.fileName}
                    >
                      <span className="recovery-list-time">{formatBackupTime(entry.mtimeMs)}</span>
                      <span className="recovery-list-name">快照</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="recovery-preview-pane">
            {!selectedGroup ? (
              <p className="recovery-empty">选择左侧节点以查看快照。</p>
            ) : groupEntries.length === 0 ? (
              <p className="recovery-empty">没有可预览的内容。</p>
            ) : preview ? (
              <>
                <div className="recovery-preview-meta">
                  <strong>{preview.title}</strong>
                  {charDelta && <span className="recovery-preview-delta">{charDelta}</span>}
                </div>
                <pre className="recovery-preview">{preview.plainText}</pre>
              </>
            ) : selected ? (
              <pre className="recovery-preview">（无法读取此快照）</pre>
            ) : (
              <p className="recovery-empty">选择一条快照以预览。</p>
            )}
          </div>
        </div>
        <div className="modal-dialog-actions">
          <button type="button" className="modal-dialog-secondary" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="modal-dialog-secondary"
            disabled={!selected || busy}
            onClick={() => {
              void handleRestore(true);
            }}
          >
            另存为副本
          </button>
          <button
            type="button"
            className="modal-dialog-primary"
            disabled={!selected || busy}
            onClick={() => {
              void handleRestore(false);
            }}
          >
            恢复此文件
          </button>
        </div>
      </div>
    </div>
  );
}
