import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Volume2 } from 'lucide-react';

interface VocabTargetBarProps {
  targetWords: string[];
  usedWords: Set<string>;
  onSpeak?: (text: string) => void;
}

export function VocabTargetBar({ targetWords, usedWords, onSpeak }: VocabTargetBarProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (targetWords.length === 0) return null;

  const usedCount = targetWords.filter((w) => usedWords.has(w.toLowerCase())).length;

  return (
    <div
      style={{
        padding: '6px 16px',
        borderBottom: '1px solid var(--border, #e5e7eb)',
        background: 'var(--bg-secondary, #f9fafb)',
      }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-label="Toggle target words"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary, #1e293b)',
          width: '100%',
        }}
      >
        🎯 Target Words
        <span style={{ fontWeight: 400, color: 'var(--text-secondary, #64748b)' }}>
          {usedCount}/{targetWords.length}
        </span>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {!collapsed && (
        <div
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}
          aria-label="Target vocabulary words"
        >
          {targetWords.map((word) => {
            const used = usedWords.has(word.toLowerCase());
            return (
              <span
                key={word}
                onClick={() => onSpeak?.(word)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onSpeak?.(word); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 10px',
                  borderRadius: 16,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: onSpeak ? 'pointer' : 'default',
                  background: used ? 'var(--success-light, #dcfce7)' : 'var(--bg, #fff)',
                  border: `1px solid ${used ? 'var(--success, #22c55e)' : 'var(--border, #d1d5db)'}`,
                  color: used ? 'var(--success, #16a34a)' : 'var(--text-primary, #374151)',
                  transition: 'all 0.2s',
                }}
              >
                {used && <Check size={12} />}
                {word}
                {onSpeak && <Volume2 size={10} style={{ opacity: 0.5 }} />}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
