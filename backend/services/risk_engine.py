"""
ZeTheta Risk Management Engine
==============================
Production-grade risk controls for HFT puzzle platform

Features:
- Position limits (per-symbol and portfolio-wide)
- Drawdown circuit breakers (daily/rolling loss limits)
- Order rate limiting (per-second throttling with burst protection)
- Real-time risk metrics and alerts
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional, Callable
from collections import deque
import time
import threading
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("RiskEngine")


class RiskViolationType(Enum):
    """Types of risk violations that can occur."""
    POSITION_LIMIT_BREACH = "position_limit_breach"
    PORTFOLIO_EXPOSURE_BREACH = "portfolio_exposure_breach"
    DAILY_LOSS_LIMIT = "daily_loss_limit"
    ROLLING_DRAWDOWN = "rolling_drawdown"
    ORDER_RATE_EXCEEDED = "order_rate_exceeded"
    MAX_ORDER_SIZE = "max_order_size"
    PRICE_DEVIATION = "price_deviation"
    CIRCUIT_BREAKER_ACTIVE = "circuit_breaker_active"


class CircuitBreakerState(Enum):
    """Circuit breaker operational states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Halted - no orders allowed
    HALF_OPEN = "half_open"  # Testing if conditions improved


@dataclass
class RiskViolation:
    """Represents a risk rule violation."""
    violation_type: RiskViolationType
    message: str
    timestamp: datetime
    severity: str  # "warning", "critical", "fatal"
    details: Dict = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        return {
            "type": self.violation_type.value,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "severity": self.severity,
            "details": self.details
        }


@dataclass
class RiskCheckResult:
    """Result of a risk check operation."""
    passed: bool
    violations: List[RiskViolation] = field(default_factory=list)
    latency_us: float = 0.0  # Latency in microseconds
    
    def to_dict(self) -> Dict:
        return {
            "passed": self.passed,
            "violations": [v.to_dict() for v in self.violations],
            "latency_us": self.latency_us
        }


@dataclass 
class PositionLimits:
    """Configuration for position limits."""
    max_position_per_symbol: int = 10000       # Max shares per symbol
    max_portfolio_exposure: float = 1000000.0  # Max total $ exposure
    max_concentration_pct: float = 0.25        # Max % in single symbol
    max_order_size: int = 1000                 # Max single order size


@dataclass
class DrawdownLimits:
    """Configuration for drawdown controls."""
    daily_loss_limit: float = 50000.0          # Max daily loss in $
    rolling_drawdown_pct: float = 0.10         # 10% rolling drawdown trigger
    rolling_window_minutes: int = 60           # Rolling window for drawdown
    recovery_threshold_pct: float = 0.05       # % recovery to reset breaker


@dataclass
class RateLimits:
    """Configuration for order rate limiting."""
    max_orders_per_second: int = 100           # Orders per second limit
    max_orders_per_minute: int = 2000          # Orders per minute limit
    burst_allowance: int = 50                  # Extra orders for bursts
    cooldown_seconds: float = 5.0              # Cooldown after rate breach


class RollingWindow:
    """Efficient rolling window for rate limiting and metrics."""
    
    def __init__(self, window_seconds: float):
        self.window_seconds = window_seconds
        self.timestamps: deque = deque()
        self._lock = threading.Lock()
    
    def add(self, timestamp: float = None) -> None:
        """Add an event to the window."""
        if timestamp is None:
            timestamp = time.time()
        with self._lock:
            self.timestamps.append(timestamp)
            self._cleanup(timestamp)
    
    def _cleanup(self, current_time: float) -> None:
        """Remove expired events."""
        cutoff = current_time - self.window_seconds
        while self.timestamps and self.timestamps[0] < cutoff:
            self.timestamps.popleft()
    
    def count(self) -> int:
        """Count events in current window."""
        with self._lock:
            self._cleanup(time.time())
            return len(self.timestamps)


