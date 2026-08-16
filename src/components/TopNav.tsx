import { useState, useRef, useEffect } from "react";

export interface Session {
  id: string;
  name: string;
}

interface TopNavProps {
  sessions: Session[];
  activeIndex: number;
  onCycle: (direction: -1 | 1) => void;
  onRename: (index: number, name: string) => void;
}

export function TopNav({ sessions, activeIndex, onCycle, onRename }: TopNavProps) {
  const [editingName, setEditingName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeSession = sessions[activeIndex];

  useEffect(() => {
    if (editingName !== null) {
      inputRef.current?.select();
    }
  }, [editingName]);

  function startEditing() {
    setEditingName(activeSession.name);
  }

  function commitEdit() {
    if (editingName === null) return;
    const trimmed = editingName.trim();
    onRename(activeIndex, trimmed || activeSession.name);
    setEditingName(null);
  }

  function cancelEdit() {
    setEditingName(null);
  }

  const showChevrons = sessions.length > 1;

  return (
    <nav className="app-nav">
      <span className="nav-arrow">{">>"}</span>
      <span className="nav-project">Pixel Project</span>
      <span className="nav-sep">/</span>
      <div className="nav-session">
        {showChevrons && (
          <button className="nav-chevron" onClick={() => onCycle(-1)} aria-label="Previous session">
            {"<"}
          </button>
        )}
        {editingName !== null ? (
          <input
            ref={inputRef}
            className="nav-session-input"
            value={editingName}
            size={Math.max(editingName.length, 4)}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") cancelEdit();
            }}
          />
        ) : (
          <span
            className={`nav-page nav-page-editable${activeSession.name === "New session" ? " nav-page-default" : ""}`}
            onClick={startEditing}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") startEditing();
            }}
          >
            {activeSession.name}
          </span>
        )}
        {showChevrons && (
          <button className="nav-chevron" onClick={() => onCycle(1)} aria-label="Next session">
            {">"}
          </button>
        )}
      </div>
    </nav>
  );
}
