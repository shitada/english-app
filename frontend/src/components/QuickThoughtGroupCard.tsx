import { useState, useCallback, useEffect, useRef } from 'react';
import { Scissors, Mic, Square, Volume2, RefreshCw, Eye, Trophy } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { getThoughtGroup, type ThoughtGroupResponse } from '../api';

type Phase = 'idle' | 'listen' | 'chunk' | 'check' | 'shadow' | 'evaluating' | 'done';

const BEST_F1_KEY = 'thought-group-best-f1';
const PAUSE_GAP_MS = 250;

interface ShadowResult {
  similarity: number; // 0..1 token overlap
  durationOk: boolean;
  durationMs: number;
  expectedMs: number;
  bonus: number; // 0 or 0.1
  finalScore: number; // similarity + bonus, capped 1
}

interface ChunkScore {
  precision: number;
  recall: number;
  f1: number;
  correctIndices: number[]; // user picks that matched
  wrongIndices: number[]; // user picks not in answer
  missedIndices: number[]; // answer pauses user didn't pick
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function computeChunkScore(userPicks: number[], correct: number[]): ChunkScore {
  const userSet = new Set(userPicks);
  const correctSet = new Set(correct);
  const correctIndices = userPicks.filter(i => correctSet.has(i));
  const wrongIndices = userPicks.filter(i => !correctSet.has(i));
  const missedIndices = correct.filter(i => !userSet.has(i));
  const tp = correctIndices.length;
  const precision = userPicks.length === 0 ? 0 : tp / userPicks.length;
  const recall = correct.length === 0 ? 0 : tp / correct.length;
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, correctIndices, wrongIndices, missedIndices };
}

function tipForScore(s: ChunkScore): string {
  if (s.f1 >= 0.9) return 'Excellent phrasing — your sense-group instincts are sharp.';
  if (s.recall < 0.5) return 'Try inserting pauses before subordinate clauses and after long subject phrases.';
  if (s.precision < 0.5) return 'Fewer pauses can sound smoother — keep them at meaningful boundaries.';
  return 'Solid grouping. Listen again to fine-tune timing at clause boundaries.';
}

