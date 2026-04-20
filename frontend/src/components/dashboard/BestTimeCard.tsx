import { useEffect, useState } from 'react';
import { api, type TimeOfDayResponse } from '../../api';

function formatHour12(hour: number): string {
  const h = ((hour + 11) % 12) + 1;
  const period = hour < 12 ? 'am' : 'pm';
  return `${h}:00 ${period}`;
}

export function BestTimeCard() {
  const [data, setData] = useState<TimeOfDayResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .getDashboardTimeOfDay()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error || !data) return null;

  const { buckets, peak_practice_hour, best_score_hour, total_samples } = data;
  const maxCount = Math.max(1, ...buckets.map((b) => b.activity_count));

  const headline =
    peak_practice_hour !== null && peak_practice_hour !== undefined
      ? `You practice most around ${formatHour12(peak_practice_hour)}`
      : 'Not enough data yet';

  let subline: string | null = null;
  if (best_score_hour !== null && best_score_hour !== undefined) {
    const bucket = buckets.find((b) => b.hour === best_score_hour);
    const avg = bucket?.avg_pronunciation_score;
    if (avg !== null && avg !== undefined) {
      subline = `Best pronunciation scores around ${formatHour12(best_score_hour)} (avg ${avg.toFixed(1)})`;
    }
  }

  const ariaLabel =
    peak_practice_hour !== null && peak_practice_hour !== undefined
      ? `Best time of day insight. Peak practice hour ${formatHour12(peak_practice_hour)}. ${subline ?? ''}`.trim()
      : 'Best time of day insight. Not enough data yet.';

  return (
    <div
      className="card dark:bg-gray-800 dark:text-gray-100"
      data-testid="best-time-card"
      role="region"
      aria-label={ariaLabel}
      style={{ marginBottom: 24 }}
    >
      <h3 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        🕒 Best Time of Day
      </h3>
      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: subline ? 2 : 12 }}>
        {headline}
      </p>
      {subline && (
        <p
          data-testid="best-time-subline"
          style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}
        >
          {subline}
        </p>
      )}

      {/* Sparkline: 24 horizontal bars sized by activity_count */}
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          height: 48,
          marginBottom: 8,
        }}
      >
        {buckets.map((b) => {
          const isPeak = b.hour === peak_practice_hour;
          const heightPct = maxCount > 0 ? (b.activity_count / maxCount) * 100 : 0;
          return (
            <div
              key={b.hour}
              data-testid={`best-time-bar-${b.hour}`}
              data-peak={isPeak ? 'true' : 'false'}
              title={`${formatHour12(b.hour)}: ${b.activity_count} activities`}
              style={{
                flex: 1,
                height: `${Math.max(heightPct, b.activity_count > 0 ? 6 : 2)}%`,
                minHeight: 2,
                background: isPeak
                  ? 'var(--primary, #6366f1)'
                  : 'var(--bg-secondary, #e5e7eb)',
                borderRadius: 2,
                transition: 'background 0.2s',
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--text-secondary)',
        }}
        aria-hidden="true"
      >
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>

      {/* Hidden a11y table */}
      <table
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        <caption>Activity by hour of day (total {total_samples} samples)</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Activities</th>
            <th scope="col">Pronunciation attempts</th>
            <th scope="col">Avg pronunciation score</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.hour}>
              <td>{formatHour12(b.hour)}</td>
              <td>{b.activity_count}</td>
              <td>{b.pronunciation_attempts}</td>
              <td>
                {b.avg_pronunciation_score !== null && b.avg_pronunciation_score !== undefined
                  ? b.avg_pronunciation_score.toFixed(2)
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
