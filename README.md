# Shortwave Ledger

A consensus-ranked news aggregator with a tactile, radio-inspired interface.

[**Live Site**](https://news.pixelsmith.io)

## Overview

Shortwave Ledger monitors major global news outlets—including BBC, NPR, DW, Al Jazeera, The Guardian, and UN News—and ranks stories based on cross-source consensus, recency, and impact.

Developed the app in order to consume news in my own preferred way, not overwhelming and allowing users (me, mostly) to dive deeper only if they choose to.

## Key Features

- **Consensus Ranking**: Headlines are prioritized when multiple independent sources report on the same topic.
- **Radio Interface**: Interactive tuning dial to cycle through stories and adjust signal visual artifacts.
- **Signal Log**: Local history of viewed headlines for persistence across sessions.

## Technical Stack

- **Framework**: [Next.js](https://nextjs.org) (App Router)
- **Deployment**: [Cloudflare Pages](https://pages.cloudflare.com/) via [@opennextjs/cloudflare](https://open-next.js.org/cloudflare)
- **Runtime**: [Bun](https://bun.sh)
- **Styling**: Tailwind CSS & Vanilla CSS

## Development

Install dependencies:
```bash
bun install
```

Start the development server:
```bash
bun dev
```

Build and deploy to Cloudflare:
```bash
bun run cf:deploy
```
