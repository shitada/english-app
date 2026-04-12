import { useState, useEffect } from 'react';
import { api } from '../../api';
import type { FluencySession } from '../../api';

const trendEmoji: Record<string, string> = {
  improving: '📈',
  declining: '📉',
  stable: '➡️',
  insufficient_data: '📊',
};

const trendLabel: Record<string, string> = {
  improving: 'Improving',
  declining: 'Needs attention',
  stable: 'Stable',
  insufficient_data: 'Not enough data yet',
};

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#6366f1';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreEmoji(score: number): string {
  if (score >= 80) return '🔥';
  if (score >= 60) return '💪';
  if (score >= 40) return '🌱';
  return '🫣';
}

export function FluencyProgressionChart() {
  const [sessions, setSessions] = useState<FluencySession[]>([]);
  const [trend, setTrend] = useState('insufficient_data');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardFluencyProgression(30)
      .then((data) => {
        setSessions(data.sessions);
        setTrend(data.trend);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Fluency Progression</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Fluency Progression</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Complete some conversations to track your fluency over time.
        </p>
      </div>
    );
  }

  const latestScore = sessions[sessions.length - 1]?.fluency_score ?? 0;
  const roundedScore = Math.round(latestScore);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Fluency Progression</h3>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          {trendEmoji[trend] ?? '📊'} {trendLabel[trend] ?? trend}
        </span>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 48, fontWeight: 700, color: scoreColor(roundedScore) }}>
          {roundedScore}
        </span>
        <span style={{ fontSize: 28, marginLeft: 4 }}>{scoreEmoji(roundedScore)}</span>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
          Current fluency score (out of 100)
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sessions.map((s) => (
          <div key={s.conversation_id}>
            <div
              onClick={() => setExpandedId(expandedId === s.conversation_id ? null : s.conversation_id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 60, textAlign: 'right' }}>
                {s.date?.slice(0, 10) ?? ''}
              </span>
              <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 18, position: 'relative', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(s.fluency_score, 100)}%`,
                    height: '100%',
                    background: scoreColor(s.fluency_score),
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }}
                />
                <span style={{
                  position: 'absolute',
                  right: 6,
                  top: 0,
                  lineHeight: '18px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: s.fluency_score > 50 ? '#fff' : 'var(--text-primary)',
                }}>
                  {Math.round(s.fluency_score)}
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 50, textTransform: 'capitalize' }}>
                {s.topic}
              </span>
              {s.personal_best && <span title="Personal best" style={{ fontSize: 13 }}>⭐</span>}
            </div>
            {expandedId === s.conversation_id && (
              <div style={{ marginLeft: 68, marginTop: 4, marginBottom: 4, padding: '6px 10px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                  <span>📝 Grammar: <strong>{Math.round(s.grammar_accuracy_rate)}%</strong></span>
                  <span>📚 Vocab Diversity: <strong>{s.vocabulary_diversity.toFixed(1)}</strong></span>
                  <span>💬 Avg Words/Msg: <strong>{s.avg_words_per_message.toFixed(1)}</strong></span>
                  <span>🗣️ Messages: <strong>{s.total_user_messages}</strong></span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
