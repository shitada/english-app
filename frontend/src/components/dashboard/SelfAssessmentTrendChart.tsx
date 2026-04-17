import { useState, useEffect } from 'react';
import { getSelfAssessmentTrend } from '../../api';
import type { SelfAssessmentTrendEntry } from '../../api';

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

const COLORS = {
  confidence: '#3b82f6',   // blue
  fluency: '#10b981',      // green
  comprehension: '#8b5cf6', // purple
};

function ratingEmoji(value: number): string {
  if (value >= 4) return '🔥';
  if (value >= 3) return '💪';
  if (value >= 2) return '🌱';
  return '🫣';
}

export function SelfAssessmentTrendChart() {
  const [entries, setEntries] = useState<SelfAssessmentTrendEntry[]>([]);
  const [trend, setTrend] = useState('insufficient_data');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSelfAssessmentTrend(20)
      .then((data) => {
        setEntries(data.entries);
        setTrend(data.trend);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Self-Assessment Trend</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Self-Assessment Trend</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Complete some self-assessments after conversations to track your progress over time.
        </p>
      </div>
    );
  }

  const latest = entries[entries.length - 1];
  const maxRating = 5;
  const chartHeight = 120;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Self-Assessment Trend</h3>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          {trendEmoji[trend] ?? '📊'} {trendLabel[trend] ?? trend}
        </span>
      </div>

      {/* CSS-based line chart */}
      <div
        style={{
          position: 'relative',
          height: chartHeight,
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        {/* Y-axis labels */}
        {[1, 2, 3, 4, 5].map((v) => (
          <span
            key={v}
            style={{
              position: 'absolute',
              left: -20,
              bottom: ((v - 1) / (maxRating - 1)) * (chartHeight - 8) - 6,
              fontSize: 10,
              color: 'var(--text-secondary)',
            }}
          >
            {v}
          </span>
        ))}
        {/* Grid lines */}
        {[1, 2, 3, 4, 5].map((v) => (
          <div
            key={`grid-${v}`}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: ((v - 1) / (maxRating - 1)) * (chartHeight - 8),
              borderBottom: '1px dashed var(--border)',
              opacity: 0.5,
            }}
          />
        ))}
        {/* Data points and lines for each metric */}
        {(['rolling_confidence', 'rolling_fluency', 'rolling_comprehension'] as const).map((metric) => {
          const colorKey = metric.replace('rolling_', '') as keyof typeof COLORS;
          const color = COLORS[colorKey];
          return entries.map((entry, i) => {
            const x = entries.length === 1 ? 50 : (i / (entries.length - 1)) * 100;
            const y = ((entry[metric] - 1) / (maxRating - 1)) * (chartHeight - 8);
            // Draw line to next point
            const nextEntry = entries[i + 1];
            let line = null;
            if (nextEntry) {
              const nextX = (((i + 1) / (entries.length - 1)) * 100);
              const nextY = ((nextEntry[metric] - 1) / (maxRating - 1)) * (chartHeight - 8);
              const dx = (nextX - x) / 100;
              const dy = nextY - y;
              const len = Math.sqrt((dx * (chartHeight * 3)) ** 2 + dy ** 2);
              const angle = Math.atan2(-dy, dx * (chartHeight * 3)) * (180 / Math.PI);
              line = (
                <div
                  key={`line-${metric}-${i}`}
                  style={{
                    position: 'absolute',
                    left: `${x}%`,
                    bottom: y,
                    width: len,
                    height: 2,
                    background: color,
                    transformOrigin: '0 50%',
                    transform: `rotate(${angle}deg)`,
                    opacity: 0.6,
                    pointerEvents: 'none',
                  }}
                />
              );
            }
            return (
              <div key={`${metric}-${i}`}>
                {line}
                <div
                  style={{
                    position: 'absolute',
                    left: `${x}%`,
                    bottom: y - 4,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    transform: 'translateX(-4px)',
                    cursor: 'pointer',
                    zIndex: 2,
                    border: hoveredIndex === i ? '2px solid var(--text-primary)' : '2px solid transparent',
                  }}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              </div>
            );
          });
        })}
        {/* Hover tooltip */}
        {hoveredIndex !== null && entries[hoveredIndex] && (
          <div
            style={{
              position: 'absolute',
              left: `${entries.length === 1 ? 50 : (hoveredIndex / (entries.length - 1)) * 100}%`,
              top: -8,
              transform: 'translateX(-50%)',
              background: 'var(--bg-primary, #fff)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 11,
              zIndex: 10,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {entries[hoveredIndex].created_at?.slice(0, 10)}
            </div>
            <div style={{ color: COLORS.confidence }}>
              Confidence: {entries[hoveredIndex].rolling_confidence.toFixed(1)}
            </div>
            <div style={{ color: COLORS.fluency }}>
              Fluency: {entries[hoveredIndex].rolling_fluency.toFixed(1)}
            </div>
            <div style={{ color: COLORS.comprehension }}>
              Comprehension: {entries[hoveredIndex].rolling_comprehension.toFixed(1)}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        {Object.entries(COLORS).map(([key, color]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
            <span style={{ textTransform: 'capitalize' }}>{key}</span>
          </div>
        ))}
      </div>

      {/* Latest ratings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <div style={{ padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>Confidence</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.confidence }}>
            {latest.confidence_rating}/5 {ratingEmoji(latest.confidence_rating)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Avg: {latest.rolling_confidence.toFixed(1)}
          </div>
        </div>
        <div style={{ padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>Fluency</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.fluency }}>
            {latest.fluency_rating}/5 {ratingEmoji(latest.fluency_rating)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Avg: {latest.rolling_fluency.toFixed(1)}
          </div>
        </div>
        <div style={{ padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>Comprehension</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.comprehension }}>
            {latest.comprehension_rating}/5 {ratingEmoji(latest.comprehension_rating)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Avg: {latest.rolling_comprehension.toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
}
