import { useState, useCallback } from 'react';

const API_BASE = 'http://localhost:8000';

export const useRiskCheck = (sessionId = 'demo123') => {
  const [lastCheckResult, setLastCheckResult] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkOrder = useCallback(async (order) => {
    setIsChecking(true);
    try {
      const response = await fetch(`${API_BASE}/api/risk/session/${sessionId}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: order.symbol || 'AAPL',
          side: order.side.toLowerCase(),
          quantity: order.qty,
          price: order.price
        })
      });
      if (response.ok) {
        const result = await response.json();
        setLastCheckResult(result);
        setIsChecking(false);
        return result;
      }
    } catch (err) {
      console.log('Risk check unavailable');
    }
    setIsChecking(false);
    return { passed: true, violations: [] };
  }, [sessionId]);

  const updatePosition = useCallback(async (symbol, quantity) => {
    try {
      await fetch(`${API_BASE}/api/risk/session/${sessionId}/position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, quantity })
      });
    } catch (err) {}
  }, [sessionId]);

  const updatePnL = useCallback(async (pnl) => {
    try {
      await fetch(`${API_BASE}/api/risk/session/${sessionId}/pnl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pnl })
      });
    } catch (err) {}
  }, [sessionId]);

  return { checkOrder, updatePosition, updatePnL, lastCheckResult, isChecking };
};

export default useRiskCheck;
