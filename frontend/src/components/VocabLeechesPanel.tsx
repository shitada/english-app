import { useEffect, useState, useCallback } from 'react';
import { Volume2, ChevronDown, ChevronRight } from 'lucide-react';
import { api, fetchVocabLeeches, type LeechWordItem } from '../api';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

interface VocabLeechesPanelProps {
  limit?: number;
}

type DrillState = {
  word: LeechWordItem;
  guess: string;
  result: 'pending' | 'correct' | 'incorrect';
};

type RoundSummary = {
  total: number;
  correct: number;
};

export default function VocabLeechesPanel({ limit = 10 }: VocabLeechesPanelProps) {
  const [open, setOpen] = useState(false);
  const [leeches, setLeeches] = useState<LeechWordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [drillQueue, setDrillQueue] = useState<LeechWordItem[]>([]);
  const [drillIdx, setDrillIdx] = useState(0);
  const [drillState, setDrillState] = useState<DrillState | null>(null);
  const [drillResults, setDrillResults] = useState<{ word: string; correct: boolean }[]>([]);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const tts = useSpeechSynthesis();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchVocabLeeches(limit);
      setLeeches(data.leeches || []);
    } catch {
      setLeeches([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { void load(); }, [load]);

  const speak = (word: string) => {
    try { tts.speak(word); } catch { /* ignore */ }
  };

  const startDrill = (subset?: LeechWordItem[]) => {
    const queue = (subset && subset.length ? subset : leeches).slice(0, 5);
    if (queue.length === 0) return;
    setDrillQueue(queue);
    setDrillIdx(0);
    setDrillResults([]);
    setSummary(null);
    setDrillState({ word: queue[0], guess: '', result: 'pending' });
    setTimeout(() => speak(queue[0].word), 50);
  };

  const submitGuess = async () => {
    if (!drillState || drillState.result !== 'pending') return;
    const target = drillState.word.word.trim().toLowerCase();
    const guess = drillState.guess.trim().toLowerCase();
    const isCorrect = guess === target;
    setDrillState({ ...drillState, result: isCorrect ? 'correct' : 'incorrect' });
    setDrillResults((prev) => [...prev, { word: drillState.word.word, correct: isCorrect }]);
    try {
      await api.submitAnswer(drillState.word.id, isCorrect);
    } catch { /* ignore network errors here; UI still advances */ }

    setTimeout(() => {
      const nextIdx = drillIdx + 1;
      if (nextIdx >= drillQueue.length) {
        const correctCount = [...drillResults, { word: drillState.word.word, correct: isCorrect }].filter(r => r.correct).length;
        setSummary({ total: drillQueue.length, correct: correctCount });
        setDrillState(null);
        void load();
      } else {
        setDrillIdx(nextIdx);
        const nextWord = drillQueue[nextIdx];
        setDrillState({ word: nextWord, guess: '', result: 'pending' });
        setTimeout(() => speak(nextWord.word), 50);
      }
    }, 900);
  };

  const closeDrill = () => {
    setDrillQueue([]);
    setDrillState(null);
    setSummary(null);
    setDrillResults([]);
    setDrillIdx(0);
  };

  return (
    <div
      data-testid="vocab-leeches-panel"
      style={{
        marginBottom: 20,
        padding: 14,
        borderRadius: 12,
        border: '2px solid #f59e0b',
        background: 'var(--bg-secondary, #fffbeb)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        data-testid="vocab-leeches-toggle"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary, #92400e)',
        }}
      >
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <span>🪤 Leech Words</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 500, opacity: 0.8 }}>
          {loading ? '…' : `${leeches.length} stubborn`}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {leeches.length === 0 && !loading && (
            <p data-testid="vocab-leeches-empty" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>
              🎉 No leeches right now — keep practicing to surface stubborn words.
            </p>
          )}

          {leeches.length > 0 && !drillState && !summary && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {leeches.map((l) => (
                  <div
                    key={l.id}
                    data-testid="vocab-leech-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: 8, borderRadius: 8, background: 'var(--bg-primary, #fff)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => speak(l.word)}
                      data-testid="vocab-leech-tts"
                      aria-label={`Play pronunciation of ${l.word}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f59e0b' }}
                    >
                      <Volume2 size={18} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{l.word}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        miss {Math.round(l.miss_rate * 100)}% · ✗{l.incorrect_count} ✓{l.correct_count}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startDrill([l])}
                      data-testid="vocab-leech-drill-row"
                      className="btn"
                      style={{
                        padding: '6px 12px', borderRadius: 8, border: '1px solid #f59e0b',
                        background: '#fef3c7', color: '#92400e', fontSize: '0.85rem', cursor: 'pointer',
                      }}
                    >
                      Drill
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => startDrill()}
                data-testid="vocab-leeches-drill-all"
                style={{
                  marginTop: 12, padding: '8px 14px', borderRadius: 8,
                  border: '1px solid #f59e0b', background: '#f59e0b', color: 'white',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                Drill top {Math.min(5, leeches.length)}
              </button>
            </>
          )}

          {drillState && (
            <div data-testid="vocab-leeches-drill" style={{ marginTop: 4 }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                Word {drillIdx + 1} / {drillQueue.length}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => speak(drillState.word.word)}
                  data-testid="vocab-leech-drill-replay"
                  aria-label="Replay audio"
                  style={{ background: 'none', border: '1px solid #f59e0b', borderRadius: 8, padding: 8, cursor: 'pointer', color: '#f59e0b' }}
                >
                  <Volume2 size={20} />
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{drillState.word.meaning}</div>
                  {drillState.word.example_sentence && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', opacity: 0.8 }}>
                      e.g. {drillState.word.example_sentence}
                    </div>
                  )}
                </div>
              </div>
              <input
                type="text"
                value={drillState.guess}
                onChange={(e) => setDrillState({ ...drillState, guess: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitGuess(); }}
                disabled={drillState.result !== 'pending'}
                placeholder="Type the word…"
                data-testid="vocab-leech-drill-input"
                autoFocus
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border, #ccc)', fontSize: '1rem',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={submitGuess}
                  disabled={drillState.result !== 'pending' || !drillState.guess.trim()}
                  data-testid="vocab-leech-drill-submit"
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: '1px solid #f59e0b',
                    background: '#f59e0b', color: 'white', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Check
                </button>
                {drillState.result === 'correct' && (
                  <span data-testid="vocab-leech-drill-feedback" style={{ color: 'var(--success, #22c55e)', fontWeight: 700 }}>✓ Correct</span>
                )}
                {drillState.result === 'incorrect' && (
                  <span data-testid="vocab-leech-drill-feedback" style={{ color: 'var(--danger, #ef4444)', fontWeight: 700 }}>
                    ✗ It was “{drillState.word.word}”
                  </span>
                )}
              </div>
            </div>
          )}

          {summary && (
            <div data-testid="vocab-leeches-summary" style={{ marginTop: 8 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Round complete: {summary.correct} / {summary.total} correct
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => startDrill()}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: '1px solid #f59e0b',
                    background: '#fef3c7', color: '#92400e', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Drill again
                </button>
                <button
                  type="button"
                  onClick={closeDrill}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border, #ccc)',
                    background: 'transparent', cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
