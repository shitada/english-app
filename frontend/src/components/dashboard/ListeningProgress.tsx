import { useState, useEffect } from 'react';
import { getListeningProgress, type ListeningProgressResponse } from '../../api';

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

export function ListeningProgress() {
  const [data, setData] = useState<ListeningProgressResponse | null>(null);

  useEffect(() => {
    getListeningProgress().then(setData).catch(() => {});
  }, []);

  if (!data || data.total_quizzes === 0) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🎧 Listening Progress
        <span style={{ fontSize: 14, fontWeight: 'normal', color: 'var(--text-secondary)' }}>
          {trendEmoji[data.trend] || '📊'} {trendLabel[data.trend] || data.trend}
        </span>
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.total_quizzes}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quizzes Taken</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor(data.avg_score) }}>{data.avg_score}%</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Avg Score</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor(data.best_score) }}>{data.best_score}%</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Best Score</div>
        </div>
      </div>

      {data.by_difficulty.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>By Difficulty</h4>
          {data.by_difficulty.map((d) => (
            <div key={d.difficulty} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', minWidth: 100 }}>
                {d.difficulty}
              </span>
              <div style={{ flex: 1, height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(d.avg_score, 100)}%`,
                    height: '100%',
                    background: scoreColor(d.avg_score),
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 60, textAlign: 'right' }}>
                {d.avg_score}% ({d.count})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
