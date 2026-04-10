import { useState, useEffect, useRef, useCallback } from 'react';
import VocabSRSProgress, { type SRSChange } from './VocabSRSProgress';
import { api } from '../api';

interface DrillWord {
  id: number;
  word: string;
  meaning: string;
  topic: string;
  difficulty: number;
}

interface VocabDrillModeProps {
  initialWords: DrillWord[];
  tts: { speak: (text: string) => void };
  onBack: () => void;
}

export default function VocabDrillMode({ initialWords, tts, onBack }: VocabDrillModeProps) {
  const [phase, setPhase] = useState<'drill' | 'result'>('drill');
  const [words, setWords] = useState(initialWords);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [timeLeft, setTimeLeft] = useState(60);
  const [srsChanges, setSrsChanges] = useState<SRSChange[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const [loading, setLoading] = useState(false);

  const handleAnswer = useCallback((known: boolean) => {
    const word = words[index];
    if (!word) return;
    setAnswers(prev => [...prev, known]);
    api.submitAnswer(word.id, known).then(res => {
      setSrsChanges(prev => [...prev, { word: word.word, newLevel: res.new_level, isCorrect: known, nextReview: res.next_review }]);
    }).catch(() => {});

    const nextIdx = index + 1;
    if (nextIdx >= words.length) {
      clearInterval(timerRef.current);
      setPhase('result');
    } else {
      setIndex(nextIdx);
      tts.speak(words[nextIdx].word);
    }
  }, [words, index, tts]);

  useEffect(() => {
    if (phase !== 'drill') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setPhase('result');
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  const startAgain = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDrillWords(10);
      if (!data.words?.length) return;
      setWords(data.words.slice(0, 10));
      setIndex(0);
      setAnswers([]);
      setTimeLeft(60);
      setSrsChanges([]);
      setPhase('drill');
      tts.speak(data.words[0].word);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [tts]);

  if (phase === 'result') {
    const answered = answers.length;
    const known = answers.filter(Boolean).length;
    const timeUsed = 60 - timeLeft;

    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>⚡ Drill Complete!</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          You reviewed {answered} of {words.length} words in {timeUsed} seconds.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#16a34a' }}>{known}</div>
            <div style={{ fontSize: 14, color: '#166534' }}>Known</div>
          </div>
          <div style={{ padding: 16, background: '#fef2f2', borderRadius: 12, border: '1px solid #fecaca' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#dc2626' }}>{answered - known}</div>
            <div style={{ fontSize: 14, color: '#991b1b' }}>Need Practice</div>
          </div>
        </div>

        {answered > 0 && (
          <div style={{ marginBottom: 24, padding: 16, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>Accuracy</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round((known / answered) * 100)}%</div>
          </div>
        )}

        <VocabSRSProgress changes={srsChanges} />

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={startAgain} disabled={loading} style={{ flex: 1 }}>
            ⚡ Drill Again
          </button>
          <button className="btn" onClick={onBack} style={{ flex: 1 }}>
            Back to Topics
          </button>
        </div>
      </div>
    );
  }

  // Active drill
  const currentWord = words[index];
  const timerPct = (timeLeft / 60) * 100;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: timeLeft <= 10 ? '#ef4444' : '#f59e0b', width: `${timerPct}%`, transition: 'width 1s linear', borderRadius: 3 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, fontSize: 14, color: 'var(--text-secondary)' }}>
        <span>{index + 1} / {words.length}</span>
        <span>⏱ {timeLeft}s</span>
      </div>

      <h2 style={{ fontSize: 28, marginBottom: 4 }}>{currentWord.word}</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 15 }}>{currentWord.meaning}</p>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          className="btn"
          onClick={() => handleAnswer(false)}
          style={{
            flex: 1, background: '#fef2f2', border: '2px solid #fca5a5',
            color: '#991b1b', fontWeight: 600, fontSize: '1.1rem', padding: '14px 0',
          }}
        >
          Don&apos;t Know
        </button>
        <button
          className="btn"
          onClick={() => handleAnswer(true)}
          style={{
            flex: 1, background: '#f0fdf4', border: '2px solid #86efac',
            color: '#166534', fontWeight: 600, fontSize: '1.1rem', padding: '14px 0',
          }}
        >
          Know ✓
        </button>
      </div>
    </div>
  );
}
