const LEVEL_LABELS = ['New', 'Seen', 'Learning', 'Familiar', 'Confident', 'Mastered', 'Expert'];
const LEVEL_COLORS = ['#94a3b8', '#60a5fa', '#a78bfa', '#fbbf24', '#34d399', '#10b981', '#059669'];
const INTERVALS = [0, 1, 3, 7, 14, 30, 60];

export interface SRSChange {
  word: string;
  newLevel: number;
  isCorrect: boolean;
  nextReview: string;
}

interface VocabSRSProgressProps {
  changes: SRSChange[];
}

export default function VocabSRSProgress({ changes }: VocabSRSProgressProps) {
  if (changes.length === 0) return null;

  const leveledUp = changes.filter(c => c.isCorrect).length;
  const leveledDown = changes.filter(c => !c.isCorrect).length;

  return (
    <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 12 }}>
      <h4 style={{ marginBottom: 12 }}>SRS Progress</h4>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: '0.85rem' }}>
        <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600 }}>↑ {leveledUp} leveled up</span>
        <span style={{ color: 'var(--danger, #ef4444)', fontWeight: 600 }}>↓ {leveledDown} leveled down</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {changes.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem' }}>
            <span style={{ fontWeight: 600, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.word}</span>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {LEVEL_LABELS.map((_, lvl) => (
                <div
                  key={lvl}
                  style={{
                    height: 8,
                    flex: 1,
                    borderRadius: 2,
                    background: lvl <= c.newLevel ? LEVEL_COLORS[c.newLevel] : 'var(--border, #e2e8f0)',
                    transition: 'background 0.3s',
                  }}
                  title={`${LEVEL_LABELS[lvl]} — review in ${INTERVALS[lvl]}d`}
                />
              ))}
            </div>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: c.isCorrect ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
              minWidth: 14,
            }}>
              {c.isCorrect ? '↑' : '↓'}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: 70 }}>
              {LEVEL_LABELS[c.newLevel]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
