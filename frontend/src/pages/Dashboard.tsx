import { useState, useEffect } from 'react';
import { Flame, MessageSquare, Mic, BookOpen, Clock, AlertTriangle } from 'lucide-react';
import { api, type DashboardStats, type MistakeItem, getMistakeJournal } from '../api';
import { formatRelativeTime } from '../utils/formatDate';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [mistakeFilter, setMistakeFilter] = useState<'all' | 'grammar' | 'pronunciation' | 'vocabulary'>('all');
  const [mistakeTotal, setMistakeTotal] = useState(0);
  const [mistakeOffset, setMistakeOffset] = useState(0);

  useEffect(() => {
    api.getDashboardStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setMistakeOffset(0);
    getMistakeJournal(mistakeFilter, 10, 0)
      .then(res => { setMistakes(res.items); setMistakeTotal(res.total_count); })
      .catch(() => {});
  }, [mistakeFilter]);

  const loadMoreMistakes = () => {
    const newOffset = mistakeOffset + 10;
    getMistakeJournal(mistakeFilter, 10, newOffset)
      .then(res => { setMistakes(prev => [...prev, ...res.items]); setMistakeOffset(newOffset); })
      .catch(() => {});
  };

  if (loading) {
    return (
      <div>
        <h2 style={{ marginBottom: 24 }}>Dashboard</h2>
        <div className="skeleton skeleton-card" style={{ height: 120, marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );
  }

  if (!stats) {
    return <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Failed to load dashboard.</p>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>Dashboard</h2>

      {/* Streak */}
      <div className="card" style={{ textAlign: 'center', marginBottom: 24, background: stats.streak > 0 ? 'linear-gradient(135deg, #fef3c7, #fde68a)' : undefined }}>
        <Flame size={40} color={stats.streak > 0 ? '#f59e0b' : '#d1d5db'} />
        <div style={{ fontSize: 48, fontWeight: 800, marginTop: 8 }}>{stats.streak}</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          {stats.streak === 0 ? 'Start learning today!' : stats.streak === 1 ? 'Day streak! Keep it up!' : `Day streak! Amazing!`}
        </p>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <StatCard icon={<MessageSquare size={24} color="#6366f1" />} label="Conversations" value={stats.total_conversations} sub={`${stats.total_messages} messages sent`} />
        <StatCard icon={<Mic size={24} color="#f59e0b" />} label="Shadowing" value={stats.total_pronunciation} sub={`Avg score: ${stats.avg_pronunciation_score}/10`} />
        <StatCard icon={<BookOpen size={24} color="#10b981" />} label="Words Reviewed" value={stats.total_vocab_reviewed} sub={`${stats.vocab_mastered} mastered`} />
        <StatCard icon={<Clock size={24} color={stats.vocab_due_count > 0 ? '#ef4444' : '#6b7280'} />} label="Due for Review" value={stats.vocab_due_count} sub={stats.vocab_due_count > 0 ? 'Words need review!' : 'All caught up!'} />
      </div>

      {/* Recent activity */}
      {stats.recent_activity.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Recent Activity</h3>
          {stats.recent_activity.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < stats.recent_activity.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 18 }}>
                {a.type === 'conversation' ? '💬' : a.type === 'vocabulary' ? '📚' : '🎙️'}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14 }}>{a.detail}</p>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatRelativeTime(a.timestamp)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mistake Journal */}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <AlertTriangle size={20} color="#f59e0b" />
          <h3 style={{ margin: 0 }}>Mistake Journal</h3>
          {mistakeTotal > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
              {mistakeTotal} total
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['all', 'grammar', 'pronunciation', 'vocabulary'] as const).map(f => (
            <button
              key={f}
              className={`btn ${mistakeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMistakeFilter(f)}
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
            {mistakes.length < mistakeTotal && (
              <button className="btn btn-secondary" onClick={loadMoreMistakes} style={{ alignSelf: 'center', marginTop: 8 }}>
                Load More
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 32, fontWeight: 700 }}>{value}</div>
      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</p>
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
