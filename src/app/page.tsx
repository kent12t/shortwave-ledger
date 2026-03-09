"use client";

import {
  useEffect,
  useMemo,
  useRef,
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

// Number of horizontal wave lines drawn across the background
const LINE_COUNT = 22;

// Per-line stable random seeds so each line has its own character
const LINE_SEEDS = Array.from({ length: LINE_COUNT }, (_, i) => {
  // Deterministic pseudo-random from index so SSR and client agree
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
});

/**
 * Build an SVG path string for a single wave line.
 *
 * The wave is a superposition of 4 sinusoids at harmonic frequencies
 * (fundamental + 2nd + 3rd + 4th harmonic), each with independent phase
 * speeds driven by `time`. This is the Fourier-series approach and produces
 * smooth, naturally organic motion without any sharp artefacts.
 *
 * `tune`  [0..100]  – scales both amplitude and frequency
 * `seed`  [0..1]    – per-line random offset so lines differ
 * `baseY`           – vertical centre of the line in SVG units
 */
function buildWavePath(
  time: number,
  tune: number,
  seed: number,
  baseY: number,
): string {
  const t = tune / 100; // normalised 0→1

  // Amplitude: at tune=0 the lines are almost flat (0.5 px); at tune=100
  // they swing ±10 px. Kept deliberately lower for readability.
  const amp = 0.5 + 9.5 * Math.pow(t, 1.6);

  // Frequency: scaled to 0.6x of the previous tight look.
  const freqBase = 0.144 + 0.336 * Math.pow(t, 1.2);

  // Scroll speed: baseline increased, and accelerates faster at high tune.
  const speed = 1.5 + 10.5 * Math.pow(t, 2.2);

  // Per-line offsets so no two lines look identical
  const phaseOff = seed * Math.PI * 2;
  const ampMod = 0.72 + seed * 0.56;

  // Step size: fine enough to show noise but coarse enough to look "electronic"
  const step = 2.5;

  let d = `M -10 ${baseY.toFixed(1)}`;

  for (let x = 0; x <= 1220; x += step) {
    const kx = x * freqBase + phaseOff;
    const wt = time * speed;

    // Multi-octave composition.
    const sig1 = Math.sin(kx + wt);
    const sig2 = Math.sin(kx * 2.13 + wt * 1.71 + 0.5) * 0.45;
    const sig3 = Math.sin(kx * 4.97 - wt * 2.33 + 1.2) * 0.25;

    // High-frequency "crackle" using a combination of fast sines.
    // This creates a textured, non-smooth signal.
    const noise = Math.sin(x * 1.5 + time * 60) * 
                  Math.sin(x * 0.8 - time * 45) * 
                  Math.sin(x * 3.2 + time * 90);
    const crackle = noise * (0.2 + t * 1.8);

    // Occasional "signal drop" or "spike" jitter
    const jitterFactor = Math.sin(x * 0.05 + time * 12 + seed);
    const jitter = jitterFactor > 0.985 ? (Math.random() - 0.5) * 6 * t : 0;

    const dy = (sig1 + sig2 + sig3 + crackle + jitter) * amp * ampMod;
    d += ` L ${x.toFixed(0)} ${(baseY + dy).toFixed(2)}`;
  }

  return d;
}

function clampTune(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizeAngleDelta(delta: number): number {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(ms);
  }
}

function readHistory(): SeenHeadline[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SeenHeadline[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(items: SeenHeadline[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 120)));
}

function addSeen(headline: Headline) {
  const existing = readHistory();
  const deduped = existing.filter((item) => item.id !== headline.id);
  writeHistory([
    {
      id: headline.id,
      title: headline.title,
      source: headline.source,
      url: headline.url,
      seenAt: new Date().toISOString(),
    },
    ...deduped,
  ]);
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
  const [tune, setTune] = useState(30);
  const [dragOrigin, setDragOrigin] = useState<{
    pointerId: number;
    centerX: number;
    centerY: number;
    lastAngle: number;
    tune: number;
  } | null>(null);

  // ── animated wave paths ────────────────────────────────────────────────────
  // We drive animation via rAF without causing React re-renders on every frame.
  // Instead we write directly to SVG <path> `d` attributes via refs.
  const svgRef = useRef<SVGSVGElement>(null);
  const tuneRef = useRef(tune);
  const rafRef = useRef<number>(0);

  // Keep tuneRef in sync with state so the rAF loop always reads the latest value
  useEffect(() => {
    tuneRef.current = tune;
  }, [tune]);

  useEffect(() => {
    let startTime: number | null = null;

    function frame(ts: number) {
      if (startTime === null) startTime = ts;
      const time = (ts - startTime) / 1000; // seconds

      const svg = svgRef.current;
      if (svg) {
        const paths = svg.querySelectorAll<SVGPathElement>("path[data-wave]");
        paths.forEach((path, i) => {
          const seed = LINE_SEEDS[i] ?? 0;
          const baseY = 20 + i * 40;
          path.setAttribute(
            "d",
            buildWavePath(time, tuneRef.current, seed, baseY),
          );
        });
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── data fetching ──────────────────────────────────────────────────────────
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
    if (!current) return;
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
    if (headlines.length < 2) return;
    vibrate(12);
    setIndex((previous) => (previous + 1) % headlines.length);
  };

  const toggleHistory = () => {
    vibrate(18);
    setHistory(readHistory());
    setHistoryOpen((previous) => !previous);
  };

  // ── CSS custom properties driven by tune ──────────────────────────────────
  const tuneRatio = tune / 100;
  const signalVars = {
    "--signal-power": `${(0.18 + tuneRatio * 0.54).toFixed(3)}`,
    "--signal-jagged": `${tuneRatio.toFixed(3)}`,
  } as CSSProperties;

  // Per-line visual properties (static, depend only on line index)
  const lineProps = useMemo(
    () =>
      Array.from({ length: LINE_COUNT }, (_, i) => ({
        id: i,
        strokeWidth: 0.7 + (i % 3) * 0.18,
        // Opacity is also scaled by tune at render time via CSS var
        baseOpacity: 0.06 + (i % 5) * 0.022,
      })),
    [],
  );

  // ── knob interaction ───────────────────────────────────────────────────────
  const knobAngle = -132 + tuneRatio * 264;

  const adjustTune = (delta: number) => {
    setTune((previous) => clampTune(previous + delta));
  };

  const onKnobPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    setDragOrigin({
      pointerId: event.pointerId,
      centerX,
      centerY,
      lastAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      tune,
    });
  };

  const onKnobPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) return;

    const dist = Math.hypot(
      event.clientX - dragOrigin.centerX,
      event.clientY - dragOrigin.centerY,
    );
    if (dist < 8) return;

    const angle = Math.atan2(
      event.clientY - dragOrigin.centerY,
      event.clientX - dragOrigin.centerX,
    );
    const rawDelta = ((angle - dragOrigin.lastAngle) * 180) / Math.PI;
    const angularDelta = normalizeAngleDelta(rawDelta);
    if (Math.abs(angularDelta) < 0.01) return;

    const nextTune = clampTune(dragOrigin.tune + angularDelta * 0.52);
    setTune(nextTune);
    setDragOrigin({ ...dragOrigin, lastAngle: angle, tune: nextTune });
  };

  const onKnobPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragOrigin && dragOrigin.pointerId === event.pointerId) {
      setDragOrigin(null);
      vibrate(10);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <main className="paper-bg min-h-dvh px-3 py-4 sm:py-6" style={signalVars}>
      {/* Always-animating wave background */}
      <div className="signal-overlay" aria-hidden="true">
        <svg
          ref={svgRef}
          viewBox={`0 0 1200 ${20 + LINE_COUNT * 40}`}
          preserveAspectRatio="none"
        >
          {lineProps.map((line) => (
            <path
              key={line.id}
              data-wave
              className="signal-path"
              d=""
              strokeWidth={line.strokeWidth}
              style={{
                opacity: `calc(${line.baseOpacity} + var(--signal-jagged, 0) * ${(line.baseOpacity * 1.4).toFixed(3)})`,
              }}
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
                adjustTune(event.deltaY > 0 ? -1.5 : 1.5);
              }}
              onPointerDown={onKnobPointerDown}
              onPointerMove={onKnobPointerMove}
              onPointerUp={onKnobPointerUp}
              onPointerCancel={onKnobPointerUp}
            >
              <span
                className="rotary-face"
                style={{ transform: `rotate(${knobAngle}deg)` }}
              >
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
