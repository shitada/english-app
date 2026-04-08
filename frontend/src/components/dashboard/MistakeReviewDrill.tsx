import { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, Volume2, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import type { MistakeReviewItem } from '../../api';

interface Props {
  items: MistakeReviewItem[];
  onClose: () => void;
}

interface AttemptResult {
  userInput: string;
  correct: string;
  isMatch: boolean;
  topic: string;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function WordDiff({ userInput, correct }: { userInput: string; correct: string }) {
  const userWords = userInput.trim().split(/\s+/);
  const correctWords = correct.trim().split(/\s+/);
  const maxLen = Math.max(userWords.length, correctWords.length);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 14 }}>
      {Array.from({ length: maxLen }, (_, i) => {
        const uWord = userWords[i] || '';
        const cWord = correctWords[i] || '';
        const match = normalizeText(uWord) === normalizeText(cWord);
        return (
          <span
            key={i}
            style={{
              color: match ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
              fontWeight: match ? 400 : 700,
              textDecoration: !match && uWord ? 'line-through' : 'none',
            }}
          >
            {uWord || '___'}
          </span>
        );
      })}
    </div>
  );
}

export function MistakeReviewDrill({ items, onClose }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [currentIndex]);

  const handleSubmit = useCallback(() => {
    if (!userInput.trim()) return;
    const item = items[currentIndex];
    const isMatch = normalizeText(userInput) === normalizeText(item.correction);
    setResults(prev => [...prev, { userInput: userInput.trim(), correct: item.correction, isMatch, topic: item.topic }]);
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

  const handleSpeak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  if (items.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>No grammar mistakes to review yet.</p>
        <button className="btn btn-secondary" onClick={onClose}>
          <ArrowLeft size={14} /> Back to Journal
        </button>
      </div>
    );
  }

  if (finished) {
    const correctCount = results.filter(r => r.isMatch).length;
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Mistake Review Complete!</h3>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 40, fontWeight: 700, color: correctCount === items.length ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)' }}>
            {correctCount}/{items.length}
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            corrections nailed {correctCount === items.length ? '🎉' : ''}
          </p>
        </div>

        {results.map((r, i) => (
          <div key={i} style={{ padding: 8, marginBottom: 6, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            {r.isMatch
              ? <CheckCircle size={16} color="var(--success, #22c55e)" />
              : <XCircle size={16} color="var(--danger, #ef4444)" />}
            <span style={{ fontSize: 13, flex: 1 }}>
              {r.isMatch ? r.correct : (
                <>
                  <span style={{ textDecoration: 'line-through', color: 'var(--danger, #ef4444)' }}>{r.userInput}</span>
                  {' → '}
                  <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600 }}>{r.correct}</span>
                </>
              )}
            </span>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={handleRestart} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Try Again
          </button>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    );
  }

  const currentItem = items[currentIndex];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>📝 Mistake Review Drill</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {currentIndex + 1} / {items.length}
        </span>
      </div>

      <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>
          You wrote ({currentItem.topic}):
        </p>
        <p style={{ margin: 0, fontSize: 15, color: 'var(--danger, #ef4444)', fontStyle: 'italic' }}>
          "{currentItem.original}"
        </p>
      </div>

      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
        💡 {currentItem.explanation}
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        Type the corrected version:
      </p>

      {!showResult ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Type the correction..."
            style={{
              flex: 1, padding: '0.5rem 0.75rem', borderRadius: 6,
              border: '1px solid var(--border)', fontSize: 14,
              background: 'var(--card-bg, #fff)', color: 'var(--text)',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!userInput.trim()}
            className="btn btn-primary"
            style={{ opacity: userInput.trim() ? 1 : 0.5 }}
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
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{currentItem.correction}</p>
            </div>
          ) : (
            <div style={{ padding: 10, borderRadius: 6, background: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger, #ef4444)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <XCircle size={18} color="var(--danger, #ef4444)" />
                <span style={{ fontWeight: 600, color: 'var(--danger, #ef4444)' }}>Not quite</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Your attempt:</p>
                <WordDiff userInput={results[results.length - 1]?.userInput || ''} correct={currentItem.correction} />
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Correct version:</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--success, #22c55e)' }}>
                  {currentItem.correction}
                </p>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleSpeak(currentItem.correction)}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Volume2 size={14} /> Listen
            </button>
            <button onClick={handleNext} className="btn btn-primary">
              {currentIndex < items.length - 1 ? 'Next' : 'See Results'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
