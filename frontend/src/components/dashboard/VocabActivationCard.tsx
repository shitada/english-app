import { useState, useEffect } from 'react';
import { api, type VocabularyActivationResponse, type ActivatedWordItem, type TopicActivationItem } from '../../api';

function rateColor(rate: number): string {
  if (rate >= 60) return '#10b981';
  if (rate >= 30) return '#f59e0b';
  return '#ef4444';
}

export function VocabActivationCard() {
  const [data, setData] = useState<VocabularyActivationResponse | null>(null);
  const [showActivated, setShowActivated] = useState(false);
  const [showUnactivated, setShowUnactivated] = useState(false);

  useEffect(() => {
    api.getDashboardVocabActivation().then(setData).catch(() => {});
  }, []);

  if (!data || data.total_studied === 0) return null;

  const ratePct = Math.round(data.activation_rate);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🔗 Vocabulary Activation
      </h3>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.total_studied}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Studied</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{data.total_activated}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Activated</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: rateColor(ratePct) }}>{ratePct}%</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Rate</div>
        </div>
      </div>

      {/* Activation rate bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Activation Rate</span>
          <span style={{ fontWeight: 600 }}>{ratePct}%</span>
        </div>
        <div style={{ height: 10, background: 'var(--bg-secondary)', borderRadius: 5, overflow: 'hidden' }}>
          <div
            style={{
              width: `${ratePct}%`,
              height: '100%',
              background: rateColor(ratePct),
              borderRadius: 5,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Per-topic breakdown */}
      {data.by_topic.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>By Topic</div>
          {data.by_topic.map((t: TopicActivationItem) => (
            <div key={t.topic} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.topic}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 60, textAlign: 'right' }}>
                {t.activated}/{t.studied}
              </div>
              <div style={{ width: 60, height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.round(t.rate)}%`,
                    height: '100%',
                    background: rateColor(t.rate),
                    borderRadius: 3,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activated words */}
      {data.activated_words.length > 0 && (
        <div>
          <button
            onClick={() => setShowActivated(!showActivated)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {showActivated ? '▼' : '▶'} Activated Words ({data.activated_words.length})
          </button>
          {showActivated && (
            <div style={{ marginTop: 8 }}>
              {data.activated_words.map((w: ActivatedWordItem) => (
                <div key={w.word} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bg-secondary)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{w.word}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.meaning}</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>×{w.times_used}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unactivated words */}
      {data.unactivated_words.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowUnactivated(!showUnactivated)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {showUnactivated ? '▼' : '▶'} Not Yet Used ({data.unactivated_words.length})
          </button>
          {showUnactivated && (
            <div style={{ marginTop: 8 }}>
              {data.unactivated_words.map((w: ActivatedWordItem) => (
                <div key={w.word} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--bg-secondary)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{w.word}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.meaning}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{w.topic}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
