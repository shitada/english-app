import { useState, useEffect } from 'react';
import { api, type GrammarWeakSpotsResponse, type GrammarCategoryItem } from '../../api';

function trendBadge(trend: string): string {
  switch (trend) {
    case 'improving': return '🟢';
    case 'declining': return '🔴';
    case 'new': return '🆕';
    default: return '⚪';
  }
}

function trendLabel(trend: string): string {
  switch (trend) {
    case 'improving': return 'Improving';
    case 'declining': return 'Declining';
    case 'new': return 'New';
    default: return 'Stable';
  }
}

function barColor(trend: string): string {
  switch (trend) {
    case 'improving': return '#10b981';
    case 'declining': return '#ef4444';
    case 'new': return '#8b5cf6';
    default: return '#6b7280';
  }
}

export function GrammarWeakSpots() {
  const [data, setData] = useState<GrammarWeakSpotsResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.getDashboardGrammarWeakSpots().then(setData).catch(() => {});
  }, []);

  if (!data || data.total_errors === 0) return null;

  const maxCount = Math.max(...data.categories.map(c => c.total_count), 1);
  const visibleCategories = expanded ? data.categories : data.categories.slice(0, 5);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        🎯 Grammar Weak Spots
      </h3>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
            {data.total_errors}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Errors</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
            {data.category_count}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Categories</div>
        </div>
        <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>
            {data.most_common_category || '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Most Common</div>
        </div>
      </div>

      {/* Category bar chart */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visibleCategories.map((cat: GrammarCategoryItem) => (
          <div key={cat.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {trendBadge(cat.trend)} {cat.name}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {cat.total_count} errors · {trendLabel(cat.trend)}
              </span>
            </div>
            <div style={{ width: '100%', height: 20, background: 'var(--bg-secondary)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div
                style={{
                  width: `${(cat.total_count / maxCount) * 100}%`,
                  height: '100%',
                  background: barColor(cat.trend),
                  borderRadius: 6,
                  transition: 'width 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  position: 'relative',
                }}
              />
              {/* Recent vs older split indicator */}
              {cat.recent_count > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${(cat.recent_count / maxCount) * 100}%`,
                    height: '100%',
                    background: barColor(cat.trend),
                    opacity: 1,
                    borderRadius: 6,
                  }}
                />
              )}
              {cat.older_count > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: `${(cat.recent_count / maxCount) * 100}%`,
                    width: `${(cat.older_count / maxCount) * 100}%`,
                    height: '100%',
                    background: barColor(cat.trend),
                    opacity: 0.4,
                    borderRadius: cat.recent_count === 0 ? 6 : '0 6px 6px 0',
                  }}
                />
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              <span>Recent: {cat.recent_count}</span>
              <span>Older: {cat.older_count}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Expand/collapse */}
      {data.categories.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 12,
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            padding: 0,
          }}
        >
          {expanded ? '▲ Show less' : `▼ Show all ${data.categories.length} categories`}
        </button>
      )}
    </div>
  );
}
