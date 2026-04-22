'use client';

import { useEffect, useRef, useCallback } from 'react';

const IDLE_MS    = 15 * 60 * 1000; // 15 minutes
const WARNING_MS = 14 * 60 * 1000; // warn at 14 minutes (1 min before logout)

const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

/**
 * Calls onWarning after 14 min of inactivity, onLogout after 15 min.
 * Resets timer on any user interaction.
 * Calling reset() manually resets the timer (e.g. user clicks "Stay logged in").
 */
export function useIdleLogout({ onLogout, onWarning, onActive }) {
  const logoutTimer  = useRef(null);
  const warningTimer = useRef(null);

  const reset = useCallback(() => {
    clearTimeout(logoutTimer.current);
    clearTimeout(warningTimer.current);
    if (onActive) onActive();

    warningTimer.current = setTimeout(() => {
      if (onWarning) onWarning();
    }, WARNING_MS);

    logoutTimer.current = setTimeout(() => {
      if (onLogout) onLogout();
    }, IDLE_MS);
  }, [onLogout, onWarning, onActive]);

  useEffect(() => {
    reset();
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(logoutTimer.current);
      clearTimeout(warningTimer.current);
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [reset]);

  return { reset };
}