class DrawdownTracker:
    """Tracks PnL and drawdown over time."""
    
    def __init__(self, window_minutes: int = 60):
        self.window_minutes = window_minutes
        self.pnl_history: deque = deque()  # (timestamp, cumulative_pnl)
        self.peak_pnl: float = 0.0
        self.daily_start_pnl: float = 0.0
        self.daily_start_time: datetime = datetime.now()
        self._lock = threading.Lock()
    
    def update(self, current_pnl: float) -> Dict:
        """Update PnL and return drawdown metrics."""
        now = time.time()
        
        with self._lock:
            # Check if new trading day
            current_date = datetime.now().date()
            if current_date > self.daily_start_time.date():
                self.daily_start_pnl = current_pnl
                self.daily_start_time = datetime.now()
                self.peak_pnl = current_pnl
            
            # Update peak
            if current_pnl > self.peak_pnl:
                self.peak_pnl = current_pnl
            
            # Add to history
            self.pnl_history.append((now, current_pnl))
            
            # Cleanup old entries
            cutoff = now - (self.window_minutes * 60)
            while self.pnl_history and self.pnl_history[0][0] < cutoff:
                self.pnl_history.popleft()
            
            # Calculate metrics
            daily_pnl = current_pnl - self.daily_start_pnl
            drawdown_from_peak = self.peak_pnl - current_pnl
            drawdown_pct = drawdown_from_peak / max(self.peak_pnl, 1.0)
            
            # Rolling drawdown (from window high)
            window_peak = max(p[1] for p in self.pnl_history) if self.pnl_history else current_pnl
            rolling_drawdown = window_peak - current_pnl
            rolling_drawdown_pct = rolling_drawdown / max(window_peak, 1.0)
            
            return {
                "current_pnl": current_pnl,
                "daily_pnl": daily_pnl,
                "peak_pnl": self.peak_pnl,
                "drawdown_from_peak": drawdown_from_peak,
                "drawdown_pct": drawdown_pct,
                "rolling_drawdown": rolling_drawdown,
                "rolling_drawdown_pct": rolling_drawdown_pct
            }


class CircuitBreaker:
    """
    Circuit breaker pattern for risk management.
    
    States:
    - CLOSED: Normal operation, orders processed
    - OPEN: Trading halted, orders rejected
    - HALF_OPEN: Testing recovery, limited orders allowed
    """
    
    def __init__(
        self,
        open_threshold: int = 3,        # Violations to trigger open
        half_open_timeout: float = 30.0,  # Seconds before testing
        success_threshold: int = 5      # Successes to close
    ):
        self.open_threshold = open_threshold
        self.half_open_timeout = half_open_timeout
        self.success_threshold = success_threshold
        
        self.state = CircuitBreakerState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time: Optional[float] = None
        self.opened_at: Optional[float] = None
        self._lock = threading.Lock()
        
        # Callbacks for state changes
        self.on_state_change: Optional[Callable] = None
    
    def record_success(self) -> None:
        """Record a successful operation."""
        with self._lock:
            if self.state == CircuitBreakerState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.success_threshold:
                    self._transition_to(CircuitBreakerState.CLOSED)
            elif self.state == CircuitBreakerState.CLOSED:
                # Reset failure count on success
                self.failure_count = max(0, self.failure_count - 1)
    
    def record_failure(self) -> None:
        """Record a failed operation (risk violation)."""
        with self._lock:
            self.failure_count += 1
            self.last_failure_time = time.time()
            
            if self.state == CircuitBreakerState.HALF_OPEN:
                # Immediate return to open on failure
                self._transition_to(CircuitBreakerState.OPEN)
            elif self.state == CircuitBreakerState.CLOSED:
                if self.failure_count >= self.open_threshold:
                    self._transition_to(CircuitBreakerState.OPEN)
    
    def allow_request(self) -> bool:
        """Check if an operation should be allowed."""
        with self._lock:
            if self.state == CircuitBreakerState.CLOSED:
                return True
            
            if self.state == CircuitBreakerState.OPEN:
                # Check if timeout has passed
                if self.opened_at and (time.time() - self.opened_at) >= self.half_open_timeout:
                    self._transition_to(CircuitBreakerState.HALF_OPEN)
                    return True
                return False
            
            # HALF_OPEN - allow limited testing
            return True
    
    def force_open(self, duration_seconds: float = 60.0) -> None:
        """Force circuit breaker open (e.g., for manual intervention)."""
        with self._lock:
            self._transition_to(CircuitBreakerState.OPEN)
            # Extend timeout
            self.half_open_timeout = duration_seconds
    
    def force_close(self) -> None:
        """Force circuit breaker closed (manual reset)."""
        with self._lock:
            self._transition_to(CircuitBreakerState.CLOSED)
    
    def _transition_to(self, new_state: CircuitBreakerState) -> None:
        """Handle state transition."""
        old_state = self.state
        self.state = new_state
        
        if new_state == CircuitBreakerState.OPEN:
            self.opened_at = time.time()
            self.success_count = 0
        elif new_state == CircuitBreakerState.CLOSED:
            self.failure_count = 0
            self.success_count = 0
            self.opened_at = None
        elif new_state == CircuitBreakerState.HALF_OPEN:
            self.success_count = 0
        
        logger.info(f"Circuit breaker: {old_state.value} -> {new_state.value}")
        
        if self.on_state_change:
            self.on_state_change(old_state, new_state)
    
    def get_state(self) -> Dict:
        """Get current circuit breaker state."""
        return {
            "state": self.state.value,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "opened_at": self.opened_at,
            "time_until_half_open": max(0, self.half_open_timeout - (time.time() - self.opened_at)) if self.opened_at else None
        }


