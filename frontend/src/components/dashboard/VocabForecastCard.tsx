import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, type VocabForecastResponse, type VocabForecastAtRiskWord } from '../../api';

function riskColor(score: number): string {
  if (score >= 60) return '#ef4444';
  if (score >= 30) return '#f59e0b';
  return '#10b981';
}

function retentionColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

export function VocabForecastCard() {
  const [data, setData] = useState<VocabForecastResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.getDashboardVocabForecast().then(setData).catch(() => {});
  }, []);

  if (!data || data.total_reviewed === 0) return null;

  const retentionPct = Math.round(data.avg_retention_score);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🔮 Retention Forecast
      </h3>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: data.at_risk_count > 0 ? '#ef4444' : '#10b981' }}>
            {data.at_risk_count}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>At Risk</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: data.overdue_count > 0 ? '#f59e0b' : '#10b981' }}>
            {data.overdue_count}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Overdue</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: retentionColor(retentionPct) }}>
            {retentionPct}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Retention</div>
        </div>
      </div>

      {/* Retention gauge bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Avg Retention Score</span>
          <span style={{ fontWeight: 600 }}>{retentionPct}%</span>
        </div>
        <div style={{ height: 10, background: 'var(--bg-secondary)', borderRadius: 5, overflow: 'hidden' }}>
          <div
            style={{
              width: `${retentionPct}%`,
              height: '100%',
              background: retentionColor(retentionPct),
              borderRadius: 5,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* At-risk words list */}
      {data.at_risk_words.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {expanded ? '▼' : '▶'} At-Risk Words ({data.at_risk_words.length})
          </button>

          {expanded && (
            <div style={{ marginTop: 8 }}>
              {data.at_risk_words.map((w: VocabForecastAtRiskWord) => (
                <div
                  key={w.word_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--bg-secondary)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{w.word}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {w.meaning}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right', minWidth: 60 }}>
                    {w.days_overdue > 0 ? `${w.days_overdue}d overdue` : 'due soon'}
                  </div>
                  {/* Risk bar */}
                  <div style={{ width: 60, height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(w.risk_score, 100)}%`,
                        height: '100%',
                        background: riskColor(w.risk_score),
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: riskColor(w.risk_score), minWidth: 28, textAlign: 'right' }}>
                    {w.risk_score}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Review button */}
      {data.recommended_review_count > 0 && (
        <Link
          to="/vocabulary"
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: 16,
            padding: '10px 16px',
            background: 'var(--primary)',
            color: '#fff',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Review {data.recommended_review_count} Words Now
        </Link>
      )}
    </div>
  );
}
