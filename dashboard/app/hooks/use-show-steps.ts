'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'autonomy-show-steps';

export function useShowSteps() {
  const [showSteps, setShowSteps] = useState(true);

  const toggleSteps = useCallback(() => {
    setShowSteps((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Initialize from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setShowSteps(stored === 'true');
    }
  }, []);

  // Keyboard shortcut: Cmd+Shift+P / Ctrl+Shift+P (Processing steps)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        toggleSteps();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSteps]);

  return { showSteps, toggleSteps };
}