class RiskEngine:
    """
    Main risk management engine.
    
    Performs pre-trade and post-trade risk checks with sub-millisecond latency.
    Integrates position limits, drawdown controls, rate limiting, and circuit breakers.
    """
    
    def __init__(
        self,
        position_limits: PositionLimits = None,
        drawdown_limits: DrawdownLimits = None,
        rate_limits: RateLimits = None
    ):
        self.position_limits = position_limits or PositionLimits()
        self.drawdown_limits = drawdown_limits or DrawdownLimits()
        self.rate_limits = rate_limits or RateLimits()
        
        # Current positions: symbol -> quantity (positive = long, negative = short)
        self.positions: Dict[str, int] = {}
        
        # Current prices for exposure calculation
        self.prices: Dict[str, float] = {}
        
        # Rate limiting windows
        self.orders_per_second = RollingWindow(1.0)
        self.orders_per_minute = RollingWindow(60.0)
        
        # Drawdown tracking
        self.drawdown_tracker = DrawdownTracker(self.drawdown_limits.rolling_window_minutes)
        self.current_pnl: float = 0.0
        
        # Circuit breaker
        self.circuit_breaker = CircuitBreaker()
        
        # Rate limit cooldown
        self.rate_cooldown_until: float = 0.0
        
        # Statistics
        self.stats = {
            "orders_checked": 0,
            "orders_rejected": 0,
            "violations_by_type": {},
            "avg_check_latency_us": 0.0
        }
        
        self._lock = threading.RLock()
    
    def update_price(self, symbol: str, price: float) -> None:
        """Update price for a symbol."""
        with self._lock:
            self.prices[symbol] = price
    
    def update_position(self, symbol: str, quantity: int) -> None:
        """Update position for a symbol."""
        with self._lock:
            self.positions[symbol] = quantity
    
    def update_pnl(self, pnl: float) -> Dict:
        """Update current PnL and return drawdown metrics."""
        with self._lock:
            self.current_pnl = pnl
            return self.drawdown_tracker.update(pnl)
    
    def check_pre_trade(
        self,
        symbol: str,
        side: str,       # "buy" or "sell"
        quantity: int,
        price: float
    ) -> RiskCheckResult:
        """
        Perform pre-trade risk checks.
        
        Returns RiskCheckResult with pass/fail and any violations.
        Designed for sub-millisecond performance.
        """
        start_time = time.perf_counter()
        violations = []
        
        with self._lock:
            self.stats["orders_checked"] += 1
            
            # 1. Circuit breaker check (fastest, exit early if open)
            if not self.circuit_breaker.allow_request():
                violations.append(RiskViolation(
                    violation_type=RiskViolationType.CIRCUIT_BREAKER_ACTIVE,
                    message="Trading halted - circuit breaker active",
                    timestamp=datetime.now(),
                    severity="fatal",
                    details=self.circuit_breaker.get_state()
                ))
                return self._finalize_result(violations, start_time)
            
            # 2. Rate limiting check
            rate_violation = self._check_rate_limits()
            if rate_violation:
                violations.append(rate_violation)
                return self._finalize_result(violations, start_time)
            
            # 3. Order size check
            if quantity > self.position_limits.max_order_size:
                violations.append(RiskViolation(
                    violation_type=RiskViolationType.MAX_ORDER_SIZE,
                    message=f"Order size {quantity} exceeds max {self.position_limits.max_order_size}",
                    timestamp=datetime.now(),
                    severity="critical",
                    details={"requested": quantity, "max": self.position_limits.max_order_size}
                ))
            
            # 4. Position limit check
            current_position = self.positions.get(symbol, 0)
            position_delta = quantity if side == "buy" else -quantity
            new_position = current_position + position_delta
            
            if abs(new_position) > self.position_limits.max_position_per_symbol:
                violations.append(RiskViolation(
                    violation_type=RiskViolationType.POSITION_LIMIT_BREACH,
                    message=f"Position {new_position} would exceed limit {self.position_limits.max_position_per_symbol}",
                    timestamp=datetime.now(),
                    severity="critical",
                    details={
                        "symbol": symbol,
                        "current": current_position,
                        "requested_delta": position_delta,
                        "would_be": new_position,
                        "limit": self.position_limits.max_position_per_symbol
                    }
                ))
            
            # 5. Portfolio exposure check
            exposure_violation = self._check_portfolio_exposure(symbol, position_delta, price)
            if exposure_violation:
                violations.append(exposure_violation)
            
            # 6. Concentration check
            concentration_violation = self._check_concentration(symbol, new_position, price)
            if concentration_violation:
                violations.append(concentration_violation)
            
            # 7. Drawdown check
            drawdown_violation = self._check_drawdown()
            if drawdown_violation:
                violations.append(drawdown_violation)
            
            # Record order in rate limiter if passed
            if not violations:
                self.orders_per_second.add()
                self.orders_per_minute.add()
                self.circuit_breaker.record_success()
            else:
                self.stats["orders_rejected"] += 1
                for v in violations:
                    vtype = v.violation_type.value
                    self.stats["violations_by_type"][vtype] = self.stats["violations_by_type"].get(vtype, 0) + 1
                
                # Record failure in circuit breaker for severe violations
                if any(v.severity in ["critical", "fatal"] for v in violations):
                    self.circuit_breaker.record_failure()
            
            return self._finalize_result(violations, start_time)
    
    def _check_rate_limits(self) -> Optional[RiskViolation]:
        """Check rate limiting rules."""
        now = time.time()
        
        # Check cooldown
        if now < self.rate_cooldown_until:
            return RiskViolation(
                violation_type=RiskViolationType.ORDER_RATE_EXCEEDED,
                message=f"Rate limit cooldown active for {self.rate_cooldown_until - now:.1f}s",
                timestamp=datetime.now(),
                severity="warning",
                details={"cooldown_remaining": self.rate_cooldown_until - now}
            )
        
        # Check per-second rate
        current_rate_1s = self.orders_per_second.count()
        if current_rate_1s >= self.rate_limits.max_orders_per_second + self.rate_limits.burst_allowance:
            self.rate_cooldown_until = now + self.rate_limits.cooldown_seconds
            return RiskViolation(
                violation_type=RiskViolationType.ORDER_RATE_EXCEEDED,
                message=f"Order rate {current_rate_1s}/s exceeds limit {self.rate_limits.max_orders_per_second}/s",
                timestamp=datetime.now(),
                severity="critical",
                details={"current_rate": current_rate_1s, "limit": self.rate_limits.max_orders_per_second}
            )
        
        # Check per-minute rate
        current_rate_1m = self.orders_per_minute.count()
        if current_rate_1m >= self.rate_limits.max_orders_per_minute:
            return RiskViolation(
                violation_type=RiskViolationType.ORDER_RATE_EXCEEDED,
                message=f"Order rate {current_rate_1m}/min exceeds limit {self.rate_limits.max_orders_per_minute}/min",
                timestamp=datetime.now(),
                severity="warning",
                details={"current_rate": current_rate_1m, "limit": self.rate_limits.max_orders_per_minute}
            )
        
        return None
    
    def _check_portfolio_exposure(
        self,
        symbol: str,
        position_delta: int,
        price: float
    ) -> Optional[RiskViolation]:
        """Check total portfolio exposure."""
        # Calculate current exposure
        total_exposure = 0.0
        for sym, pos in self.positions.items():
            sym_price = self.prices.get(sym, 0)
            total_exposure += abs(pos) * sym_price
        
        # Add proposed change
        new_exposure = total_exposure + abs(position_delta) * price
        
        if new_exposure > self.position_limits.max_portfolio_exposure:
            return RiskViolation(
                violation_type=RiskViolationType.PORTFOLIO_EXPOSURE_BREACH,
                message=f"Portfolio exposure ${new_exposure:,.2f} would exceed limit ${self.position_limits.max_portfolio_exposure:,.2f}",
                timestamp=datetime.now(),
                severity="critical",
                details={
                    "current_exposure": total_exposure,
                    "additional_exposure": abs(position_delta) * price,
                    "would_be": new_exposure,
                    "limit": self.position_limits.max_portfolio_exposure
                }
            )
        return None
    
    def _check_concentration(
        self,
        symbol: str,
        new_position: int,
        price: float
    ) -> Optional[RiskViolation]:
        """Check concentration risk in single symbol."""
        # Calculate total portfolio value
        total_value = 0.0
        for sym, pos in self.positions.items():
            sym_price = self.prices.get(sym, price if sym == symbol else 0)
            total_value += abs(pos) * sym_price
        
        if total_value == 0:
            return None
        
        # Calculate new concentration
        symbol_value = abs(new_position) * price
        concentration = symbol_value / total_value
        
        if concentration > self.position_limits.max_concentration_pct:
            return RiskViolation(
                violation_type=RiskViolationType.PORTFOLIO_EXPOSURE_BREACH,
                message=f"Concentration {concentration:.1%} in {symbol} exceeds limit {self.position_limits.max_concentration_pct:.1%}",
                timestamp=datetime.now(),
                severity="warning",
                details={
                    "symbol": symbol,
                    "concentration": concentration,
                    "limit": self.position_limits.max_concentration_pct
                }
            )
        return None
    
    def _check_drawdown(self) -> Optional[RiskViolation]:
        """Check drawdown limits."""
        metrics = self.drawdown_tracker.update(self.current_pnl)
        
        # Check daily loss limit
        if metrics["daily_pnl"] < -self.drawdown_limits.daily_loss_limit:
            return RiskViolation(
                violation_type=RiskViolationType.DAILY_LOSS_LIMIT,
                message=f"Daily loss ${-metrics['daily_pnl']:,.2f} exceeds limit ${self.drawdown_limits.daily_loss_limit:,.2f}",
                timestamp=datetime.now(),
                severity="fatal",
                details={
                    "daily_pnl": metrics["daily_pnl"],
                    "limit": self.drawdown_limits.daily_loss_limit
                }
            )
        
        # Check rolling drawdown
        if metrics["rolling_drawdown_pct"] > self.drawdown_limits.rolling_drawdown_pct:
            return RiskViolation(
                violation_type=RiskViolationType.ROLLING_DRAWDOWN,
                message=f"Rolling drawdown {metrics['rolling_drawdown_pct']:.1%} exceeds limit {self.drawdown_limits.rolling_drawdown_pct:.1%}",
                timestamp=datetime.now(),
                severity="critical",
                details={
                    "drawdown_pct": metrics["rolling_drawdown_pct"],
                    "drawdown_amount": metrics["rolling_drawdown"],
                    "limit": self.drawdown_limits.rolling_drawdown_pct
                }
            )
        
        return None
    
    def _finalize_result(
        self,
        violations: List[RiskViolation],
        start_time: float
    ) -> RiskCheckResult:
        """Finalize risk check result with latency measurement."""
        latency_us = (time.perf_counter() - start_time) * 1_000_000
        
        # Update average latency
        n = self.stats["orders_checked"]
        old_avg = self.stats["avg_check_latency_us"]
        self.stats["avg_check_latency_us"] = old_avg + (latency_us - old_avg) / n
        
        return RiskCheckResult(
            passed=len(violations) == 0,
            violations=violations,
            latency_us=latency_us
        )
    
    def get_risk_metrics(self) -> Dict:
        """Get current risk metrics and status."""
        with self._lock:
            # Calculate current exposure
            total_exposure = sum(
                abs(pos) * self.prices.get(sym, 0)
                for sym, pos in self.positions.items()
            )
            
            drawdown_metrics = self.drawdown_tracker.update(self.current_pnl)
            
            return {
                "positions": dict(self.positions),
                "prices": dict(self.prices),
                "total_exposure": total_exposure,
                "exposure_utilization": total_exposure / self.position_limits.max_portfolio_exposure,
                "current_pnl": self.current_pnl,
                "drawdown": drawdown_metrics,
                "rate_limits": {
                    "orders_last_second": self.orders_per_second.count(),
                    "orders_last_minute": self.orders_per_minute.count(),
                    "rate_1s_utilization": self.orders_per_second.count() / self.rate_limits.max_orders_per_second,
                    "rate_1m_utilization": self.orders_per_minute.count() / self.rate_limits.max_orders_per_minute
                },
                "circuit_breaker": self.circuit_breaker.get_state(),
                "stats": dict(self.stats)
            }
    
    def reset(self) -> None:
        """Reset all risk state (for new trading session)."""
        with self._lock:
            self.positions.clear()
            self.prices.clear()
            self.current_pnl = 0.0
            self.orders_per_second = RollingWindow(1.0)
            self.orders_per_minute = RollingWindow(60.0)
            self.drawdown_tracker = DrawdownTracker(self.drawdown_limits.rolling_window_minutes)
            self.circuit_breaker.force_close()
            self.rate_cooldown_until = 0.0
            self.stats = {
                "orders_checked": 0,
                "orders_rejected": 0,
                "violations_by_type": {},
                "avg_check_latency_us": 0.0
            }
            logger.info("Risk engine reset")


