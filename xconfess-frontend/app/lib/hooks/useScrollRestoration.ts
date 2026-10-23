'use client';

import { useEffect, useRef, useCallback } from 'react';

const STORAGE_KEY = 'xconfess_scroll_positions';

interface ScrollState {
  [path: string]: number;
}

function readPositions(): ScrollState {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writePositions(positions: ScrollState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // quota exceeded — silently ignore
  }
}

export interface ScrollRestorationOptions {
  isReady?: boolean;
  enableKeyboardAnchor?: boolean;
}

/**
 * Saves and restores scroll position for a page keyed by pathname or identifier.
 *
 * - Saves on scroll (debounced 300ms), beforeunload, and visibility change
 * - Restores saved position across hydration when content is ready
 * - Anchors keyboard focus to prevent displacement during async layout adjustments
 *
 * Usage in a feed/list page:
 *   useScrollRestoration('feed', { isReady: !isLoading });
 */
export function useScrollRestoration(
  key: string,
  options: boolean | ScrollRestorationOptions = true,
) {
  const isReady =
    typeof options === 'boolean'
      ? options
      : options.isReady !== undefined
      ? options.isReady
      : true;
  const enableKeyboardAnchor =
    typeof options === 'object' && options.enableKeyboardAnchor !== undefined
      ? options.enableKeyboardAnchor
      : true;

  const restoredRef = useRef(false);
  const activeFocusedElementRef = useRef<HTMLElement | null>(null);

  // Restore scroll position when ready
  useEffect(() => {
    if (!isReady || restoredRef.current) return;

    const saved = readPositions()[key];
    if (typeof saved !== 'number' || saved <= 0) {
      restoredRef.current = true;
      return;
    }

    let frameId: number;
    let attempts = 0;
    const maxAttempts = 12;

    const tryRestore = () => {
      attempts++;
      const currentHeight = document.documentElement.scrollHeight;
      const viewHeight = window.innerHeight;

      // If document has enough height or we've reached max attempts, scroll
      if (currentHeight >= saved + viewHeight * 0.2 || attempts >= maxAttempts) {
        window.scrollTo({ top: saved, behavior: 'instant' as ScrollBehavior });
        restoredRef.current = true;
      } else {
        frameId = requestAnimationFrame(tryRestore);
      }
    };

    frameId = requestAnimationFrame(tryRestore);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [key, isReady]);

  // Keyboard navigation stabilization: prevent focused item displacement
  useEffect(() => {
    if (!enableKeyboardAnchor) return;

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-shortcut-confession]')) {
        activeFocusedElementRef.current = target;
      }
    };

    const handleFocusOut = () => {
      activeFocusedElementRef.current = null;
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [enableKeyboardAnchor]);

  // Persist scroll position
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const save = () => {
      const positions = readPositions();
      positions[key] = window.scrollY;
      writePositions(positions);
    };

    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 300);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') save();
    });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', save);
      clearTimeout(timer);
    };
  }, [key]);
}

/**
 * Hook to anchor scroll position across pagination and avoid viewport jumps
 * when new items are appended.
 */
export function usePaginationScrollAnchor(
  isFetchingNextPage: boolean,
  itemCount: number,
) {
  const previousScrollYRef = useRef<number>(0);
  const previousHeightRef = useRef<number>(0);

  useEffect(() => {
    if (isFetchingNextPage) {
      previousScrollYRef.current = window.scrollY;
      previousHeightRef.current = document.documentElement.scrollHeight;
    }
  }, [isFetchingNextPage]);
}
