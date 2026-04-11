import { useState, useEffect } from 'react';
import { api, type LearningVelocityResponse, type WeeklyActivityData } from '../../api';

const ACTIVITY_COLORS = {
  new_words: '#6366f1',
  quiz_attempts: '#10b981',
  conversations: '#f59e0b',
  pronunciation_attempts: '#ec4899',
};

const ACTIVITY_LABELS: Record<string, string> = {
  new_words: 'Words',
  quiz_attempts: 'Quizzes',
  conversations: 'Conversations',
  pronunciation_attempts: 'Pronunciation',
};

function trendEmoji(trend: string): string {
  if (trend === 'accelerating') return '🚀';
  if (trend === 'decelerating') return '📉';
  return '➡️';
}

function trendLabel(trend: string): string {
  if (trend === 'accelerating') return 'Accelerating';
  if (trend === 'decelerating') return 'Decelerating';
  return 'Steady';
}

function trendColor(trend: string): string {
  if (trend === 'accelerating') return '#10b981';
  if (trend === 'decelerating') return '#ef4444';
  return '#6366f1';
}

export function LearningVelocityCard() {
  const [data, setData] = useState<LearningVelocityResponse | null>(null);

  useEffect(() => {
    api.getDashboardLearningVelocity().then(setData).catch(() => {});
  }, []);

  if (!data || data.total_active_days === 0) return null;

  const pace = data.current_pace;
  const maxWeekTotal = Math.max(
    1,
    ...data.weekly_data.map(
      (w) => w.new_words + w.quiz_attempts + w.conversations + w.pronunciation_attempts
    )
  );

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        ⚡ Learning Velocity
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 12,
            background: `${trendColor(data.trend)}20`,
            color: trendColor(data.trend),
          }}
        >
          {trendEmoji(data.trend)} {trendLabel(data.trend)}
        </span>
      </h3>

      {/* Current pace grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        {([
          { label: 'Words/day', value: pace.words_per_day, color: ACTIVITY_COLORS.new_words },
          { label: 'Quizzes/day', value: pace.quizzes_per_day, color: ACTIVITY_COLORS.quiz_attempts },
          { label: 'Convos/day', value: pace.conversations_per_day, color: ACTIVITY_COLORS.conversations },
          { label: 'Pronun/day', value: pace.pronunciation_per_day, color: ACTIVITY_COLORS.pronunciation_attempts },
        ] as const).map((item) => (
          <div
            key={item.label}
            style={{
              textAlign: 'center',
              padding: '10px 4px',
              background: 'var(--bg-secondary)',
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>
              {item.value.toFixed(1)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Weekly bar chart */}
      {data.weekly_data.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Weekly Activity
          </h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
            {data.weekly_data.map((w: WeeklyActivityData) => {
              const total = w.new_words + w.quiz_attempts + w.conversations + w.pronunciation_attempts;
              const barH = (total / maxWeekTotal) * 72;
              const segments = [
                { key: 'new_words', val: w.new_words, color: ACTIVITY_COLORS.new_words },
                { key: 'quiz_attempts', val: w.quiz_attempts, color: ACTIVITY_COLORS.quiz_attempts },
                { key: 'conversations', val: w.conversations, color: ACTIVITY_COLORS.conversations },
                { key: 'pronunciation_attempts', val: w.pronunciation_attempts, color: ACTIVITY_COLORS.pronunciation_attempts },
              ];
              return (
                <div
                  key={w.week}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                  title={`${w.week}: ${total} activities`}
                >
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 32,
                      height: barH,
                      borderRadius: 4,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column-reverse',
                    }}
                  >
                    {segments.map((s) =>
                      s.val > 0 ? (
                        <div
                          key={s.key}
                          style={{
                            height: total > 0 ? `${(s.val / total) * 100}%` : 0,
                            background: s.color,
                            minHeight: s.val > 0 ? 2 : 0,
                          }}
                        />
                      ) : null
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {w.week.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            {Object.entries(ACTIVITY_COLORS).map(([key, color]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                <span style={{ color: 'var(--text-secondary)' }}>{ACTIVITY_LABELS[key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary line */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
          color: 'var(--text-secondary)',
          padding: '8px 0',
          borderTop: '1px solid var(--bg-secondary)',
        }}
      >
        <span>
          <strong style={{ color: 'var(--text-primary)' }}>{data.total_active_days}</strong> active days
        </span>
        <span>
          <strong style={{ color: 'var(--text-primary)' }}>{data.words_per_study_day.toFixed(1)}</strong> words/study day
        </span>
      </div>
    </div>
  );
}