# Challenge-specific presets
CHALLENGE_RISK_PRESETS = {
    "market_maker": {
        "position_limits": PositionLimits(
            max_position_per_symbol=5000,
            max_portfolio_exposure=500000,
            max_concentration_pct=1.0,  # No concentration limit for single-symbol
            max_order_size=500
        ),
        "drawdown_limits": DrawdownLimits(
            daily_loss_limit=25000,
            rolling_drawdown_pct=0.15,
            rolling_window_minutes=30
        ),
        "rate_limits": RateLimits(
            max_orders_per_second=200,  # Market makers need high rate
            max_orders_per_minute=5000,
            burst_allowance=100
        )
    },
    "latency_arb": {
        "position_limits": PositionLimits(
            max_position_per_symbol=2000,
            max_portfolio_exposure=200000,
            max_concentration_pct=0.5,
            max_order_size=200
        ),
        "drawdown_limits": DrawdownLimits(
            daily_loss_limit=10000,
            rolling_drawdown_pct=0.08,
            rolling_window_minutes=15
        ),
        "rate_limits": RateLimits(
            max_orders_per_second=500,  # Arb needs fastest rate
            max_orders_per_minute=10000,
            burst_allowance=200
        )
    },
    "momentum": {
        "position_limits": PositionLimits(
            max_position_per_symbol=10000,
            max_portfolio_exposure=1000000,
            max_concentration_pct=0.4,
            max_order_size=1000
        ),
        "drawdown_limits": DrawdownLimits(
            daily_loss_limit=50000,
            rolling_drawdown_pct=0.12,
            rolling_window_minutes=60
        ),
        "rate_limits": RateLimits(
            max_orders_per_second=50,  # Momentum needs fewer orders
            max_orders_per_minute=1000,
            burst_allowance=20
        )
    },
    "flash_crash": {
        "position_limits": PositionLimits(
            max_position_per_symbol=3000,
            max_portfolio_exposure=300000,
            max_concentration_pct=0.5,
            max_order_size=300
        ),
        "drawdown_limits": DrawdownLimits(
            daily_loss_limit=15000,
            rolling_drawdown_pct=0.20,  # Higher tolerance for volatile scenario
            rolling_window_minutes=10
        ),
        "rate_limits": RateLimits(
            max_orders_per_second=150,
            max_orders_per_minute=3000,
            burst_allowance=50
        )
    },
    "adverse_selection": {
        "position_limits": PositionLimits(
            max_position_per_symbol=2000,
            max_portfolio_exposure=200000,
            max_concentration_pct=1.0,
            max_order_size=200
        ),
        "drawdown_limits": DrawdownLimits(
            daily_loss_limit=20000,
            rolling_drawdown_pct=0.10,
            rolling_window_minutes=30
        ),
        "rate_limits": RateLimits(
            max_orders_per_second=100,
            max_orders_per_minute=2000,
            burst_allowance=30
        )
    }
}


