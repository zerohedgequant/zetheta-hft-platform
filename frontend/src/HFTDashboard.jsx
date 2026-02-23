import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import RiskDashboard from "./components/RiskDashboard";

// ═══════════════════════════════════════════════════════════════
// ZETHETA HFT PUZZLE PLATFORM v2 — REFINED TRADING DASHBOARD
// ═══════════════════════════════════════════════════════════════

const MONO = "'JetBrains Mono', 'Fira Code', 'Source Code Pro', monospace";
const DISPLAY = "'Orbitron', sans-serif";
const BODY = "'IBM Plex Mono', 'JetBrains Mono', monospace";

const T = {
  bg: "#060a11",
  bgAlt: "#0a0f1a",
  surface: "#0f1520",
  surfaceHover: "#131b28",
  surfaceAlt: "#0b1018",
  panel: "#111a27",
  border: "#1a2436",
  borderLight: "#243048",
  text: "#e8edf5",
  textSec: "#94a3b8",
  textDim: "#64748b",
  textMuted: "#3e4c63",
  cyan: "#22d3ee",
  cyanBright: "#67e8f9",
  cyanDim: "rgba(34,211,238,0.10)",
  green: "#34d399",
  greenBright: "#6ee7b7",
  greenDim: "rgba(52,211,153,0.08)",
  red: "#f87171",
  redBright: "#fca5a5",
  redDim: "rgba(248,113,113,0.08)",
  amber: "#fbbf24",
  amberDim: "rgba(251,191,36,0.08)",
  purple: "#a78bfa",
  purpleDim: "rgba(167,139,250,0.08)",
  gold: "#ffd700",
  silver: "#c0c0c0",
  bronze: "#cd7f32",
};

const fmt = (n, d = 2) => Number(n).toFixed(d);
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n));
const fmtComma = (n) => n.toLocaleString();
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = () => Math.random().toString(36).slice(2, 8);

function generateCandles(mid, count = 60) {
  const candles = [];
  let price = mid - rand(1, 3);
  for (let i = 0; i < count; i++) {
    const open = price;
    const delta = rand(-0.3, 0.35) + rand(-0.3, 0.35) + rand(-0.3, 0.35);
    const close = clamp(open + delta, mid - 5, mid + 5);
    const high = Math.max(open, close) + rand(0, 0.2);
    const low = Math.min(open, close) - rand(0, 0.2);
    const vol = Math.round(rand(200, 4000) * (1 + Math.abs(close - open) * 5));
    candles.push({ t: i, open, high, low, close, vol });
    price = close;
  }
  return candles;
}

function generateOrderBook(midPrice, spread = 0.05, levels = 15) {
  const bids = [], asks = [];
  for (let i = 0; i < levels; i++) {
    const decay = Math.exp(-i * 0.12);
    bids.push({ price: midPrice - spread / 2 - i * rand(0.01, 0.035), qty: Math.round(rand(80, 2200) * decay), total: 0 });
    asks.push({ price: midPrice + spread / 2 + i * rand(0.01, 0.035), qty: Math.round(rand(80, 2200) * decay), total: 0 });
  }
  let cb = 0, ca = 0;
  bids.forEach(b => { cb += b.qty; b.total = cb; });
  asks.forEach(a => { ca += a.qty; a.total = ca; });
  return { bids, asks, maxQty: Math.max(...bids.map(b => b.qty), ...asks.map(a => a.qty)) };
}

const CHALLENGES = [
  { id: "mm1", name: "Market Making 101", cat: "Market Making", diff: 1, desc: "Quote bid/ask prices and earn the spread. Manage your inventory risk as the market moves.", obj: "PnL ≥ $500 with |inventory| < 100", time: 120, color: T.cyan, icon: "⚡", tips: ["Start with tight spreads", "Widen when volatile", "Watch your position"] },
  { id: "arb1", name: "Latency Arbitrage", cat: "Arbitrage", diff: 2, desc: "Spot price gaps between two venues and trade before convergence. Speed is everything.", obj: "Capture 10+ arb opportunities", time: 90, color: T.green, icon: "🔄", tips: ["Watch the spread differential", "React within 50ms", "Mind the transaction costs"] },
  { id: "mom1", name: "Momentum Surge", cat: "Momentum", diff: 2, desc: "Detect momentum signals and ride the wave. Enter early, exit before the reversal.", obj: "Ride 3+ waves, net positive PnL", time: 150, color: T.amber, icon: "📈", tips: ["Volume confirms momentum", "Set trailing stops", "Don't chase late"] },
  { id: "stat1", name: "Pairs Trading", cat: "Stat Arb", diff: 3, desc: "Trade mean-reversion between correlated instruments when the spread deviates from equilibrium.", obj: "Sharpe ratio > 1.5", time: 180, color: T.purple, icon: "📊", tips: ["Monitor z-score", "Size proportionally", "Exit at mean reversion"] },
  { id: "crash1", name: "Flash Crash", cat: "Risk Mgmt", diff: 3, desc: "A sudden crash hits the market. Manage risk, cut losses, and survive the chaos.", obj: "Max drawdown < $200", time: 60, color: T.red, icon: "💥", tips: ["Pre-set stop losses", "Reduce position fast", "Don't catch the knife"] },
  { id: "mm2", name: "Adverse Selection", cat: "Market Making", diff: 4, desc: "Market make against informed flow. Detect toxic orders and dynamically adjust your quotes.", obj: "Stay profitable despite toxic flow", time: 120, color: T.cyanBright, icon: "🛡️", tips: ["Track order flow toxicity", "Widen on informed flow", "Skew your quotes"] },
];

