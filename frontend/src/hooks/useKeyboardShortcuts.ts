import { useEffect, useRef } from 'react';

interface ShortcutDescriptor {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  handler: () => void;
  enabled?: boolean;
  /** If true, shortcut fires even when an input/textarea is focused */
  allowInInput?: boolean;
}

export function useKeyboardShortcuts(shortcuts: ShortcutDescriptor[]) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      for (const s of shortcutsRef.current) {
        if (s.enabled === false) continue;
        if (inInput && !s.allowInInput) continue;
        if (e.key !== s.key) continue;
        if (s.ctrlKey && !e.ctrlKey && !e.metaKey) continue;
        if (s.metaKey && !e.metaKey) continue;
        if (s.shiftKey && !e.shiftKey) continue;

        e.preventDefault();
        s.handler();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
