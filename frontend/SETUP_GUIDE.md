# Zetheta HFT Arena — Frontend Setup Guide

## Prerequisites

Make sure you have these installed:

```bash
# Check Node.js (need v16+)
node --version

# Check npm
npm --version
```

If you don't have Node.js, install it:
- **Windows**: Download from https://nodejs.org (LTS version)
- **Mac**: `brew install node`
- **Linux**: `sudo apt install nodejs npm`

---

## Quick Start (3 commands)

```bash
# 1. Navigate to the frontend folder
cd hft-frontend

# 2. Install dependencies
npm install

# 3. Run the dev server
npm start
```

That's it. Browser opens automatically at **http://localhost:3000**

---

## Project Structure

```
hft-frontend/
├── package.json            # Dependencies & scripts
├── public/
│   └── index.html          # HTML shell
├── src/
│   ├── index.js            # React entry point
│   └── HFTDashboard.jsx    # Main dashboard component (everything lives here)
└── SETUP_GUIDE.md          # This file
```

---

## Where This Fits in Project 46

```
zetheta-hft-puzzle/
├── engine/                 # Phase 1 — C++ matching engine (DONE)
│   ├── include/
│   ├── src/
│   ├── tests/
│   └── CMakeLists.txt
├── api/                    # Phase 2 — FastAPI + WebSocket (DONE)
│   ├── main.py
│   ├── config.py
│   ├── services/
│   ├── routes/
│   └── requirements.txt
├── hft-frontend/           # Phase 3 — React frontend (YOU ARE HERE)
│   ├── package.json
│   ├── public/
│   └── src/
└── README.md
```

---

## What You'll See

The dashboard has 3 views (use the top nav to switch):

### 1. TRADE View
- **Left**: Live order book with bid/ask depth bars
- **Center**: OHLC candlestick chart + market depth chart (hover for OHLC tooltip)
- **Right**: Order entry panel (BUY/SELL, LIMIT/MARKET, quantity presets)
- **Bottom**: Trade log / positions / open orders tabs
- **Top bar**: PnL, position, fills, latency stats

### 2. CHALLENGES View
- 6 puzzles (Market Making, Latency Arb, Momentum, Pairs Trading, Flash Crash, Adverse Selection)
- Click a challenge → see description, objective, strategy tips
- Hit START → switches to Trade view with countdown timer

### 3. RANKINGS View
- Podium display for top 3
- Full leaderboard with score, solved count, best latency, streak

---

## Troubleshooting

### `npm install` fails
```bash
# Clear cache and retry
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Port 3000 already in use
```bash
# Use a different port
PORT=3001 npm start

# Or on Windows:
set PORT=3001 && npm start
```

### Fonts not loading
The dashboard loads Google Fonts (Orbitron, JetBrains Mono, IBM Plex Mono) via CDN. 
If you're offline, the fallback monospace fonts will be used. No action needed.

---

## Next Steps

This is currently a **standalone prototype with mock data**. The order book, 
candlestick chart, and trades are all simulated client-side.

To connect to your FastAPI backend (Phase 2), we'll need to:

1. **WebSocket connection** — Replace the simulated `setInterval` updates with 
   real WebSocket feeds from `ws://localhost:8000/ws/trade/{session_id}`
2. **REST API integration** — Wire up auth (login/register), challenge 
   start/stop, leaderboard fetching to your FastAPI endpoints
3. **Trade execution** — Send orders through WebSocket to the real matching engine 
   instead of the mock `handleTrade` function

We'll tackle this wiring in the next session.