const LEADERBOARD_DATA = [
  { rank: 1, name: "QuantKing_99", score: 14820, solved: 6, best: "0.4μs", streak: 12 },
  { rank: 2, name: "AlphaSeeker", score: 12350, solved: 6, best: "0.6μs", streak: 8 },
  { rank: 3, name: "NanoTrader", score: 11200, solved: 5, best: "0.5μs", streak: 6 },
  { rank: 4, name: "ByteArb", score: 9870, solved: 5, best: "0.7μs", streak: 5 },
  { rank: 5, name: "SpreadEagle", score: 8430, solved: 4, best: "0.9μs", streak: 3 },
  { rank: 6, name: "DeltaHedge", score: 7650, solved: 4, best: "1.1μs", streak: 2 },
  { rank: 7, name: "PipHunter", score: 6200, solved: 3, best: "1.3μs", streak: 0 },
  { rank: 8, name: "MarketOwl", score: 5100, solved: 3, best: "1.5μs", streak: 0 },
  { rank: 9, name: "FlowRider", score: 4200, solved: 2, best: "1.8μs", streak: 0 },
  { rank: 10, name: "TickSniper", score: 3100, solved: 2, best: "2.0μs", streak: 0 },
];

// ═══════════════════════════════════════════════════════════════
// MICRO COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Panel({ children, title, accent = T.cyan, style = {}, right, noPad }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 4, display: "flex", flexDirection: "column", overflow: "hidden", ...style }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderBottom: `1px solid ${T.border}`, background: "rgba(0,0,0,0.3)", minHeight: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 3, height: 10, borderRadius: 1, background: accent, flexShrink: 0 }} />
            <span style={{ fontFamily: DISPLAY, fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: accent, opacity: 0.9 }}>{title}</span>
          </div>
          {right}
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", ...(noPad ? {} : { padding: "10px 12px" }) }}>{children}</div>
    </div>
  );
}

function Badge({ children, color = T.cyan, glow }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 7px", borderRadius: 2, fontSize: 9, fontFamily: MONO, fontWeight: 600, color, background: color + "15", border: `1px solid ${color}30`, ...(glow ? { boxShadow: `0 0 8px ${color}30` } : {}) }}>
      {children}
    </span>
  );
}

function Difficulty({ level, max = 4 }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {Array.from({ length: max }, (_, i) => (
        <div key={i} style={{ width: 5, height: 5, borderRadius: 1, background: i < level ? T.amber : T.textMuted + "40", transition: "background 0.3s" }} />
      ))}
    </div>
  );
}

function Kbd({ children }) {
  return (
    <kbd style={{ display: "inline-block", padding: "1px 5px", fontSize: 9, fontFamily: MONO, background: T.surfaceHover, border: `1px solid ${T.borderLight}`, borderRadius: 3, color: T.textDim, lineHeight: "16px" }}>
      {children}
    </kbd>
  );
}

