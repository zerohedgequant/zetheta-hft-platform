"""
ZeTheta Risk Management API Routes
===================================
FastAPI endpoints for risk engine integration
"""

from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, Dict, List
from datetime import datetime
import asyncio
import json

from services.risk_engine import (
    RiskEngine,
    PositionLimits,
    DrawdownLimits,
    RateLimits,
    create_risk_engine_for_challenge,
    CHALLENGE_RISK_PRESETS
)

router = APIRouter(prefix="/api/risk", tags=["risk"])

# Global risk engine instances per session
risk_engines: Dict[str, RiskEngine] = {}


# ============ Pydantic Models ============

class RiskConfigUpdate(BaseModel):
    """Request model for updating risk configuration."""
    max_position_per_symbol: Optional[int] = None
    max_portfolio_exposure: Optional[float] = None
    max_concentration_pct: Optional[float] = None
    max_order_size: Optional[int] = None
    daily_loss_limit: Optional[float] = None
    rolling_drawdown_pct: Optional[float] = None
    max_orders_per_second: Optional[int] = None
    max_orders_per_minute: Optional[int] = None


class PreTradeCheckRequest(BaseModel):
    """Request model for pre-trade risk check."""
    symbol: str
    side: str  # "buy" or "sell"
    quantity: int
    price: float


class PositionUpdate(BaseModel):
    """Request model for position update."""
    symbol: str
    quantity: int


class PriceUpdate(BaseModel):
    """Request model for price update."""
    symbol: str
    price: float


class PnLUpdate(BaseModel):
    """Request model for PnL update."""
    pnl: float


class CircuitBreakerAction(BaseModel):
    """Request model for circuit breaker manual control."""
    action: str  # "open", "close", "reset"
    duration_seconds: Optional[float] = 60.0


# ============ Helper Functions ============

def get_or_create_risk_engine(session_id: str) -> RiskEngine:
    """Get or create a risk engine for a session."""
    if session_id not in risk_engines:
        risk_engines[session_id] = RiskEngine()
    return risk_engines[session_id]


# ============ API Endpoints ============

@router.post("/session/{session_id}/init")
async def initialize_risk_engine(
    session_id: str,
    challenge_type: Optional[str] = None
):
    """
    Initialize a risk engine for a trading session.
    Optionally use a challenge-specific preset.
    """
    if challenge_type and challenge_type in CHALLENGE_RISK_PRESETS:
        risk_engines[session_id] = create_risk_engine_for_challenge(
            challenge_type)
        return {
            "status": "initialized",
            "session_id": session_id,
            "challenge_type": challenge_type,
            "preset_applied": True
        }
    else:
        risk_engines[session_id] = RiskEngine()
        return {
            "status": "initialized",
            "session_id": session_id,
            "preset_applied": False
        }


@router.delete("/session/{session_id}")
async def cleanup_risk_session(session_id: str):
    """Clean up risk engine for a session."""
    if session_id in risk_engines:
        del risk_engines[session_id]
        return {"status": "cleaned_up", "session_id": session_id}
    raise HTTPException(status_code=404, detail="Session not found")


