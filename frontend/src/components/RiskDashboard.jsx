/**
 * ZeTheta Risk Dashboard Component
 * =================================
 * Real-time risk visualization with circuit breaker status,
 * position monitoring, and violation alerts
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Risk status colors
const COLORS = {
  safe: '#00ff88',
  warning: '#ffaa00',
  danger: '#ff4444',
  critical: '#ff0066',
  neutral: '#6b7280',
  background: '#0a0a0f',
  surface: '#141420',
  border: '#2a2a3a'
};

// Circuit breaker states
const CircuitBreakerState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

// Risk meter gauge component
const RiskGauge = ({ label, value, max, unit = '%', thresholds = [0.5, 0.8] }) => {
  const percentage = Math.min(value / max, 1) * 100;
  
  const getColor = () => {
    const ratio = value / max;
    if (ratio >= thresholds[1]) return COLORS.danger;
    if (ratio >= thresholds[0]) return COLORS.warning;
    return COLORS.safe;
  };
  
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ color: '#888', fontSize: '12px' }}>{label}</span>
        <span style={{ color: getColor(), fontSize: '12px', fontFamily: 'monospace' }}>
          {typeof value === 'number' ? value.toFixed(1) : value}{unit} / {max}{unit}
        </span>
      </div>
      <div style={{
        height: '8px',
        background: COLORS.surface,
        borderRadius: '4px',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${percentage}%`,
          background: getColor(),
          borderRadius: '4px',
          transition: 'width 0.3s, background 0.3s'
        }} />
      </div>
    </div>
  );
};

// Circuit breaker status indicator
const CircuitBreakerIndicator = ({ state, timeUntilHalfOpen }) => {
  const getStateInfo = () => {
    switch (state) {
      case CircuitBreakerState.CLOSED:
        return { color: COLORS.safe, label: 'ACTIVE', icon: '●' };
      case CircuitBreakerState.OPEN:
        return { color: COLORS.critical, label: 'HALTED', icon: '⬤' };
      case CircuitBreakerState.HALF_OPEN:
        return { color: COLORS.warning, label: 'TESTING', icon: '◐' };
      default:
        return { color: COLORS.neutral, label: 'UNKNOWN', icon: '○' };
    }
  };
  
  const info = getStateInfo();
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      background: `${info.color}15`,
      border: `1px solid ${info.color}40`,
      borderRadius: '8px'
    }}>
      <span style={{
        fontSize: '24px',
        color: info.color,
        animation: state === CircuitBreakerState.OPEN ? 'pulse 1s infinite' : 'none'
      }}>
        {info.icon}
      </span>
      <div>
        <div style={{ color: info.color, fontWeight: 'bold', fontSize: '14px' }}>
          {info.label}
        </div>
        {state === CircuitBreakerState.OPEN && timeUntilHalfOpen && (
          <div style={{ color: '#888', fontSize: '11px' }}>
            Resume test in {Math.ceil(timeUntilHalfOpen)}s
          </div>
        )}
      </div>
    </div>
  );
};

// Violation alert component
const ViolationAlert = ({ violation, onDismiss }) => {
  const getSeverityColor = () => {
    switch (violation.severity) {
      case 'fatal': return COLORS.critical;
      case 'critical': return COLORS.danger;
      case 'warning': return COLORS.warning;
      default: return COLORS.neutral;
    }
  };
  
  const color = getSeverityColor();
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px',
      background: `${color}15`,
      border: `1px solid ${color}40`,
      borderRadius: '6px',
      marginBottom: '8px',
      animation: 'slideIn 0.3s ease-out'
    }}>
      <span style={{ fontSize: '18px' }}>⚠</span>
      <div style={{ flex: 1 }}>
        <div style={{ color, fontWeight: 'bold', fontSize: '12px', textTransform: 'uppercase' }}>
          {violation.type.replace(/_/g, ' ')}
        </div>
        <div style={{ color: '#ccc', fontSize: '12px', marginTop: '2px' }}>
          {violation.message}
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: '#888',
          cursor: 'pointer',
          padding: '4px',
          fontSize: '16px'
        }}
      >
        ×
      </button>
    </div>
  );
};

// Position card component
const PositionCard = ({ symbol, quantity, price, limit }) => {
  const utilization = Math.abs(quantity) / limit;
  const isLong = quantity > 0;
  
  return (
    <div style={{
      padding: '12px',
      background: COLORS.surface,
      borderRadius: '6px',
      border: `1px solid ${COLORS.border}`
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ color: '#fff', fontWeight: 'bold' }}>{symbol}</span>
        <span style={{
          color: isLong ? COLORS.safe : COLORS.danger,
          fontFamily: 'monospace'
        }}>
          {isLong ? '+' : ''}{quantity.toLocaleString()}
        </span>
      </div>
      <RiskGauge
        label="Position Utilization"
        value={Math.abs(quantity)}
        max={limit}
        unit=""
        thresholds={[0.6, 0.85]}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666' }}>
        <span>Price: ${price.toFixed(2)}</span>
        <span>Value: ${(Math.abs(quantity) * price).toLocaleString()}</span>
      </div>
    </div>
  );
};

// Rate limit visualizer
const RateLimitMeter = ({ current, max, label, period }) => {
  const percentage = (current / max) * 100;
  const isWarning = percentage > 70;
  const isDanger = percentage > 90;
  
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: '#888',
        marginBottom: '4px'
      }}>
        <span>{label}</span>
        <span style={{
          color: isDanger ? COLORS.danger : isWarning ? COLORS.warning : COLORS.safe,
          fontFamily: 'monospace'
        }}>
          {current}/{max} per {period}
        </span>
      </div>
      <div style={{
        height: '4px',
        background: COLORS.surface,
        borderRadius: '2px',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${percentage}%`,
          background: isDanger ? COLORS.danger : isWarning ? COLORS.warning : COLORS.safe,
          transition: 'width 0.1s'
        }} />
      </div>
    </div>
  );
};

// Main Risk Dashboard Component
const RiskDashboard = ({ 
  sessionId,
  apiBaseUrl = 'http://localhost:8000',
  wsUrl = null 
}) => {
  const [metrics, setMetrics] = useState(null);
  const [violations, setViolations] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  
  // Connect to WebSocket for real-time updates
  useEffect(() => {
    if (!sessionId) return;
    
    const wsEndpoint = wsUrl || `ws://localhost:8000/api/risk/ws/${sessionId}`;
    
    const connect = () => {
      try {
        wsRef.current = new WebSocket(wsEndpoint);
        
        wsRef.current.onopen = () => {
          setIsConnected(true);
          setError(null);
          console.log('Risk WebSocket connected');
        };
        
        wsRef.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            
            if (message.type === 'risk_metrics') {
              setMetrics(message.data);
            } else if (message.type === 'risk_violation') {
              setViolations(prev => [message.data, ...prev].slice(0, 10));
            }
          } catch (e) {
            console.error('Failed to parse risk message:', e);
          }
        };
        
        wsRef.current.onclose = () => {
          setIsConnected(false);
          // Attempt reconnect after 2 seconds
          setTimeout(connect, 2000);
        };
        
        wsRef.current.onerror = (err) => {
          setError('WebSocket connection error');
          console.error('Risk WebSocket error:', err);
        };
        
      } catch (e) {
        setError('Failed to connect to risk service');
      }
    };
    
    connect();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId, wsUrl]);
  
  // Dismiss a violation alert
  const dismissViolation = useCallback((index) => {
    setViolations(prev => prev.filter((_, i) => i !== index));
  }, []);
  
  // Mock data for demonstration when not connected
  const displayMetrics = metrics || {
    positions: { AAPL: 2500, GOOGL: -1200 },
    prices: { AAPL: 178.50, GOOGL: 141.25 },
    total_exposure: 615625,
    exposure_utilization: 0.62,
    current_pnl: 12450,
    drawdown: {
      daily_pnl: 3250,
      drawdown_pct: 0.045,
      rolling_drawdown_pct: 0.032
    },
    rate_limits: {
      orders_last_second: 45,
      orders_last_minute: 820,
      rate_1s_utilization: 0.45,
      rate_1m_utilization: 0.41
    },
    circuit_breaker: {
      state: 'closed',
      failure_count: 1,
      time_until_half_open: null
    },
    stats: {
      orders_checked: 15847,
      orders_rejected: 23,
      avg_check_latency_us: 0.45
    }
  };
  
  return (
    <div style={{
      background: COLORS.background,
      color: '#fff',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: '20px',
      borderRadius: '12px',
      minHeight: '600px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div>
          <h2 style={{ margin: 0, color: COLORS.safe, fontSize: '18px' }}>
            ⚡ RISK ENGINE
          </h2>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
            Session: {sessionId || 'demo'} • 
            Latency: {displayMetrics.stats?.avg_check_latency_us?.toFixed(2) || '0.00'}μs
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isConnected ? COLORS.safe : COLORS.danger
          }} />
          <span style={{ fontSize: '11px', color: '#888' }}>
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>
      
      {/* Error display */}
      {error && (
        <div style={{
          padding: '12px',
          background: `${COLORS.danger}20`,
          border: `1px solid ${COLORS.danger}40`,
          borderRadius: '6px',
          marginBottom: '16px',
          fontSize: '12px',
          color: COLORS.danger
        }}>
          {error}
        </div>
      )}
      
      {/* Violations */}
      {violations.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
            RECENT VIOLATIONS
          </h3>
          {violations.map((v, i) => (
            <ViolationAlert
              key={`${v.timestamp}-${i}`}
              violation={v}
              onDismiss={() => dismissViolation(i)}
            />
          ))}
        </div>
      )}
      
      {/* Main grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px'
      }}>
        {/* Circuit Breaker Status */}
        <div style={{
          padding: '16px',
          background: COLORS.surface,
          borderRadius: '8px',
          border: `1px solid ${COLORS.border}`
        }}>
          <h3 style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
            CIRCUIT BREAKER
          </h3>
          <CircuitBreakerIndicator
            state={displayMetrics.circuit_breaker?.state || 'closed'}
            timeUntilHalfOpen={displayMetrics.circuit_breaker?.time_until_half_open}
          />
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            marginTop: '12px',
            fontSize: '11px'
          }}>
            <div style={{ padding: '8px', background: COLORS.background, borderRadius: '4px' }}>
              <div style={{ color: '#666' }}>Failures</div>
              <div style={{ color: '#fff', fontWeight: 'bold' }}>
                {displayMetrics.circuit_breaker?.failure_count || 0}
              </div>
            </div>
            <div style={{ padding: '8px', background: COLORS.background, borderRadius: '4px' }}>
              <div style={{ color: '#666' }}>Rejected</div>
              <div style={{ color: COLORS.danger, fontWeight: 'bold' }}>
                {displayMetrics.stats?.orders_rejected || 0}
              </div>
            </div>
          </div>
        </div>
        
        {/* Portfolio Exposure */}
        <div style={{
          padding: '16px',
          background: COLORS.surface,
          borderRadius: '8px',
          border: `1px solid ${COLORS.border}`
        }}>
          <h3 style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
            PORTFOLIO EXPOSURE
          </h3>
          <div style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#fff',
            marginBottom: '12px'
          }}>
            ${displayMetrics.total_exposure?.toLocaleString() || '0'}
          </div>
          <RiskGauge
            label="Exposure Limit"
            value={displayMetrics.exposure_utilization * 100 || 0}
            max={100}
            thresholds={[0.6, 0.85]}
          />
          <RiskGauge
            label="Drawdown"
            value={(displayMetrics.drawdown?.rolling_drawdown_pct || 0) * 100}
            max={10}
            thresholds={[0.5, 0.8]}
          />
        </div>
        
        {/* Rate Limiting */}
        <div style={{
          padding: '16px',
          background: COLORS.surface,
          borderRadius: '8px',
          border: `1px solid ${COLORS.border}`
        }}>
          <h3 style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
            ORDER RATE
          </h3>
          <RateLimitMeter
            current={displayMetrics.rate_limits?.orders_last_second || 0}
            max={100}
            label="Per Second"
            period="sec"
          />
          <RateLimitMeter
            current={displayMetrics.rate_limits?.orders_last_minute || 0}
            max={2000}
            label="Per Minute"
            period="min"
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#666',
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: `1px solid ${COLORS.border}`
          }}>
            <span>Total Checked</span>
            <span style={{ color: COLORS.safe }}>
              {displayMetrics.stats?.orders_checked?.toLocaleString() || 0}
            </span>
          </div>
        </div>
        
        {/* PnL Summary */}
        <div style={{
          padding: '16px',
          background: COLORS.surface,
          borderRadius: '8px',
          border: `1px solid ${COLORS.border}`
        }}>
          <h3 style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
            P&L STATUS
          </h3>
          <div style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: (displayMetrics.current_pnl || 0) >= 0 ? COLORS.safe : COLORS.danger,
            marginBottom: '12px'
          }}>
            {(displayMetrics.current_pnl || 0) >= 0 ? '+' : ''}
            ${(displayMetrics.current_pnl || 0).toLocaleString()}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            fontSize: '11px'
          }}>
            <div style={{ padding: '8px', background: COLORS.background, borderRadius: '4px' }}>
              <div style={{ color: '#666' }}>Daily P&L</div>
              <div style={{
                color: (displayMetrics.drawdown?.daily_pnl || 0) >= 0 ? COLORS.safe : COLORS.danger,
                fontWeight: 'bold'
              }}>
                {(displayMetrics.drawdown?.daily_pnl || 0) >= 0 ? '+' : ''}
                ${(displayMetrics.drawdown?.daily_pnl || 0).toLocaleString()}
              </div>
            </div>
            <div style={{ padding: '8px', background: COLORS.background, borderRadius: '4px' }}>
              <div style={{ color: '#666' }}>Peak DD</div>
              <div style={{ color: COLORS.warning, fontWeight: 'bold' }}>
                -{((displayMetrics.drawdown?.drawdown_pct || 0) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Positions Grid */}
      {displayMetrics.positions && Object.keys(displayMetrics.positions).length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <h3 style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
            ACTIVE POSITIONS
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px'
          }}>
            {Object.entries(displayMetrics.positions).map(([symbol, quantity]) => (
              <PositionCard
                key={symbol}
                symbol={symbol}
                quantity={quantity}
                price={displayMetrics.prices?.[symbol] || 0}
                limit={10000}
              />
            ))}
          </div>
        </div>
      )}
      
      {/* CSS animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes slideIn {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default RiskDashboard;
