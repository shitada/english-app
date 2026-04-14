import { useState, useCallback, useEffect, useRef } from 'react';
import { Ear, Volume2, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api, type MinimalPairItem } from '../api';

const PAIRS_PER_SESSION = 5;

interface PairResult {
  pair: MinimalPairItem;
  played: 'a' | 'b';
  chosen: 'a' | 'b';
  correct: boolean;
}

export default function QuickMinimalPairsCard() {
  const tts = useSpeechSynthesis();

  const [pairs, setPairs] = useState<MinimalPairItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [played, setPlayed] = useState<'a' | 'b' | null>(null);
  const [results, setResults] = useState<PairResult[]>([]);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'answering' | 'feedback' | 'done'>('idle');
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  const fetchPairs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMinimalPairs(undefined, PAIRS_PER_SESSION);
      if (res.pairs.length > 0) {
        setPairs(res.pairs);
        setCurrentIdx(0);
        setResults([]);
        setPhase('idle');
        setPlayed(null);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      fetchPairs();
    }
  }, [fetchPairs]);

  const currentPair = pairs[currentIdx] ?? null;

  const handlePlay = useCallback(() => {
    if (!currentPair) return;
    const choice: 'a' | 'b' = Math.random() < 0.5 ? 'a' : 'b';
    const word = choice === 'a' ? currentPair.word_a : currentPair.word_b;
    tts.speak(word);
    setPlayed(choice);
    setPhase('answering');
  }, [currentPair, tts]);

  const handleAnswer = useCallback((chosen: 'a' | 'b') => {
    if (!currentPair || !played) return;
    const correct = chosen === played;
    setResults(prev => [...prev, { pair: currentPair, played, chosen, correct }]);
    setPhase('feedback');
  }, [currentPair, played]);

  const handleNext = useCallback(async () => {
    const nextIdx = currentIdx + 1;
    if (nextIdx >= pairs.length || nextIdx >= PAIRS_PER_SESSION) {
      setPhase('done');
      // Save results
      setSaving(true);
      try {
        const allResults = [...results];
        const lastResult = results[results.length - 1];
        if (lastResult) {
          await api.saveMinimalPairsResults(
            allResults.map(r => ({
              phoneme_contrast: r.pair.phoneme_contrast,
              word_a: r.pair.word_a,
              word_b: r.pair.word_b,
              is_correct: r.correct,
            }))
          );
        }
      } catch { /* ignore */ }
      finally { setSaving(false); }
    } else {
      setCurrentIdx(nextIdx);
      setPlayed(null);
      setPhase('idle');
    }
  }, [currentIdx, pairs.length, results]);

  const handleRestart = useCallback(() => {
    setPhase('idle');
    setPlayed(null);
    setResults([]);
    fetchPairs();
  }, [fetchPairs]);

  if (!tts.isSupported) return null;

  const lastResult = results[results.length - 1];
  const correctCount = results.filter(r => r.correct).length;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Ear size={20} color="#8b5cf6" />
        <strong style={{ fontSize: 15, color: 'var(--text)' }}>Minimal Pairs</strong>
        {pairs.length > 0 && phase !== 'done' && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-secondary)' }}>
            {currentIdx + 1}/{Math.min(pairs.length, PAIRS_PER_SESSION)}
          </span>
        )}
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading pairs...</p>}

      {!loading && phase === 'done' && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <p style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
            {correctCount}/{results.length}
          </p>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            {correctCount === results.length ? '🎯 Perfect ear!' : correctCount >= 3 ? '👍 Good listening!' : '💪 Keep practicing!'}
          </p>
          {results.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
              fontSize: 13, color: 'var(--text-secondary)',
            }}>
              {r.correct ? <CheckCircle size={14} color="#22c55e" /> : <XCircle size={14} color="#ef4444" />}
              <span>{r.pair.word_a} vs {r.pair.word_b}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>{r.pair.phoneme_contrast}</span>
            </div>
          ))}
          <button onClick={handleRestart} disabled={saving} style={{
            marginTop: 12, padding: '8px 16px', border: 'none', borderRadius: 8,
            background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <RefreshCw size={14} /> Try Again
          </button>
        </div>
      )}

      {!loading && currentPair && phase !== 'done' && (
        <div style={{ textAlign: 'center' }}>
          {phase === 'idle' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                Listen and identify the word you hear
              </p>
              <button onClick={handlePlay} style={{
                padding: '10px 20px', border: 'none', borderRadius: 10,
                background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
                fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                <Volume2 size={18} /> Play Sound
              </button>
            </>
          )}

          {phase === 'answering' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                Which word did you hear?
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                {(['a', 'b'] as const).map(choice => (
                  <button key={choice} onClick={() => handleAnswer(choice)} style={{
                    padding: '10px 24px', border: '2px solid var(--border)', borderRadius: 10,
                    background: 'var(--card-bg, white)', cursor: 'pointer',
                    fontSize: 16, fontWeight: 600, color: 'var(--text)', minWidth: 100,
                    transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    {choice === 'a' ? currentPair.word_a : currentPair.word_b}
                  </button>
                ))}
              </div>
              <button onClick={handlePlay} style={{
                marginTop: 10, padding: '6px 12px', border: 'none', borderRadius: 6,
                background: 'transparent', cursor: 'pointer', fontSize: 13,
                color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                <Volume2 size={14} /> Replay
              </button>
            </>
          )}

          {phase === 'feedback' && lastResult && (
            <>
              <div style={{
                padding: '10px 16px', borderRadius: 10, marginBottom: 10,
                background: lastResult.correct ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              }}>
                {lastResult.correct
                  ? <p style={{ margin: 0, color: '#22c55e', fontWeight: 600 }}>✅ Correct!</p>
                  : <p style={{ margin: 0, color: '#ef4444', fontWeight: 600 }}>
                      ❌ It was "{lastResult.played === 'a' ? lastResult.pair.word_a : lastResult.pair.word_b}"
                    </p>
                }
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {currentPair.phoneme_contrast}
                </p>
              </div>
              <button onClick={handleNext} style={{
                padding: '8px 16px', border: 'none', borderRadius: 8,
                background: 'var(--primary, #3b82f6)', color: 'white', cursor: 'pointer',
                fontSize: 14, fontWeight: 600,
              }}>
                {currentIdx + 1 >= Math.min(pairs.length, PAIRS_PER_SESSION) ? 'See Results' : 'Next Pair'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
