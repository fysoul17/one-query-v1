'use client';

import { useEffect, useRef, useState } from 'react';

export type TimeWarning = 'none' | 'long' | 'very_long' | 'timeout_risk';

const THRESHOLDS = {
  long: 30_000, // 30s
  very_long: 120_000, // 2 min
  timeout_risk: 240_000, // 4 min (60s before the 300s backend timeout)
};

export function useProcessingTimer(isProcessing: boolean) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isProcessing) {
      startRef.current = Date.now();
      setElapsedMs(0);
      intervalRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startRef.current);
      }, 1000);
    } else {
      setElapsedMs(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isProcessing]);

  const warning: TimeWarning =
    elapsedMs >= THRESHOLDS.timeout_risk
      ? 'timeout_risk'
      : elapsedMs >= THRESHOLDS.very_long
        ? 'very_long'
        : elapsedMs >= THRESHOLDS.long
          ? 'long'
          : 'none';

  return { elapsedMs, warning };
}
