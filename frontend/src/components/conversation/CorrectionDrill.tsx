import { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, Volume2, CheckCircle, XCircle } from 'lucide-react';

interface CorrectionError {
  original: string;
  correction: string;
  explanation: string;
}

interface Props {
  errors: CorrectionError[];
  tts: { speak: (text: string) => void; isSpeaking: boolean };
}

interface AttemptResult {
  userInput: string;
  correct: string;
  isMatch: boolean;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
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

export function CorrectionDrill({ errors, tts }: Props) {
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
    const err = errors[currentIndex];
    const isMatch = normalizeText(userInput) === normalizeText(err.correction);
    setResults(prev => [...prev, { userInput: userInput.trim(), correct: err.correction, isMatch }]);
    setShowResult(true);
  }, [userInput, currentIndex, errors]);

  const handleNext = useCallback(() => {
    setShowResult(false);
    setUserInput('');
    if (currentIndex < errors.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
    }
  }, [currentIndex, errors.length]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setUserInput('');
    setResults([]);
    setShowResult(false);
    setFinished(false);
  }, []);

  if (errors.length === 0) return null;

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
          ✏️ Practice Your Corrections ({errors.length})
        </button>
      </div>
    );
  }

  if (finished) {
    const correctCount = results.filter(r => r.isMatch).length;
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
        <h4 style={{ margin: '0 0 12px', textAlign: 'center' }}>Correction Drill Complete!</h4>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: correctCount === errors.length ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)' }}>
            {correctCount}/{errors.length}
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            corrections nailed
          </p>
        </div>
        {results.map((r, i) => (
          <div key={i} style={{ padding: 8, marginBottom: 6, background: 'var(--card-bg, #fff)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
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

  const currentError = errors[currentIndex];

  return (
    <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>✏️ Correction Drill</h4>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {errors.length}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>
          You wrote:
        </p>
        <p style={{ margin: 0, fontSize: 15, color: 'var(--danger, #ef4444)', fontStyle: 'italic' }}>
          "{currentError.original}"
        </p>
      </div>

      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
        💡 {currentError.explanation}
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
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{currentError.correction}</p>
            </div>
          ) : (
            <div style={{ padding: 10, borderRadius: 6, background: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger, #ef4444)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <XCircle size={18} color="var(--danger, #ef4444)" />
                <span style={{ fontWeight: 600, color: 'var(--danger, #ef4444)' }}>Not quite</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Your attempt:</p>
                <WordDiff userInput={results[results.length - 1]?.userInput || ''} correct={currentError.correction} />
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Correct version:</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--success, #22c55e)' }}>
                  {currentError.correction}
                </p>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => tts.speak(currentError.correction)}
              disabled={tts.isSpeaking}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0.4rem 0.8rem', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--card-bg, #fff)',
                color: 'var(--text)', cursor: tts.isSpeaking ? 'default' : 'pointer',
                fontSize: '0.85rem', opacity: tts.isSpeaking ? 0.5 : 1,
              }}
            >
              <Volume2 size={14} /> Listen
            </button>
            <button
              onClick={handleNext}
              style={{
                padding: '0.4rem 0.8rem', borderRadius: 6, border: 'none',
                background: 'var(--primary, #6366f1)', color: '#fff',
                fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
              }}
            >
              {currentIndex < errors.length - 1 ? 'Next' : 'See Results'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
