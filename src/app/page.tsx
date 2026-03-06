"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Headline } from "@/lib/news";

type SeenHeadline = {
  id: string;
  title: string;
  source: string;
  url: string;
  seenAt: string;
};

const HISTORY_KEY = "shortwave-ledger-history-v1";

function clampTune(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(ms);
  }
}

function readHistory(): SeenHeadline[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as SeenHeadline[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

function writeHistory(items: SeenHeadline[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 120)));
}

function addSeen(headline: Headline) {
  const existing = readHistory();
  const deduped = existing.filter((item) => item.id !== headline.id);
  const next = [
    {
      id: headline.id,
      title: headline.title,
      source: headline.source,
      url: headline.url,
      seenAt: new Date().toISOString(),
    },
    ...deduped,
  ];

  writeHistory(next);
}

function formatStamp(value: string) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [feedHealth, setFeedHealth] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SeenHeadline[]>([]);
  const [tune, setTune] = useState(58);
  const [dragOrigin, setDragOrigin] = useState<{
    pointerId: number;
    x: number;
    y: number;
    tune: number;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/headlines", { cache: "no-store" });
        const data = (await response.json()) as {
          headlines: Headline[];
          message?: string;
          feedHealth?: string;
        };

        setHeadlines(data.headlines ?? []);
        setFeedHealth(data.feedHealth ?? "");
        setMessage(data.message ?? "");
      } catch {
        setMessage("Unable to tune into feeds right now.");
      } finally {
        setLoading(false);
      }
    };

    load().catch(() => {
      setLoading(false);
      setMessage("Unable to tune into feeds right now.");
    });
    setHistory(readHistory());
  }, []);

  const current = headlines[index] ?? null;

  useEffect(() => {
    if (!current) {
      return;
    }

    addSeen(current);
    setHistory(readHistory());
  }, [current]);

  const groupedHistory = useMemo(() => {
    const groups = new Map<string, SeenHeadline[]>();

    history.forEach((item) => {
      const day = new Date(item.seenAt).toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      const existing = groups.get(day) ?? [];
      groups.set(day, [...existing, item]);
    });

    return [...groups.entries()];
  }, [history]);

  const showNext = () => {
    if (headlines.length < 2) {
      return;
    }

    vibrate(12);
    setIndex((previous) => (previous + 1) % headlines.length);
  };

  const toggleHistory = () => {
    vibrate(18);
    setHistory(readHistory());
    setHistoryOpen((previous) => !previous);
  };

  const signalVars = {
    "--signal-power": `${(0.26 + tune / 180).toFixed(3)}`,
  } as CSSProperties;

  const topoPaths = useMemo(() => {
    return Array.from({ length: 24 }, (_, index) => {
      const baseY = 36 + index * 35;
      const ampA = 8 + (index % 6) * 2.2;
      const ampB = 4 + (index % 4) * 1.4;
      const freqA = 0.011 + (index % 5) * 0.0012;
      const freqB = 0.021 + (index % 7) * 0.0009;
      const phaseA = (tune / 14) * (1 + index * 0.04);
      const phaseB = (tune / 11) * (1 + index * 0.03);

      let d = `M -20 ${baseY.toFixed(2)}`;
      for (let x = 0; x <= 1240; x += 34) {
        const y =
          baseY +
          Math.sin(x * freqA + phaseA) * ampA +
          Math.cos(x * freqB - phaseB) * ampB;
        d += ` L ${x} ${y.toFixed(2)}`;
      }

      return {
        id: index,
        d,
        strokeWidth: 0.9 + (index % 3) * 0.24,
        opacity: 0.08 + (index % 5) * 0.025,
      };
    });
  }, [tune]);

  const knobAngle = -132 + (tune / 100) * 264;

  const adjustTune = (delta: number) => {
    setTune((previous) => clampTune(previous + delta));
  };

  const onKnobPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragOrigin({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      tune,
    });
  };

  const onKnobPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragOrigin.x;
    const deltaY = dragOrigin.y - event.clientY;
    const nextTune = clampTune(dragOrigin.tune + deltaX * 0.3 + deltaY * 0.45);
    setTune(nextTune);
  };

  const onKnobPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragOrigin && dragOrigin.pointerId === event.pointerId) {
      setDragOrigin(null);
      vibrate(10);
    }
  };

  return (
    <main className="paper-bg min-h-dvh px-3 py-4 sm:py-6" style={signalVars}>
      <div className="signal-overlay" aria-hidden="true">
        <svg viewBox="0 0 1200 900" preserveAspectRatio="none">
          {topoPaths.map((path) => (
            <path
              key={path.id}
              className="signal-path"
              d={path.d}
              strokeWidth={path.strokeWidth}
              opacity={path.opacity}
            />
          ))}
        </svg>
      </div>
      <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-md flex-col justify-center gap-4 sm:min-h-[calc(100dvh-3rem)]">
        <section className="flex w-full flex-col gap-4 rounded-[1.5rem] border border-[var(--line)] bg-[var(--paper)] p-4 shadow-[0_14px_30px_rgba(53,40,23,0.14)] sm:p-6">
          <header className="relative border-b border-dashed border-[var(--line)] pb-3">
            <button
              onClick={toggleHistory}
              className="history-button"
              aria-label="Open viewed headline history"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 8v4l2.8 1.6M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
              </svg>
            </button>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
              Shortwave Ledger
            </p>
            <h1 className="mt-1 text-4xl leading-none font-semibold text-[var(--ink)]">
              Main Signal
            </h1>
            <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">
              Consensus-ranked headline of the day
            </p>
          </header>

          <article className="signal-card min-h-72 rounded-[1.2rem] border border-[var(--line)] p-4">
            {loading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-3 w-24 rounded bg-[var(--line)]" />
                <div className="h-9 rounded bg-[var(--line)]" />
                <div className="h-14 rounded bg-[var(--line)]" />
              </div>
            ) : current ? (
              <>
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  {current.source} / {formatStamp(current.publishedAt)}
                </p>
                <h2 className="mt-2 text-[2rem] leading-[1.02] font-semibold text-[var(--ink)]">
                  {current.title}
                </h2>
                <p className="mt-3 line-clamp-2 text-[1rem] leading-relaxed text-[var(--ink-soft)]">
                  {current.summary}
                </p>

                <div className="mt-5 flex items-end justify-between gap-3">
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => vibrate(22)}
                    className="read-link"
                  >
                    Read Further
                  </a>
                  <button onClick={showNext} className="dial-button" type="button">
                    Next Headline
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                  Signal unavailable
                </p>
                <p className="text-lg leading-relaxed text-[var(--ink)]">
                  {message || "No stories are available from the feeds right now."}
                </p>
              </div>
            )}
          </article>

          <footer className="flex items-center justify-between border-t border-dashed border-[var(--line)] pt-3 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            <span>Seen: {history.length}</span>
            <span>Feeds: {feedHealth || "--"}</span>
          </footer>
        </section>

        <section className="radio-deck flex w-full flex-col rounded-[1.2rem] border border-[var(--line)] p-3">
          <div className="dial-window">
            <div className="dial-minor" />
            <div className="dial-medium" />
            <div className="dial-major" />
            <div className="dial-frequency-labels" aria-hidden="true">
              <span style={{ left: "6%" }}>88</span>
              <span style={{ left: "18%" }}>92</span>
              <span style={{ left: "30%" }}>96</span>
              <span style={{ left: "42%" }}>100</span>
              <span style={{ left: "54%" }}>104</span>
              <span style={{ left: "66%" }}>108</span>
              <span style={{ left: "79%" }}>112</span>
              <span style={{ left: "91%" }}>114</span>
            </div>
            <div className="dial-needle" style={{ left: `${tune}%` }}>
              <span className="dial-needle-glass" />
              <span className="dial-needle-ring" />
            </div>
          </div>
          <div className="radio-control-wrap">
            <button
              type="button"
              className="rotary-knob"
              aria-label="Tune radio dial"
              onWheel={(event) => {
                event.preventDefault();
                adjustTune(event.deltaY > 0 ? -1.3 : 1.3);
              }}
              onPointerDown={onKnobPointerDown}
              onPointerMove={onKnobPointerMove}
              onPointerUp={onKnobPointerUp}
              onPointerCancel={onKnobPointerUp}
            >
              <span className="rotary-face" style={{ transform: `rotate(${knobAngle}deg)` }}>
                <span className="rotary-marker" />
              </span>
              <span className="rotary-core" />
            </button>
          </div>
        </section>
      </div>

      <aside
        className={`history-drawer ${historyOpen ? "open" : ""}`}
        aria-hidden={!historyOpen}
      >
        <div className="mx-auto w-full max-w-md rounded-t-[1.2rem] border border-b-0 border-[var(--line)] bg-[var(--paper)] p-4 shadow-[0_-12px_35px_rgba(53,40,23,0.16)]">
          <div className="mb-3 flex items-center justify-between border-b border-dashed border-[var(--line)] pb-2">
            <h3 className="text-2xl font-semibold">Signal Log</h3>
            <button
              type="button"
              onClick={toggleHistory}
              className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]"
            >
              Close
            </button>
          </div>

          {groupedHistory.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">
              No headlines viewed yet.
            </p>
          ) : (
            <div className="max-h-[58dvh] space-y-4 overflow-auto pr-1">
              {groupedHistory.map(([day, items]) => (
                <section key={day} className="space-y-2">
                  <p className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    {day}
                  </p>
                  {items.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="history-item block rounded-md border border-[var(--line)] p-2"
                    >
                      <p className="text-base leading-tight text-[var(--ink)]">
                        {item.title}
                      </p>
                      <p className="mt-1 font-mono text-[0.64rem] uppercase tracking-[0.16em] text-[var(--ink-soft)]">
                        {item.source} / {formatStamp(item.seenAt)}
                      </p>
                    </a>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}
