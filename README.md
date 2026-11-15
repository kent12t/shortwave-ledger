# Shortwave Ledger

A consensus-ranked news aggregator with a tactile, radio-inspired interface.

[**Live Site**](https://news.pixelsmith.io)

---

## The Philosophy

In an era of information fatigue, **Shortwave Ledger** was built to provide a focused, intentional news consumption experience. Modern news discovery is often driven by engagement loops and algorithmic agitation; this project exists to return to a more deliberate mode of "tuning in."

The goal is not to present every story, but to surface the signals that truly resonate across the global landscape, allowing users to dive deeper only when they choose.

## Design Decisions

### Consensus-Based Discovery
Rather than relying on trending metrics or social media velocity, the system prioritizes headlines based on **cross-source consensus**. It monitors major global outlets (BBC, NPR, DW, Al Jazeera, The Guardian, UN News) and groups headlines that describe the same event, even when each newsroom words it differently (*"Estonia closes border to Russia…"* and *"Estonia to close border crossings with Russia…"* become one story carried by three newsrooms). Matching weighs the rarest shared words in each headline and its lede, so two unrelated stories that both mention "Gaza" stay apart.

Each story's "Main Signal" score combines:
- **Consensus**: How many independent newsrooms carry it.
- **Recency**: Exponential decay over roughly the last day.
- **Prominence**: How high each newsroom placed it in its own feed.
- **Impact**: Keyword analysis for high-gravity events.

A final diversity pass stops any single prolific feed from monopolising the dial. Every story card lists the other newsrooms carrying it, with links to each version.

### Tactile Interaction
The interface draws inspiration from 20th-century shortwave radios. The top 24 stories are **stations on a real tuning band**. You move between them by turning the knob, dragging the dial window, swiping the story card or pressing <kbd>←</kbd>/<kbd>→</kbd>. Between stations the story smears into static. As you approach a station it sharpens, and automatic fine-tuning (AFC) pulls the needle onto the nearest station when you let go.

The background ink lines are a canvas-rendered signal field. Off-station they crackle with jagged grain. On a station they resolve into a smooth carrier wave whose shape is unique to that station. They part around your cursor or finger, and every tap or station lock sends a ripple through them. A small oscilloscope in the tuner deck shows the same signal up close. Optional synthesized sound (static that follows signal clarity, detent clicks, a lock chirp) and haptic detents complete the feel. Everything respects `prefers-reduced-motion`, and the page follows the system light or dark setting (dark is a warm, backlit night dial).

### Privacy by Default
Persistence is handled entirely on the client. The "Signal Log" (user history) is stored in local storage, ensuring that reading habits remain private and never touch a backend database. A story is logged only after you stay tuned to it for a moment, so sweeping across the band doesn't fill the log.

## Technical Implementation

- **Runtime**: [Bun](https://bun.sh)
- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS & vanilla CSS custom properties driven per-frame by the tuner
- **Rendering**: Canvas 2D signal field and oscilloscope; Web Audio for optional receiver sound
- **Infrastructure**: Cloudflare Pages via OpenNext

## Local Development

### Installation
```bash
bun install
```

### Run Locally
```bash
bun dev
```

### Build & Deploy
```bash
bun run build
bun run cf:deploy
```

---
*Developed for personal use and public reference.*
