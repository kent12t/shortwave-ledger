"use client";

import { useEffect, useRef } from "react";
import type { RadioEngine, RadioFrame } from "@/lib/radio";

type Variant = "field" | "scope";

type Ripple = { x: number; y: number; t0: number; strength: number };

/** Cheap deterministic hash → [-1, 1]. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Smooth 1-D value noise → roughly [-1, 1]. */
function vnoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i + seed * 57.31);
  const b = hash(i + 1 + seed * 57.31);
  return a + (b - a) * u;
}

function readColor(el: Element, name: string, fallback: string) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Canvas renderer for the receiver's signal.
 *
 * - `field`: ink lines across the whole page. Off-station they crackle
 *   with jagged static; as a station comes in they resolve into a smooth
 *   carrier whose shape is unique to that station. Lines bend around the
 *   pointer and every tap or station lock sends a ripple through them.
 * - `scope`: a small oscilloscope trace for the tuner deck.
 */
export function SignalField({
  engine,
  variant,
  className,
}: {
  engine: RadioEngine;
  variant: Variant;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let ink = "60, 46, 28";
    let accent = "232, 112, 32";
    let inkAlpha = 0.22;
    // Signature of the last static (reduced-motion) frame; cleared whenever
    // the canvas is resized or recoloured, since that wipes the bitmap.
    let lastStatic = "";

    const refreshColors = () => {
      ink = readColor(canvas, "--wave-ink", ink);
      accent = readColor(canvas, "--wave-accent", accent);
      inkAlpha = parseFloat(readColor(canvas, "--wave-alpha", String(inkAlpha))) || inkAlpha;
      lastStatic = "";
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastStatic = "";
    };

    refreshColors();
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", refreshColors);

    // ── pointer & ripples (field only) ──────────────────────────────────
    const pointer = { x: -9999, y: -9999, sx: -9999, sy: -9999, presence: 0, lastMove: 0 };
    const ripples: Ripple[] = [];
    let clock = 0;

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (pointer.sx < -999) {
        pointer.sx = pointer.x;
        pointer.sy = pointer.y;
      }
      pointer.lastMove = clock;
    };
    const onDown = (event: PointerEvent) => {
      onMove(event);
      ripples.push({ x: event.clientX, y: event.clientY, t0: clock, strength: 0.8 });
      if (ripples.length > 6) ripples.shift();
    };
    const offLock = engine.on("lock", () => {
      const needle = document.querySelector("[data-needle]");
      if (!needle) return;
      const rect = needle.getBoundingClientRect();
      ripples.push({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        t0: clock,
        strength: 1.4,
      });
    });
    if (variant === "field") {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
    }

    // Smoothed values so the picture eases rather than snaps.
    let clarity = 0;
    let speed = 0;
    let carrierK = 0.02;
    let harmonic = 2;

    const draw = (frame: RadioFrame) => {
      clock = frame.time;
      const t = engine.reducedMotion ? 0 : frame.time;
      const ease = Math.min(1, frame.dt * 6);
      clarity += (frame.clarity - clarity) * ease;
      speed += (Math.min(frame.speed, 1.5) - speed) * ease;

      // Each station has its own carrier shape, derived from its position.
      const stationPos = engine.stations[frame.nearest] ?? frame.tune;
      const targetK = 0.011 + stationPos * 0.022;
      carrierK += (targetK - carrierK) * ease;
      harmonic = 2 + (frame.nearest % 3);

      // Under reduced motion only redraw when the signal actually changes.
      if (engine.reducedMotion) {
        const key = `${clarity.toFixed(3)}|${frame.tune.toFixed(4)}`;
        if (key === lastStatic) return;
        lastStatic = key;
      }

      const c = clarity;
      const staticLevel = Math.pow(1 - c, 1.25) + speed * 0.35;
      // Static flickers at ~20fps, like a CRT refreshing grain.
      const grainFrame = Math.floor(t * 20);

      ctx.clearRect(0, 0, width, height);

      if (variant === "scope") {
        drawScope(c, staticLevel, t, grainFrame);
        return;
      }

      pointer.sx += (pointer.x - pointer.sx) * Math.min(1, frame.dt * 10);
      pointer.sy += (pointer.y - pointer.sy) * Math.min(1, frame.dt * 10);
      const active = clock - pointer.lastMove < 1.6 ? 1 : 0;
      pointer.presence += (active - pointer.presence) * Math.min(1, frame.dt * 3);

      for (let r = ripples.length - 1; r >= 0; r--) {
        if (clock - ripples[r]!.t0 > 2.6) ripples.splice(r, 1);
      }

      const lineCount = Math.max(12, Math.min(30, Math.round(height / 30)));
      const gap = height / lineCount;
      const noiseAmp = Math.min(gap * 0.42, 11) * staticLevel;
      const carrierAmp = Math.min(gap * 0.4, 13) * c;
      const step = width > 900 ? 5 : 4;
      const lensR = 120;

      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      for (let i = 0; i < lineCount; i++) {
        const baseY = (i + 0.5) * gap;
        const lineAlpha = inkAlpha * (0.55 + 0.45 * ((i * 7) % 5) / 4) * (0.75 + c * 0.35);
        ctx.beginPath();

        for (let x = -step; x <= width + step; x += step) {
          // Static: two octaves of value noise plus rare sharp spikes.
          let noise = 0;
          if (noiseAmp > 0.05) {
            noise =
              vnoise(x * 0.11 + i * 31.7, grainFrame + i) * 0.65 +
              vnoise(x * 0.37 + i * 7.3, grainFrame * 1.37 + i) * 0.35;
            const spike = hash(Math.floor(x / 9) * 3.1 + i * 91.7 + grainFrame * 13.3);
            if (spike > 0.94) noise += (spike - 0.94) * 30 * Math.sign(hash(x + grainFrame));
          }

          // Carrier: a travelling wave with a slow breathing envelope and
          // a station-specific harmonic.
          let carrier = 0;
          if (carrierAmp > 0.05) {
            const phase = x * carrierK + t * 1.6 + i * 0.52;
            const envelope = 0.62 + 0.38 * Math.sin(x * 0.0042 - t * 0.55 + i * 0.85);
            carrier =
              (Math.sin(phase) + 0.28 * Math.sin(phase * harmonic + t * 0.9 + i)) * envelope;
          }

          let y = baseY + noise * noiseAmp + carrier * carrierAmp;

          // Pointer lens: lines part around the cursor / finger.
          if (pointer.presence > 0.01) {
            const dx = x - pointer.sx;
            const dy = baseY - pointer.sy;
            const g = Math.exp(-(dx * dx + dy * dy) / (2 * lensR * lensR));
            y += (dy / lensR) * 22 * g * pointer.presence;
          }

          // Ripples push lines radially outward as a ring expands.
          for (const ripple of ripples) {
            const age = clock - ripple.t0;
            const radius = age * 460;
            const dx = x - ripple.x;
            const dy = baseY - ripple.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            const ring = Math.exp(-((d - radius) ** 2) / (2 * 30 * 30));
            if (ring < 0.01) continue;
            y += (dy / d) * ring * 14 * ripple.strength * Math.exp(-age * 1.5);
          }

          if (x === -step) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = `rgba(${ink}, ${lineAlpha.toFixed(3)})`;
        ctx.lineWidth = i % 4 === 0 ? 1.25 : 0.85;
        ctx.stroke();
      }
    };

    const drawScope = (c: number, staticLevel: number, t: number, grainFrame: number) => {
      const mid = height / 2;

      // Graticule
      ctx.strokeStyle = `rgba(${ink}, 0.12)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= width; gx += width / 10) {
        ctx.moveTo(Math.round(gx) + 0.5, 0);
        ctx.lineTo(Math.round(gx) + 0.5, height);
      }
      ctx.moveTo(0, Math.round(mid) + 0.5);
      ctx.lineTo(width, Math.round(mid) + 0.5);
      ctx.stroke();

      const noiseAmp = height * 0.34 * Math.min(1.2, staticLevel);
      const carrierAmp = height * 0.3 * c;
      // 2.5–6.5 visible cycles depending on the station.
      const cycles = ((carrierK - 0.011) / 0.022) * 4 + 2.5;
      const k = (cycles * Math.PI * 2) / Math.max(width, 1);

      const trace = (alpha: number, lag: number, lineWidth: number) => {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 1.5) {
          const noise =
            noiseAmp > 0.05
              ? vnoise(x * 0.35, grainFrame - lag) * 0.7 + vnoise(x * 1.1, grainFrame * 1.7 - lag) * 0.3
              : 0;
          const phase = x * k - (t - lag * 0.04) * 6;
          const carrier = Math.sin(phase) + 0.28 * Math.sin(phase * harmonic);
          const y = mid + noise * noiseAmp + carrier * carrierAmp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${accent}, ${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      };

      // Phosphor persistence: fainter echoes of earlier sweeps.
      trace(0.14, 2, 1);
      trace(0.28, 1, 1.2);
      trace(0.95, 0, 1.6);
    };

    const offFrame = engine.on("frame", draw);

    return () => {
      offFrame();
      offLock();
      resizeObserver.disconnect();
      scheme.removeEventListener("change", refreshColors);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [engine, variant]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
