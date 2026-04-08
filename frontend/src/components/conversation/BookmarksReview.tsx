import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Volume2, Bookmark, BookmarkX } from 'lucide-react';
import { getBookmarkedMessages, toggleMessageBookmark, type BookmarkedMessage } from '../../api';
import { formatRelativeTime } from '../../utils/formatDate';

interface Props {
  onBack: () => void;
}

export function BookmarksReview({ onBack }: Props) {
  const [messages, setMessages] = useState<BookmarkedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBookmarkedMessages({ limit: 100 })
      .then(res => setMessages(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleUnbookmark = useCallback(async (msgId: number) => {
    try {
      await toggleMessageBookmark(msgId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch { /* ignore */ }
  }, []);

  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    }
  }, []);

  // Group by topic
  const grouped = messages.reduce<Record<string, BookmarkedMessage[]>>((acc, m) => {
    const topic = m.topic || 'Unknown';
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push(m);
    return acc;
  }, {});

  if (loading) {
    return (
      <div>
        <button onClick={onBack} className="btn btn-secondary" style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={16} /> Back to Scenarios
        </button>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <Bookmark size={20} color="var(--primary, #6366f1)" />
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Bookmarked Messages</h2>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {messages.length} saved
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <Bookmark size={32} color="var(--text-secondary)" style={{ marginBottom: 12, opacity: 0.5 }} />
          <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>No bookmarked messages yet.</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            During conversations, tap the bookmark icon on any message to save it for later review.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(grouped).map(([topic, msgs]) => (
            <div key={topic} className="card">
              <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 6 }}>
                💬 {topic.replace(/_/g, ' ')}
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>
                  ({msgs.length})
                </span>
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {msgs.map(m => (
                  <div
                    key={m.id}
                    style={{
                      padding: '10px 12px',
                      background: m.role === 'assistant' ? 'var(--bg-secondary, #f5f3ff)' : 'var(--bg-secondary, #f9fafb)',
                      borderRadius: 8,
                      borderLeft: `3px solid ${m.role === 'assistant' ? 'var(--primary, #6366f1)' : 'var(--success, #10b981)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: m.role === 'assistant' ? 'var(--primary, #6366f1)' : 'var(--success, #10b981)' }}>
                        {m.role === 'assistant' ? 'AI' : 'You'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {formatRelativeTime(m.created_at)}
                      </span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        {m.role === 'assistant' && (
                          <button
                            onClick={() => speak(m.content)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-secondary)' }}
                            title="Listen"
                          >
                            <Volume2 size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => handleUnbookmark(m.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#f59e0b' }}
                          title="Remove bookmark"
                        >
                          <BookmarkX size={14} />
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>
                      {m.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
