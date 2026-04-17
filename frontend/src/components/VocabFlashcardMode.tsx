import { useState, useCallback } from 'react';
import VocabSRSProgress, { type SRSChange } from './VocabSRSProgress';
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
  reverse?: boolean;
}

export default function VocabFlashcardMode({ initialWords, tts, onBack, reverse = false }: VocabFlashcardModeProps) {
  const [phase, setPhase] = useState<'review' | 'result'>('review');
  const [words, setWords] = useState(initialWords);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [srsChanges, setSrsChanges] = useState<SRSChange[]>([]);

  const handleAnswer = useCallback(async (known: boolean) => {
    const word = words[index];
    api.submitAnswer(word.id, known).then(res => {
      setSrsChanges(prev => [...prev, { word: word.word, newLevel: res.new_level, isCorrect: known, nextReview: res.next_review }]);
    }).catch(() => {});
    setAnswers(prev => [...prev, known]);
    if (index + 1 >= words.length) {
      setPhase('result');
    } else {
      setIndex(prev => prev + 1);
      setFlipped(false);
      if (!reverse) {
        tts.speak(words[index + 1].word);
      }
    }
  }, [words, index, tts, reverse]);

  const reviewAgain = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDrillWords(10);
      if (data.words?.length) {
        setWords(data.words.slice(0, 10));
        setIndex(0);
        setAnswers([]);
        setFlipped(false);
        setSrsChanges([]);
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
        <p style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
          You reviewed {total} words at your own pace.
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>
          Mode: {reverse ? 'Meaning → Word' : 'Word → Meaning'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: 'var(--success-bg)', borderRadius: 12, border: '1px solid var(--success-border)' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--success-text)' }}>{known}</div>
            <div style={{ fontSize: 14, color: 'var(--success-text-strong)' }}>Got It</div>
          </div>
          <div style={{ padding: 16, background: 'var(--danger-bg)', borderRadius: 12, border: '1px solid var(--danger-border)' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--danger-text)' }}>{total - known}</div>
            <div style={{ fontSize: 14, color: 'var(--danger-text-strong)' }}>Again</div>
          </div>
        </div>

        {total > 0 && (
          <div style={{ marginBottom: 24, padding: 16, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>Recall Rate</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round((known / total) * 100)}%</div>
          </div>
        )}

        <VocabSRSProgress changes={srsChanges} />

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

  // In reverse mode, show meaning on front / word on back
  const frontContent = reverse ? currentWord.meaning : currentWord.word;
  const backContent = reverse ? currentWord.word : currentWord.meaning;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 8, textAlign: 'center' }}>🃏 Flashcard Review</h2>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12, marginBottom: 8 }}>
        {reverse ? 'Meaning → Word' : 'Word → Meaning'}
      </p>
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
        {reverse ? (
          <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', lineHeight: 1.5 }}>
            {frontContent}
          </span>
        ) : (
          <span
            style={{ fontSize: 32, fontWeight: 700, color: 'var(--primary)', cursor: 'pointer' }}
            onClick={() => tts.speak(currentWord.word)}
          >
            {frontContent} 🔊
          </span>
        )}

        {flipped ? (
          <div style={{ marginTop: 20 }}>
            {reverse ? (
              <p
                style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)', cursor: 'pointer' }}
                onClick={() => tts.speak(currentWord.word)}
              >
                {backContent} 🔊
              </p>
            ) : (
              <p style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>{backContent}</p>
            )}
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
              flex: 1, background: 'var(--danger-bg)', border: '2px solid var(--danger-accent)',
              color: 'var(--danger-text-strong)', fontWeight: 600, fontSize: '1rem',
            }}
          >
            Again
          </button>
          <button
            className="btn"
            onClick={() => handleAnswer(true)}
            style={{
              flex: 1, background: 'var(--success-bg)', border: '2px solid var(--success-accent)',
              color: 'var(--success-text-strong)', fontWeight: 600, fontSize: '1rem',
            }}
          >
            Got It ✓
          </button>
        </div>
      )}
    </div>
  );
}
