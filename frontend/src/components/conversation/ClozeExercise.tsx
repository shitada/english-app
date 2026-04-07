import { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, CheckCircle, XCircle } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  key_phrases?: string[];
}

interface ClozeItem {
  sentence: string;
  blank: string;
  answer: string;
}

interface Props {
  messages: Message[];
}

interface AttemptResult {
  userInput: string;
  answer: string;
  sentence: string;
  isMatch: boolean;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

function buildClozeItems(messages: Message[]): ClozeItem[] {
  const items: ClozeItem[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.key_phrases?.length) continue;
    const sentences = msg.content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);

    for (const phrase of msg.key_phrases) {
      const lower = phrase.toLowerCase();
      if (seen.has(lower)) continue;

      const match = sentences.find(s => s.toLowerCase().includes(lower));
      if (!match) continue;

      const idx = match.toLowerCase().indexOf(lower);
      const original = match.substring(idx, idx + phrase.length);
      const blank = match.substring(0, idx) + '___' + match.substring(idx + phrase.length);

      seen.add(lower);
      items.push({ sentence: blank, blank: '___', answer: original });
      if (items.length >= 6) return items;
    }
  }
  return items;
}

export function ClozeExercise({ messages }: Props) {
  const items = buildClozeItems(messages);
  const [expanded, setExpanded] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded, currentIndex]);

  const handleSubmit = useCallback(() => {
    if (!userInput.trim()) return;
    const item = items[currentIndex];
    const isMatch = normalizeText(userInput) === normalizeText(item.answer);
    setResults(prev => [...prev, { userInput: userInput.trim(), answer: item.answer, sentence: item.sentence, isMatch }]);
    setShowResult(true);
  }, [userInput, currentIndex, items]);

  const handleNext = useCallback(() => {
    setShowResult(false);
    setUserInput('');
    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
    }
  }, [currentIndex, items.length]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setUserInput('');
    setResults([]);
    setShowResult(false);
    setFinished(false);
  }, []);

  if (items.length === 0) return null;

  if (!expanded) {
    return (
      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        <button
          onClick={() => setExpanded(true)}
          style={{
            padding: '0.6rem 1.2rem',
            borderRadius: 8,
            border: '2px solid var(--primary, #6366f1)',
            background: 'transparent',
            color: 'var(--primary, #6366f1)',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          📝 Fill in the Blank ({items.length})
        </button>
      </div>
    );
  }

  if (finished) {
    const correctCount = results.filter(r => r.isMatch).length;
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
        <h4 style={{ margin: '0 0 12px', textAlign: 'center' }}>Cloze Exercise Complete!</h4>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: correctCount === items.length ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)' }}>
            {correctCount}/{items.length}
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            phrases recalled
          </p>
        </div>
        {results.map((r, i) => (
          <div key={i} style={{ padding: 8, marginBottom: 6, background: 'var(--card-bg, #fff)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            {r.isMatch
              ? <CheckCircle size={16} color="var(--success, #22c55e)" />
              : <XCircle size={16} color="var(--danger, #ef4444)" />}
            <span style={{ fontSize: 13, flex: 1 }}>
              {r.isMatch ? r.answer : (
                <>
                  <span style={{ textDecoration: 'line-through', color: 'var(--danger, #ef4444)' }}>{r.userInput}</span>
                  {' → '}
                  <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600 }}>{r.answer}</span>
                </>
              )}
            </span>
          </div>
        ))}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            onClick={handleRestart}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.4rem 0.8rem', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--card-bg, #fff)',
              color: 'var(--text)', cursor: 'pointer', fontSize: '0.85rem',
            }}
          >
            <RotateCcw size={14} /> Try Again
          </button>
        </div>
      </div>
    );
  }

  const currentItem = items[currentIndex];

  return (
    <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>📝 Fill in the Blank</h4>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {items.length}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Complete the sentence:
        </p>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
          {currentItem.sentence.split('___').map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && (
                <span style={{
                  display: 'inline-block', minWidth: 60, borderBottom: '2px solid var(--primary, #6366f1)',
                  textAlign: 'center', color: 'var(--primary, #6366f1)', fontWeight: 600,
                  margin: '0 2px', padding: '0 4px',
                }}>
                  ?
                </span>
              )}
            </span>
          ))}
        </p>
      </div>

      {!showResult ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Type the missing phrase..."
            style={{
              flex: 1, padding: '0.5rem 0.75rem', borderRadius: 6,
              border: '1px solid var(--border)', fontSize: 14,
              background: 'var(--card-bg, #fff)', color: 'var(--text)',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!userInput.trim()}
            style={{
              padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
              background: 'var(--primary, #6366f1)', color: '#fff',
              fontWeight: 600, cursor: userInput.trim() ? 'pointer' : 'not-allowed',
              opacity: userInput.trim() ? 1 : 0.5,
            }}
          >
            Check
          </button>
        </div>
      ) : (
        <div>
          {results[results.length - 1]?.isMatch ? (
            <div style={{ padding: 10, borderRadius: 6, background: 'var(--success-bg, #f0fdf4)', border: '1px solid var(--success, #22c55e)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <CheckCircle size={18} color="var(--success, #22c55e)" />
                <span style={{ fontWeight: 600, color: 'var(--success, #22c55e)' }}>Correct!</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>
                {currentItem.sentence.replace('___', currentItem.answer)}
              </p>
            </div>
          ) : (
            <div style={{ padding: 10, borderRadius: 6, background: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger, #ef4444)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <XCircle size={18} color="var(--danger, #ef4444)" />
                <span style={{ fontWeight: 600, color: 'var(--danger, #ef4444)' }}>Not quite</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Your answer:</p>
                <p style={{ margin: 0, fontSize: 14, textDecoration: 'line-through', color: 'var(--danger, #ef4444)' }}>
                  {results[results.length - 1]?.userInput}
                </p>
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Correct answer:</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--success, #22c55e)' }}>
                  {currentItem.answer}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={handleNext}
            style={{
              padding: '0.4rem 0.8rem', borderRadius: 6, border: 'none',
              background: 'var(--primary, #6366f1)', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
            }}
          >
            {currentIndex < items.length - 1 ? 'Next' : 'See Results'}
          </button>
        </div>
      )}
    </div>
  );
}
