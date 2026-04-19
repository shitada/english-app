import { useI18n } from '../../i18n/I18nContext';

interface PaceBadgeProps {
  /** Words-per-minute computed for the user's spoken turn. */
  wpm: number;
}

/**
 * Per-turn pace badge shown under user messages submitted via the mic.
 *
 * Buckets:
 *   < 90  WPM  → 🐢 Slow & clear (info)
 *   90–160 WPM → ✅ Natural      (success)
 *   > 160 WPM  → ⚡ Fast — slow down (warning)
 */
export function PaceBadge({ wpm }: PaceBadgeProps) {
  const { t } = useI18n();
  if (!wpm || wpm <= 0) return null;

  let label: string;
  let emoji: string;
  let bg: string;
  let fg: string;
  let tip: string;

  if (wpm < 90) {
    label = t('paceSlowClear');
    emoji = '🐢';
    bg = 'rgba(59,130,246,0.12)';
    fg = 'var(--info, #3b82f6)';
    tip = t('paceTipSlow');
  } else if (wpm <= 160) {
    label = t('paceNatural');
    emoji = '✅';
    bg = 'rgba(34,197,94,0.12)';
    fg = 'var(--success, #22c55e)';
    tip = t('paceTipNatural');
  } else {
    label = t('paceFast');
    emoji = '⚡';
    bg = 'rgba(245,158,11,0.15)';
    fg = 'var(--warning, #f59e0b)';
    tip = t('paceTipFast');
  }

  const wpmRounded = Math.round(wpm);

  return (
    <span
      data-testid="pace-badge"
      title={`${tip} (${wpmRounded} ${t('paceWpmUnit')})`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        marginTop: 4,
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
      <span style={{ opacity: 0.7, fontWeight: 500 }}>· {wpmRounded} {t('paceWpmUnit')}</span>
    </span>
  );
}

export default PaceBadge;
