import { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { api, type MinimalPairItem } from '../../api';

interface MinimalPairsExerciseProps {
  tts: {
    speak: (text: string) => void;
    isSpeaking: boolean;
  };
  difficultyFilter: 'all' | 'beginner' | 'intermediate' | 'advanced';
  setDifficultyFilter: (v: 'all' | 'beginner' | 'intermediate' | 'advanced') => void;
  onBack: () => void;
}

export function MinimalPairsExercise({ tts, difficultyFilter, setDifficultyFilter, onBack }: MinimalPairsExerciseProps) {
  const [phase, setPhase] = useState<'select' | 'practice' | 'finished'>('select');
  const [mpPairs, setMpPairs] = useState<MinimalPairItem[]>([]);
  const [mpIndex, setMpIndex] = useState(0);
  const [mpAnswer, setMpAnswer] = useState<string | null>(null);
  const [mpRevealed, setMpRevealed] = useState(false);
  const [mpResults, setMpResults] = useState<boolean[]>([]);
  const [mpFinished, setMpFinished] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);

  if (phase === 'select') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
          Listen to a word and choose which one you heard. Train your ear to distinguish similar English sounds.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((level) => (
            <button
              key={level}
              className={`btn ${difficultyFilter === level ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDifficultyFilter(level)}
              style={{ fontSize: 13, padding: '4px 12px' }}
            >
              {level === 'all' ? 'All' : level === 'beginner' ? '🌱 Beginner' : level === 'intermediate' ? '📗 Intermediate' : '🚀 Advanced'}
            </button>
          ))}
        </div>
        <button
          className="btn btn-primary"
          disabled={mpLoading}
          onClick={async () => {
            setMpLoading(true);
            try {
              const diff = difficultyFilter === 'all' ? undefined : difficultyFilter;
              const res = await api.getMinimalPairs(diff, 10);
              setMpPairs(res.pairs);
              setMpIndex(0);
              setMpAnswer(null);
              setMpRevealed(false);
              setMpResults([]);
              setMpFinished(false);
              setPhase('practice');
            } catch (err) {
              console.error('Failed to load minimal pairs:', err);
            } finally {
              setMpLoading(false);
            }
          }}
          style={{ padding: '10px 32px', fontSize: 16 }}
        >
          {mpLoading ? 'Loading…' : '🎧 Start Exercise'}
        </button>
      </div>
    );
  }

  if (mpFinished) {
    const correct = mpResults.filter(Boolean).length;
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h3 style={{ marginBottom: 16 }}>Minimal Pairs Results</h3>
        <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
          {correct}/{mpResults.length}
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>correct answers</p>

        {mpPairs.filter((_, i) => !mpResults[i]).length > 0 && (
          <div style={{ textAlign: 'left', marginBottom: 24 }}>
            <h4 style={{ marginBottom: 8 }}>Review missed pairs:</h4>
            {mpPairs.filter((_, i) => !mpResults[i]).map((pair, i) => (
              <div key={i} style={{ padding: 10, marginBottom: 8, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{pair.word_a}</span>
                  <span style={{ color: 'var(--text-secondary)', margin: '0 8px' }}>vs</span>
                  <span style={{ fontWeight: 600 }}>{pair.word_b}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>({pair.phoneme_contrast})</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => tts.speak(pair.word_a)} disabled={tts.isSpeaking} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                    <Volume2 size={16} color="var(--primary)" />
                  </button>
                  <button onClick={() => tts.speak(pair.word_b)} disabled={tts.isSpeaking} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                    <Volume2 size={16} color="var(--primary)" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="btn btn-primary" onClick={onBack}>Back to Selection</button>
      </div>
    );
  }

  const currentPair = mpPairs[mpIndex];
  const playedWord = currentPair.play_word === 'a' ? currentPair.word_a : currentPair.word_b;

  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h3 style={{ marginBottom: 8 }}>Minimal Pairs ({mpIndex + 1}/{mpPairs.length})</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Sound contrast: <strong>{currentPair.phoneme_contrast}</strong>
      </p>

      <button
        className="btn btn-primary"
        onClick={() => tts.speak(playedWord)}
        disabled={tts.isSpeaking}
        style={{ marginBottom: 24, padding: '12px 32px', fontSize: 18 }}
      >
        🔊 {tts.isSpeaking ? 'Playing…' : 'Play Sound'}
      </button>

      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>Which word did you hear?</p>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 16 }}>
        {['a', 'b'].map((choice) => {
          const word = choice === 'a' ? currentPair.word_a : currentPair.word_b;
          const isSelected = mpAnswer === choice;
          const isCorrect = choice === currentPair.play_word;
          let bg = 'var(--card-bg, #fff)';
          let border = '2px solid var(--border, #e5e7eb)';
          if (mpRevealed) {
            if (isCorrect) { bg = '#dcfce7'; border = '2px solid var(--success, #22c55e)'; }
            else if (isSelected && !isCorrect) { bg = '#fee2e2'; border = '2px solid var(--danger, #ef4444)'; }
          }
          return (
            <button
              key={choice}
              onClick={() => {
                if (mpRevealed) return;
                setMpAnswer(choice);
                setMpRevealed(true);
                setMpResults((prev) => [...prev, choice === currentPair.play_word]);
              }}
              disabled={mpRevealed}
              style={{ padding: '16px 32px', fontSize: 20, fontWeight: 600, background: bg, border, borderRadius: 8, cursor: mpRevealed ? 'default' : 'pointer', minWidth: 120 }}
            >
              {word}
            </button>
          );
        })}
      </div>

      {mpRevealed && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            {mpAnswer === currentPair.play_word ? '✅ Correct!' : `❌ The word was "${playedWord}"`}
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 12 }}>
            <button onClick={() => tts.speak(currentPair.word_a)} disabled={tts.isSpeaking} className="btn btn-secondary" style={{ fontSize: 13 }}>
              🔊 {currentPair.word_a}
            </button>
            <button onClick={() => tts.speak(currentPair.word_b)} disabled={tts.isSpeaking} className="btn btn-secondary" style={{ fontSize: 13 }}>
              🔊 {currentPair.word_b}
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <em>"{currentPair.example_a}"</em><br />
            <em>"{currentPair.example_b}"</em>
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (mpIndex < mpPairs.length - 1) {
                setMpIndex((i) => i + 1);
                setMpAnswer(null);
                setMpRevealed(false);
              } else {
                setMpFinished(true);
              }
            }}
            style={{ marginTop: 12 }}
          >
            {mpIndex < mpPairs.length - 1 ? 'Next Pair →' : 'See Results'}
          </button>
        </div>
      )}
    </div>
  );
}
