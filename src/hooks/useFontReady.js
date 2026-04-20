'use client';

import { useEffect, useState } from 'react';

// Resolves true once "Noto Sans Devanagari" is loaded and available.
// On iOS WebKit, SVG text fonts are locked at first paint; this hook
// lets chart components delay mounting until the font is confirmed ready.
export function useFontReady() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const done = () => { if (!cancelled) setReady(true); };
    document.fonts.ready.then(done);
    document.fonts.load('1em "Noto Sans Devanagari"').then(done);
    return () => { cancelled = true; };
  }, []);

  return ready;
}
