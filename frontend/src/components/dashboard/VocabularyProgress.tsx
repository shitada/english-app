import { useState, useEffect } from 'react';
import { getVocabularyStats, type VocabularyStatsResponse } from '../../api';

function masteryColor(pct: number): string {
  if (pct >= 80) return '#10b981';
  if (pct >= 50) return '#6366f1';
  if (pct >= 25) return '#f59e0b';
  return '#ef4444';
}

export function VocabularyProgress() {
  const [stats, setStats] = useState<VocabularyStatsResponse | null>(null);

  useEffect(() => {
    getVocabularyStats().then(setStats).catch(() => {});
  }, []);

  if (!stats || stats.total_words === 0) return null;

  const masteryPct = Math.round((stats.total_mastered / stats.total_words) * 100);
  const accuracyPct = Math.round(stats.accuracy_rate);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        📚 Vocabulary Progress
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.total_words}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Words</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: masteryColor(masteryPct) }}>{stats.total_mastered}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Mastered</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: masteryColor(accuracyPct) }}>{accuracyPct}%</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Accuracy</div>
        </div>
      </div>

      {/* Overall mastery bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Overall Mastery</span>
          <span style={{ fontWeight: 600 }}>{masteryPct}%</span>
        </div>
        <div style={{ height: 10, background: 'var(--bg-secondary)', borderRadius: 5, overflow: 'hidden' }}>
          <div
            style={{
              width: `${masteryPct}%`,
              height: '100%',
              background: masteryColor(masteryPct),
              borderRadius: 5,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Per-topic breakdown */}
      {stats.topic_breakdown.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>By Topic</h4>
          {stats.topic_breakdown.map((t) => {
            const topicPct = t.word_count > 0 ? Math.round((t.mastered_count / t.word_count) * 100) : 0;
            return (
              <div key={t.topic} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', minWidth: 100 }}>
                  {t.topic}
                </span>
                <div style={{ flex: 1, height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${topicPct}%`,
                      height: '100%',
                      background: masteryColor(topicPct),
                      borderRadius: 4,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 80, textAlign: 'right' }}>
                  {t.mastered_count}/{t.word_count} ({topicPct}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