def create_risk_engine_for_challenge(challenge_type: str) -> RiskEngine:
    """Create a risk engine with preset limits for a specific challenge."""
    preset = CHALLENGE_RISK_PRESETS.get(challenge_type, {})
    return RiskEngine(
        position_limits=preset.get("position_limits"),
        drawdown_limits=preset.get("drawdown_limits"),
        rate_limits=preset.get("rate_limits")
    )


if __name__ == "__main__":
    # Quick demo
    print("ZeTheta Risk Engine Demo")
    print("=" * 50)
    
    engine = create_risk_engine_for_challenge("market_maker")
    
    # Simulate some trading
    engine.update_price("AAPL", 150.0)
    engine.update_pnl(10000)
    
    # Test valid order
    result = engine.check_pre_trade("AAPL", "buy", 100, 150.0)
    print(f"\nOrder 1 (buy 100 AAPL): {'PASSED' if result.passed else 'REJECTED'}")
    print(f"  Latency: {result.latency_us:.2f}μs")
    
    # Update position
    engine.update_position("AAPL", 100)
    
    # Test order that would exceed position limit
    result = engine.check_pre_trade("AAPL", "buy", 5000, 150.0)
    print(f"\nOrder 2 (buy 5000 AAPL): {'PASSED' if result.passed else 'REJECTED'}")
    if result.violations:
        print(f"  Violation: {result.violations[0].message}")
    
    # Show metrics
    print("\nCurrent Risk Metrics:")
    metrics = engine.get_risk_metrics()
    print(f"  Exposure: ${metrics['total_exposure']:,.2f}")
    print(f"  Exposure Utilization: {metrics['exposure_utilization']:.1%}")
    print(f"  Orders/sec: {metrics['rate_limits']['orders_last_second']}")
    print(f"  Circuit Breaker: {metrics['circuit_breaker']['state']}")
