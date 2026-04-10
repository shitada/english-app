import { useState } from 'react';
import type { GrammarNote } from '../../api';

export function HighlightedMessage({ content, keyPhrases, grammarNotes, onSpeak }: {
  content: string;
  keyPhrases?: string[];
  grammarNotes?: GrammarNote[];
  onSpeak: (text: string) => void;
}) {
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);

  const hasKey = keyPhrases && keyPhrases.length > 0;
  const hasGrammar = grammarNotes && grammarNotes.length > 0;
  if (!hasKey && !hasGrammar) return <>{content}</>;

  // Combine all phrases: key phrases + grammar note phrases
  const allPhrases: { text: string; type: 'key' | 'grammar'; note?: GrammarNote }[] = [];
  if (hasKey) {
    for (const kp of keyPhrases) {
      allPhrases.push({ text: kp, type: 'key' });
    }
  }
  if (hasGrammar) {
    for (const gn of grammarNotes) {
      // Don't add if already covered by a key phrase
      if (!allPhrases.some((p) => p.text.toLowerCase() === gn.phrase.toLowerCase())) {
        allPhrases.push({ text: gn.phrase, type: 'grammar', note: gn });
      }
    }
  }

  // Build regex (longest first)
  const sorted = [...allPhrases].sort((a, b) => b.text.length - a.text.length);
  const escaped = sorted.map((p) => p.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = content.split(regex);

  // Lookup helpers
  const findKeyPhrase = (text: string) => keyPhrases?.find((kp) => kp.toLowerCase() === text.toLowerCase());
  const findGrammarNote = (text: string) => grammarNotes?.find((gn) => gn.phrase.toLowerCase() === text.toLowerCase());

  return (
    <>
      {parts.map((part, i) => {
        const isKey = !!findKeyPhrase(part);
        const grammarNote = findGrammarNote(part);

        if (!isKey && !grammarNote) return <span key={i}>{part}</span>;

        if (isKey && !grammarNote) {
          return (
            <span
              key={i}
              onClick={() => onSpeak(part)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSpeak(part); }}
              title="Click to hear pronunciation"
              style={{
                background: '#dbeafe',
                borderRadius: 3,
                padding: '1px 2px',
                cursor: 'pointer',
                borderBottom: '2px solid #3b82f6',
              }}
            >
              {part} <span style={{ fontSize: 10 }}>🔊</span>
            </span>
          );
        }

        // Grammar note (with or without key phrase)
        return (
          <span
            key={i}
            style={{ position: 'relative', display: 'inline' }}
          >
            <span
              onClick={() => setActiveTooltip(activeTooltip === i ? null : i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveTooltip(activeTooltip === i ? null : i); }}
              onMouseEnter={() => setActiveTooltip(i)}
              onMouseLeave={() => setActiveTooltip(null)}
              style={{
                borderBottom: '2px dashed #22c55e',
                cursor: 'pointer',
                padding: '1px 2px',
                borderRadius: 3,
                background: isKey ? '#dbeafe' : 'transparent',
              }}
            >
              {part}
              {isKey && <span style={{ fontSize: 10 }}> 🔊</span>}
              <span style={{ fontSize: 10 }}> 📖</span>
            </span>
            {activeTooltip === i && grammarNote && (
              <span style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                background: 'var(--card-bg, #1f2937)', color: 'var(--text-primary, #f9fafb)',
                border: '1px solid var(--border-color, #374151)', borderRadius: 8, padding: '8px 12px',
                fontSize: 12, zIndex: 50, whiteSpace: 'nowrap', maxWidth: 260,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', marginBottom: 4,
              }}>
                <div style={{ fontWeight: 600, color: '#22c55e', marginBottom: 2 }}>{grammarNote.grammar_point}</div>
                <div style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>{grammarNote.explanation}</div>
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}
