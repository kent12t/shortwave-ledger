"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SeenHeadline } from "@/lib/history";

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function HistoryDrawer({
  open,
  history,
  onClose,
  onClear,
}: {
  open: boolean;
  history: SeenHeadline[];
  onClose: () => void;
  onClear: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, SeenHeadline[]>();
    history.forEach((item) => {
      const day = dayLabel(item.seenAt);
      groups.set(day, [...(groups.get(day) ?? []), item]);
    });
    return [...groups.entries()];
  }, [history]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  return (
    <div className={`history-layer ${open ? "open" : ""}`} inert={!open}>
      <button
        type="button"
        className="history-backdrop"
        aria-label="Close signal log"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="history-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signal-log-title"
      >
        <div className="drawer-handle" aria-hidden="true" />
        <div className="drawer-head">
          <h2 id="signal-log-title">Signal Log</h2>
          <div className="drawer-actions">
            {history.length > 0 && (
              <button type="button" className="text-button" onClick={onClear}>
                Clear
              </button>
            )}
            <button ref={closeRef} type="button" className="text-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {grouped.length === 0 ? (
          <p className="drawer-empty">
            Nothing logged yet. Stories you stay tuned to for a moment are kept here, on this
            device only.
          </p>
        ) : (
          <div className="drawer-scroll">
            {grouped.map(([day, items]) => (
              <section key={day} className="drawer-group">
                <h3>{day}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="history-item">
                        <span className="history-title">{item.title}</span>
                        <span className="history-meta">
                          {item.source} · {formatTime(item.seenAt)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
