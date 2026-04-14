import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getReviewQueue, type ReviewQueueItem } from '../api';
import { useI18n } from '../i18n/I18nContext';

const MODULE_ICONS: Record<string, string> = {
  vocabulary: '📚',
  pronunciation: '🎤',
  grammar: '📝',
  listening: '🎧',
  conversation: '💬',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

function getPriorityLabel(priority: number): string {
  if (priority >= 8) return 'high';
  if (priority >= 4) return 'medium';
  return 'low';
}

function getItemLabel(item: ReviewQueueItem): string {
  const d = item.detail;
  if (item.module === 'vocabulary') {
    return `${d.word || d.english || ''}${d.meaning ? ` — ${d.meaning}` : ''}`;
  }
  if (item.module === 'pronunciation') {
    const score = d.latest_score != null ? ` (${d.latest_score}/10)` : d.score != null ? ` (${d.score}/10)` : '';
    return `${d.reference_text || d.text || 'Practice phrase'}${score}`;
  }
  if (item.module === 'grammar') {
    const count = d.occurrence_count != null ? ` (×${d.occurrence_count})` : d.count != null ? ` (×${d.count})` : '';
    return `${d.category || d.pattern || 'Grammar pattern'}${count}`;
  }
  return d.title || d.text || item.module;
}

export default function SmartReviewQueue() {
  const { t } = useI18n();
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    getReviewQueue(8)
      .then((res) => setItems(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const grouped = items.reduce<Record<string, ReviewQueueItem[]>>((acc, item) => {
    (acc[item.module] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          padding: '0.75rem 1rem',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🎯</span>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            {t('smartReviewQueue')}
          </h3>
          {items.length > 0 && (
            <span
              style={{
                background: 'var(--primary, #6366f1)',
                color: '#fff',
                borderRadius: '999px',
                padding: '0.1rem 0.5rem',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              {items.length}
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>
          {collapsed ? '▸' : '▾'}
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: '0 1rem 0.75rem' }}>
          {items.length === 0 ? (
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary, #6b7280)',
                margin: '0.5rem 0',
              }}
            >
              {t('allCaughtUp')}
            </p>
          ) : (
            Object.entries(grouped).map(([mod, modItems]) => (
              <div key={mod} style={{ marginBottom: '0.75rem' }}>
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-secondary, #6b7280)',
                    marginBottom: '0.25rem',
                    textTransform: 'capitalize',
                  }}
                >
                  {MODULE_ICONS[mod] || '📋'} {mod}
                </div>
                {modItems.map((item, i) => {
                  const pLabel = getPriorityLabel(item.priority);
                  return (
                    <Link
                      key={`${mod}-${i}`}
                      to={item.route}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.4rem 0.5rem',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        color: 'inherit',
                        fontSize: '0.85rem',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          'var(--bg-hover, rgba(99,102,241,0.08))')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = 'transparent')
                      }
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: PRIORITY_COLORS[pLabel],
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getItemLabel(item)}
                      </span>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          color: PRIORITY_COLORS[pLabel],
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        {pLabel}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