function Toast({ toast, onDone }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setShow(true));
    const t = setTimeout(() => { setShow(false); setTimeout(onDone, 300); }, 2200);
    return () => clearTimeout(t);
  }, []);
  const color = toast.side === "BUY" ? T.green : T.red;
  return (
    <div style={{ padding: "8px 14px", background: T.panel, border: `1px solid ${color}40`, borderLeft: `3px solid ${color}`, borderRadius: 4, fontFamily: MONO, fontSize: 11, color: T.text, opacity: show ? 1 : 0, transform: show ? "translateX(0)" : "translateX(20px)", transition: "all 0.3s ease", boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 15px ${color}15`, display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color, fontWeight: 700 }}>{toast.side}</span>
      <span style={{ color: T.textDim }}>×</span>
      <span>{toast.qty}</span>
      <span style={{ color: T.textDim }}>@</span>
      <span style={{ color }}>{fmt(toast.price)}</span>
    </div>
  );
}

function ToastContainer({ toasts, removeToast }) {
  return (
    <div style={{ position: "fixed", top: 60, right: 16, zIndex: 10000, display: "flex", flexDirection: "column", gap: 6 }}>
      {toasts.map(t => <Toast key={t.id} toast={t} onDone={() => removeToast(t.id)} />)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CANDLESTICK CHART
// ═══════════════════════════════════════════════════════════════
function CandlestickChart({ candles, width, height }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef();
  const pad = { top: 10, right: 50, bottom: 4, left: 0 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;
  const volH = 35;
  const allHigh = Math.max(...candles.map(c => c.high));
  const allLow = Math.min(...candles.map(c => c.low));
  const priceRange = allHigh - allLow || 1;
  const maxVol = Math.max(...candles.map(c => c.vol));
  const barW = Math.max(2, (cw / candles.length) - 1.5);
  const gap = cw / candles.length;
  const yP = (p) => pad.top + (1 - (p - allLow) / priceRange) * (ch - volH);
  const gridLines = 4;
  const priceStep = priceRange / gridLines;

  return (
    <svg ref={svgRef} width={width} height={height} style={{ display: "block", width: "100%" }}
      onMouseMove={e => { const rect = svgRef.current.getBoundingClientRect(); const idx = Math.round((e.clientX - rect.left - pad.left) / gap); if (idx >= 0 && idx < candles.length) setHover(idx); }}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: gridLines + 1 }, (_, i) => {
        const price = allLow + i * priceStep;
        const y = yP(price);
        return (<g key={i}><line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke={T.border} strokeWidth="0.5" strokeDasharray="3,4" /><text x={width - pad.right + 6} y={y + 3} fill={T.textMuted} fontSize="9" fontFamily={MONO}>{fmt(price)}</text></g>);
      })}
      {candles.map((c, i) => {
        const x = pad.left + i * gap;
        const bull = c.close >= c.open;
        return (<rect key={`v${i}`} x={x + 0.5} y={height - pad.bottom - (c.vol / maxVol) * volH} width={Math.max(1, barW - 1)} height={(c.vol / maxVol) * volH} fill={bull ? T.green : T.red} opacity={hover === i ? 0.4 : 0.12} rx="0.5" />);
      })}
      {candles.map((c, i) => {
        const x = pad.left + i * gap + gap / 2;
        const bull = c.close >= c.open;
        const color = bull ? T.green : T.red;
        const bodyTop = yP(Math.max(c.open, c.close));
        const bodyH = Math.max(1, yP(Math.min(c.open, c.close)) - bodyTop);
        return (
          <g key={`c${i}`} opacity={hover !== null && hover !== i ? 0.4 : 1} style={{ transition: "opacity 0.15s" }}>
            <line x1={x} y1={yP(c.high)} x2={x} y2={yP(c.low)} stroke={color} strokeWidth="1" opacity="0.6" />
            <rect x={x - barW / 2} y={bodyTop} width={barW} height={bodyH} fill={color} rx="0.5" stroke={color} strokeWidth="0.5" opacity="0.85" />
          </g>
        );
      })}
      {hover !== null && candles[hover] && (() => {
        const c = candles[hover];
        const x = pad.left + hover * gap + gap / 2;
        const y = yP(c.close);
        const bull = c.close >= c.open;
        const color = bull ? T.green : T.red;
        const ttX = Math.min(x + 8, width - 120);
        const ttY = Math.max(pad.top, y - 50);
        return (
          <g>
            <line x1={x} y1={pad.top} x2={x} y2={height - pad.bottom} stroke={T.textMuted} strokeWidth="0.5" strokeDasharray="2,3" />
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke={color} strokeWidth="0.5" strokeDasharray="2,3" />
            <circle cx={x} cy={y} r="3" fill={color} stroke={T.bg} strokeWidth="1.5" />
            <rect x={width - pad.right + 2} y={y - 8} width={44} height={16} rx="2" fill={color} />
            <text x={width - pad.right + 6} y={y + 3} fill="#000" fontSize="9" fontWeight="700" fontFamily={MONO}>{fmt(c.close)}</text>
            <rect x={ttX} y={ttY} width={108} height={48} rx="3" fill={T.bg} stroke={T.borderLight} strokeWidth="0.5" opacity="0.95" />
            <text fontFamily={MONO} fontSize="8.5" fill={T.textDim}>
              <tspan x={ttX + 6} y={ttY + 12}>O {fmt(c.open)}  H {fmt(c.high)}</tspan>
              <tspan x={ttX + 6} y={ttY + 24}>L {fmt(c.low)}  C <tspan fill={color}>{fmt(c.close)}</tspan></tspan>
              <tspan x={ttX + 6} y={ttY + 36}>VOL {fmtK(c.vol)}</tspan>
            </text>
          </g>
        );
      })()}
      {candles.length > 0 && (() => {
        const last = candles[candles.length - 1];
        const y = yP(last.close);
        const color = last.close >= last.open ? T.green : T.red;
        return <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke={color} strokeWidth="0.7" strokeDasharray="4,3" opacity="0.5" />;
      })()}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEPTH CHART
// ═══════════════════════════════════════════════════════════════
function DepthChart({ book, width, height }) {
  const pad = { left: 10, right: 10, top: 5, bottom: 5 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const allP = [...book.bids.map(b => b.price), ...book.asks.map(a => a.price)];
  const minP = Math.min(...allP), maxP = Math.max(...allP), rng = maxP - minP || 1;
  const maxT = Math.max(book.bids[book.bids.length - 1]?.total || 1, book.asks[book.asks.length - 1]?.total || 1);
  const x = p => pad.left + ((p - minP) / rng) * w;
  const y = t => pad.top + h - (t / maxT) * h;
  const bidPts = book.bids.map(b => `${x(b.price)},${y(b.total)}`).join(" ");
  const askPts = book.asks.map(a => `${x(a.price)},${y(a.total)}`).join(" ");
  const bidFill = `${x(book.bids[0]?.price || 0)},${pad.top + h} ${bidPts} ${x(book.bids[book.bids.length - 1]?.price || 0)},${pad.top + h}`;
  const askFill = `${x(book.asks[0]?.price || 0)},${pad.top + h} ${askPts} ${x(book.asks[book.asks.length - 1]?.price || 0)},${pad.top + h}`;
  return (
    <svg width={width} height={height} style={{ display: "block", width: "100%" }}>
      <defs>
        <linearGradient id="bG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.green} stopOpacity="0.25" /><stop offset="100%" stopColor={T.green} stopOpacity="0.02" /></linearGradient>
        <linearGradient id="aG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.red} stopOpacity="0.25" /><stop offset="100%" stopColor={T.red} stopOpacity="0.02" /></linearGradient>
      </defs>
      <polygon points={bidFill} fill="url(#bG)" /><polyline points={bidPts} fill="none" stroke={T.green} strokeWidth="1.2" opacity="0.7" />
      <polygon points={askFill} fill="url(#aG)" /><polyline points={askPts} fill="none" stroke={T.red} strokeWidth="1.2" opacity="0.7" />
      <line x1={w / 2 + pad.left} y1={pad.top} x2={w / 2 + pad.left} y2={pad.top + h} stroke={T.textMuted} strokeWidth="0.5" strokeDasharray="2,3" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// ORDER BOOK
// ═══════════════════════════════════════════════════════════════
function OrderBook({ book }) {
  const Row = ({ price, qty, total, side, maxQty }) => {
    const isBid = side === "bid";
    const color = isBid ? T.green : T.red;
    const pct = (qty / maxQty) * 100;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "2.5px 10px", fontSize: 11, fontFamily: MONO, position: "relative", cursor: "pointer", transition: "background 0.08s" }}
        onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        <div style={{ position: "absolute", top: 0, bottom: 0, [isBid ? "left" : "right"]: 0, width: `${pct}%`, background: isBid ? T.greenDim : T.redDim, borderRight: isBid ? `1px solid ${color}20` : "none", borderLeft: !isBid ? `1px solid ${color}20` : "none", transition: "width 0.4s ease" }} />
        <span style={{ color, position: "relative", textAlign: "left", fontWeight: 500, fontSize: 10.5 }}>{fmt(price)}</span>
        <span style={{ color: T.textSec, position: "relative", textAlign: "center", fontSize: 10.5 }}>{fmtK(qty)}</span>
        <span style={{ color: T.textMuted, position: "relative", textAlign: "right", fontSize: 10 }}>{fmtK(total)}</span>
      </div>
    );
  };
  const spread = book.asks[0]?.price - book.bids[0]?.price;
  const mid = (book.bids[0]?.price + book.asks[0]?.price) / 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "5px 10px", fontSize: 8.5, fontFamily: MONO, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.5, borderBottom: `1px solid ${T.border}` }}>
        <span>Price</span><span style={{ textAlign: "center" }}>Size</span><span style={{ textAlign: "right" }}>Cum.</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          {[...book.asks].reverse().slice(0, 10).map((a, i) => <Row key={`a${i}`} {...a} side="ask" maxQty={book.maxQty} />)}
        </div>
        <div style={{ padding: "5px 10px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(0,0,0,0.3)", borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: T.cyan, letterSpacing: 0.5 }}>{fmt(mid)}</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: T.textDim, background: T.cyanDim, padding: "1px 6px", borderRadius: 2 }}>SPD {fmt(spread, 3)}</span>
        </div>
        <div>
          {book.bids.slice(0, 10).map((b, i) => <Row key={`b${i}`} {...b} side="bid" maxQty={book.maxQty} />)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRADING PANEL
// ═══════════════════════════════════════════════════════════════
function TradingPanel({ midPrice, onTrade }) {
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("LIMIT");
  const [price, setPrice] = useState(fmt(midPrice));
  const [qty, setQty] = useState("100");
  useEffect(() => { if (orderType === "MARKET") setPrice(fmt(midPrice)); }, [midPrice, orderType]);
  const isBuy = side === "BUY";
  const accent = isBuy ? T.green : T.red;
  const est = parseFloat(price || 0) * parseInt(qty || 0);

  const tog = (active, color) => ({ flex: 1, padding: "7px 0", border: `1px solid ${active ? color + "60" : T.border}`, background: active ? color + "12" : "transparent", color: active ? color : T.textDim, fontFamily: MONO, fontSize: 10, fontWeight: 700, cursor: "pointer", borderRadius: 3, transition: "all 0.12s", letterSpacing: 1.2, textAlign: "center" });
  const inp = { width: "100%", padding: "8px 10px", background: T.bgAlt, border: `1px solid ${T.border}`, borderRadius: 3, color: T.text, fontFamily: MONO, fontSize: 12, outline: "none", boxSizing: "border-box", transition: "border-color 0.15s" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={tog(isBuy, T.green)} onClick={() => setSide("BUY")}>BUY</button>
        <button style={tog(!isBuy, T.red)} onClick={() => setSide("SELL")}>SELL</button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {["LIMIT", "MARKET"].map(t => <button key={t} style={tog(orderType === t, T.cyan)} onClick={() => setOrderType(t)}>{t}</button>)}
      </div>
      {orderType === "LIMIT" && (
        <div>
          <label style={{ fontFamily: MONO, fontSize: 8.5, color: T.textDim, textTransform: "uppercase", letterSpacing: 1.5, display: "block", marginBottom: 3 }}>Price</label>
          <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} style={inp} />
        </div>
      )}
      <div>
        <label style={{ fontFamily: MONO, fontSize: 8.5, color: T.textDim, textTransform: "uppercase", letterSpacing: 1.5, display: "block", marginBottom: 3 }}>Quantity</label>
        <input type="number" value={qty} onChange={e => setQty(e.target.value)} style={inp} />
        <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
          {[25, 50, 100, 250, 500, 1000].map(q => (
            <button key={q} onClick={() => setQty(String(q))} style={{ flex: 1, padding: "3px 0", fontSize: 8.5, fontFamily: MONO, background: qty === String(q) ? T.cyanDim : "transparent", border: `1px solid ${qty === String(q) ? T.cyan + "40" : T.border}`, color: qty === String(q) ? T.cyan : T.textMuted, borderRadius: 2, cursor: "pointer", transition: "all 0.1s" }}>
              {q >= 1000 ? `${q / 1000}K` : q}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: "8px 0", borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10, color: T.textDim, marginBottom: 4 }}>
          <span>EST. VALUE</span><span style={{ color: T.text, fontWeight: 600 }}>${fmtComma(Math.round(est))}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10, color: T.textDim }}>
          <span>FEES (EST.)</span><span style={{ color: T.textSec }}>${fmt(est * 0.0001)}</span>
        </div>
      </div>
      <button onClick={() => onTrade?.({ side, orderType, price: parseFloat(price || midPrice), qty: parseInt(qty || 0), id: uid() })}
        style={{ padding: "11px 0", background: accent, border: "none", borderRadius: 4, color: "#000", fontFamily: DISPLAY, fontSize: 11, fontWeight: 800, letterSpacing: 2.5, cursor: "pointer", textTransform: "uppercase", transition: "all 0.12s", boxShadow: `0 2px 15px ${accent}35, inset 0 1px 0 rgba(255,255,255,0.15)` }}
        onMouseDown={e => e.currentTarget.style.transform = "scale(0.97)"}
        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
      >
        {side} {orderType}
      </button>
      <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 8.5, color: T.textMuted, marginTop: -4 }}>
        <Kbd>B</Kbd> Buy · <Kbd>S</Kbd> Sell · <Kbd>Enter</Kbd> Submit
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATS BAR + CHALLENGE BANNER + TRADE LOG
// ═══════════════════════════════════════════════════════════════
function StatsBar({ pnl, trades, position, latency }) {
  const S = ({ label, value, color, prefix = "" }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontFamily: MONO, fontSize: 8.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.2 }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color, fontWeight: 600 }}>{prefix}{value}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 20, padding: "6px 16px", background: T.bgAlt, borderBottom: `1px solid ${T.border}`, alignItems: "center", flexShrink: 0 }}>
      <S label="PnL" value={`$${fmt(Math.abs(pnl))}`} prefix={pnl >= 0 ? "+" : "−"} color={pnl >= 0 ? T.green : T.red} />
      <div style={{ width: 1, height: 14, background: T.border }} />
      <S label="Pos" value={Math.abs(position)} prefix={position > 0 ? "+" : position < 0 ? "−" : ""} color={position !== 0 ? (position > 0 ? T.green : T.red) : T.textDim} />
      <S label="Fills" value={trades} color={T.text} />
      <div style={{ flex: 1 }} />
      <S label="Latency" value={`${fmt(latency, 1)}μs`} color={latency < 1 ? T.green : latency < 5 ? T.amber : T.red} />
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.green, boxShadow: `0 0 6px ${T.green}80` }} />
        <span style={{ fontFamily: MONO, fontSize: 9, color: T.green, fontWeight: 600 }}>LIVE</span>
      </div>
    </div>
  );
}

function ChallengeBanner({ challenge, timeLeft, onStop }) {
  const pct = (timeLeft / challenge.time) * 100;
  const urgent = pct < 20;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: `linear-gradient(90deg, ${challenge.color}08, transparent 60%)`, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      <span style={{ fontSize: 16 }}>{challenge.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 10, color: challenge.color, letterSpacing: 1.5 }}>{challenge.name}</span>
          <Badge color={challenge.color}>{challenge.cat}</Badge>
        </div>
        <div style={{ height: 2, background: T.border, borderRadius: 1, marginTop: 5, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: urgent ? T.red : challenge.color, borderRadius: 1, transition: "width 1s linear, background 0.5s", boxShadow: urgent ? `0 0 8px ${T.red}` : "none" }} />
        </div>
      </div>
      <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: urgent ? T.red : T.text, minWidth: 52, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{timeLeft}s</span>
      <button onClick={onStop} style={{ padding: "4px 10px", background: T.redDim, border: `1px solid ${T.red}30`, borderRadius: 3, color: T.red, fontFamily: MONO, fontSize: 9, cursor: "pointer", fontWeight: 600, letterSpacing: 1 }}>END</button>
    </div>
  );
}

function TradeLog({ trades }) {
  if (!trades.length) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 6, padding: 20 }}>
      <span style={{ fontSize: 22, opacity: 0.4 }}>📋</span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: T.textMuted }}>Waiting for trades...</span>
    </div>
  );
  return (
    <div>{trades.slice(0, 30).map((t, i) => (
      <div key={t.id || i} style={{ display: "grid", gridTemplateColumns: "44px 50px 60px 1fr", gap: 8, padding: "4px 12px", fontSize: 10.5, fontFamily: MONO, borderBottom: `1px solid ${T.border}`, alignItems: "center", opacity: Math.max(0.4, 1 - i * 0.05) }}>
        <Badge color={t.side === "BUY" ? T.green : T.red}>{t.side}</Badge>
        <span style={{ color: T.textSec }}>{t.orderType === "MARKET" ? "MKT" : "LMT"}</span>
        <span style={{ color: T.text, textAlign: "right" }}>×{t.qty}</span>
        <span style={{ color: t.side === "BUY" ? T.green : T.red, textAlign: "right" }}>@{fmt(t.price)}</span>
      </div>
    ))}</div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHALLENGES VIEW
// ═══════════════════════════════════════════════════════════════
function ChallengesView({ onStart }) {
  const [sel, setSel] = useState(null);
  const c = sel !== null ? CHALLENGES[sel] : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%", gap: 1, background: T.border }}>
      <div style={{ background: T.panel, overflow: "auto" }}>
        <div style={{ padding: "14px 14px 8px", fontFamily: DISPLAY, fontSize: 9, color: T.textDim, letterSpacing: 2, textTransform: "uppercase" }}><span style={{ color: T.cyan }}>6</span> Challenges Available</div>
        {CHALLENGES.map((ch, i) => (
          <div key={ch.id} onClick={() => setSel(i)}
            style={{ padding: "11px 14px", background: sel === i ? ch.color + "08" : "transparent", borderLeft: `3px solid ${sel === i ? ch.color : "transparent"}`, borderBottom: `1px solid ${T.border}`, cursor: "pointer", transition: "all 0.12s" }}
            onMouseEnter={e => { if (sel !== i) e.currentTarget.style.background = T.surfaceHover; }}
            onMouseLeave={e => { if (sel !== i) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15 }}>{ch.icon}</span>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: T.text }}>{ch.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: T.textDim, marginTop: 2 }}>{ch.cat} · {ch.time}s</div>
                </div>
              </div>
              <Difficulty level={ch.diff} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: T.surface, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
        {c ? (
          <div style={{ maxWidth: 480, padding: "40px 32px", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 28 }}>
              <div style={{ width: 56, height: 56, borderRadius: 8, background: c.color + "12", border: `1px solid ${c.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>{c.icon}</div>
              <div>
                <h2 style={{ fontFamily: DISPLAY, fontSize: 18, color: c.color, letterSpacing: 2, margin: 0, lineHeight: 1.2 }}>{c.name}</h2>
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <Badge color={c.color} glow>{c.cat}</Badge>
                  <Difficulty level={c.diff} />
                  <span style={{ fontFamily: MONO, fontSize: 9, color: T.textDim }}>{c.time}s</span>
                </div>
              </div>
            </div>
            <p style={{ fontFamily: BODY, fontSize: 13, lineHeight: 1.8, color: T.textSec, marginBottom: 20, letterSpacing: 0.2 }}>{c.desc}</p>
            <div style={{ padding: "14px 16px", background: T.bgAlt, borderRadius: 6, border: `1px solid ${T.border}`, marginBottom: 16 }}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>🎯 Objective</div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: T.text, fontWeight: 500 }}>{c.obj}</div>
            </div>
            <div style={{ padding: "14px 16px", background: T.bgAlt, borderRadius: 6, border: `1px solid ${T.border}`, marginBottom: 24 }}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>💡 Strategy Tips</div>
              {c.tips.map((tip, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: i < c.tips.length - 1 ? 6 : 0 }}>
                  <span style={{ color: c.color, fontSize: 9, marginTop: 2 }}>▸</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: T.textSec, lineHeight: 1.5 }}>{tip}</span>
                </div>
              ))}
            </div>
            <button onClick={() => onStart(c)} style={{ width: "100%", padding: "13px 0", background: c.color, border: "none", borderRadius: 5, color: "#000", fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, letterSpacing: 3, cursor: "pointer", boxShadow: `0 2px 20px ${c.color}30, inset 0 1px 0 rgba(255,255,255,0.2)`, transition: "all 0.12s" }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
            >START CHALLENGE</button>
          </div>
        ) : (
          <div style={{ textAlign: "center", color: T.textMuted }}>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>🎯</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 11, letterSpacing: 2.5, marginBottom: 6, color: T.textDim }}>SELECT A CHALLENGE</div>
            <div style={{ fontFamily: MONO, fontSize: 10 }}>Pick a puzzle from the left to begin</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LEADERBOARD VIEW
