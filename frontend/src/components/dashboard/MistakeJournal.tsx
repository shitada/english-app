import { AlertTriangle } from 'lucide-react';
import type { MistakeItem } from '../../api';
import { formatRelativeTime } from '../../utils/formatDate';

interface MistakeJournalProps {
  mistakes: MistakeItem[];
  filter: 'all' | 'grammar' | 'pronunciation' | 'vocabulary';
  setFilter: (f: 'all' | 'grammar' | 'pronunciation' | 'vocabulary') => void;
  total: number;
  onLoadMore: () => void;
  onStartReview?: () => void;
  hasGrammarMistakes?: boolean;
}

export function MistakeJournal({ mistakes, filter, setFilter, total, onLoadMore, onStartReview, hasGrammarMistakes }: MistakeJournalProps) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <AlertTriangle size={20} color="#f59e0b" />
        <h3 style={{ margin: 0 }}>Mistake Journal</h3>
        {total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            {total} total
          </span>
        )}
        {onStartReview && hasGrammarMistakes && (
          <button
            onClick={onStartReview}
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '3px 10px', marginLeft: total > 0 ? 8 : 'auto' }}
          >
            ✏️ Practice Mistakes
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'grammar', 'pronunciation', 'vocabulary'] as const).map(f => (
          <button
            key={f}
            className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
            style={{ fontSize: 12, padding: '3px 10px' }}
          >
            {f === 'all' ? 'All' : f === 'grammar' ? '📝 Grammar' : f === 'pronunciation' ? '🎙️ Pronunciation' : '📚 Vocabulary'}
          </button>
        ))}
      </div>

      {mistakes.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, padding: 16 }}>
          No mistakes recorded yet. Keep practicing!
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mistakes.map((m, i) => (
            <MistakeCard key={`${m.module}-${i}`} item={m} />
          ))}
          {mistakes.length < total && (
            <button className="btn btn-secondary" onClick={onLoadMore} style={{ alignSelf: 'center', marginTop: 8 }}>
              Load More
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MistakeCard({ item }: { item: MistakeItem }) {
  const d = item.detail as Record<string, string | number>;
  const icon = item.module === 'grammar' ? '📝' : item.module === 'pronunciation' ? '🎙️' : '📚';

  return (
    <div style={{ padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span>{icon}</span>
        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{item.module}</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {formatRelativeTime(item.created_at)}
        </span>
      </div>
      {item.module === 'grammar' && (
        <div>
          <p><span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{String(d.original || '')}</span> → <span style={{ color: '#22c55e' }}>{String(d.correction || '')}</span></p>
          {d.explanation && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{String(d.explanation)}</p>}
        </div>
      )}
      {item.module === 'pronunciation' && (
        <div>
          <p>Expected: <strong>{String(d.reference_text || '')}</strong></p>
          <p>You said: "{String(d.user_transcription || '')}" <span style={{ color: Number(d.score) >= 5 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>({d.score}/10)</span></p>
        </div>
      )}
      {item.module === 'vocabulary' && (
        <p><strong>{String(d.word || '')}</strong> — {String(d.meaning || '')}</p>
      )}
    </div>
  );
}
