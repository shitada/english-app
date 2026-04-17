import { useState, useEffect } from 'react';
import { getCEFREstimate, type CEFREstimateResponse } from '../../api';

const LEVEL_COLORS: Record<string, string> = {
  A1: '#ef4444',
  A2: '#f59e0b',
  B1: '#3b82f6',
  B2: '#6366f1',
  C1: '#8b5cf6',
  C2: '#10b981',
};

function scoreBarColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#6366f1';
  if (score >= 25) return '#f59e0b';
  return '#ef4444';
}

const SUB_SCORE_LABELS: { key: keyof CEFREstimateResponse['sub_scores']; label: string; emoji: string }[] = [
  { key: 'grammar', label: 'Grammar', emoji: '📝' },
  { key: 'vocabulary', label: 'Vocabulary', emoji: '📚' },
  { key: 'pronunciation', label: 'Pronunciation', emoji: '🎙️' },
  { key: 'fluency', label: 'Fluency', emoji: '💬' },
  { key: 'listening', label: 'Listening', emoji: '🎧' },
];

export function CEFRLevelCard() {
  const [data, setData] = useState<CEFREstimateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCEFREstimate()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <div className="skeleton" style={{ width: 80, height: 80, borderRadius: '50%', margin: '0 auto 12px' }} />
        <div className="skeleton" style={{ width: 140, height: 16, margin: '0 auto 8px' }} />
        <div className="skeleton" style={{ width: 200, height: 12, margin: '0 auto' }} />
      </div>
    );
  }

  if (!data) return null;

  const levelColor = LEVEL_COLORS[data.level] || '#6b7280';

  return (
    <div className="card" data-testid="cefr-level-card">
      <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        🎯 CEFR English Level
      </h3>

      {/* Large circular level badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 20 }}>
        <div
          style={{
            width: 90,
            height: 90,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${levelColor}22, ${levelColor}44)`,
            border: `3px solid ${levelColor}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 800, color: levelColor }}>{data.level}</div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600 }}>{Math.round(data.overall_score)}/100</div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{data.level_label}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Progress to {data.next_level}
          </div>
          {/* Progress bar */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(data.progress_to_next, 100)}%`,
                height: '100%',
                background: levelColor,
                borderRadius: 6,
                transition: 'width 0.5s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            {Math.round(data.progress_to_next)}% toward {data.next_level}
          </div>
        </div>
      </div>

      {/* Sub-score breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {SUB_SCORE_LABELS.map(({ key, label, emoji }) => {
          const score = data.sub_scores[key];
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, width: 22 }}>{emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 600, width: 110 }}>{label}</span>
              <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(score, 100)}%`,
                    height: '100%',
                    background: scoreBarColor(score),
                    borderRadius: 4,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, width: 36, textAlign: 'right', color: scoreBarColor(score) }}>
                {Math.round(score)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Focus tip */}
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          fontSize: 13,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        💡 {data.focus_tip}
      </div>
    </div>
  );
}
