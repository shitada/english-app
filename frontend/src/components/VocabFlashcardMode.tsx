import { useState, useCallback } from 'react';
import { api } from '../api';

interface FlashcardWord {
  id: number;
  word: string;
  meaning: string;
  topic: string;
  difficulty: number;
}

interface VocabFlashcardModeProps {
  initialWords: FlashcardWord[];
  tts: { speak: (text: string) => void };
  onBack: () => void;
}

export default function VocabFlashcardMode({ initialWords, tts, onBack }: VocabFlashcardModeProps) {
  const [phase, setPhase] = useState<'review' | 'result'>('review');
  const [words, setWords] = useState(initialWords);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAnswer = useCallback(async (known: boolean) => {
    const word = words[index];
    try { await api.submitAnswer(word.id, known); } catch { /* ignore */ }
    setAnswers(prev => [...prev, known]);
    if (index + 1 >= words.length) {
      setPhase('result');
    } else {
      setIndex(prev => prev + 1);
      setFlipped(false);
      tts.speak(words[index + 1].word);
    }
  }, [words, index, tts]);

  const reviewAgain = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDrillWords(10);
      if (data.words?.length) {
        setWords(data.words.slice(0, 10));
        setIndex(0);
        setAnswers([]);
        setFlipped(false);
        setPhase('review');
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  if (phase === 'result') {
    const known = answers.filter(Boolean).length;
    const total = answers.length;

    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>🃏 Flashcard Review Complete!</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          You reviewed {total} words at your own pace.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#16a34a' }}>{known}</div>
            <div style={{ fontSize: 14, color: '#166534' }}>Got It</div>
          </div>
          <div style={{ padding: 16, background: '#fef2f2', borderRadius: 12, border: '1px solid #fecaca' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#dc2626' }}>{total - known}</div>
            <div style={{ fontSize: 14, color: '#991b1b' }}>Again</div>
          </div>
        </div>

        {total > 0 && (
          <div style={{ marginBottom: 24, padding: 16, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>Recall Rate</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round((known / total) * 100)}%</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={reviewAgain} disabled={loading} style={{ flex: 1 }}>
            🃏 Review Again
          </button>
          <button className="btn" onClick={onBack} style={{ flex: 1 }}>
            Back to Topics
          </button>
        </div>
      </div>
    );
  }

  // Active review
  const currentWord = words[index];
  const progress = words.length > 0 ? (index / words.length) * 100 : 0;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 8, textAlign: 'center' }}>🃏 Flashcard Review</h2>
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: '#06b6d4', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        {index + 1} / {words.length}
      </p>

      <div
        style={{
          padding: 32, borderRadius: 16, border: '2px solid var(--border)',
          background: 'var(--surface)', textAlign: 'center', minHeight: 200,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span
          style={{ fontSize: 32, fontWeight: 700, color: 'var(--primary)', cursor: 'pointer' }}
          onClick={() => tts.speak(currentWord.word)}
        >
          {currentWord.word} 🔊
        </span>

        {flipped ? (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>{currentWord.meaning}</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              Topic: {currentWord.topic.replace(/_/g, ' ')}
            </p>
          </div>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => setFlipped(true)}
            style={{ marginTop: 24 }}
          >
            Show Answer
          </button>
        )}
      </div>

      {flipped && (
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button
            className="btn"
            onClick={() => handleAnswer(false)}
            style={{
              flex: 1, background: '#fef2f2', border: '2px solid #fca5a5',
              color: '#991b1b', fontWeight: 600, fontSize: '1rem',
            }}
          >
            Again
          </button>
          <button
            className="btn"
            onClick={() => handleAnswer(true)}
            style={{
              flex: 1, background: '#f0fdf4', border: '2px solid #86efac',
              color: '#166534', fontWeight: 600, fontSize: '1rem',
            }}
          >
            Got It ✓
          </button>
        </div>
      )}
    </div>
  );
}
