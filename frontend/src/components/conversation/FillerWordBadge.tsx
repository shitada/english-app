import { useState, useRef, useEffect } from 'react';

interface FillerWordBadgeProps {
  /** Total filler words counted so far in the session. */
  fillerCount: number;
  /** Per-word breakdown, e.g. { "um": 3, "like": 1 }. */
  fillerDetails: Record<string, number>;
}

/**
 * A small, non-intrusive badge that displays the session filler-word count.
 *
 * - Green (0–2): Great job keeping fillers low.
 * - Yellow (3–5): A few fillers crept in.
 * - Red (6+): Lots of fillers – something to work on.
 *
 * Hovering / clicking reveals a popover with the per-word breakdown.
 */
export function FillerWordBadge({ fillerCount, fillerDetails }: FillerWordBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const color =
    fillerCount <= 2
      ? 'var(--success, #22c55e)'
      : fillerCount <= 5
        ? 'var(--warning, #f59e0b)'
        : 'var(--danger, #ef4444)';

  const entries = Object.entries(fillerDetails).sort((a, b) => b[1] - a[1]);

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      <button
        type="button"
        aria-label={`${fillerCount} filler words detected`}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          color: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
        }}
        data-testid="filler-word-badge"
      >
        🫢 <strong style={{ color }}>{fillerCount}</strong>{' '}
        {fillerCount === 1 ? 'filler' : 'fillers'}
      </button>

      {open && entries.length > 0 && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 6,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            padding: '8px 12px',
            minWidth: 140,
            zIndex: 50,
            fontSize: '0.8rem',
          }}
          data-testid="filler-word-popover"
        >
          <div style={{ fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap' }}>Filler breakdown</div>
          {entries.map(([word, count]) => (
            <div key={word} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>"{word}"</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
