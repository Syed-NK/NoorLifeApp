import { useCallback, useEffect, useState } from 'react';

/**
 * Resend cooldown timer.
 *
 * Both Verify Email and Reset Link Sent show a `Resend … (00:45)` control, so the countdown lives
 * here rather than twice. It starts immediately on mount, because a code or link has just been sent
 * at the moment either screen appears.
 *
 * The interval is cleared on unmount, so leaving the screen mid-countdown cannot leave a timer
 * running against an unmounted component.
 */
export function useResendCountdown(seconds: number) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setRemaining((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [remaining]);

  const restart = useCallback(() => {
    setRemaining(seconds);
  }, [seconds]);

  const minutes = Math.floor(remaining / 60);
  const rest = remaining % 60;

  return {
    remaining,
    /** True once the cooldown has elapsed. */
    ready: remaining <= 0,
    /** `mm:ss`, matching the reference's `(00:45)`. */
    label: `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`,
    restart,
  };
}
