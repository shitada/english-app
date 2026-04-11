import { useState, useEffect } from 'react';
import { api, type PronunciationProgress, type ScoreTrendResponse, type PronunciationDifficultyProgressResponse } from '../../api';

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
  if (score >= 8) return '#10b981';
  if (score >= 6) return '#6366f1';
  if (score >= 4) return '#f59e0b';
  return '#ef4444';
}

export function PronunciationProgress() {
  const [progress, setProgress] = useState<PronunciationProgress | null>(null);
  const [trend, setTrend] = useState<ScoreTrendResponse | null>(null);
  const [difficulty, setDifficulty] = useState<PronunciationDifficultyProgressResponse | null>(null);

  useEffect(() => {
    api.getPronunciationProgress().then(setProgress).catch(() => {});
    api.getPronunciationScoreTrend().then(setTrend).catch(() => {});
    api.getPronunciationDifficultyProgress().then(setDifficulty).catch(() => {});
  }, []);

  if (!progress || progress.total_attempts === 0) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🎙️ Pronunciation Progress
        {trend && (
          <span style={{ fontSize: 14, fontWeight: 'normal', color: 'var(--text-secondary)' }}>
            {trendEmoji[trend.trend] || '📊'} {trendLabel[trend.trend] || trend.trend}
          </span>
        )}
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{progress.total_attempts}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Attempts</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor(progress.avg_score) }}>{progress.avg_score}/10</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Avg Score</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor(progress.best_score) }}>{progress.best_score}/10</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Best Score</div>
        </div>
      </div>

      {difficulty && difficulty.items.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>By Difficulty</h4>
          {difficulty.items.map((d) => (
            <div key={d.difficulty} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', minWidth: 100 }}>
                {d.difficulty}
              </span>
              <div style={{ flex: 1, height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(d.avg_score * 10, 100)}%`,
                    height: '100%',
                    background: scoreColor(d.avg_score),
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 70, textAlign: 'right' }}>
                {d.avg_score}/10 ({d.attempt_count})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
