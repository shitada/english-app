import { useCallback, useRef, useState } from 'react';
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

  const selected: ClozeBlank[] = [];
  const step = Math.max(1, Math.floor(candidates.length / count));
  for (let i = 0; i < candidates.length && selected.length < count; i += step) {
    selected.push(candidates[i]);
  }

  return { tokens, blanks: selected };
}

/** Compute the character offset (within the original passage) of the token at tokenIndex. */
function tokenCharOffset(tokens: string[], tokenIndex: number): number {
  let n = 0;
  for (let i = 0; i < tokenIndex && i < tokens.length; i++) n += tokens[i].length;
  return n;
}

/** Return the sentence (split on /(?<=[.!?])\s+/) that contains the blank at tokenIndex. */
export function getSentenceForBlank(passage: string, tokens: string[], tokenIndex: number): string {
  const offset = tokenCharOffset(tokens, tokenIndex);
  const sentences = passage.split(/(?<=[.!?])\s+/);
  // Reconstruct char ranges. Each sentence boundary in the original passage is followed by
  // exactly the whitespace that was consumed by the lookbehind split. We reconstruct by
  // walking the original passage and matching each sentence's start.
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const start = passage.indexOf(s, cursor);
    if (start === -1) continue;
    const end = start + s.length;
    if (offset >= start && offset < end) return s;
    cursor = end;
  }
  return sentences[sentences.length - 1] || passage;
}

/** Speak a single sentence at slow rate using the Web Speech API. Safe to call when unsupported. */
export function speakSentenceForBlank(passage: string, tokens: string[], tokenIndex: number): void {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) return;
  const sentence = getSentenceForBlank(passage, tokens, tokenIndex);
  if (!sentence || !sentence.trim()) return;
  window.speechSynthesis.cancel();
  const utt = new (window as any).SpeechSynthesisUtterance(sentence);
  utt.rate = 0.75;
  utt.lang = 'en-US';
  window.speechSynthesis.speak(utt);
}

/** Indices (within blanks array) whose answer is incorrect, given current answers. */
export function computeMissedBlankIndices(
  blanks: ClozeBlank[],
  answers: Record<number, string>
): number[] {
  const out: number[] = [];
  for (let i = 0; i < blanks.length; i++) {
    const b = blanks[i];
    const userAnswer = (answers[b.index] || '').trim().toLowerCase();
    const expected = b.word.toLowerCase();
    if (userAnswer !== expected) out.push(i);
  }
  return out;
}