@router.get("/session/{session_id}/metrics")
async def get_risk_metrics(session_id: str):
    """Get current risk metrics for a session."""
    engine = risk_engines.get(session_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Session not found")

    return engine.get_risk_metrics()


@router.post("/session/{session_id}/check")
async def pre_trade_check(
    session_id: str,
    request: PreTradeCheckRequest
):
    """
    Perform pre-trade risk check.
    Returns pass/fail with any violations.
    """
    engine = risk_engines.get(session_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Session not found")

    result = engine.check_pre_trade(
        symbol=request.symbol,
        side=request.side,
        quantity=request.quantity,
        price=request.price
    )

    return result.to_dict()


@router.post("/session/{session_id}/position")
async def update_position(
    session_id: str,
    request: PositionUpdate
):
    """Update position for a symbol."""
    engine = risk_engines.get(session_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Session not found")

    engine.update_position(request.symbol, request.quantity)
    return {"status": "updated", "symbol": request.symbol, "quantity": request.quantity}


@router.post("/session/{session_id}/price")
async def update_price(
    session_id: str,
    request: PriceUpdate
):
    """Update price for a symbol."""
    engine = risk_engines.get(session_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Session not found")

    engine.update_price(request.symbol, request.price)
    return {"status": "updated", "symbol": request.symbol, "price": request.price}


@router.post("/session/{session_id}/pnl")
async def update_pnl(
    session_id: str,
    request: PnLUpdate
):
    """Update PnL and get drawdown metrics."""
    engine = risk_engines.get(session_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Session not found")

    metrics = engine.update_pnl(request.pnl)
    return {"status": "updated", "pnl": request.pnl, "drawdown_metrics": metrics}


@router.post("/session/{session_id}/circuit-breaker")
async def control_circuit_breaker(
    session_id: str,
    request: CircuitBreakerAction
):
    """Manually control circuit breaker state."""
    engine = risk_engines.get(session_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Session not found")

    if request.action == "open":
        engine.circuit_breaker.force_open(request.duration_seconds)
    elif request.action == "close":
        engine.circuit_breaker.force_close()
    elif request.action == "reset":
        engine.reset()
    else:
        raise HTTPException(
            status_code=400, detail=f"Unknown action: {request.action}")

    return {"status": request.action, "circuit_breaker": engine.circuit_breaker.get_state()}


@router.patch("/session/{session_id}/config")
async def update_risk_config(
    session_id: str,
    config: RiskConfigUpdate
):
    """Update risk configuration for a session."""
    engine = risk_engines.get(session_id)
    if not engine:
        raise HTTPException(status_code=404, detail="Session not found")

    # Update position limits
    if config.max_position_per_symbol is not None:
        engine.position_limits.max_position_per_symbol = config.max_position_per_symbol
    if config.max_portfolio_exposure is not None:
        engine.position_limits.max_portfolio_exposure = config.max_portfolio_exposure
    if config.max_concentration_pct is not None:
        engine.position_limits.max_concentration_pct = config.max_concentration_pct
    if config.max_order_size is not None:
        engine.position_limits.max_order_size = config.max_order_size

    # Update drawdown limits
    if config.daily_loss_limit is not None:
        engine.drawdown_limits.daily_loss_limit = config.daily_loss_limit
    if config.rolling_drawdown_pct is not None:
        engine.drawdown_limits.rolling_drawdown_pct = config.rolling_drawdown_pct

    # Update rate limits
    if config.max_orders_per_second is not None:
        engine.rate_limits.max_orders_per_second = config.max_orders_per_second
    if config.max_orders_per_minute is not None:
        engine.rate_limits.max_orders_per_minute = config.max_orders_per_minute

    return {
        "status": "updated",
        "position_limits": {
            "max_position_per_symbol": engine.position_limits.max_position_per_symbol,
            "max_portfolio_exposure": engine.position_limits.max_portfolio_exposure,
            "max_concentration_pct": engine.position_limits.max_concentration_pct,
            "max_order_size": engine.position_limits.max_order_size
        },
        "drawdown_limits": {
            "daily_loss_limit": engine.drawdown_limits.daily_loss_limit,
            "rolling_drawdown_pct": engine.drawdown_limits.rolling_drawdown_pct
        },
        "rate_limits": {
            "max_orders_per_second": engine.rate_limits.max_orders_per_second,
            "max_orders_per_minute": engine.rate_limits.max_orders_per_minute
        }
    }


@router.get("/presets")
async def get_challenge_presets():
    """Get available challenge risk presets."""
    presets_info = {}
    for name, preset in CHALLENGE_RISK_PRESETS.items():
        presets_info[name] = {
            "position_limits": {
                "max_position_per_symbol": preset["position_limits"].max_position_per_symbol,
                "max_portfolio_exposure": preset["position_limits"].max_portfolio_exposure,
                "max_order_size": preset["position_limits"].max_order_size
            },
            "drawdown_limits": {
                "daily_loss_limit": preset["drawdown_limits"].daily_loss_limit,
                "rolling_drawdown_pct": preset["drawdown_limits"].rolling_drawdown_pct
            },
            "rate_limits": {
                "max_orders_per_second": preset["rate_limits"].max_orders_per_second,
                "max_orders_per_minute": preset["rate_limits"].max_orders_per_minute
            }
        }
    return presets_info


# ============ WebSocket for Real-time Risk Updates ============

class RiskWebSocketManager:
    """Manages WebSocket connections for real-time risk updates."""

    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket):
        if session_id in self.active_connections:
            self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def broadcast_metrics(self, session_id: str, metrics: Dict):
        if session_id in self.active_connections:
            message = json.dumps({
                "type": "risk_metrics",
                "timestamp": datetime.now().isoformat(),
                "data": metrics
            })
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_text(message)
                except:
                    pass

    async def broadcast_violation(self, session_id: str, violation: Dict):
        if session_id in self.active_connections:
            message = json.dumps({
                "type": "risk_violation",
                "timestamp": datetime.now().isoformat(),
                "data": violation
            })
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_text(message)
                except:
                    pass


ws_manager = RiskWebSocketManager()


@router.websocket("/ws/{session_id}")
async def risk_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time risk metrics streaming.

    Sends risk metrics every 100ms and violations immediately.
    """
    await ws_manager.connect(session_id, websocket)

    try:
        # Start background task to send periodic metrics
        async def send_periodic_metrics():
            while True:
                engine = risk_engines.get(session_id)
                if engine:
                    metrics = engine.get_risk_metrics()
                    await ws_manager.broadcast_metrics(session_id, metrics)
                await asyncio.sleep(0.1)  # 100ms updates

        # Start the periodic task
        metrics_task = asyncio.create_task(send_periodic_metrics())

        # Listen for incoming messages (e.g., manual commands)
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)

                if message.get("type") == "check_order":
                    engine = risk_engines.get(session_id)
                    if engine:
                        result = engine.check_pre_trade(
                            symbol=message["symbol"],
                            side=message["side"],
                            quantity=message["quantity"],
                            price=message["price"]
                        )
                        await websocket.send_text(json.dumps({
                            "type": "check_result",
                            "data": result.to_dict()
                        }))

                        # Broadcast violation if any
                        if result.violations:
                            for v in result.violations:
                                await ws_manager.broadcast_violation(session_id, v.to_dict())

                elif message.get("type") == "update_position":
                    engine = risk_engines.get(session_id)
                    if engine:
                        engine.update_position(
                            message["symbol"], message["quantity"])

                elif message.get("type") == "update_pnl":
                    engine = risk_engines.get(session_id)
                    if engine:
                        engine.update_pnl(message["pnl"])

            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        metrics_task.cancel()
        ws_manager.disconnect(session_id, websocket)
