import { useEffect, useState } from 'react';

type PauseDetectorOptions = {
  enabled: boolean;
  isDrawing: boolean;
  isHovering: boolean;
  lastInteractionAt: number | null;
  thresholdMs?: number;
  onPause: () => void;
};

export function usePauseDetector({
  enabled,
  isDrawing,
  isHovering,
  lastInteractionAt,
  thresholdMs = 1200,
  onPause,
}: PauseDetectorOptions) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || isDrawing || isHovering || lastInteractionAt === null) {
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
  }, [enabled, isDrawing, isHovering, lastInteractionAt, onPause, thresholdMs]);

  return timeLeft;
}
