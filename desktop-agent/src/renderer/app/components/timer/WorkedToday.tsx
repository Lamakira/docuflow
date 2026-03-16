import React, { useEffect, useState } from 'react';
import { formatTime } from '../../types';

export function WorkedToday() {
  const [total, setTotal] = useState(0);

  async function refresh() {
    try {
      const result = await window.agentBridge.getWorkedToday();
      if (result.ok) setTotal(result.total);
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="worked-today">
      <span className="worked-today__label">Worked today</span>
      <span className="worked-today__value">{formatTime(total)}</span>
    </div>
  );
}
