import { useRef, useState, useEffect, type ReactNode } from 'react';

/**
 * Hook that uses IntersectionObserver to detect when an element scrolls near
 * the viewport.  Once visible the flag latches — the component stays mounted
 * even if the user scrolls away.
 */
export function useLazyLoad(rootMargin = '200px') {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, isVisible };
}

/**
 * Wrapper component that defers rendering its children until the element
 * scrolls within 200 px of the viewport.  While hidden a skeleton card
 * placeholder is shown instead.
 */
export function LazySection({ children, height = 200 }: { children: ReactNode; height?: number }) {
  const { ref, isVisible } = useLazyLoad();

  return (
    <div ref={ref}>
      {isVisible ? (
        children
      ) : (
        <div
          className="skeleton skeleton-card"
          style={{ height, marginBottom: 16, borderRadius: 12 }}
        />
      )}
    </div>
  );
}
