import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDayDetail, type DayDetailResponse } from '../../api';
import { useI18n } from '../../i18n/I18nContext';

interface Props {
  date: string;
  onClose: () => void;
}

const MODULE_ROUTE: Record<string, string> = {
  conversation: '/conversation',
  pronunciation: '/pronunciation',
  vocabulary: '/vocabulary',
  listening: '/listening',
};

export function HeatmapDayDetail({ date, onClose }: Props) {
  const { t, tParam } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<DayDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    getDayDetail(date)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const hasActivity = !!data && (
    data.conversation_message_count > 0 ||
    data.pronunciation.count > 0 ||
    data.vocabulary.count > 0 ||
    data.listening.count > 0
  );

  const onPracticeAgain = () => {
    if (!data?.top_module) return;
    const route = MODULE_ROUTE[data.top_module];
    if (route) navigate(route);
  };

  return (
    <div
      className="card"
      data-testid="heatmap-day-detail"
      style={{ marginTop: '0.75rem', padding: '1rem', border: '1px solid var(--border, #e5e7eb)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h4 style={{ margin: 0, fontSize: '1rem' }}>{tParam('heatmapActivityOn', { date })}</h4>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('heatmapClose')}
          data-testid="heatmap-day-detail-close"
          style={{
            background: 'transparent',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: '4px',
            padding: '0.25rem 0.6rem',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          ✕
        </button>
      </div>

      {loading && <p style={{ margin: '0.5rem 0', fontSize: '0.85rem' }}>…</p>}
      {error && (
        <p style={{ margin: '0.5rem 0', fontSize: '0.85rem', color: 'var(--danger, #dc2626)' }}>
          {error}
        </p>
      )}

      {data && !loading && !error && (
        <>
          {!hasActivity ? (
            <p style={{ margin: '0.5rem 0', fontSize: '0.85rem', color: 'var(--text-secondary, #666)' }}>
              {t('heatmapNoActivity')}
            </p>
          ) : (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0.25rem 0 0.75rem', fontSize: '0.85rem' }}>
                {data.conversation_message_count > 0 && (
                  <li>💬 {tParam('heatmapConvCount', { count: data.conversation_message_count })}</li>
                )}
                {data.pronunciation.count > 0 && (
                  <li>🎤 {tParam('heatmapPronCount', { count: data.pronunciation.count, score: data.pronunciation.avg_score })}</li>
                )}
                {data.vocabulary.count > 0 && (
                  <li>📚 {tParam('heatmapVocabCount', { count: data.vocabulary.count })}</li>
                )}
                {data.listening.count > 0 && (
                  <li>🎧 {tParam('heatmapListeningCount', { count: data.listening.count, accuracy: data.listening.accuracy })}</li>
                )}
              </ul>

              {data.conversations.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
                  {data.conversations.map((c) => (
                    <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', padding: '0.15rem 0' }}>
                      <span>{c.topic}</span>
                      <a
                        href={`/conversation?resume=${c.id}`}
                        data-testid={`heatmap-day-replay-${c.id}`}
                        style={{ fontSize: '0.8rem' }}
                      >
                        {t('heatmapReplaySummary')}
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {data.vocabulary.new_words.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #666)', marginBottom: '0.25rem' }}>
                    {t('heatmapNewWords')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {data.vocabulary.new_words.slice(0, 12).map((w) => (
                      <span
                        key={w}
                        style={{
                          background: 'var(--bg-secondary, #f3f4f6)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                        }}
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.top_module && (
                <button
                  type="button"
                  onClick={onPracticeAgain}
                  data-testid="heatmap-day-practice-again"
                  style={{
                    background: 'var(--accent, #3b82f6)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '0.45rem 0.9rem',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  {t('heatmapPracticeAgainLikeThisDay')} →
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
