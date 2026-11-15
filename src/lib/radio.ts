/**
 * The receiver model: stations sit at fixed positions along a 0–1 band, the
 * needle position ("tune") moves continuously, and signal clarity falls off
 * with distance from the nearest station. A small spring glides the needle
 * for seeks and for automatic fine-tuning (AFC) once the user lets go.
 */

export const BAND_MIN_MHZ = 88;
export const BAND_MAX_MHZ = 108;
const BAND_EDGE = 0.05;

/** Clarity above which a station counts as locked in. */
export const LOCK_THRESHOLD = 0.9;
/** Idle time before AFC pulls the needle onto the nearest station. */
const AFC_DELAY_MS = 360;

export function toMHz(tune: number): number {
  return BAND_MIN_MHZ + tune * (BAND_MAX_MHZ - BAND_MIN_MHZ);
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Deterministic 0–1 hash so station layout is identical on every render. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Spread stations across the band with a little irregular spacing so the
 * dial reads like a real broadcast band rather than a ruler.
 */
export function layoutStations(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  const span = 1 - BAND_EDGE * 2;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const jitter = i === 0 || i === count - 1 ? 0 : (hash01(i) - 0.5) * step * 0.36;
    return BAND_EDGE + i * step + jitter;
  });
}

export type Signal = {
  nearest: number;
  /** Signed distance from the nearest station, in band units. */
  offset: number;
  clarity: number;
};

export function signalAt(tune: number, stations: number[]): Signal {
  if (stations.length === 0) return { nearest: -1, offset: 0, clarity: 0 };

  let nearest = 0;
  let best = Infinity;
  stations.forEach((position, i) => {
    const distance = Math.abs(tune - position);
    if (distance < best) {
      best = distance;
      nearest = i;
    }
  });

  const spacing = stations.length > 1 ? (1 - BAND_EDGE * 2) / (stations.length - 1) : 0.2;
  const sigma = Math.min(spacing * 0.3, 0.03);
  const offset = tune - stations[nearest]!;
  const clarity = Math.exp(-(offset * offset) / (2 * sigma * sigma));
  return { nearest, offset, clarity };
}

export type RadioFrame = {
  time: number;
  dt: number;
  tune: number;
  clarity: number;
  nearest: number;
  locked: boolean;
  /** Needle speed in band-widths per second. */
  speed: number;
};

type RadioEvents = {
  frame: (frame: RadioFrame) => void;
  nearest: (index: number) => void;
  lock: (index: number) => void;
  unlock: () => void;
  /** The needle crossed a station while being moved by hand. */
  detent: (index: number) => void;
};

type Listeners = { [K in keyof RadioEvents]: Set<RadioEvents[K]> };

export class RadioEngine {
  tune = 0;
  stations: number[] = [];
  reducedMotion = false;

  private target: number | null = null;
  private stiffness = 9;
  private dragging = false;
  private lastInputAt = 0;
  private raf = 0;
  private lastTs = 0;
  private startTs = 0;
  private speed = 0;
  private nearest = -1;
  private locked = false;
  private lastSide = 0;
  private listeners: Listeners = {
    frame: new Set(),
    nearest: new Set(),
    lock: new Set(),
    unlock: new Set(),
    detent: new Set(),
  };

  on<K extends keyof RadioEvents>(event: K, fn: RadioEvents[K]): () => void {
    this.listeners[event].add(fn);
    return () => {
      this.listeners[event].delete(fn);
    };
  }

  private emit<K extends keyof RadioEvents>(event: K, ...args: Parameters<RadioEvents[K]>) {
    this.listeners[event].forEach((fn) => (fn as (...a: typeof args) => void)(...args));
  }

  start() {
    if (this.raf) return;
    const loop = (ts: number) => {
      this.step(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
  }

  setStations(stations: number[]) {
    this.stations = stations;
    this.nearest = -1;
    this.locked = false;
  }

  /** Move the needle directly (drag, wheel, keyboard fine-tune). */
  setTune(value: number) {
    this.target = null;
    this.tune = clamp01(value);
    this.lastInputAt = performance.now();
  }

  nudge(delta: number) {
    this.setTune(this.tune + delta);
  }

  /** Spring the needle towards a position (seek, tap on dial, AFC). */
  glideTo(value: number, stiffness = 9) {
    this.target = clamp01(value);
    this.stiffness = stiffness;
    if (this.reducedMotion) {
      this.tune = this.target;
      this.target = null;
    }
  }

  seek(direction: 1 | -1) {
    if (this.stations.length === 0) return;
    // Measure from where the needle is heading, so rapid presses chain.
    // Between stations, the first press lands on the next one in that
    // direction rather than skipping past it.
    const from = this.target ?? this.tune;
    const eps = 0.002;
    let next =
      direction > 0
        ? this.stations.findIndex((p) => p > from + eps)
        : this.stations.findLastIndex((p) => p < from - eps);
    if (next < 0) next = direction > 0 ? 0 : this.stations.length - 1; // wrap around
    this.glideTo(this.stations[next]!, 7);
  }

  tuneTo(index: number) {
    const position = this.stations[index];
    if (position !== undefined) this.glideTo(position, 7);
  }

  beginDrag() {
    this.dragging = true;
    this.target = null;
  }

  endDrag() {
    this.dragging = false;
    this.lastInputAt = performance.now();
  }

  private step(ts: number) {
    if (!this.lastTs) {
      this.lastTs = ts;
      this.startTs = ts;
    }
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    const before = this.tune;

    if (this.target !== null) {
      const k = 1 - Math.exp(-dt * this.stiffness);
      this.tune += (this.target - this.tune) * k;
      if (Math.abs(this.target - this.tune) < 0.0002) {
        this.tune = this.target;
        this.target = null;
      }
    } else if (
      !this.dragging &&
      this.stations.length > 0 &&
      performance.now() - this.lastInputAt > AFC_DELAY_MS
    ) {
      const { nearest, offset } = signalAt(this.tune, this.stations);
      if (Math.abs(offset) > 0.0002) this.glideTo(this.stations[nearest]!, 11);
    }

    const instantSpeed = dt > 0 ? Math.abs(this.tune - before) / dt : 0;
    this.speed += (instantSpeed - this.speed) * Math.min(1, dt * 12);

    const signal = signalAt(this.tune, this.stations);

    if (signal.nearest !== this.nearest) {
      this.nearest = signal.nearest;
      this.lastSide = Math.sign(signal.offset);
      this.emit("nearest", signal.nearest);
    } else if (signal.nearest >= 0) {
      const side = Math.sign(signal.offset);
      if (side !== 0 && this.lastSide !== 0 && side !== this.lastSide && this.target === null) {
        this.emit("detent", signal.nearest);
      }
      if (side !== 0) this.lastSide = side;
    }

    // Hysteresis so the lock doesn't flicker at the threshold.
    const locked = this.locked
      ? signal.clarity > LOCK_THRESHOLD - 0.15
      : signal.clarity > LOCK_THRESHOLD && this.speed < 0.15;
    if (locked !== this.locked) {
      this.locked = locked;
      if (locked) this.emit("lock", signal.nearest);
      else this.emit("unlock");
    }

    this.emit("frame", {
      time: (ts - this.startTs) / 1000,
      dt,
      tune: this.tune,
      clarity: signal.clarity,
      nearest: signal.nearest,
      locked,
      speed: this.speed,
    });
  }
}
