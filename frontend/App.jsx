import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ============================================================
// ZETHETA HFT PUZZLE PLATFORM — REACT FRONTEND
// Phase 3: Complete Trading Interface
// ============================================================

// --- Config ---
const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";

// --- Utility Helpers ---
const fmt = (n, decimals = 2) => Number(n).toFixed(decimals);
const fmtPrice = (n) => `$${fmt(n, 2)}`;
const fmtPnL = (n) => {
  const s = fmt(n, 2);
  return n >= 0 ? `+$${s}` : `-$${Math.abs(n).toFixed(2)}`;
};
const fmtTime = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};
const cls = (...classes) => classes.filter(Boolean).join(" ");

// --- API Client ---
const api = {
  token: null,
  async req(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Request failed" }));
      throw new Error(err.detail || err.message || "Request failed");
    }
    return res.json();
  },
  get: (p) => api.req(p),
  post: (p, body) => api.req(p, { method: "POST", body: JSON.stringify(body) }),
  del: (p) => api.req(p, { method: "DELETE" }),
};

// --- Sparkline Component ---
function Sparkline({ data, width = 120, height = 32, color = "#00ff88" }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- Animated Number ---
function AnimNum({ value, prefix = "", decimals = 2, className = "" }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const start = prev.current;
    const end = value;
    if (start === end) return;
    const duration = 300;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    prev.current = value;
  }, [value]);

  return <span className={className}>{prefix}{fmt(display, decimals)}</span>;
}

// ============================================================
// VIEWS
// ============================================================

