"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Headline } from "@/lib/news";
import { BAND_MAX_MHZ, BAND_MIN_MHZ, clamp01, toMHz, type RadioEngine } from "@/lib/radio";
import { SignalField } from "@/components/SignalField";

/** Band-units of tune per degree of knob rotation (~2.5 turns end to end). */
const TUNE_PER_DEGREE = 1 / 900;

const SCALE_LABELS = Array.from(
  { length: (BAND_MAX_MHZ - BAND_MIN_MHZ) / 4 + 1 },
  (_, i) => BAND_MIN_MHZ + i * 4,
);

export function Tuner({
  engine,
  stations,
  headlines,
  seenIds,
  nearest,
  locked,
  scanning,
}: {
  engine: RadioEngine;
  stations: number[];
  headlines: Headline[];
  seenIds: Set<string>;
  nearest: number;
  locked: boolean;
  scanning: boolean;
}) {
  const deckRef = useRef<HTMLElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const freqRef = useRef<HTMLSpanElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const knobDrag = useRef<{ id: number; cx: number; cy: number; angle: number } | null>(null);
  const dialDrag = useRef<number | null>(null);

  // Live frequency readout + ARIA value, written directly per frame.
  useEffect(() => {
    let lastText = "";
    return engine.on("frame", ({ tune }) => {
      const text = toMHz(tune).toFixed(1);
      if (text === lastText) return;
      lastText = text;
      if (freqRef.current) freqRef.current.textContent = text;
      knobRef.current?.setAttribute("aria-valuenow", text);
    });
  }, [engine]);

  // Wheel needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : -event.deltaY;
      const unit = event.deltaMode === 1 ? 16 : 1;
      engine.nudge(delta * unit * 0.00022);
    };
    deck.addEventListener("wheel", onWheel, { passive: false });
    return () => deck.removeEventListener("wheel", onWheel);
  }, [engine]);

  // ── knob: rotate by dragging around its centre ─────────────────────────
  const onKnobDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    knobDrag.current = {
      id: event.pointerId,
      cx,
      cy,
      angle: Math.atan2(event.clientY - cy, event.clientX - cx),
    };
    engine.beginDrag();
  };

  const onKnobMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = knobDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.cx;
    const dy = event.clientY - drag.cy;
    if (Math.hypot(dx, dy) < 6) return; // too close to the axis to read an angle
    const angle = Math.atan2(dy, dx);
    let delta = ((angle - drag.angle) * 180) / Math.PI;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    drag.angle = angle;
    engine.setTune(engine.tune + delta * TUNE_PER_DEGREE);
  };

  const onKnobUp = (event: PointerEvent<HTMLDivElement>) => {
    if (knobDrag.current?.id !== event.pointerId) return;
    knobDrag.current = null;
    engine.endDrag();
  };

  const onKnobKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const fine = 0.004;
    switch (event.key) {
      case "ArrowRight":
        engine.seek(1);
        break;
      case "ArrowLeft":
        engine.seek(-1);
        break;
      case "ArrowUp":
        engine.nudge(fine);
        break;
      case "ArrowDown":
        engine.nudge(-fine);
        break;
      case "Home":
        engine.tuneTo(0);
        break;
      case "End":
        engine.tuneTo(stations.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // ── dial window: grab anywhere and slide the needle ─────────────────────
  const dialPosition = (clientX: number) => {
    const rect = dialRef.current!.getBoundingClientRect();
    // The band is inset from the window edges (see .dial-stations).
    const inset = parseFloat(getComputedStyle(dialRef.current!).getPropertyValue("--band-inset")) || 14;
    return clamp01((clientX - rect.left - inset) / (rect.width - inset * 2));
  };

  const onDialDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dialDrag.current = event.pointerId;
    engine.beginDrag();
    engine.glideTo(dialPosition(event.clientX), 18);
  };

  const onDialMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dialDrag.current !== event.pointerId) return;
    engine.setTune(dialPosition(event.clientX));
  };

  const onDialUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dialDrag.current !== event.pointerId) return;
    dialDrag.current = null;
    engine.endDrag();
  };

  const current = headlines[nearest];
  const valueText = current
    ? `${toMHz(stations[nearest] ?? 0).toFixed(1)} megahertz, channel ${nearest + 1}: ${current.source}`
    : "No station";

  return (
    <section
      ref={deckRef}
      className="radio-deck"
      data-locked={locked || undefined}
      aria-label="Tuner"
    >
      <div className="deck-top">
        <div className="scope">
          <SignalField engine={engine} variant="scope" className="scope-canvas" />
        </div>
        <div className="readout" aria-hidden="true">
          <div className="readout-freq">
            <span ref={freqRef}>{toMHz(0).toFixed(1)}</span>
            <small>MHz</small>
          </div>
          <div className="readout-station">
            {scanning ? "Scanning" : current ? current.source : "No signal"}
          </div>
          <div className="signal-bars">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ "--i": i } as CSSProperties} />
            ))}
            <em className="lock-lamp">{locked ? "Lock" : " "}</em>
          </div>
        </div>
      </div>

      <div
        ref={dialRef}
        className="dial-window"
        onPointerDown={onDialDown}
        onPointerMove={onDialMove}
        onPointerUp={onDialUp}
        onPointerCancel={onDialUp}
        aria-hidden="true"
      >
        <div className="dial-ticks" />
        <div className="dial-stations">
          {stations.map((position, i) => {
            const headline = headlines[i];
            const strength = headline ? Math.min(1, headline.coverage.length / 4) : 0;
            return (
              <span
                key={headline?.id ?? i}
                className="station-mark"
                data-active={i === nearest || undefined}
                data-seen={(headline && seenIds.has(headline.id)) || undefined}
                style={
                  {
                    left: `${position * 100}%`,
                    "--strength": strength,
                  } as CSSProperties
                }
              />
            );
          })}
        </div>
        <div className="dial-labels">
          {SCALE_LABELS.map((mhz) => (
            <span
              key={mhz}
              style={{ left: `${((mhz - BAND_MIN_MHZ) / (BAND_MAX_MHZ - BAND_MIN_MHZ)) * 100}%` }}
            >
              {mhz}
            </span>
          ))}
        </div>
        <div className="dial-needle" data-needle>
          <span className="dial-needle-glow" />
        </div>
        <div className="dial-glass" />
      </div>

      <div className="deck-controls">
        <button
          type="button"
          className="seek-button"
          onClick={() => engine.seek(-1)}
          aria-label="Previous station"
          disabled={stations.length < 2}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>

        <div
          ref={knobRef}
          className="rotary-knob"
          role="slider"
          tabIndex={0}
          aria-label="Tuning dial"
          aria-valuemin={BAND_MIN_MHZ}
          aria-valuemax={BAND_MAX_MHZ}
          aria-valuenow={BAND_MIN_MHZ}
          aria-valuetext={valueText}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          onPointerDown={onKnobDown}
          onPointerMove={onKnobMove}
          onPointerUp={onKnobUp}
          onPointerCancel={onKnobUp}
          onKeyDown={onKnobKey}
        >
          <span className="rotary-face">
            <span className="rotary-marker" />
          </span>
          <span className="rotary-core" />
        </div>

        <button
          type="button"
          className="seek-button"
          onClick={() => engine.seek(1)}
          aria-label="Next station"
          disabled={stations.length < 2}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </section>
  );
}