// ═══════════════════════════════════════════════════════════════
function LeaderboardView() {
  const podium = LEADERBOARD_DATA.slice(0, 3);
  const rest = LEADERBOARD_DATA.slice(3);
  const medalColors = [T.gold, T.silver, T.bronze];
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 20px", height: "100%", overflow: "auto" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 16, color: T.cyan, letterSpacing: 4, margin: 0 }}>GLOBAL RANKINGS</h2>
        <p style={{ fontFamily: MONO, fontSize: 10, color: T.textDim, marginTop: 6 }}>Top traders across all challenges</p>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 24, alignItems: "flex-end" }}>
        {[1, 0, 2].map(idx => {
          const p = podium[idx]; const isFirst = idx === 0; const color = medalColors[idx];
          return (
            <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: isFirst ? 140 : 120 }}>
              <div style={{ width: isFirst ? 48 : 40, height: isFirst ? 48 : 40, borderRadius: "50%", background: `${color}18`, border: `2px solid ${color}60`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: isFirst ? 16 : 13, fontWeight: 800, color, marginBottom: 8, boxShadow: `0 0 15px ${color}20` }}>#{p.rank}</div>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: T.green, marginBottom: 4 }}>{fmtComma(p.score)}</div>
              <div style={{ fontFamily: MONO, fontSize: 9, color: T.textDim }}>{p.solved}/6 · {p.best}</div>
              <div style={{ width: "100%", height: isFirst ? 80 : 56 - idx * 8, background: `linear-gradient(to top, ${color}12, ${color}06)`, borderTop: `2px solid ${color}40`, borderRadius: "4px 4px 0 0", marginTop: 8 }} />
            </div>
          );
        })}
      </div>
      <Panel title="Rankings" noPad accent={T.cyan} right={<span style={{ fontFamily: MONO, fontSize: 8.5, color: T.textMuted }}>SCORE · SOLVED · BEST · STREAK</span>}>
        {rest.map(e => (
          <div key={e.rank} style={{ display: "grid", gridTemplateColumns: "32px 1fr 70px 44px 44px 36px", alignItems: "center", padding: "8px 12px", fontSize: 11, fontFamily: MONO, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
            onMouseEnter={ev => ev.currentTarget.style.background = T.surfaceHover}
            onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
          >
            <span style={{ color: T.textMuted }}>#{e.rank}</span>
            <span style={{ color: T.text }}>{e.name}</span>
            <span style={{ color: T.green, textAlign: "right", fontWeight: 600 }}>{fmtComma(e.score)}</span>
            <span style={{ color: T.textDim, textAlign: "right" }}>{e.solved}/6</span>
            <span style={{ color: T.textDim, textAlign: "right" }}>{e.best}</span>
            <span style={{ textAlign: "right", fontSize: 10 }}>{e.streak > 0 ? `🔥${e.streak}` : "—"}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function HFTDashboard() {
  const MID = 152.35;
  const [candles, setCandles] = useState(() => generateCandles(MID));
  const [book, setBook] = useState(() => generateOrderBook(MID));
  const [trades, setTrades] = useState([]);
  const [pnl, setPnl] = useState(0);
  const [position, setPosition] = useState(0);
  const [view, setView] = useState("trade");
  const [activeChallenge, setActiveChallenge] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [bottomTab, setBottomTab] = useState("Trades");
  const [toasts, setToasts] = useState([]);
  const [latency] = useState(() => rand(0.3, 1.2));

  const currentPrice = candles[candles.length - 1]?.close || MID;
  const firstPrice = candles[0]?.open || MID;
  const priceChange = currentPrice - firstPrice;
  const pctChange = (priceChange / firstPrice) * 100;

  useEffect(() => {
    const iv = setInterval(() => {
      setCandles(prev => {
        const last = prev[prev.length - 1];
        const open = last.close;
        const delta = rand(-0.2, 0.22);
        const close = clamp(open + delta, MID - 5, MID + 5);
        const high = Math.max(open, close) + rand(0, 0.12);
        const low = Math.min(open, close) - rand(0, 0.12);
        const vol = Math.round(rand(200, 3500));
        const next = [...prev.slice(-59), { t: last.t + 1, open, high, low, close, vol }];
        setBook(generateOrderBook(close));
        return next;
      });
    }, 900);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!activeChallenge) return;
    if (timeLeft <= 0) { setActiveChallenge(null); return; }
    const iv = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(iv);
  }, [activeChallenge, timeLeft]);

  const handleTrade = useCallback(trade => {
    setTrades(prev => [trade, ...prev].slice(0, 100));
    const delta = trade.side === "BUY" ? trade.qty : -trade.qty;
    setPosition(p => p + delta);
    setPnl(p => p + delta * rand(-0.03, 0.035));
    setToasts(prev => [...prev, { ...trade, id: uid() }]);
  }, []);

  const removeToast = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const startChallenge = c => {
    setActiveChallenge(c); setTimeLeft(c.time);
    setTrades([]); setPnl(0); setPosition(0); setView("trade");
  };

  return (
    <div style={{ width: "100%", height: "100vh", background: T.bg, color: T.text, fontFamily: MONO, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px; }
        input:focus { border-color: ${T.cyan} !important; box-shadow: 0 0 0 1px ${T.cyan}30; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0; }
      `}</style>

      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Scan lines */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999, background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(34,211,238,0.008) 3px, rgba(34,211,238,0.008) 4px)", mixBlendMode: "screen" }} />

      {/* NAV */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", height: 42, borderBottom: `1px solid ${T.border}`, background: T.bgAlt, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 22, height: 22, background: `linear-gradient(135deg, ${T.cyan}, ${T.cyan}80)`, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 10, fontWeight: 900, color: "#000" }}>Z</span>
          </div>
          <span style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: 3 }}>ZETHETA</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: T.textMuted, padding: "2px 6px", background: T.cyanDim, borderRadius: 2 }}>HFT ARENA</span>
        </div>
        <div style={{ display: "flex", gap: 2, background: T.surface, borderRadius: 4, padding: 2, border: `1px solid ${T.border}` }}>
          {[{ key: "trade", label: "TRADE", icon: "◈" }, { key: "challenges", label: "CHALLENGES", icon: "◆" }, { key: "leaderboard", label: "RANKINGS", icon: "◇" }, { key: "risk", label: "RISK", icon: "⚡" }].map(v => (
            <button key={v.key} onClick={() => setView(v.key)} style={{ padding: "5px 14px", fontFamily: DISPLAY, fontSize: 8.5, letterSpacing: 1.5, background: view === v.key ? T.cyanDim : "transparent", border: "none", color: view === v.key ? T.cyan : T.textDim, borderRadius: 3, cursor: "pointer", transition: "all 0.12s", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 7 }}>{v.icon}</span> {v.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: T.textDim }}>{new Date().toLocaleTimeString("en-US", { hour12: false })}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.green, boxShadow: `0 0 6px ${T.green}80` }} />
            <span style={{ fontFamily: MONO, fontSize: 9, color: T.green, fontWeight: 600 }}>LIVE</span>
          </div>
        </div>
      </div>

      {activeChallenge && <ChallengeBanner challenge={activeChallenge} timeLeft={timeLeft} onStop={() => setActiveChallenge(null)} />}
      {view === "trade" && <StatsBar pnl={pnl} trades={trades.length} position={position} latency={latency} />}

      <div style={{ flex: 1, overflow: "hidden" }}>
        {view === "trade" && (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 240px", gridTemplateRows: "1fr 170px", height: "100%", gap: 1, background: T.border }}>
            <Panel title="Order Book" accent={T.cyan} noPad style={{ borderRadius: 0 }}>
              <OrderBook book={book} />
            </Panel>
            <div style={{ background: T.surface, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "10px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontFamily: DISPLAY, fontSize: 10, color: T.textDim, letterSpacing: 2 }}>AAPL</span>
                    <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>{fmt(currentPrice)}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: priceChange >= 0 ? T.green : T.red, fontWeight: 600 }}>
                      {priceChange >= 0 ? "+" : ""}{fmt(priceChange)} ({priceChange >= 0 ? "+" : ""}{fmt(pctChange)}%)
                    </span>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: T.textMuted, marginTop: 3 }}>
                    H {fmt(Math.max(...candles.slice(-20).map(c => c.high)))} · L {fmt(Math.min(...candles.slice(-20).map(c => c.low)))} · V {fmtK(candles.slice(-20).reduce((a, c) => a + c.vol, 0))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {["1s", "5s", "15s", "1m", "5m"].map((tf, i) => (
                    <button key={tf} style={{ padding: "3px 7px", fontSize: 8.5, fontFamily: MONO, background: i === 2 ? T.cyanDim : "transparent", border: `1px solid ${i === 2 ? T.cyan + "30" : T.border}`, color: i === 2 ? T.cyan : T.textMuted, borderRadius: 2, cursor: "pointer" }}>{tf}</button>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, padding: "8px 12px 0", display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
                <CandlestickChart candles={candles} width={580} height={210} />
              </div>
              <div style={{ padding: "0 12px 6px" }}>
                <div style={{ fontFamily: MONO, fontSize: 8, color: T.textMuted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2, paddingLeft: 10 }}>Market Depth</div>
                <DepthChart book={book} width={580} height={60} />
              </div>
            </div>
            <Panel title="Place Order" accent={T.cyan} style={{ borderRadius: 0 }}>
              <TradingPanel midPrice={currentPrice} onTrade={handleTrade} />
            </Panel>
            <div style={{ gridColumn: "1 / -1", background: T.panel, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "0 14px", borderBottom: `1px solid ${T.border}`, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 28 }}>
                <div style={{ display: "flex", gap: 1 }}>
                  {["Trades", "Positions", "Open Orders"].map(tab => (
                    <button key={tab} onClick={() => setBottomTab(tab)} style={{ padding: "5px 12px", fontFamily: MONO, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", background: bottomTab === tab ? T.cyanDim : "transparent", border: "none", color: bottomTab === tab ? T.cyan : T.textDim, cursor: "pointer", borderBottom: bottomTab === tab ? `1px solid ${T.cyan}` : "1px solid transparent", transition: "all 0.1s" }}>
                      {tab}
                    </button>
                  ))}
                </div>
                <span style={{ fontFamily: MONO, fontSize: 9, color: T.textMuted }}>{trades.length} fills</span>
              </div>
              <div style={{ flex: 1, overflow: "auto" }}>
                {bottomTab === "Trades" && <TradeLog trades={trades} />}
                {bottomTab === "Positions" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: MONO, fontSize: 11, color: T.textMuted }}>
                    {position !== 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Badge color={position > 0 ? T.green : T.red}>{position > 0 ? "LONG" : "SHORT"}</Badge>
                        <span style={{ color: T.text, fontWeight: 600 }}>{Math.abs(position)} shares AAPL</span>
                      </div>
                    ) : "Flat — no open positions"}
                  </div>
                )}
                {bottomTab === "Open Orders" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: MONO, fontSize: 11, color: T.textMuted }}>No open orders</div>
                )}
              </div>
            </div>
          </div>
        )}
        {view === "challenges" && <ChallengesView onStart={startChallenge} />}
        {view === "leaderboard" && <LeaderboardView />}
        {view === "risk" && <RiskDashboard sessionId="demo123" apiBaseUrl="http://localhost:8000" />}
      </div>
    </div>
  );
}
