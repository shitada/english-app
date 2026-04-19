import { useRef, useState } from 'react';

/**
 * "Share Today's Progress" card (frontend-only, no new endpoints).
 *
 * Renders a compact summary (date, streak, minutes today, words reviewed today,
 * top skill) with two actions:
 *   - Copy text  -> navigator.clipboard.writeText (with insecure-context fallback)
 *   - Download PNG -> 600x315 offscreen canvas (no external deps)
 *
 * Rows whose value is undefined are hidden. A transient "Copied!" / "Saved!"
 * confirmation is announced via role="status" aria-live="polite".
 *
 * Pure helpers (formatShareText, drawShareCanvas, fileNameForDate) are exported
 * so they can be unit-tested without DOM.
 */

export interface ShareProgressCardProps {
  /** ISO date string (YYYY-MM-DD). Defaults to today (local). */
  date?: string;
  streak?: number;
  /** Minutes practiced today. Hidden if undefined. */
  minutesToday?: number;
  /** Words reviewed today. Hidden if undefined. */
  wordsToday?: number;
  /** Top skill label, e.g. "Speaking". Hidden if undefined. */
  topSkill?: string;
}

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 315;

export function todayIsoLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fileNameForDate(date: string): string {
  return `english-app-progress-${date}.png`;
}

/** Build the multi-line text used by the Copy button and the PNG. */
export function formatShareText(props: ShareProgressCardProps): string {
  const date = props.date ?? todayIsoLocal();
  const lines: string[] = [`English App — Daily Progress`, `Date: ${date}`];
  if (typeof props.streak === 'number') {
    lines.push(`Streak: ${props.streak} day${props.streak === 1 ? '' : 's'} 🔥`);
  }
  if (typeof props.minutesToday === 'number') {
    lines.push(`Minutes today: ${props.minutesToday}`);
  }
  if (typeof props.wordsToday === 'number') {
    lines.push(`Words reviewed today: ${props.wordsToday}`);
  }
  if (props.topSkill) {
    lines.push(`Top skill: ${props.topSkill}`);
  }
  return lines.join('\n');
}

/**
 * Draw the share card onto the supplied canvas (must be 600x315).
 * Uses Canvas 2D API only — no external dependencies.
 * Exported for testing with mocked getContext.
 */
export function drawShareCanvas(
  canvas: HTMLCanvasElement,
  props: ShareProgressCardProps,
): void {
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Gradient background (fixed colors — independent of theme).
  const grad = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  grad.addColorStop(0, '#6366f1');
  grad.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Header
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 28px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('English App — Daily Progress', 32, 28);

  ctx.font = '16px system-ui, -apple-system, "Segoe UI", sans-serif';
  const date = props.date ?? todayIsoLocal();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(date, 32, 66);

  // Stats — only render rows whose value is present.
  const rows: { label: string; value: string }[] = [];
  if (typeof props.streak === 'number') {
    rows.push({ label: 'Streak', value: `${props.streak} day${props.streak === 1 ? '' : 's'}` });
  }
  if (typeof props.minutesToday === 'number') {
    rows.push({ label: 'Minutes today', value: String(props.minutesToday) });
  }
  if (typeof props.wordsToday === 'number') {
    rows.push({ label: 'Words reviewed today', value: String(props.wordsToday) });
  }
  if (props.topSkill) {
    rows.push({ label: 'Top skill', value: props.topSkill });
  }

  let y = 120;
  const rowHeight = 40;
  for (const row of rows) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '16px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(row.label, 32, y);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(row.value, 280, y - 4);
    y += rowHeight;
  }

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('Keep learning every day ✨', 32, CANVAS_HEIGHT - 36);
}

/** Copy text to clipboard with insecure-context fallback. Resolves true on success. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

export function ShareProgressCard(props: ShareProgressCardProps) {
  const date = props.date ?? todayIsoLocal();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string>('');

  const showStatus = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 2000);
  };

  const handleCopy = async () => {
    const text = formatShareText({ ...props, date });
    const ok = await copyTextToClipboard(text);
    showStatus(ok ? 'Copied!' : 'Copy failed');
  };

  const handleDownload = () => {
    const canvas = canvasRef.current ?? document.createElement('canvas');
    drawShareCanvas(canvas, { ...props, date });
    canvas.toBlob((blob) => {
      if (!blob) {
        showStatus('Save failed');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameForDate(date);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after the click has been processed.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showStatus('Saved!');
    }, 'image/png');
  };

  const rows: { key: string; label: string; value: string }[] = [];
  if (typeof props.streak === 'number') {
    rows.push({ key: 'streak', label: 'Streak', value: `${props.streak} day${props.streak === 1 ? '' : 's'} 🔥` });
  }
  if (typeof props.minutesToday === 'number') {
    rows.push({ key: 'minutes', label: 'Minutes today', value: String(props.minutesToday) });
  }
  if (typeof props.wordsToday === 'number') {
    rows.push({ key: 'words', label: 'Words reviewed today', value: String(props.wordsToday) });
  }
  if (props.topSkill) {
    rows.push({ key: 'top', label: 'Top skill', value: props.topSkill });
  }

  return (
    <div
      className="card"
      data-testid="share-progress-card"
      style={{ marginBottom: 24 }}
    >
      <h3 style={{ marginBottom: 8 }}>Share Today's Progress</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
        {date}
      </p>

      <div style={{ marginBottom: 16 }}>
        {rows.map((r) => (
          <div
            key={r.key}
            data-testid={`share-row-${r.key}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 14,
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
            <span style={{ fontWeight: 600 }}>{r.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCopy}
          data-testid="share-copy-btn"
        >
          Copy text
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleDownload}
          data-testid="share-download-btn"
        >
          Download PNG
        </button>
        <span
          role="status"
          aria-live="polite"
          data-testid="share-status"
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            minHeight: 18,
            marginLeft: 4,
          }}
        >
          {status}
        </span>
      </div>

      {/* Hidden canvas reused across downloads. */}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </div>
  );
}

export default ShareProgressCard;
