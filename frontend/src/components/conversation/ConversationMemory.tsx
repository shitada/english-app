import { useState, useEffect, useCallback } from 'react';
import { Trash2, ChevronDown } from 'lucide-react';
import { api } from '../../api';

export function ConversationMemory() {
  const [facts, setFacts] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api.getConversationMemory()
      .then((res) => setFacts(res.facts))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      await api.clearConversationMemory();
      setFacts([]);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  }, []);

  // Don't render anything if no facts and not loading
  if (!loading && facts.length === 0) return null;

  return (
    <div
      data-testid="conversation-memory"
      style={{
        marginBottom: 20,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--card-bg, #f8f9fa)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        data-testid="conversation-memory-toggle"
        style={{
          width: '100%',
          padding: '12px 16px',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--text)',
          fontSize: '0.95rem',
          fontWeight: 600,
        }}
      >
        <span>🧠 AI remembers about you...</span>
        <ChevronDown
          size={18}
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 14px 16px' }}>
          {loading ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Loading...</div>
          ) : (
            <>
              <ul
                data-testid="conversation-memory-facts"
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  listStyle: 'disc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {facts.map((fact, i) => (
                  <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {fact}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleClear}
                disabled={clearing}
                data-testid="conversation-memory-clear"
                style={{
                  marginTop: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #fecaca',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  fontSize: '0.8rem',
                  cursor: clearing ? 'not-allowed' : 'pointer',
                  opacity: clearing ? 0.6 : 1,
                }}
              >
                <Trash2 size={14} />
                {clearing ? 'Clearing...' : 'Clear Memory'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
