"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { HeadlinesResponse } from "@/app/api/headlines/route";
import { HistoryDrawer } from "@/components/HistoryDrawer";
import { SignalField } from "@/components/SignalField";
import { Tuner } from "@/components/Tuner";
import { ReceiverAudio } from "@/lib/audio";
import {
  addSeen,
  clearHistory,
  readHistory,
  readPreference,
  writePreference,
  type SeenHeadline,
} from "@/lib/history";
import { RadioEngine, layoutStations } from "@/lib/radio";

/** Stay locked on a story this long before it is written to the log. */
const DWELL_MS = 1500;
/** Refetch when the tab returns and the data is older than this. */
const STALE_MS = 10 * 60 * 1000;

type Status = "loading" | "ready" | "error";

function vibrate(pattern: number | number[]) {
  try {
    // Browsers refuse (and warn) until the user has interacted with the page.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
      .userActivation;
    if (activation && !activation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported (iOS Safari) — haptics are a bonus.
  }
}

function relativeTime(iso: string, now: number) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function Home() {
  const [engine] = useState(() => new RadioEngine());
  const [audio] = useState(() => new ReceiverAudio());

  const [data, setData] = useState<HeadlinesResponse | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [nearest, setNearest] = useState(-1);
  const [locked, setLocked] = useState(false);
  const [history, setHistory] = useState<SeenHeadline[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const rootRef = useRef<HTMLElement>(null);
  const currentIdRef = useRef<string | null>(null);
  const loadedAtRef = useRef(0);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  const headlines = useMemo(() => data?.headlines ?? [], [data]);
  const stations = useMemo(() => layoutStations(headlines.length), [headlines.length]);
  const current = headlines[nearest] ?? null;
  const seenIds = useMemo(() => new Set(history.map((item) => item.id)), [history]);

  // ── radio engine wiring ──────────────────────────────────────────────────
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => engine.setReducedMotion(motion.matches);
    syncMotion();
    motion.addEventListener("change", syncMotion);

    const root = rootRef.current;
    const offs = [
      engine.on("frame", ({ tune, clarity, speed }) => {
        if (root) {
          root.style.setProperty("--tune", tune.toFixed(5));
          root.style.setProperty("--clarity", clarity.toFixed(3));
        }
        audio.update(clarity, speed);
      }),
      engine.on("nearest", setNearest),
      engine.on("lock", () => {
        setLocked(true);
        audio.lock();
        vibrate([8, 40, 14]);
      }),
      engine.on("unlock", () => setLocked(false)),
      engine.on("detent", () => {
        audio.detent();
        vibrate(6);
      }),
    ];
    engine.start();

    return () => {
      offs.forEach((off) => off());
      motion.removeEventListener("change", syncMotion);
      engine.stop();
    };
  }, [engine, audio]);

  // ── data ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/headlines", { cache: "no-store" });
      const payload = (await response.json()) as HeadlinesResponse;
      const next = payload.headlines ?? [];
      const positions = layoutStations(next.length);
      const keepIndex = next.findIndex((h) => h.id === currentIdRef.current);

      engine.setStations(positions);
      if (keepIndex >= 0) {
        // Refresh: stay on the story the reader was on.
        engine.setTune(positions[keepIndex]!);
      } else if (positions.length > 0) {
        // First load: sweep in from across the band and lock the top story.
        engine.glideTo(positions[0]!, 3.2);
      }

      loadedAtRef.current = Date.now();
      setData(payload);
      setNow(Date.now());
      setStatus(next.length > 0 ? "ready" : "error");
    } catch {
      setData(null);
      setStatus("error");
    }
  }, [engine]);

  useEffect(() => {
    // Drift the needle while we wait, as if scanning for a signal.
    engine.setTune(0.55);
    engine.glideTo(0.38, 0.6);
    const initial = window.setTimeout(() => void load(), 0);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (loadedAtRef.current && Date.now() - loadedAtRef.current > STALE_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(clock);
    };
  }, [engine, load]);

  const retry = () => {
    setStatus("loading");
    engine.glideTo(Math.random(), 0.8);
    void load();
  };

  // ── persisted client state ───────────────────────────────────────────────
  useEffect(() => {
    // Deferred so the server and first client render agree.
    const id = window.setTimeout(() => {
      setHistory(readHistory());
      if (readPreference("sound") === "on") setSoundOn(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    currentIdRef.current = current?.id ?? null;
  }, [current]);

  // Only log a story once the reader has actually stopped on it.
  useEffect(() => {
    if (!locked || !current) return;
    const id = window.setTimeout(() => setHistory(addSeen(current)), DWELL_MS);
    return () => window.clearTimeout(id);
  }, [locked, current]);

  // Audio can only start from a user gesture, so a remembered "on"
  // preference arms it for the first interaction.
  useEffect(() => {
    if (!soundOn || audio.enabled) return;
    const arm = () => void audio.enable();
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [soundOn, audio]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writePreference("sound", next ? "on" : "off");
    if (next) void audio.enable();
    else void audio.disable();
    vibrate(10);
  };

  // ── keyboard: ← → seek anywhere on the page ─────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (historyOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable], [role=slider]")) return;
      if (event.key === "ArrowRight" || event.key === "j") engine.seek(1);
      else if (event.key === "ArrowLeft" || event.key === "k") engine.seek(-1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, historyOpen]);

  // ── swipe the story card to scrub the dial ───────────────────────────────
  const scrub = useRef<{
    id: number;
    x: number;
    y: number;
    tune: number;
    from: number;
    active: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const onCardDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    scrub.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      tune: engine.tune,
      from: nearest,
      active: false,
    };
  };

  const onCardMove = (event: ReactPointerEvent<HTMLElement>) => {
    const s = scrub.current;
    if (!s || s.id !== event.pointerId || stations.length < 2) return;
    const dx = event.clientX - s.x;
    const dy = event.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        scrub.current = null; // vertical scroll — let it go
        return;
      }
      if (Math.abs(dx) < 10) return;
      s.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      engine.beginDrag();
    }
    const spacing = (stations[stations.length - 1]! - stations[0]!) / (stations.length - 1);
    const width = event.currentTarget.getBoundingClientRect().width;
    engine.setTune(s.tune - (dx / width) * spacing * 1.8);
  };

  const onCardUp = (event: ReactPointerEvent<HTMLElement>) => {
    const s = scrub.current;
    scrub.current = null;
    if (!s || s.id !== event.pointerId || !s.active) return;
    engine.endDrag();
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 50);
    // A short flick that didn't cross halfway still changes station.
    const dx = event.clientX - s.x;
    if (Math.abs(dx) > 36 && nearest === s.from) engine.seek(dx < 0 ? 1 : -1);
  };

  const onCardClickCapture = (event: ReactMouseEvent) => {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // ── render ───────────────────────────────────────────────────────────────
  const feedsDown = data?.feeds.filter((feed) => !feed.ok).map((feed) => feed.name) ?? [];
  const channelLabel =
    status === "error" ? "No Signal" : nearest <= 0 ? "Main Signal" : `Channel ${pad(nearest + 1)}`;
  const subtitle =
    status === "error"
      ? "Every newsroom feed is quiet for the moment"
      : status === "loading"
        ? "Tuning across the world service band"
        : nearest <= 0
          ? "The story most newsrooms agree on right now"
          : `Ranked ${nearest + 1} of ${headlines.length} by cross-source consensus`;

  return (
    <main ref={rootRef} className="receiver" data-locked={locked || undefined}>
      <SignalField engine={engine} variant="field" className="signal-field" />

      <div className="receiver-stack">
        <section className="ledger-card" aria-labelledby="channel-title">
          <header className="ledger-head">
            <div>
              <p className="eyebrow">Shortwave Ledger</p>
              <h1 id="channel-title">{channelLabel}</h1>
              <p className="subtitle">{subtitle}</p>
            </div>
            <div className="head-actions">
              <button
                type="button"
                onClick={toggleSound}
                className="icon-button"
                aria-pressed={soundOn}
                aria-label={soundOn ? "Mute receiver sound" : "Turn on receiver sound"}
                title={soundOn ? "Sound on" : "Sound off"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
                  {soundOn ? (
                    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
                  ) : (
                    <path d="M16 9.5l5 5M21 9.5l-5 5" />
                  )}
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  vibrate(12);
                  setHistory(readHistory());
                  setHistoryOpen(true);
                }}
                className="icon-button"
                aria-label="Open signal log"
                aria-haspopup="dialog"
                title="Signal log"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 8v4l2.8 1.6M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
                </svg>
              </button>
            </div>
          </header>

          <article
            className="signal-card"
            onPointerDown={onCardDown}
            onPointerMove={onCardMove}
            onPointerUp={onCardUp}
            onPointerCancel={onCardUp}
            onClickCapture={onCardClickCapture}
            aria-busy={status === "loading"}
          >
            {status === "loading" ? (
              <div className="card-skeleton" aria-label="Loading headlines">
                <span style={{ width: "40%" }} />
                <span className="tall" />
                <span className="tall" style={{ width: "70%" }} />
                <span />
                <span style={{ width: "85%" }} />
              </div>
            ) : status === "error" || !current ? (
              <div className="card-empty">
                <p className="meta">Signal lost</p>
                <p className="card-empty-text">
                  {data?.message ?? "Couldn't reach the newsroom feeds. Check your connection."}
                </p>
                <button type="button" className="pill-button" onClick={retry}>
                  Scan again
                </button>
              </div>
            ) : (
              <div className="tuned" key={current.id}>
                <p className="meta">
                  <span>{current.source}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={current.publishedAt} title={new Date(current.publishedAt).toLocaleString()}>
                    {relativeTime(current.publishedAt, now)}
                  </time>
                </p>
                <h2 className="headline">{current.title}</h2>
                {current.summary && <p className="summary">{current.summary}</p>}

                <div className="coverage">
                  <span className="coverage-label">
                    {current.coverage.length > 1
                      ? `Carried by ${current.coverage.length} newsrooms`
                      : "Single-source report"}
                  </span>
                  {current.coverage.length > 1 && (
                    <ul>
                      {current.coverage.map((item) => (
                        <li key={item.source}>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={item.title}
                            className="coverage-chip"
                          >
                            {item.source}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <a
                  href={current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => vibrate(16)}
                  className="read-link"
                >
                  Read at {current.source}
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </a>
              </div>
            )}
            {status !== "error" && (
              <div className="static-veil" aria-hidden="true">
                <span>{status === "loading" ? "Scanning" : "Tuning"}</span>
              </div>
            )}
          </article>

          <footer className="ledger-foot">
            <span>Logged {history.length}</span>
            <span title={feedsDown.length ? `Off air: ${feedsDown.join(", ")}` : "All feeds on air"}>
              {data?.feedHealth ?? "--"} on air
            </span>
            <span>
              {data && (
                <time dateTime={data.generatedAt} title="Last updated">
                  {new Date(data.generatedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              )}
            </span>
          </footer>
        </section>

        <Tuner
          engine={engine}
          stations={stations}
          headlines={headlines}
          seenIds={seenIds}
          nearest={nearest}
          locked={locked}
          scanning={status === "loading"}
        />

        <p className="hint">
          Turn the dial · drag the band · swipe the story
          <span className="kbd-only">
            {" "}
            · <kbd>←</kbd> <kbd>→</kbd> to seek
          </span>
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {locked && current ? `Channel ${nearest + 1}, ${current.source}: ${current.title}` : ""}
      </p>

      <HistoryDrawer
        open={historyOpen}
        history={history}
        onClose={closeHistory}
        onClear={() => setHistory(clearHistory())}
      />
    </main>
  );
}
