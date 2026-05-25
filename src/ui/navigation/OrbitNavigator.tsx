import { useEffect, useRef, useState } from "react";
import { CollapsedOrbitRail } from "./CollapsedOrbitRail";
import { StructureTree } from "./StructureTree";

const COLLAPSE_DELAY_MS = 320;

export function OrbitNavigator() {
  const [isExpanded, setIsExpanded] = useState(false);
  const collapseTimer = useRef<number | null>(null);

  const cancelCollapse = () => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };

  const scheduleCollapse = () => {
    cancelCollapse();
    collapseTimer.current = window.setTimeout(() => {
      setIsExpanded(false);
      collapseTimer.current = null;
    }, COLLAPSE_DELAY_MS);
  };

  useEffect(() => {
    return () => cancelCollapse();
  }, []);

  return (
    <>
      <div
        className={`editor-blur-overlay${isExpanded ? " is-active" : ""}`}
        aria-hidden="true"
      />
      <div
        className={`orbit-navigator${isExpanded ? " is-expanded" : ""}`}
        onMouseEnter={() => {
          cancelCollapse();
          setIsExpanded(true);
        }}
        onMouseLeave={scheduleCollapse}
      >
        <div className={`orbit-panel${isExpanded ? " is-expanded" : ""}`}>
          <div className="orbit-collapsed-layer" aria-hidden={isExpanded}>
            <CollapsedOrbitRail />
          </div>
          <div className="orbit-expanded-content" aria-hidden={!isExpanded}>
            <StructureTree />
          </div>
        </div>
      </div>
    </>
  );
}
