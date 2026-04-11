import { useState, useCallback, useEffect } from 'react';
import { Volume2, Check, X, ArrowRight, RotateCcw } from 'lucide-react';
import VocabSRSProgress, { type SRSChange } from './VocabSRSProgress';
import { api } from '../api';

interface DrillWord {
  id: number;
  word: string;
  meaning: string;
  topic: string;
  difficulty: number;
}

interface VocabSpellingBeeProps {
  initialWords: DrillWord[];
  onBack: () => void;
}

function speak(text: string, rate = 0.9) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function renderDiff(typed: string, correct: string) {
  const maxLen = Math.max(typed.length, correct.length);
  const chars: { char: string; color: string }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const c = correct[i] || '';
    const t = typed[i] || '';
    chars.push({ char: c || '_', color: t.toLowerCase() === c.toLowerCase() ? 'green' : 'red' });
  }
  return chars;
}

export default function VocabSpellingBee({ initialWords, onBack }: VocabSpellingBeeProps) {
  const [words] = useState(initialWords);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<{ word: string; typed: string; correct: boolean }[]>([]);
  const [srsChanges, setSrsChanges] = useState<SRSChange[]>([]);
  const [phase, setPhase] = useState<'practice' | 'result'>('practice');

  const w = words[index];
  const isCorrect = checked && input.trim().toLowerCase() === w?.word.toLowerCase();

  // Auto-play word on new question
  useEffect(() => {
    if (w && !checked) speak(w.word);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlay = useCallback(() => {
    if (w) speak(w.word);
  }, [w]);

  const handleSubmit = useCallback(() => {
    if (!w || checked) return;
    setChecked(true);
    const correct = input.trim().toLowerCase() === w.word.toLowerCase();
    api.submitAnswer(w.id, correct).then(res => {
      setSrsChanges(prev => [...prev, {
        word: w.word,
        isCorrect: correct,
        newLevel: res.new_level,
        nextReview: res.next_review,
      }]);
    }).catch(() => { /* ignore */ });
  }, [w, input, checked]);

  const handleNext = useCallback(() => {
    if (!w) return;
    const correct = input.trim().toLowerCase() === w.word.toLowerCase();
    setResults(prev => [...prev, { word: w.word, typed: input.trim(), correct }]);
    if (index + 1 < words.length) {
      setIndex(index + 1);
      setInput('');
      setChecked(false);
    } else {
      setPhase('result');
    }
  }, [w, input, index, words.length]);

  if (phase === 'result') {
    const correctCount = results.filter(r => r.correct).length;
    const pct = Math.round((correctCount / results.length) * 100);
    return (
      <div>
        <h2 style={{ marginBottom: 16 }}>🐝 Spelling Bee — Results</h2>
        <div style={{
          padding: 20, borderRadius: 12, marginBottom: 20,
          background: pct >= 70 ? 'var(--success-bg, #d1fae5)' : 'var(--warning-bg, #fef3c7)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{pct}%</div>
          <div style={{ color: 'var(--text-secondary)' }}>{correctCount}/{results.length} correct</div>
        </div>
        <div style={{ marginBottom: 20 }}>
          {results.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
              borderBottom: '1px solid var(--border)',
            }}>
              {r.correct ? <Check size={16} color="green" /> : <X size={16} color="red" />}
              <span style={{ fontWeight: 600 }}>{r.word}</span>
              {!r.correct && (
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  (you typed: "{r.typed}")
                </span>
              )}
            </div>
          ))}
        </div>
        <VocabSRSProgress changes={srsChanges} />
        <button onClick={onBack} style={{
          marginTop: 16, padding: '12px 24px', borderRadius: 8, cursor: 'pointer',
          border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
        }}>
          <RotateCcw size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Back to Vocabulary
        </button>
      </div>
    );
  }

  if (!w) return null;

  const diffChars = checked && !isCorrect ? renderDiff(input.trim(), w.word) : [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🐝 Spelling Bee</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {index + 1} / {words.length}
        </span>
      </div>

      <div style={{
        width: '100%', height: 6, borderRadius: 3, background: 'var(--border)',
        marginBottom: 20, overflow: 'hidden',
      }}>
        <div style={{
          width: `${((index) / words.length) * 100}%`, height: '100%',
          background: 'var(--primary)', borderRadius: 3, transition: 'width 0.3s',
        }} />
      </div>

      <div style={{
        padding: 20, borderRadius: 12, marginBottom: 16,
        background: 'var(--card-bg, #f9fafb)', border: '1px solid var(--border)',
        textAlign: 'center',
      }}>
        <button onClick={handlePlay} style={{
          padding: '16px 32px', borderRadius: 12, cursor: 'pointer',
          border: '2px solid #f59e0b', background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
          color: '#92400e', fontWeight: 600, fontSize: '1.1rem', marginBottom: 16,
        }}>
          <Volume2 size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          Play Word
        </button>

        <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', margin: '12px 0 0' }}>
          Hint: {w.meaning}
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !checked) handleSubmit(); }}
          placeholder="Type the spelling..."
          disabled={checked}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 8, fontSize: '1.1rem',
            border: checked
              ? `2px solid ${isCorrect ? 'green' : 'red'}`
              : '2px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text)',
            boxSizing: 'border-box', letterSpacing: '0.05em',
          }}
          aria-label="Type the spelling of the word"
        />
      </div>

      {checked && (
        <div style={{
          padding: 12, borderRadius: 8, marginBottom: 16,
          background: isCorrect ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)',
        }}>
          {isCorrect ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={18} color="green" /> Correct!
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <X size={18} color="red" /> Incorrect
              </div>
              <div style={{ fontSize: '1.1rem', letterSpacing: '0.1em' }}>
                {diffChars.map((c, i) => (
                  <span key={i} style={{ color: c.color, fontWeight: 700 }}>{c.char}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {!checked ? (
          <button onClick={handleSubmit} disabled={!input.trim()} style={{
            flex: 1, padding: '12px', borderRadius: 8, cursor: 'pointer',
            border: 'none', background: 'var(--primary)', color: 'white',
            fontWeight: 600, opacity: input.trim() ? 1 : 0.5,
          }}>
            Check
          </button>
        ) : (
          <button onClick={handleNext} style={{
            flex: 1, padding: '12px', borderRadius: 8, cursor: 'pointer',
            border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600,
          }}>
            {index + 1 < words.length ? (
              <><ArrowRight size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Next</>
            ) : 'See Results'}
          </button>
        )}
      </div>
    </div>
  );
}
