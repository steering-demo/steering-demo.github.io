import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * True when the visitor asked for reduced motion.
 *
 * The server snapshot is `false`, so the first client render matches the server HTML and the
 * real value arrives without a hydration mismatch.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export interface AnimatedNumbersOptions {
  duration?: number;
  /** When false, values jump straight to the target. */
  enabled?: boolean;
  /** Change this to snap instead of tween - used when switching scenarios. */
  snapKey?: string;
}

/**
 * Eases an array of numbers toward `target`.
 *
 * Each new target re-bases the tween on whatever is currently on screen and cancels the frame
 * already scheduled, so dragging the slider quickly never queues stale animations - there is
 * only ever one tween, and it always starts from the visible state. Callers keep using the
 * real target for text and ARIA, so the semantic state is never delayed by the animation.
 */
export function useAnimatedNumbers(
  target: number[],
  { duration = 200, enabled = true, snapKey = '' }: AnimatedNumbersOptions = {},
): number[] {
  const [display, setDisplay] = useState<number[]>(target);
  const displayRef = useRef<number[]>(target);
  const frameRef = useRef<number | null>(null);
  const snapKeyRef = useRef<string>(snapKey);

  displayRef.current = display;

  const targetKey = target.join(',');
  const shapeChanged = display.length !== target.length;

  useEffect(() => {
    const cancel = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    cancel();

    // A new scenario is a different subject, not a change in degree: jump rather than tween.
    const scenarioChanged = snapKeyRef.current !== snapKey;
    snapKeyRef.current = snapKey;

    if (!enabled || shapeChanged || scenarioChanged || duration <= 0) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const from = displayRef.current;
    if (from.every((value, i) => value === target[i])) return;

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(progress);
      const next = target.map((value, i) => {
        const base = from[i] ?? value;
        return base + (value - base) * eased;
      });
      displayRef.current = next;
      setDisplay(next);
      frameRef.current = progress < 1 ? requestAnimationFrame(step) : null;
    };
    frameRef.current = requestAnimationFrame(step);

    return cancel;
    // `targetKey` stands in for `target`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, snapKey, enabled, duration, shapeChanged]);

  return display;
}

/** Observed content width of an element, or 0 before measurement. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/**
 * Trailing-edge debounce, used to keep the polite live region from narrating every frame of a
 * slider drag. Only the value the visitor lands on is announced.
 */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
