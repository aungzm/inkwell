import { useEffect, useState } from 'react';

type PauseDetectorOptions = {
  enabled: boolean;
  isDrawing: boolean;
  lastInteractionAt: number | null;
  thresholdMs?: number;
  onPause: () => void;
};

export function usePauseDetector({
  enabled,
  isDrawing,
  lastInteractionAt,
  thresholdMs = 500,
  onPause,
}: PauseDetectorOptions) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || isDrawing || lastInteractionAt === null) {
      setTimeLeft(null);
      return;
    }

    const tick = () => {
      const remaining = thresholdMs - (Date.now() - lastInteractionAt);
      if (remaining <= 0) {
        onPause();
        setTimeLeft(0);
        return;
      }

      setTimeLeft(remaining);
    };

    tick();
    const timer = window.setInterval(tick, 60);
    return () => window.clearInterval(timer);
  }, [enabled, isDrawing, lastInteractionAt, onPause, thresholdMs]);

  return timeLeft;
}