// --- AUTH VIEW ---
function AuthView({ onLogin }) {
  const [mode, setMode] = useState("login"); // login | register
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        await api.post("/api/auth/register", { username, email, password });
      }
      const data = await api.post("/api/auth/login", { username, password });
      api.token = data.access_token;
      onLogin({ username, token: data.access_token });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.authContainer}>
      <div style={styles.authGlow} />
      <div style={styles.authCard}>
        <div style={styles.authLogo}>
          <span style={styles.logoZ}>Z</span>
          <span style={styles.logoText}>ETHETA</span>
        </div>
        <p style={styles.authSubtitle}>High-Frequency Trading Puzzle Platform</p>

        <div style={styles.authTabs}>
          <button
            onClick={() => setMode("login")}
            style={cls(mode === "login" ? styles.authTabActive : styles.authTab)}
          >
            LOGIN
          </button>
          <button
            onClick={() => setMode("register")}
            style={cls(mode === "register" ? styles.authTabActive : styles.authTab)}
          >
            REGISTER
          </button>
        </div>

        <div style={styles.authForm}>
          <label style={styles.inputLabel}>USERNAME</label>
          <input
            style={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="trader_alpha"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          {mode === "register" && (
            <>
              <label style={styles.inputLabel}>EMAIL</label>
              <input
                style={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="trader@zetheta.com"
                type="email"
              />
            </>
          )}
          <label style={styles.inputLabel}>PASSWORD</label>
          <input
            style={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
        </div>

        {error && <p style={styles.errorMsg}>{error}</p>}

        <button
          style={styles.authBtn}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? "AUTHENTICATING..." : mode === "login" ? "ENTER THE ARENA" : "CREATE ACCOUNT"}
        </button>

        <div style={styles.authFooter}>
          <div style={styles.terminalLine}>
            <span style={{ color: "#00ff88" }}>$</span> connecting to matching_engine...
            <span style={styles.blink}>█</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- DASHBOARD VIEW ---
function DashboardView({ user, onStartChallenge, onViewLeaderboard }) {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalScore: 0, rank: "-", completed: 0 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await api.get("/api/challenges");
      setChallenges(data.challenges || data || []);
      // Calculate stats from challenges
      const completed = (data.challenges || data || []).filter((c) => c.completed).length;
      setStats({ totalScore: completed * 250, rank: completed > 0 ? "#" + Math.max(1, 10 - completed) : "-", completed });
    } catch (e) {
      console.error("Failed to load challenges:", e);
      // Fallback challenges for demo
      setChallenges(DEMO_CHALLENGES);
    } finally {
      setLoading(false);
    }
  };

  const difficultyColor = (d) => {
    if (d <= 3) return "#00ff88";
    if (d <= 6) return "#ffaa00";
    return "#ff4444";
  };

  const categoryIcon = (cat) => {
    const icons = {
      market_making: "◈",
      arbitrage: "⇋",
      momentum: "↗",
      risk_management: "⛊",
      flash_crash: "⚡",
      stat_arb: "∿",
    };
    return icons[cat] || "◉";
  };

  return (
    <div style={styles.dashContainer}>
      {/* Header Stats Bar */}
      <div style={styles.statsBar}>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>TRADER</span>
          <span style={styles.statValue}>{user.username}</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>RANK</span>
          <span style={{ ...styles.statValue, color: "#00ff88" }}>{stats.rank}</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>SCORE</span>
          <span style={{ ...styles.statValue, color: "#00ddff" }}>{stats.totalScore}</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>COMPLETED</span>
          <span style={styles.statValue}>{stats.completed}/{challenges.length}</span>
        </div>
        <button style={styles.leaderboardBtn} onClick={onViewLeaderboard}>
          🏆 LEADERBOARD
        </button>
      </div>

      {/* Section Title */}
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>TRADING CHALLENGES</h2>
        <div style={styles.sectionLine} />
      </div>

      {/* Challenge Grid */}
      {loading ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p style={{ color: "#8899aa", marginTop: 16, fontFamily: "'JetBrains Mono', monospace" }}>
            Loading challenges from matching engine...
          </p>
        </div>
      ) : (
        <div style={styles.challengeGrid}>
          {challenges.map((ch, i) => (
            <div
              key={ch.id || i}
              style={styles.challengeCard}
              onClick={() => onStartChallenge(ch)}
            >
              <div style={styles.cardHeader}>
                <span style={{ ...styles.cardIcon, color: difficultyColor(ch.difficulty || ch.difficulty_level || 5) }}>
                  {categoryIcon(ch.category)}
                </span>
                <span style={{ ...styles.cardDifficulty, color: difficultyColor(ch.difficulty || ch.difficulty_level || 5) }}>
                  LVL {ch.difficulty || ch.difficulty_level || "?"}
                </span>
              </div>
              <h3 style={styles.cardTitle}>{ch.title || ch.name}</h3>
              <p style={styles.cardDesc}>{ch.description}</p>
              <div style={styles.cardMeta}>
                <span style={styles.cardTag}>{(ch.category || "trading").replace("_", " ").toUpperCase()}</span>
                {ch.time_limit_ms && (
                  <span style={styles.cardTime}>⏱ {fmtTime(ch.time_limit_ms)}</span>
                )}
              </div>
              <div style={styles.cardStartHint}>
                CLICK TO START →
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- ORDER BOOK COMPONENT ---
function OrderBookDisplay({ bids = [], asks = [], lastPrice = 0 }) {
  const maxQty = useMemo(() => {
    const allQty = [...bids, ...asks].map((o) => o.quantity || o.qty || 0);
    return Math.max(...allQty, 1);
  }, [bids, asks]);

  const sortedAsks = useMemo(
    () => [...asks].sort((a, b) => (b.price || 0) - (a.price || 0)).slice(0, 12),
    [asks]
  );
  const sortedBids = useMemo(
    () => [...bids].sort((a, b) => (b.price || 0) - (a.price || 0)).slice(0, 12),
    [bids]
  );

  return (
    <div style={styles.obContainer}>
      <div style={styles.obHeader}>
        <span>PRICE</span>
        <span>SIZE</span>
        <span>TOTAL</span>
      </div>

      {/* Asks (sells) — shown in reverse, lowest at bottom */}
      <div style={styles.obAsks}>
        {sortedAsks.map((o, i) => {
          const qty = o.quantity || o.qty || 0;
          const pct = (qty / maxQty) * 100;
          return (
            <div key={`a-${i}`} style={styles.obRow}>
              <div
                style={{
                  ...styles.obBarAsk,
                  width: `${pct}%`,
                }}
              />
              <span style={styles.obPriceAsk}>{fmtPrice(o.price)}</span>
              <span style={styles.obQty}>{qty.toLocaleString()}</span>
              <span style={styles.obTotal}>{fmtPrice(o.price * qty)}</span>
            </div>
          );
        })}
      </div>

      {/* Spread / Last Price */}
      <div style={styles.obSpread}>
        <span style={{ color: "#00ff88", fontSize: 18, fontWeight: 700 }}>
          {fmtPrice(lastPrice)}
        </span>
        {sortedAsks.length > 0 && sortedBids.length > 0 && (
          <span style={{ color: "#667788", fontSize: 11, marginLeft: 8 }}>
            spread: {fmtPrice((sortedAsks[sortedAsks.length - 1]?.price || 0) - (sortedBids[0]?.price || 0))}
          </span>
        )}
      </div>

      {/* Bids (buys) */}
      <div style={styles.obBids}>
        {sortedBids.map((o, i) => {
          const qty = o.quantity || o.qty || 0;
          const pct = (qty / maxQty) * 100;
          return (
            <div key={`b-${i}`} style={styles.obRow}>
              <div
                style={{
                  ...styles.obBarBid,
                  width: `${pct}%`,
                }}
              />
              <span style={styles.obPriceBid}>{fmtPrice(o.price)}</span>
              <span style={styles.obQty}>{qty.toLocaleString()}</span>
              <span style={styles.obTotal}>{fmtPrice(o.price * qty)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- ORDER ENTRY COMPONENT ---
function OrderEntry({ onSubmit, bestBid, bestAsk }) {
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("LIMIT");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("100");

  const handleSubmit = () => {
    const order = {
      side,
      order_type: orderType,
      quantity: parseInt(quantity) || 0,
    };
    if (orderType === "LIMIT") {
      order.price = parseFloat(price) || 0;
    }
    onSubmit(order);
  };

  return (
    <div style={styles.oeContainer}>
      <div style={styles.oeTitle}>ORDER ENTRY</div>

      {/* Side Toggle */}
      <div style={styles.oeSideToggle}>
        <button
          style={side === "BUY" ? styles.oeBuyActive : styles.oeSideBtn}
          onClick={() => setSide("BUY")}
        >
          BUY
        </button>
        <button
          style={side === "SELL" ? styles.oeSellActive : styles.oeSideBtn}
          onClick={() => setSide("SELL")}
        >
          SELL
        </button>
      </div>

      {/* Order Type */}
      <div style={styles.oeTypeToggle}>
        <button
          style={orderType === "LIMIT" ? styles.oeTypeActive : styles.oeTypeBtn}
          onClick={() => setOrderType("LIMIT")}
        >
          LIMIT
        </button>
        <button
          style={orderType === "MARKET" ? styles.oeTypeActive : styles.oeTypeBtn}
          onClick={() => setOrderType("MARKET")}
        >
          MARKET
        </button>
      </div>

      {/* Price */}
      {orderType === "LIMIT" && (
        <div style={styles.oeFieldGroup}>
          <label style={styles.oeLabel}>PRICE</label>
          <div style={styles.oePriceRow}>
            <input
              style={styles.oeInput}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              type="number"
              step="0.01"
            />
            <button
              style={styles.oePriceBtn}
              onClick={() => setPrice(bestBid?.toFixed(2) || "")}
              title="Set to best bid"
            >
              BID
            </button>
            <button
              style={styles.oePriceBtn}
              onClick={() => setPrice(bestAsk?.toFixed(2) || "")}
              title="Set to best ask"
            >
              ASK
            </button>
          </div>
        </div>
      )}

      {/* Quantity */}
      <div style={styles.oeFieldGroup}>
        <label style={styles.oeLabel}>QUANTITY</label>
        <input
          style={styles.oeInput}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="100"
          type="number"
        />
        <div style={styles.oeQtyPresets}>
          {[100, 500, 1000, 5000].map((q) => (
            <button
              key={q}
              style={styles.oePresetBtn}
              onClick={() => setQuantity(String(q))}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Estimated Cost */}
      <div style={styles.oeEstimate}>
        <span style={{ color: "#667788" }}>EST. VALUE</span>
        <span style={{ color: "#ccdde8" }}>
          {orderType === "LIMIT"
            ? fmtPrice((parseFloat(price) || 0) * (parseInt(quantity) || 0))
            : fmtPrice((side === "BUY" ? bestAsk : bestBid || 0) * (parseInt(quantity) || 0))}
        </span>
      </div>

      {/* Submit */}
      <button
        style={{
          ...styles.oeSubmitBtn,
          background: side === "BUY"
            ? "linear-gradient(135deg, #00aa55, #00ff88)"
            : "linear-gradient(135deg, #cc2244, #ff4466)",
        }}
        onClick={handleSubmit}
      >
        {side} {orderType === "MARKET" ? "@ MARKET" : `@ ${price || "—"}`}
      </button>
    </div>
  );
}

// --- POSITION & PnL PANEL ---
function PositionPanel({ position, trades = [] }) {
  const { quantity = 0, avgPrice = 0, unrealizedPnL = 0, realizedPnL = 0 } = position || {};
  const totalPnL = unrealizedPnL + realizedPnL;

  return (
    <div style={styles.posContainer}>
      <div style={styles.posTitle}>POSITION & P&L</div>
      <div style={styles.posGrid}>
        <div style={styles.posItem}>
          <span style={styles.posLabel}>QUANTITY</span>
          <span style={{
            ...styles.posValue,
            color: quantity > 0 ? "#00ff88" : quantity < 0 ? "#ff4466" : "#8899aa"
          }}>
            {quantity > 0 ? "+" : ""}{quantity}
          </span>
        </div>
        <div style={styles.posItem}>
          <span style={styles.posLabel}>AVG PRICE</span>
          <span style={styles.posValue}>{avgPrice ? fmtPrice(avgPrice) : "—"}</span>
        </div>
        <div style={styles.posItem}>
          <span style={styles.posLabel}>UNREALIZED</span>
          <span style={{
            ...styles.posValue,
            color: unrealizedPnL >= 0 ? "#00ff88" : "#ff4466"
          }}>
            {fmtPnL(unrealizedPnL)}
          </span>
        </div>
        <div style={styles.posItem}>
          <span style={styles.posLabel}>REALIZED</span>
          <span style={{
            ...styles.posValue,
            color: realizedPnL >= 0 ? "#00ff88" : "#ff4466"
          }}>
            {fmtPnL(realizedPnL)}
          </span>
        </div>
      </div>
      <div style={styles.posTotalRow}>
        <span style={styles.posTotalLabel}>TOTAL P&L</span>
        <span style={{
          ...styles.posTotalValue,
          color: totalPnL >= 0 ? "#00ff88" : "#ff4466"
        }}>
          {fmtPnL(totalPnL)}
        </span>
      </div>

      {/* Recent Trades */}
      {trades.length > 0 && (
        <div style={styles.tradesSection}>
          <div style={styles.tradesTitle}>RECENT FILLS</div>
          <div style={styles.tradesList}>
            {trades.slice(-6).reverse().map((t, i) => (
              <div key={i} style={styles.tradeRow}>
                <span style={{ color: t.side === "BUY" ? "#00ff88" : "#ff4466", width: 36 }}>
                  {t.side === "BUY" ? "BUY" : "SELL"}
                </span>
                <span style={{ color: "#ccdde8" }}>{t.quantity}</span>
                <span style={{ color: "#8899aa" }}>@</span>
                <span style={{ color: "#ccdde8" }}>{fmtPrice(t.price)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- TRADING VIEW (Main Game View) ---
function TradingView({ challenge, user, onBack }) {
  const [sessionId, setSessionId] = useState(null);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [position, setPosition] = useState({});
  const [trades, setTrades] = useState([]);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [timeLeft, setTimeLeft] = useState(challenge.time_limit_ms || 120000);
  const [priceHistory, setPriceHistory] = useState([]);
  const [sessionStats, setSessionStats] = useState({ ordersPlaced: 0, fills: 0 });
  const ws = useRef(null);
  const timerRef = useRef(null);

  const lastPrice = useMemo(() => {
    if (priceHistory.length > 0) return priceHistory[priceHistory.length - 1];
    const bestBid = orderBook.bids[0]?.price || 0;
    const bestAsk = orderBook.asks[0]?.price || 0;
    return bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 100;
  }, [orderBook, priceHistory]);

  const bestBid = orderBook.bids[0]?.price || 0;
  const bestAsk = orderBook.asks[0]?.price || 0;

  // Start challenge session
  useEffect(() => {
    startSession();
    return () => {
      if (ws.current) ws.current.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startSession = async () => {
    try {
      const data = await api.post(`/api/challenges/${challenge.id}/start`, {});
      setSessionId(data.session_id);
      connectWebSocket(data.session_id);
      addMessage("system", `Challenge "${challenge.title || challenge.name}" started`);
      addMessage("system", `Session: ${data.session_id?.slice(0, 8)}...`);

      // Start countdown
      const endTime = Date.now() + (challenge.time_limit_ms || 120000);
      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, endTime - Date.now());
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(timerRef.current);
          addMessage("system", "⏰ TIME'S UP! Challenge complete.");
        }
      }, 100);
    } catch (e) {
      addMessage("error", `Failed to start: ${e.message}`);
      // Demo mode - generate fake order book
      generateDemoOrderBook();
    }
  };

  const generateDemoOrderBook = () => {
    const mid = 100 + Math.random() * 50;
    const bids = Array.from({ length: 12 }, (_, i) => ({
      price: mid - 0.01 * (i + 1),
      quantity: Math.floor(Math.random() * 5000) + 100,
    }));
    const asks = Array.from({ length: 12 }, (_, i) => ({
      price: mid + 0.01 * (i + 1),
      quantity: Math.floor(Math.random() * 5000) + 100,
    }));
    setOrderBook({ bids, asks });
    setPriceHistory([mid - 0.5, mid - 0.3, mid + 0.1, mid - 0.1, mid + 0.2, mid]);
    setConnected(true);
    addMessage("system", "Running in demo mode (API not connected)");

    // Simulate updates
    const interval = setInterval(() => {
      setOrderBook((prev) => {
        const newBids = prev.bids.map((b) => ({
          ...b,
          quantity: Math.max(50, b.quantity + Math.floor(Math.random() * 200 - 100)),
        }));
        const newAsks = prev.asks.map((a) => ({
          ...a,
          quantity: Math.max(50, a.quantity + Math.floor(Math.random() * 200 - 100)),
        }));
        return { bids: newBids, asks: newAsks };
      });
      setPriceHistory((prev) => {
        const last = prev[prev.length - 1] || mid;
        return [...prev.slice(-49), last + (Math.random() - 0.5) * 0.1];
      });
    }, 500);

    return () => clearInterval(interval);
  };

  const connectWebSocket = (sid) => {
    const url = `${WS_BASE}/ws/trading?token=${api.token}&session_id=${sid}`;
    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      setConnected(true);
      addMessage("system", "WebSocket connected ✓");
    };

    ws.current.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleWSMessage(msg);
      } catch (e) {
        console.error("WS parse error:", e);
      }
    };

    ws.current.onclose = () => {
      setConnected(false);
      addMessage("system", "WebSocket disconnected");
    };

    ws.current.onerror = () => {
      addMessage("error", "WebSocket error — falling back to demo mode");
      generateDemoOrderBook();
    };
  };

  const handleWSMessage = (msg) => {
    switch (msg.type) {
      case "order_book_update":
        if (msg.data) {
          setOrderBook({
            bids: msg.data.bids || [],
            asks: msg.data.asks || [],
          });
          const mid = msg.data.midpoint || msg.data.last_price;
          if (mid) setPriceHistory((prev) => [...prev.slice(-49), mid]);
        }
        break;
      case "execution":
        setTrades((prev) => [...prev, msg.data]);
        setSessionStats((s) => ({ ...s, fills: s.fills + 1 }));
        addMessage("fill", `${msg.data.side} ${msg.data.quantity} @ ${fmtPrice(msg.data.price)}`);
        break;
      case "position_update":
        setPosition(msg.data);
        break;
      case "order_update":
        addMessage("order", `Order ${msg.data.status}: ${msg.data.side} ${msg.data.quantity}`);
        break;
      case "heartbeat":
        break;
      default:
        break;
    }
  };

  const placeOrder = (order) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          action: "place_order",
          symbol: challenge.symbol || "AAPL",
          ...order,
        })
      );
      setSessionStats((s) => ({ ...s, ordersPlaced: s.ordersPlaced + 1 }));
      addMessage("order", `Placed ${order.side} ${order.order_type} ${order.quantity} ${order.price ? `@ ${fmtPrice(order.price)}` : "@ MKT"}`);
    } else {
      // Demo mode
      const fillPrice = order.order_type === "MARKET"
        ? (order.side === "BUY" ? bestAsk : bestBid)
        : order.price;
      const fill = { side: order.side, quantity: order.quantity, price: fillPrice };
      setTrades((prev) => [...prev, fill]);
      setSessionStats((s) => ({ ...s, ordersPlaced: s.ordersPlaced + 1, fills: s.fills + 1 }));
      
      // Update position in demo
      setPosition((prev) => {
        const dir = order.side === "BUY" ? 1 : -1;
        const newQty = (prev.quantity || 0) + dir * order.quantity;
        return {
          ...prev,
          quantity: newQty,
          avgPrice: fillPrice,
          unrealizedPnL: newQty * (lastPrice - fillPrice),
          realizedPnL: prev.realizedPnL || 0,
        };
      });
      addMessage("fill", `${order.side} ${order.quantity} @ ${fmtPrice(fillPrice)}`);
    }
  };

  const addMessage = (type, text) => {
    setMessages((prev) => [...prev.slice(-50), { type, text, time: Date.now() }]);
  };

  const timerColor = timeLeft > 30000 ? "#00ff88" : timeLeft > 10000 ? "#ffaa00" : "#ff4466";

  return (
    <div style={styles.tradingContainer}>
      {/* Top Bar */}
      <div style={styles.tradingTopBar}>
        <button style={styles.backBtn} onClick={onBack}>← EXIT</button>
        <div style={styles.challengeInfo}>
          <span style={styles.challengeName}>{challenge.title || challenge.name}</span>
          <span style={styles.challengeCat}>{(challenge.category || "").replace("_", " ").toUpperCase()}</span>
        </div>
        <div style={styles.topBarRight}>
          <div style={{
            ...styles.connectionDot,
            background: connected ? "#00ff88" : "#ff4466",
            boxShadow: connected ? "0 0 8px #00ff88" : "0 0 8px #ff4466",
          }} />
          <span style={{ ...styles.timerDisplay, color: timerColor }}>
            {Math.floor(timeLeft / 60000)}:{String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Main Trading Grid */}
      <div style={styles.tradingGrid}>
        {/* Left: Order Book */}
        <div style={styles.tradingPanel}>
          <div style={styles.panelHeader}>
            ORDER BOOK — {challenge.symbol || "AAPL"}
          </div>
          <OrderBookDisplay
            bids={orderBook.bids}
            asks={orderBook.asks}
            lastPrice={lastPrice}
          />
        </div>

        {/* Center: Chart + Order Entry */}
        <div style={styles.tradingCenter}>
          <div style={styles.tradingPanel}>
            <div style={styles.panelHeader}>PRICE ACTION</div>
            <div style={{ padding: "12px 16px" }}>
              <Sparkline
                data={priceHistory}
                width={380}
                height={80}
                color={priceHistory.length > 1 && priceHistory[priceHistory.length - 1] >= priceHistory[0] ? "#00ff88" : "#ff4466"}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <span style={{ color: "#667788", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  BID: {fmtPrice(bestBid)}
                </span>
                <span style={{ color: "#00ddff", fontSize: 13, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  MID: {fmtPrice(lastPrice)}
                </span>
                <span style={{ color: "#667788", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  ASK: {fmtPrice(bestAsk)}
                </span>
              </div>
            </div>
          </div>
          <OrderEntry onSubmit={placeOrder} bestBid={bestBid} bestAsk={bestAsk} />
        </div>

        {/* Right: Position + Messages */}
        <div style={styles.tradingRight}>
          <PositionPanel position={position} trades={trades} />
          
          {/* Session Stats */}
          <div style={{ ...styles.tradingPanel, marginTop: 8 }}>
            <div style={styles.panelHeader}>SESSION STATS</div>
            <div style={{ padding: "8px 12px", display: "flex", gap: 16 }}>
              <div>
                <div style={{ color: "#667788", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>ORDERS</div>
                <div style={{ color: "#00ddff", fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                  {sessionStats.ordersPlaced}
                </div>
              </div>
              <div>
                <div style={{ color: "#667788", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>FILLS</div>
                <div style={{ color: "#00ff88", fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                  {sessionStats.fills}
                </div>
              </div>
              <div>
                <div style={{ color: "#667788", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>TRADES</div>
                <div style={{ color: "#ccdde8", fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                  {trades.length}
                </div>
              </div>
            </div>
          </div>

          {/* Message Log */}
          <div style={{ ...styles.tradingPanel, marginTop: 8, flex: 1, minHeight: 120 }}>
            <div style={styles.panelHeader}>EVENT LOG</div>
            <div style={styles.messageLog}>
              {messages.map((m, i) => (
                <div key={i} style={styles.logEntry}>
                  <span style={{
                    color: m.type === "error" ? "#ff4466" : m.type === "fill" ? "#00ff88" : m.type === "order" ? "#00ddff" : "#667788",
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    [{m.type.toUpperCase()}]
                  </span>
                  <span style={{ color: "#aabbcc", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", marginLeft: 6 }}>
                    {m.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- LEADERBOARD VIEW ---
function LeaderboardView({ onBack }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const loadLeaderboard = async () => {
    try {
      const data = await api.get("/api/leaderboard/global");
      setLeaderboard(data.entries || data || []);
    } catch (e) {
      // Demo data
      setLeaderboard(DEMO_LEADERBOARD);
    } finally {
      setLoading(false);
    }
  };

  const rankStyle = (rank) => {
    if (rank === 1) return { color: "#ffd700", textShadow: "0 0 10px #ffd70066" };
    if (rank === 2) return { color: "#c0c0c0", textShadow: "0 0 8px #c0c0c066" };
    if (rank === 3) return { color: "#cd7f32", textShadow: "0 0 8px #cd7f3266" };
    return { color: "#8899aa" };
  };

  return (
    <div style={styles.lbContainer}>
      <div style={styles.lbHeader}>
        <button style={styles.backBtn} onClick={onBack}>← BACK</button>
        <h2 style={styles.lbTitle}>🏆 GLOBAL LEADERBOARD</h2>
        <div />
      </div>

      <div style={styles.lbTable}>
        <div style={styles.lbTableHeader}>
          <span style={{ width: 60, textAlign: "center" }}>RANK</span>
          <span style={{ flex: 1 }}>TRADER</span>
          <span style={{ width: 100, textAlign: "right" }}>SCORE</span>
          <span style={{ width: 100, textAlign: "right" }}>TRADES</span>
          <span style={{ width: 120, textAlign: "right" }}>SHARPE</span>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#667788" }}>Loading...</div>
        ) : (
          leaderboard.map((entry, i) => (
            <div key={i} style={{
              ...styles.lbRow,
              background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
            }}>
              <span style={{ width: 60, textAlign: "center", fontSize: 18, fontWeight: 700, ...rankStyle(i + 1) }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, color: "#ccdde8", fontWeight: 500 }}>
                {entry.username || entry.user || `Trader_${i}`}
              </span>
              <span style={{ width: 100, textAlign: "right", color: "#00ff88", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                {(entry.score || entry.total_score || 0).toLocaleString()}
              </span>
              <span style={{ width: 100, textAlign: "right", color: "#8899aa", fontFamily: "'JetBrains Mono', monospace" }}>
                {entry.trades || entry.total_trades || "—"}
              </span>
              <span style={{ width: 120, textAlign: "right", color: "#00ddff", fontFamily: "'JetBrains Mono', monospace" }}>
                {entry.sharpe ? entry.sharpe.toFixed(2) : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("auth"); // auth | dashboard | trading | leaderboard
  const [activeChallenge, setActiveChallenge] = useState(null);

  const handleLogin = (userData) => {
    setUser(userData);
    setView("dashboard");
  };

  const handleStartChallenge = (challenge) => {
    setActiveChallenge(challenge);
    setView("trading");
  };

  return (
    <div style={styles.appRoot}>
      <style>{globalCSS}</style>
      {view === "auth" && <AuthView onLogin={handleLogin} />}
      {view === "dashboard" && (
        <DashboardView
          user={user}
          onStartChallenge={handleStartChallenge}
          onViewLeaderboard={() => setView("leaderboard")}
        />
      )}
      {view === "trading" && activeChallenge && (
        <TradingView
          challenge={activeChallenge}
          user={user}
          onBack={() => setView("dashboard")}
        />
      )}
      {view === "leaderboard" && (
        <LeaderboardView onBack={() => setView("dashboard")} />
      )}
    </div>
  );
}

// ============================================================
// DEMO DATA (fallback when API unavailable)
// ============================================================

const DEMO_CHALLENGES = [
  { id: 1, title: "Market Making Basics", description: "Provide liquidity by posting bid/ask quotes. Collect the spread while managing inventory risk.", category: "market_making", difficulty: 3, time_limit_ms: 120000, symbol: "AAPL" },
  { id: 2, title: "Latency Arbitrage", description: "Exploit price discrepancies between venues. Speed is everything — milliseconds matter.", category: "arbitrage", difficulty: 6, time_limit_ms: 90000, symbol: "MSFT" },
  { id: 3, title: "Momentum Hunter", description: "Detect large incoming orders and ride the momentum wave. Enter early, exit before reversal.", category: "momentum", difficulty: 5, time_limit_ms: 120000, symbol: "TSLA" },
  { id: 4, title: "Statistical Arbitrage", description: "Trade the spread between correlated assets. Mean reversion is your friend.", category: "stat_arb", difficulty: 7, time_limit_ms: 180000, symbol: "GOOG" },
  { id: 5, title: "Flash Crash Survival", description: "Navigate extreme volatility. Manage risk when circuit breakers trigger and liquidity evaporates.", category: "flash_crash", difficulty: 9, time_limit_ms: 60000, symbol: "SPY" },
  { id: 6, title: "Queue Position Game", description: "Master order book queue dynamics. Earlier placement = priority execution.", category: "market_making", difficulty: 4, time_limit_ms: 120000, symbol: "AMZN" },
];

const DEMO_LEADERBOARD = [
  { username: "algo_shark", score: 15420, trades: 1847, sharpe: 3.24 },
  { username: "quant_wizard", score: 12850, trades: 2103, sharpe: 2.87 },
  { username: "latency_king", score: 11200, trades: 956, sharpe: 2.55 },
  { username: "spread_hunter", score: 9800, trades: 3214, sharpe: 2.31 },
  { username: "nano_trader", score: 8540, trades: 1523, sharpe: 2.12 },
  { username: "deep_book", score: 7200, trades: 892, sharpe: 1.95 },
  { username: "market_maker_x", score: 6100, trades: 2567, sharpe: 1.78 },
  { username: "tick_sniper", score: 5400, trades: 1234, sharpe: 1.62 },
];

// ============================================================
// GLOBAL CSS
// ============================================================

const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e17; overflow: hidden; }
  
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1a2535; border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: #2a3545; }

  @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
  @keyframes glow-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.6; } }
  @keyframes slide-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
`;

// ============================================================
// STYLES
// ============================================================

const styles = {
  appRoot: {
    width: "100vw",
    height: "100vh",
    background: "#0a0e17",
    color: "#ccdde8",
    fontFamily: "'Outfit', sans-serif",
    overflow: "hidden",
  },

  // --- AUTH ---
  authContainer: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(ellipse at 30% 20%, #0d1a2a 0%, #0a0e17 70%)",
    position: "relative",
  },
  authGlow: {
    position: "absolute",
    width: 400,
    height: 400,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(0,255,136,0.06) 0%, transparent 70%)",
    top: "20%",
    left: "30%",
    animation: "glow-pulse 4s ease-in-out infinite",
  },
  authCard: {
    width: 400,
    padding: "40px 36px",
    background: "linear-gradient(135deg, rgba(15,22,36,0.95), rgba(10,14,23,0.98))",
    border: "1px solid rgba(0,255,136,0.1)",
    borderRadius: 16,
    position: "relative",
    zIndex: 1,
    animation: "slide-up 0.6s ease-out",
  },
  authLogo: {
    textAlign: "center",
    marginBottom: 4,
  },
  logoZ: {
    fontSize: 42,
    fontWeight: 800,
    color: "#00ff88",
    fontFamily: "'Outfit', sans-serif",
    textShadow: "0 0 20px rgba(0,255,136,0.3)",
  },
  logoText: {
    fontSize: 42,
    fontWeight: 300,
    color: "#ccdde8",
    fontFamily: "'Outfit', sans-serif",
    letterSpacing: 4,
  },
  authSubtitle: {
    textAlign: "center",
    color: "#667788",
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 28,
    fontFamily: "'JetBrains Mono', monospace",
  },
  authTabs: {
    display: "flex",
    gap: 0,
    marginBottom: 24,
    border: "1px solid #1a2535",
    borderRadius: 8,
    overflow: "hidden",
  },
  authTab: {
    flex: 1,
    padding: "10px 0",
    background: "transparent",
    border: "none",
    color: "#667788",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 2,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  authTabActive: {
    flex: 1,
    padding: "10px 0",
    background: "rgba(0,255,136,0.08)",
    border: "none",
    color: "#00ff88",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 2,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  authForm: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 10,
    color: "#556677",
    letterSpacing: 2,
    marginTop: 8,
    fontFamily: "'JetBrains Mono', monospace",
  },
  input: {
    padding: "12px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid #1a2535",
    borderRadius: 8,
    color: "#ccdde8",
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
    transition: "border-color 0.2s",
  },
  errorMsg: {
    color: "#ff4466",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  authBtn: {
    width: "100%",
    padding: "14px 0",
    background: "linear-gradient(135deg, #00aa55, #00ff88)",
    border: "none",
    borderRadius: 8,
    color: "#0a0e17",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 2,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    transition: "transform 0.1s, box-shadow 0.2s",
  },
  authFooter: {
    marginTop: 24,
    textAlign: "center",
  },
  terminalLine: {
    fontSize: 11,
    color: "#667788",
    fontFamily: "'JetBrains Mono', monospace",
  },
  blink: {
    animation: "blink 1s step-end infinite",
    color: "#00ff88",
  },

  // --- DASHBOARD ---
  dashContainer: {
    width: "100%",
    height: "100%",
    background: "#0a0e17",
    overflowY: "auto",
    padding: 24,
  },
  statsBar: {
    display: "flex",
    alignItems: "center",
    gap: 32,
    padding: "16px 24px",
    background: "linear-gradient(135deg, rgba(15,22,36,0.9), rgba(10,14,23,0.95))",
    border: "1px solid #1a2535",
    borderRadius: 12,
    marginBottom: 24,
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statLabel: {
    fontSize: 10,
    color: "#556677",
    letterSpacing: 2,
    fontFamily: "'JetBrains Mono', monospace",
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "#ccdde8",
    fontFamily: "'JetBrains Mono', monospace",
  },
  leaderboardBtn: {
    marginLeft: "auto",
    padding: "10px 20px",
    background: "rgba(255,215,0,0.08)",
    border: "1px solid rgba(255,215,0,0.2)",
    borderRadius: 8,
    color: "#ffd700",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  sectionHeader: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#556677",
    letterSpacing: 3,
    fontFamily: "'JetBrains Mono', monospace",
  },
  sectionLine: {
    height: 1,
    background: "linear-gradient(90deg, #00ff8833, transparent)",
    marginTop: 8,
  },
  loadingContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 60,
  },
  spinner: {
    width: 32,
    height: 32,
    border: "2px solid #1a2535",
    borderTopColor: "#00ff88",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  challengeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: 16,
  },
  challengeCard: {
    padding: "20px 24px",
    background: "linear-gradient(135deg, rgba(15,22,36,0.8), rgba(10,14,23,0.9))",
    border: "1px solid #1a2535",
    borderRadius: 12,
    cursor: "pointer",
    transition: "border-color 0.2s, transform 0.15s",
    position: "relative",
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardDifficulty: {
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: "#e0eaf0",
    marginBottom: 6,
    fontFamily: "'Outfit', sans-serif",
  },
  cardDesc: {
    fontSize: 13,
    color: "#667788",
    lineHeight: 1.5,
    marginBottom: 14,
  },
  cardMeta: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  cardTag: {
    fontSize: 10,
    color: "#00ddff",
    background: "rgba(0,221,255,0.08)",
    padding: "3px 8px",
    borderRadius: 4,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  cardTime: {
    fontSize: 11,
    color: "#667788",
    fontFamily: "'JetBrains Mono', monospace",
  },
  cardStartHint: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: "8px 24px",
    background: "linear-gradient(180deg, transparent, rgba(0,255,136,0.05))",
    color: "#00ff88",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2,
    textAlign: "center",
    fontFamily: "'JetBrains Mono', monospace",
    opacity: 0.6,
  },

  // --- TRADING VIEW ---
  tradingContainer: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "#0a0e17",
  },
  tradingTopBar: {
    display: "flex",
    alignItems: "center",
    padding: "10px 16px",
    background: "rgba(15,22,36,0.95)",
    borderBottom: "1px solid #1a2535",
    gap: 16,
    flexShrink: 0,
  },
  backBtn: {
    padding: "6px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid #1a2535",
    borderRadius: 6,
    color: "#8899aa",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  challengeInfo: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  challengeName: {
    fontSize: 15,
    fontWeight: 600,
    color: "#e0eaf0",
  },
  challengeCat: {
    fontSize: 10,
    color: "#00ddff",
    background: "rgba(0,221,255,0.08)",
    padding: "3px 8px",
    borderRadius: 4,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  topBarRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
  timerDisplay: {
    fontSize: 20,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 2,
  },

  tradingGrid: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "280px 1fr 300px",
    gap: 6,
    padding: 6,
    overflow: "hidden",
  },
  tradingPanel: {
    background: "rgba(12,18,30,0.9)",
    border: "1px solid #141e2e",
    borderRadius: 8,
    overflow: "hidden",
  },
  tradingCenter: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  tradingRight: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    overflow: "hidden",
  },
  panelHeader: {
    padding: "8px 12px",
    fontSize: 10,
    fontWeight: 600,
    color: "#556677",
    letterSpacing: 2,
    borderBottom: "1px solid #141e2e",
    fontFamily: "'JetBrains Mono', monospace",
  },

  // --- ORDER BOOK ---
  obContainer: {
    padding: "4px 0",
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  obHeader: {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 12px",
    fontSize: 9,
    color: "#445566",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  obAsks: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  obBids: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  obRow: {
    display: "flex",
    alignItems: "center",
    padding: "2px 12px",
    position: "relative",
    height: 22,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
  },
  obBarAsk: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    background: "rgba(255,68,102,0.08)",
    transition: "width 0.3s ease",
  },
  obBarBid: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    background: "rgba(0,255,136,0.08)",
    transition: "width 0.3s ease",
  },
  obPriceAsk: {
    color: "#ff4466",
    flex: 1,
    position: "relative",
    zIndex: 1,
  },
  obPriceBid: {
    color: "#00ff88",
    flex: 1,
    position: "relative",
    zIndex: 1,
  },
  obQty: {
    width: 60,
    textAlign: "right",
    color: "#8899aa",
    position: "relative",
    zIndex: 1,
  },
  obTotal: {
    width: 80,
    textAlign: "right",
    color: "#556677",
    fontSize: 10,
    position: "relative",
    zIndex: 1,
  },
  obSpread: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 12px",
    borderTop: "1px solid #141e2e",
    borderBottom: "1px solid #141e2e",
    fontFamily: "'JetBrains Mono', monospace",
  },

  // --- ORDER ENTRY ---
  oeContainer: {
    background: "rgba(12,18,30,0.9)",
    border: "1px solid #141e2e",
    borderRadius: 8,
    padding: 16,
  },
  oeTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: "#556677",
    letterSpacing: 2,
    marginBottom: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  oeSideToggle: {
    display: "flex",
    gap: 0,
    marginBottom: 10,
    borderRadius: 6,
    overflow: "hidden",
    border: "1px solid #1a2535",
  },
  oeSideBtn: {
    flex: 1,
    padding: "10px 0",
    background: "transparent",
    border: "none",
    color: "#667788",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  oeBuyActive: {
    flex: 1,
    padding: "10px 0",
    background: "rgba(0,255,136,0.12)",
    border: "none",
    color: "#00ff88",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  oeSellActive: {
    flex: 1,
    padding: "10px 0",
    background: "rgba(255,68,102,0.12)",
    border: "none",
    color: "#ff4466",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  oeTypeToggle: {
    display: "flex",
    gap: 6,
    marginBottom: 12,
  },
  oeTypeBtn: {
    flex: 1,
    padding: "6px 0",
    background: "transparent",
    border: "1px solid #1a2535",
    borderRadius: 4,
    color: "#667788",
    fontSize: 10,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  oeTypeActive: {
    flex: 1,
    padding: "6px 0",
    background: "rgba(0,221,255,0.08)",
    border: "1px solid rgba(0,221,255,0.2)",
    borderRadius: 4,
    color: "#00ddff",
    fontSize: 10,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  oeFieldGroup: {
    marginBottom: 10,
  },
  oeLabel: {
    fontSize: 9,
    color: "#556677",
    letterSpacing: 2,
    marginBottom: 4,
    display: "block",
    fontFamily: "'JetBrains Mono', monospace",
  },
  oeInput: {
    width: "100%",
    padding: "10px 12px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid #1a2535",
    borderRadius: 6,
    color: "#ccdde8",
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
  },
  oePriceRow: {
    display: "flex",
    gap: 6,
  },
  oePriceBtn: {
    padding: "10px 10px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid #1a2535",
    borderRadius: 6,
    color: "#8899aa",
    fontSize: 10,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
  },
  oeQtyPresets: {
    display: "flex",
    gap: 4,
    marginTop: 6,
  },
  oePresetBtn: {
    flex: 1,
    padding: "4px 0",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid #1a2535",
    borderRadius: 4,
    color: "#667788",
    fontSize: 10,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  oeEstimate: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    borderTop: "1px solid #141e2e",
    marginBottom: 10,
  },
  oeSubmitBtn: {
    width: "100%",
    padding: "12px 0",
    border: "none",
    borderRadius: 6,
    color: "#0a0e17",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },

  // --- POSITION ---
  posContainer: {
    background: "rgba(12,18,30,0.9)",
    border: "1px solid #141e2e",
    borderRadius: 8,
    overflow: "hidden",
  },
  posTitle: {
    padding: "8px 12px",
    fontSize: 10,
    fontWeight: 600,
    color: "#556677",
    letterSpacing: 2,
    borderBottom: "1px solid #141e2e",
    fontFamily: "'JetBrains Mono', monospace",
  },
  posGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 0,
  },
  posItem: {
    padding: "8px 12px",
    borderBottom: "1px solid #0d1520",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  posLabel: {
    fontSize: 9,
    color: "#445566",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  posValue: {
    fontSize: 14,
    fontWeight: 600,
    color: "#ccdde8",
    fontFamily: "'JetBrains Mono', monospace",
  },
  posTotalRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
    borderTop: "1px solid #141e2e",
  },
  posTotalLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "#667788",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  posTotalValue: {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
  },
  tradesSection: {
    borderTop: "1px solid #141e2e",
  },
  tradesTitle: {
    padding: "6px 12px",
    fontSize: 9,
    color: "#445566",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1,
  },
  tradesList: {
    padding: "0 12px 8px",
  },
  tradeRow: {
    display: "flex",
    gap: 8,
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    padding: "2px 0",
  },

  // --- MESSAGES ---
  messageLog: {
    padding: "6px 10px",
    overflowY: "auto",
    maxHeight: 200,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  logEntry: {
    display: "flex",
    alignItems: "flex-start",
    gap: 4,
    lineHeight: 1.4,
  },

  // --- LEADERBOARD ---
  lbContainer: {
    width: "100%",
    height: "100%",
    background: "#0a0e17",
    padding: 24,
    overflowY: "auto",
  },
  lbHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  lbTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#ffd700",
    fontFamily: "'Outfit', sans-serif",
    letterSpacing: 2,
  },
  lbTable: {
    maxWidth: 700,
    margin: "0 auto",
    background: "rgba(12,18,30,0.9)",
    border: "1px solid #1a2535",
    borderRadius: 12,
    overflow: "hidden",
  },
  lbTableHeader: {
    display: "flex",
    padding: "12px 20px",
    fontSize: 10,
    color: "#445566",
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: 1.5,
    borderBottom: "1px solid #1a2535",
  },
  lbRow: {
    display: "flex",
    alignItems: "center",
    padding: "14px 20px",
    borderBottom: "1px solid #0d1520",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    transition: "background 0.15s",
  },
};
