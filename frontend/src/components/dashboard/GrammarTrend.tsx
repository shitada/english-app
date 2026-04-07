import { type GrammarTrendItem } from '../../api';

interface Props {
  conversations: GrammarTrendItem[];
  trend: string;
}

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

function accuracyColor(rate: number): string {
  if (rate >= 80) return '#10b981';
  if (rate >= 60) return '#f59e0b';
  return '#ef4444';
}

export function GrammarTrend({ conversations, trend }: Props) {
  if (conversations.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Grammar Trend</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Complete some conversations to see your grammar trend here.
        </p>
      </div>
    );
  }

  const first = conversations[0];
  const last = conversations[conversations.length - 1];

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Grammar Trend</h3>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          {trendEmoji[trend] ?? '📊'} {trendLabel[trend] ?? trend}
        </span>
      </div>

      {conversations.length >= 3 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          {first.accuracy_rate}% → {last.accuracy_rate}% over last {conversations.length} conversations
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {conversations.map((c) => (
          <div key={c.conversation_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 60, textAlign: 'right' }}>
              {c.started_at?.slice(0, 10) ?? ''}
            </span>
            <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 18, position: 'relative', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${c.accuracy_rate}%`,
                  height: '100%',
                  background: accuracyColor(c.accuracy_rate),
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
                color: c.accuracy_rate > 50 ? '#fff' : 'var(--text-primary)',
              }}>
                {c.accuracy_rate}%
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 30 }}>
              {c.checked_count}msg
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
