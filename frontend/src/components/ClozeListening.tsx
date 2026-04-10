import { useState, useCallback } from 'react';
import { Volume2, CheckCircle, XCircle, RotateCcw } from 'lucide-react';

interface ClozeBlank {
  index: number;
  word: string;
}

interface ClozeListeningProps {
  passage: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'they', 'been', 'have', 'were',
  'said', 'each', 'which', 'their', 'will', 'other', 'about', 'many', 'then',
  'them', 'some', 'would', 'make', 'like', 'into', 'could', 'time', 'very',
  'when', 'what', 'your', 'there', 'also', 'more', 'than', 'just', 'only',
]);

export function extractClozeBlanks(passage: string, count: number = 6): { tokens: string[]; blanks: ClozeBlank[] } {
  const tokens = passage.split(/(\s+)/);
  const candidates: { index: number; word: string }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const word = raw.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (word.length >= 4 && !STOP_WORDS.has(word)) {
      candidates.push({ index: i, word: raw.replace(/[^a-zA-Z']/g, '') });
    }
  }

  // Spread blanks evenly through the passage
  const selected: ClozeBlank[] = [];
  const step = Math.max(1, Math.floor(candidates.length / count));
  for (let i = 0; i < candidates.length && selected.length < count; i += step) {
    selected.push(candidates[i]);
  }

  return { tokens, blanks: selected };
}

export function ClozeListening({ passage }: ClozeListeningProps) {
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [clozeData] = useState(() => extractClozeBlanks(passage, 6));

  const handleReplay = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(passage);
      utt.rate = 0.85;
      utt.lang = 'en-US';
      window.speechSynthesis.speak(utt);
    }
  }, [passage]);

  const handleSubmit = () => {
    setSubmitted(true);
  };

  const handleReset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  const blankIndices = new Set(clozeData.blanks.map(b => b.index));

  const getResult = (blank: ClozeBlank): 'correct' | 'wrong' => {
    const userAnswer = (answers[blank.index] || '').trim().toLowerCase();
    const expected = blank.word.toLowerCase();
    return userAnswer === expected ? 'correct' : 'wrong';
  };

  const correctCount = submitted
    ? clozeData.blanks.filter(b => getResult(b) === 'correct').length
    : 0;

  if (clozeData.blanks.length === 0) return null;

  return (
    <div style={{
      marginTop: 24,
      padding: 20,
      background: 'var(--bg-secondary, #f5f5f5)',
      borderRadius: 12,
      border: '1px solid var(--border-color, #e5e7eb)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: '1rem' }}>🧩 Cloze Listening</h4>
        <button
          className="btn btn-secondary"
          onClick={handleReplay}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 12px' }}
          aria-label="Replay passage audio"
        >
          <Volume2 size={14} /> Replay
        </button>
      </div>

      {!started ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <p style={{ color: 'var(--text-secondary, #6b7280)', marginBottom: 12, fontSize: 14 }}>
            Listen to the passage and fill in the missing words.
          </p>
          <button className="btn btn-primary" onClick={() => { setStarted(true); handleReplay(); }}>
            Start Cloze Drill
          </button>
        </div>
      ) : (
        <>
          <div style={{
            lineHeight: 2.2,
            fontSize: 15,
            color: 'var(--text-primary, #1f2937)',
            marginBottom: 16,
          }}>
            {clozeData.tokens.map((token, i) => {
              if (blankIndices.has(i)) {
                const blank = clozeData.blanks.find(b => b.index === i)!;
                const result = submitted ? getResult(blank) : null;
                return (
                  <span key={i} style={{ display: 'inline-block', verticalAlign: 'bottom' }}>
                    <input
                      type="text"
                      value={answers[i] || ''}
                      onChange={e => setAnswers(prev => ({ ...prev, [i]: e.target.value }))}
                      disabled={submitted}
                      placeholder="____"
                      style={{
                        width: Math.max(60, blank.word.length * 10),
                        padding: '2px 6px',
                        fontSize: 14,
                        border: `2px solid ${result === 'correct' ? 'var(--success, #22c55e)' : result === 'wrong' ? 'var(--danger, #ef4444)' : 'var(--border-color, #d1d5db)'}`,
                        borderRadius: 6,
                        background: result === 'correct' ? 'var(--success-bg, #f0fdf4)' : result === 'wrong' ? 'var(--danger-bg, #fef2f2)' : 'var(--bg-primary, #fff)',
                        textAlign: 'center',
                        outline: 'none',
                      }}
                      aria-label={`Fill blank ${clozeData.blanks.indexOf(blank) + 1}`}
                    />
                    {result === 'correct' && <CheckCircle size={14} color="var(--success, #22c55e)" style={{ marginLeft: 2 }} />}
                    {result === 'wrong' && (
                      <span style={{ fontSize: 12, color: 'var(--danger, #ef4444)', marginLeft: 4 }}>
                        <XCircle size={14} style={{ verticalAlign: 'middle' }} /> {blank.word}
                      </span>
                    )}
                  </span>
                );
              }
              return <span key={i}>{token}</span>;
            })}
          </div>

          {submitted ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <span style={{
                fontSize: 15,
                fontWeight: 600,
                color: correctCount === clozeData.blanks.length ? 'var(--success, #22c55e)' : 'var(--text-primary, #1f2937)',
              }}>
                {correctCount}/{clozeData.blanks.length} correct
              </span>
              <button className="btn btn-secondary" onClick={handleReset} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <RotateCcw size={14} /> Try Again
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={handleSubmit}>
              Check Answers
            </button>
          )}
        </>
      )}
    </div>
  );
}