export default function QuickThoughtGroupCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [data, setData] = useState<ThoughtGroupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [userPicks, setUserPicks] = useState<number[]>([]);
  const [chunkScore, setChunkScore] = useState<ChunkScore | null>(null);
  const [shadowResult, setShadowResult] = useState<ShadowResult | null>(null);
  const [bestF1, setBestF1] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem(BEST_F1_KEY) || '0');
      return isNaN(v) ? 0 : v;
    } catch { return 0; }
  });
  const [initialized, setInitialized] = useState(false);

  const expectedDurationRef = useRef<number>(0);
  const recordStartRef = useRef<number>(0);

  const fetchSentence = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getThoughtGroup(difficulty);
      setData(res);
      setUserPicks([]);
      setChunkScore(null);
      setShadowResult(null);
      setPhase('idle');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchSentence();
    }
  }, [initialized, fetchSentence]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        fetchSentence();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchSentence]);

  const handleListen = useCallback(() => {
    if (!data) return;
    setPhase('listen');
    tts.speak(data.sentence);
  }, [data, tts]);

  useEffect(() => {
    if (phase === 'listen' && !tts.isSpeaking) {
      const t = setTimeout(() => setPhase('chunk'), 250);
      return () => clearTimeout(t);
    }
  }, [phase, tts.isSpeaking]);

  const toggleGap = useCallback((gapIdx: number) => {
    setUserPicks(prev => {
      if (prev.includes(gapIdx)) return prev.filter(i => i !== gapIdx);
      return [...prev, gapIdx].sort((a, b) => a - b);
    });
  }, []);

  const playChunked = useCallback(async () => {
    if (!data) return;
    const picks = userPicks.length > 0 ? userPicks : data.pause_indices;
    // Split words by user picks; pauses occur AFTER word i (1-based)
    const groups: string[] = [];
    let start = 0;
    for (const i of picks) {
      groups.push(data.words.slice(start, i).join(' '));
      start = i;
    }
    if (start < data.words.length) groups.push(data.words.slice(start).join(' '));

    setPhase('listen');
    const startedAt = Date.now();
    for (let g = 0; g < groups.length; g++) {
      const segment = groups[g];
      if (!segment) continue;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(segment);
        u.lang = 'en-US';
        u.rate = 0.95;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
      if (g < groups.length - 1) {
        await new Promise(res => setTimeout(res, PAUSE_GAP_MS));
      }
    }
    expectedDurationRef.current = Date.now() - startedAt;
    setPhase('chunk');
  }, [data, userPicks]);

  const reveal = useCallback(() => {
    if (!data) return;
    const score = computeChunkScore(userPicks, data.pause_indices);
    setChunkScore(score);
    setPhase('check');
  }, [data, userPicks]);

  const startShadow = useCallback(() => {
    speech.reset();
    speech.start();
    recordStartRef.current = Date.now();
    setPhase('shadow');
  }, [speech]);

  const stopShadow = useCallback(() => {
    speech.stop();
    const transcript = (speech.transcript || speech.interimTranscript || '').trim();
    const elapsed = Date.now() - recordStartRef.current;
    if (!data) {
      setPhase('check');
      return;
    }
    setPhase('evaluating');

    // Token overlap similarity
    const expectedTokens = tokenize(data.sentence);
    const userTokens = tokenize(transcript);
    const expectedSet = new Set(expectedTokens);
    let overlap = 0;
    const seen = new Set<string>();
    for (const t of userTokens) {
      if (expectedSet.has(t) && !seen.has(t)) {
        overlap++;
        seen.add(t);
      }
    }
    const denom = Math.max(expectedTokens.length, 1);
    const similarity = Math.min(1, overlap / denom);

    const expectedMs = expectedDurationRef.current || (data.words.length * 380);
    const ratio = elapsed / Math.max(expectedMs, 1);
    const durationOk = ratio >= 0.85 && ratio <= 1.15;
    const bonus = durationOk ? 0.1 : 0;
    const finalScore = Math.min(1, similarity + bonus);

    const result: ShadowResult = {
      similarity,
      durationOk,
      durationMs: elapsed,
      expectedMs,
      bonus,
      finalScore,
    };
    setShadowResult(result);

    // Persist best F1 (combined: chunk F1 floor + shadow boost)
    if (chunkScore) {
      const composite = chunkScore.f1; // best F1 is on chunking accuracy
      if (composite > bestF1) {
        try { localStorage.setItem(BEST_F1_KEY, composite.toFixed(3)); } catch { /* ignore */ }
        setBestF1(composite);
      }
    }
    setPhase('done');
  }, [speech, data, chunkScore, bestF1]);

  const handleNew = useCallback(() => {
    speech.stop();
    speech.reset();
    tts.stop();
    fetchSentence();
  }, [fetchSentence, speech, tts]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const renderChips = (showColors: boolean) => {
    if (!data) return null;
    const correctSet = new Set(data.pause_indices);
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: '0.5rem' }}>
        {data.words.map((w, i) => {
          const gapIdx = i + 1; // pause AFTER this 1-based word index
          const isLast = i === data.words.length - 1;
          const picked = userPicks.includes(gapIdx);
          let gapColor = 'transparent';
          let gapText = picked ? '|' : '·';
          if (showColors && !isLast) {
            if (picked && correctSet.has(gapIdx)) gapColor = '#22c55e';
            else if (picked && !correctSet.has(gapIdx)) gapColor = '#ef4444';
            else if (!picked && correctSet.has(gapIdx)) { gapColor = '#9ca3af'; gapText = '|'; }
          }
          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span style={{
                padding: '4px 8px',
                background: 'var(--card-bg, #fff)',
                border: '1px solid var(--border, #d1d5db)',
                borderRadius: 6,
                fontSize: '0.9rem',
                color: 'var(--text)',
              }}>{w}</span>
              {!isLast && (
                <button
                  type="button"
                  onClick={() => phase === 'chunk' && toggleGap(gapIdx)}
                  disabled={phase !== 'chunk'}
                  aria-label={`gap after word ${gapIdx}`}
                  data-testid={`tg-gap-${gapIdx}`}
                  style={{
                    margin: '0 2px',
                    minWidth: 14,
                    padding: '4px 4px',
                    background: showColors && gapColor !== 'transparent' ? gapColor : (picked ? '#3b82f6' : 'transparent'),
                    color: picked || (showColors && gapColor !== 'transparent') ? '#fff' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: phase === 'chunk' ? 'pointer' : 'default',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    lineHeight: 1,
                  }}
                >{gapText}</button>
              )}
            </span>
          );
        })}
      </div>
    );
  };

  const showColors = phase === 'check' || phase === 'shadow' || phase === 'evaluating' || phase === 'done';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <Scissors size={20} color="#8b5cf6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Thought-Group Phrasing</h3>
        {bestF1 > 0 && (
          <span title="Best F1" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 12, marginLeft: 'auto',
            background: '#fef3c7', color: '#92400e', fontSize: '0.7rem', fontWeight: 600,
          }}>
            <Trophy size={12} /> Best F1: {(bestF1 * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading sentence…</p>
      ) : !data ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No sentence available.</p>
      ) : (
        <div>
          {renderChips(showColors)}

          {phase === 'chunk' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
              Tap the dots between words to insert <strong>|</strong> pause markers.
            </p>
          )}

          {chunkScore && (phase === 'check' || phase === 'shadow' || phase === 'evaluating' || phase === 'done') && (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#22c55e' }}>{(chunkScore.precision * 100).toFixed(0)}%</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Precision</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3b82f6' }}>{(chunkScore.recall * 100).toFixed(0)}%</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Recall</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#8b5cf6' }}>{(chunkScore.f1 * 100).toFixed(0)}%</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>F1</div>
              </div>
            </div>
          )}

          {chunkScore && phase !== 'done' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
              💡 {tipForScore(chunkScore)}
            </p>
          )}

          {phase === 'shadow' && (speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}

          {phase === 'evaluating' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Scoring shadow…</p>
          )}

          {phase === 'done' && shadowResult && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Shadow similarity</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>{(shadowResult.similarity * 100).toFixed(0)}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Duration</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: shadowResult.durationOk ? '#22c55e' : '#f59e0b' }}>
                    {(shadowResult.durationMs / 1000).toFixed(1)}s {shadowResult.durationOk ? '✓' : ''}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Final</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#8b5cf6' }}>{(shadowResult.finalScore * 100).toFixed(0)}%</div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleListen}
              className="btn btn-secondary"
              disabled={phase === 'listen' || phase === 'shadow'}
              data-testid="tg-listen"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Volume2 size={14} /> Listen
            </button>

            <button
              onClick={playChunked}
              className="btn btn-secondary"
              disabled={!data || phase === 'listen' || phase === 'shadow' || phase === 'evaluating'}
              data-testid="tg-hear-chunked"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Volume2 size={14} /> Hear chunked
            </button>

            {(phase === 'chunk' || phase === 'idle') && (
              <button
                onClick={reveal}
                className="btn btn-primary"
                disabled={!data || phase === 'idle'}
                data-testid="tg-reveal"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Eye size={14} /> Check
              </button>
            )}

            {phase === 'shadow' ? (
              <button
                onClick={stopShadow}
                className="btn btn-primary"
                data-testid="tg-stop"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Square size={14} /> Stop
              </button>
            ) : (
              (phase === 'check' || phase === 'done') && (
                <button
                  onClick={startShadow}
                  className="btn btn-primary"
                  data-testid="tg-shadow"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <Mic size={14} /> Shadow
                </button>
              )
            )}

            <button
              onClick={handleNew}
              className="btn btn-secondary"
              disabled={phase === 'shadow' || phase === 'listen' || phase === 'evaluating'}
              data-testid="tg-new"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <RefreshCw size={14} /> New
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
