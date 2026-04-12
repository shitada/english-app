import { useState, useEffect } from 'react';
import { api, type TopicCoverageResponse, type TopicCoverageItem } from '../../api';

const TOPIC_EMOJIS: Record<string, string> = {
  hotel_checkin: '🏨',
  restaurant_order: '🍽️',
  job_interview: '💼',
  doctor_visit: '🏥',
  shopping: '🛍️',
  airport: '✈️',
};

function proficiencyColor(count: number): string {
  if (count === 0) return 'var(--text-secondary)';
  if (count <= 2) return '#f59e0b';
  return '#10b981';
}

function proficiencyBg(count: number): string {
  if (count === 0) return 'var(--bg-secondary)';
  if (count <= 2) return 'rgba(245, 158, 11, 0.1)';
  return 'rgba(16, 185, 129, 0.1)';
}

export function TopicCoverageMap() {
  const [data, setData] = useState<TopicCoverageResponse | null>(null);

  useEffect(() => {
    api.getDashboardTopicCoverage().then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🗺️ Topic Coverage
      </h3>

      {/* Coverage summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {data.practiced_count}/{data.total_topics} topics practiced
            </span>
            <span style={{ fontWeight: 600 }}>{Math.round(data.coverage_rate)}%</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${data.coverage_rate}%`,
                height: '100%',
                background: data.coverage_rate === 100 ? '#10b981' : '#3b82f6',
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* Topic grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 10,
      }}>
        {data.topics.map((topic: TopicCoverageItem) => (
          <div
            key={topic.topic_id}
            style={{
              padding: 12,
              borderRadius: 10,
              background: proficiencyBg(topic.practice_count),
              border: `1px solid ${topic.practice_count === 0 ? 'var(--bg-secondary)' : proficiencyColor(topic.practice_count)}`,
              textAlign: 'center',
              transition: 'transform 0.15s ease',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 4 }}>
              {TOPIC_EMOJIS[topic.topic_id] || '💬'}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {topic.label}
            </div>
            {topic.practice_count > 0 ? (
              <>
                <div style={{ fontSize: 12, color: proficiencyColor(topic.practice_count), fontWeight: 600 }}>
                  {topic.practice_count} session{topic.practice_count !== 1 ? 's' : ''}
                </div>
                {topic.grammar_accuracy != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    Grammar: {Math.round(topic.grammar_accuracy)}%
                  </div>
                )}
              </>
            ) : (
              <a
                href="/conversation"
                style={{
                  fontSize: 12,
                  color: '#3b82f6',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Try it →
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