export function ClozeListening({ passage }: ClozeListeningProps) {
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [clozeData] = useState(() => extractClozeBlanks(passage, 6));
  const [lockedBlanks, setLockedBlanks] = useState<Set<number>>(new Set());
  const [firstTry, setFirstTry] = useState<{ correct: number; total: number } | null>(null);
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const handleReplay = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(passage);
      utt.rate = 0.85;
      utt.lang = 'en-US';
      window.speechSynthesis.speak(utt);
    }
  }, [passage]);

  const blankIndices = new Set(clozeData.blanks.map(b => b.index));

  const getResult = (blank: ClozeBlank): 'correct' | 'wrong' => {
    if (lockedBlanks.has(blank.index)) return 'correct';
    const userAnswer = (answers[blank.index] || '').trim().toLowerCase();
    const expected = blank.word.toLowerCase();
    return userAnswer === expected ? 'correct' : 'wrong';
  };

  const correctCount = submitted
    ? clozeData.blanks.filter(b => getResult(b) === 'correct').length
    : 0;

  const handleSubmit = () => {
    setSubmitted(true);
    if (firstTry === null) {
      const correct = clozeData.blanks.filter(b => {
        const userAnswer = (answers[b.index] || '').trim().toLowerCase();
        return userAnswer === b.word.toLowerCase();
      }).length;
      setFirstTry({ correct, total: clozeData.blanks.length });
    }
  };

  const handleReset = () => {
    setAnswers({});
    setSubmitted(false);
    setLockedBlanks(new Set());
    setFirstTry(null);
  };

  const handleRetryMissed = () => {
    // Lock currently-correct blanks and clear wrong ones.
    const newLocked = new Set(lockedBlanks);
    const newAnswers: Record<number, string> = { ...answers };
    let firstMissedTokenIndex: number | null = null;
    for (const b of clozeData.blanks) {
      const userAnswer = (answers[b.index] || '').trim().toLowerCase();
      const isCorrect = lockedBlanks.has(b.index) || userAnswer === b.word.toLowerCase();
      if (isCorrect) {
        newLocked.add(b.index);
      } else {
        delete newAnswers[b.index];
        if (firstMissedTokenIndex === null) firstMissedTokenIndex = b.index;
      }
    }
    setLockedBlanks(newLocked);
    setAnswers(newAnswers);
    setSubmitted(false);
    handleReplay();
    // Focus the first missed input on next paint.
    if (firstMissedTokenIndex !== null) {
      const target = firstMissedTokenIndex;
      setTimeout(() => {
        const el = inputRefs.current[target];
        if (el) el.focus();
      }, 0);
    }
  };

  const missedCount = submitted
    ? clozeData.blanks.filter(b => getResult(b) === 'wrong').length
    : 0;

  if (clozeData.blanks.length === 0) return null;

  return (
    <div
      data-testid="cloze-listening"
      style={{
        marginTop: 24,
        padding: 20,
        background: 'var(--bg-secondary, #f5f5f5)',
        borderRadius: 12,
        border: '1px solid var(--border-color, #e5e7eb)',
      }}
    >
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
                const isLocked = lockedBlanks.has(i);
                const result = submitted || isLocked ? getResult(blank) : null;

                if (isLocked) {
                  return (
                    <span
                      key={i}
                      data-testid={`cloze-locked-${i}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        padding: '2px 6px',
                        fontSize: 14,
                        border: '2px solid var(--success, #22c55e)',
                        borderRadius: 6,
                        background: 'var(--success-bg, #f0fdf4)',
                        color: 'var(--success, #16a34a)',
                        fontWeight: 600,
                      }}
                    >
                      {blank.word}
                      <CheckCircle size={14} color="var(--success, #22c55e)" />
                    </span>
                  );
                }

                return (
                  <span key={i} style={{ display: 'inline-block', verticalAlign: 'bottom' }}>
                    <input
                      ref={(el) => { inputRefs.current[i] = el; }}
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
                        <button
                          type="button"
                          onClick={() => speakSentenceForBlank(passage, clozeData.tokens, i)}
                          aria-label={`Hear sentence containing blank ${clozeData.blanks.indexOf(blank) + 1}`}
                          data-testid={`cloze-speak-sentence-${i}`}
                          style={{
                            marginLeft: 4,
                            padding: '0 4px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 13,
                            verticalAlign: 'middle',
                          }}
                        >
                          🔊
                        </button>
                      </span>
                    )}
                  </span>
                );
              }
              return <span key={i}>{token}</span>;
            })}
          </div>

          {submitted ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {firstTry && (
                <span
                  data-testid="cloze-first-try-score"
                  style={{ fontSize: 14, color: 'var(--text-secondary, #6b7280)', fontWeight: 500 }}
                >
                  First-try: {firstTry.correct}/{firstTry.total}
                </span>
              )}
              <span
                data-testid="cloze-final-score"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: correctCount === clozeData.blanks.length ? 'var(--success, #22c55e)' : 'var(--text-primary, #1f2937)',
                }}
              >
                {firstTry && lockedBlanks.size > 0 ? 'Final' : 'Score'}: {correctCount}/{clozeData.blanks.length}
              </span>
              {missedCount > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={handleRetryMissed}
                  data-testid="cloze-retry-missed-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                >
                  🔁 Retry Missed ({missedCount})
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={handleReset}
                data-testid="cloze-reset-all-btn"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              >
                <RotateCcw size={14} /> ↺ Reset All
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
