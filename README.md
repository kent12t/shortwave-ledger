# Shortwave Ledger

A consensus-ranked news aggregator with a tactile, radio-inspired interface.

[**Live Site**](https://news.pixelsmith.io)

---

## The Philosophy

In an era of information fatigue, **Shortwave Ledger** was built to provide a focused, intentional news consumption experience. Modern news discovery is often driven by engagement loops and algorithmic agitation; this project exists to return to a more deliberate mode of "tuning in."

The goal is not to present every story, but to surface the signals that truly resonate across the global landscape, allowing users to dive deeper only when they choose.

## Design Decisions

### Consensus-Based Discovery
Rather than relying on trending metrics or social media velocity, the system prioritizes headlines based on **cross-source consensus**. By monitoring major global outlets (BBC, NPR, DW, Al Jazeera, The Guardian, UN News), the ranking algorithm identifies topics being reported independently across multiple jurisdictions. 

The final "Main Signal" score is a weighted combination of:
- **Consensus**: Coverage density across independent networks.
- **Recency**: Statistical decay favoring the last 24 hours.
- **Impact**: Keyword-based analysis of high-gravity events.
- **Diversity**: Dynamic boosting for less-represented sources to avoid monoculture.

### Tactile Interaction
The interface draws inspiration from 20th-century shortwave radios. News is navigated via an interactive tuning dial rather than a scrollable list, encouraging a one-at-a-time focus. Visual "signal artifacts"—animated wave paths driven by harmonic sinusoids—provide a textured, electronic aesthetic that responds to the tuning state.

### Privacy by Default
Persistence is handled entirely on the client. The "Signal Log" (user history) is stored in local storage, ensuring that reading habits remain private and never touch a backend database.

## Technical Implementation

- **Runtime**: [Bun](https://bun.sh)
- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS & Vanilla CSS (Harmonic SVG animations)
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
