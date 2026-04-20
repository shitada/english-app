import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, RefreshCw, SkipForward, Volume2, Sparkles } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  generateElasticSentence,
  submitElasticSentence,
  getElasticSentenceStats,
  type ElasticDifficulty,
  type ElasticSentenceItem,
  type ElasticSentenceStats,
} from '../api';

type Phase = 'picker' | 'loading' | 'stepping' | 'final' | 'scoring' | 'results' | 'error';

const WORD_RE = /[a-z0-9']+/g;

export function normalizeWords(text: string): string[] {
  return (text || '').toLowerCase().match(WORD_RE) || [];
}

export function computeAccuracy(expected: string, transcript: string): number {
  const exp = normalizeWords(expected);
  if (exp.length === 0) return 0;
  const tr = new Set(normalizeWords(transcript));
  let hits = 0;
  for (const w of exp) if (tr.has(w)) hits++;
  return Math.round((1000 * hits) / exp.length) / 10;
}

export function diffTokens(expected: string, transcript: string): { word: string; hit: boolean }[] {
  const exp = normalizeWords(expected);
  const tr = new Set(normalizeWords(transcript));
  return exp.map(w => ({ word: w, hit: tr.has(w) }));
}

export function highlightNewTokens(prev: string, next: string): { word: string; isNew: boolean }[] {
  const prevSet = new Set(normalizeWords(prev));
  const words = (next || '').split(/\s+/).filter(Boolean);
  return words.map(raw => {
    const norm = raw.toLowerCase().replace(/[^a-z0-9']/g, '');
    return { word: raw, isNew: norm.length > 0 && !prevSet.has(norm) };
  });
}

const DIFFICULTIES: { key: ElasticDifficulty; label: string; hint: string }[] = [
  { key: 'short', label: 'Short', hint: '≈6 words' },
  { key: 'medium', label: 'Medium', hint: '≈10 words' },
  { key: 'long', label: 'Long', hint: '≈14 words' },
];

export default function ElasticSentencePage() {
  const tts = useSpeechSynthesis();
  const recog = useSpeechRecognition({ lang: 'en-US', continuous: false, interimResults: true });

  const [difficulty, setDifficulty] = useState<ElasticDifficulty>('medium');
  const [phase, setPhase] = useState<Phase>('picker');
  const [item, setItem] = useState<ElasticSentenceItem | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [transcriptCaptured, setTranscriptCaptured] = useState('');
  const [maxReached, setMaxReached] = useState(0);
  const [stats, setStats] = useState<ElasticSentenceStats | null>(null);
  const [longestWords, setLongestWords] = useState(0);
  const submittedRef = useRef(false);

  const refreshStats = useCallback(async () => {
    try {
      const s = await getElasticSentenceStats();
      setStats(s);
    } catch {
      /* best effort */
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const startSession = useCallback(async (diff: ElasticDifficulty) => {
    setDifficulty(diff);
    setPhase('loading');
    setErrorMsg('');
    setStepIdx(0);
    setAccuracy(null);
    setTranscriptCaptured('');
    setMaxReached(0);
    setLongestWords(0);
    submittedRef.current = false;
    recog.reset();
    try {
      const data = await generateElasticSentence(diff);
      setItem(data);
      setPhase('stepping');
    } catch {
      setPhase('error');
      setErrorMsg('Could not generate a sentence. Please try again.');
    }
  }, [recog]);

  const playStep = useCallback((text: string) => {
    if (!tts.isSupported) return;
    tts.setRate(0.95);
    tts.speak(text);
  }, [tts]);

  const advanceStep = useCallback(() => {
    if (!item) return;
    const next = stepIdx + 1;
    setMaxReached(m => Math.max(m, next));
    if (next >= item.chain.length - 1) {
      // Final step is reached — move to final speak phase
      setStepIdx(item.chain.length - 1);
      setPhase('final');
    } else {
      setStepIdx(next);
    }
  }, [item, stepIdx]);

  const startFinalRecording = useCallback(() => {
    if (!item) return;
    recog.reset();
    setAccuracy(null);
    setTranscriptCaptured('');
    try { recog.start(); } catch { /* noop */ }
  }, [item, recog]);

  const stopFinalRecording = useCallback(() => {
    if (!item) return;
    recog.stop();
    setPhase('scoring');
  }, [item, recog]);

  // After recognition fully stops, score & submit.
  useEffect(() => {
    if (phase !== 'scoring') return;
    if (recog.isListening) return;
    if (!item) return;

    const transcript = recog.transcript.trim();
    setTranscriptCaptured(transcript);
    const acc = computeAccuracy(item.target, transcript);
    setAccuracy(acc);

    const expectedWords = normalizeWords(item.target).length;
    const longest = acc >= 60 ? expectedWords : Math.max(0, maxReached > 0 && item.chain[maxReached - 1]
      ? normalizeWords(item.chain[maxReached - 1]).length
      : 0);
    setLongestWords(longest);

    if (!submittedRef.current) {
      submittedRef.current = true;
      submitElasticSentence({
        difficulty,
        target: item.target,
        chain: item.chain,
        max_reached: Math.max(maxReached, item.chain.length),
        accuracy: acc,
        transcript,
      }).then(res => {
        setLongestWords(res.longest_words);
        refreshStats();
      }).catch(() => { /* best effort */ });
    }
    setPhase('results');
  }, [phase, recog.isListening, recog.transcript, item, difficulty, maxReached, refreshStats]);

  const restart = useCallback(() => {
    setPhase('picker');
    setItem(null);
    setStepIdx(0);
    setAccuracy(null);
    setTranscriptCaptured('');
    setMaxReached(0);
    setLongestWords(0);
    submittedRef.current = false;
    recog.reset();
  }, [recog]);

  const currentStep = item?.chain[stepIdx] ?? '';
  const prevStep = stepIdx > 0 ? (item?.chain[stepIdx - 1] ?? '') : '';

  return (
    <div data-testid="elastic-sentence-page" style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link to="/" style={{ color: 'var(--primary, #6366f1)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Home
        </Link>
      </div>

      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.25rem' }}>
        <Sparkles size={24} color="#8b5cf6" />
        Elastic Sentence
      </h2>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
        Grow a sentence one chunk at a time — train working memory and fluency.
      </p>

      {stats && stats.total_sessions > 0 && (
        <div
          data-testid="elastic-sentence-stats"
          style={{
            display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
            padding: '6px 10px', marginBottom: 12, borderRadius: 999,
            border: '1px solid var(--border)', background: 'var(--bg, #f8fafc)',
            color: 'var(--text)', fontSize: 13,
          }}
        >
          <span>📚 Sessions: <strong>{stats.total_sessions}</strong></span>
          <span style={{ color: 'var(--text-secondary)' }}>·</span>
          <span>Avg accuracy: <strong>{stats.avg_accuracy_last_20.toFixed(1)}%</strong></span>
          <span style={{ color: 'var(--text-secondary)' }}>·</span>
          <span>Longest: <strong>{stats.longest_words}w</strong></span>
        </div>
      )}

      {phase === 'picker' && (
        <div className="card" data-testid="elastic-sentence-picker" style={{
          padding: '1rem', border: '1px solid var(--border)', borderRadius: 12,
          background: 'var(--card-bg, white)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Pick a target length</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {DIFFICULTIES.map(d => (
              <button
                key={d.key}
                type="button"
                className="btn"
                data-testid={`elastic-sentence-diff-${d.key}`}
                onClick={() => startSession(d.key)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '10px 14px', minWidth: 120, border: '1px solid var(--border)',
                  borderRadius: 10, background: 'var(--bg, #f8fafc)',
                }}
              >
                <div style={{ fontWeight: 600 }}>{d.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <p style={{ color: 'var(--text-secondary)' }}>Generating your expansion chain…</p>
      )}

      {phase === 'error' && (
        <div className="card" style={{ padding: '1rem', borderColor: '#dc2626' }}>
          <p style={{ color: '#dc2626', margin: '0 0 0.5rem' }}>{errorMsg}</p>
          <button className="btn btn-primary" onClick={() => startSession(difficulty)} data-testid="elastic-sentence-retry">
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {item && (phase === 'stepping' || phase === 'final' || phase === 'scoring' || phase === 'results') && (
        <div className="card" style={{
          padding: '1rem 1.1rem', border: '1px solid var(--border)', borderRadius: 12,
          background: 'var(--card-bg, white)', color: 'var(--text)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <span data-testid="elastic-sentence-step-counter">
              Step {Math.min(stepIdx + 1, item.chain.length)} / {item.chain.length}
            </span>
            <span>🎯 Target: {normalizeWords(item.target).length} words</span>
          </div>

          {(phase === 'stepping' || phase === 'final') && (
            <div data-testid="elastic-sentence-builder" style={{
              fontSize: 20, lineHeight: 1.55, marginBottom: 12, minHeight: 48,
              padding: '8px 10px', background: 'var(--bg, #f8fafc)', borderRadius: 8,
              border: '1px solid var(--border)',
            }}>
              {highlightNewTokens(prevStep, currentStep).map((t, i) => (
                <span
                  key={i}
                  data-testid={t.isNew ? 'elastic-sentence-new-token' : 'elastic-sentence-token'}
                  style={{
                    marginRight: 6,
                    background: t.isNew ? 'rgba(139,92,246,0.18)' : 'transparent',
                    color: t.isNew ? '#6d28d9' : 'inherit',
                    fontWeight: t.isNew ? 700 : 400,
                    padding: t.isNew ? '0 4px' : 0,
                    borderRadius: 4,
                  }}
                >
                  {t.word}
                </span>
              ))}
            </div>
          )}

          {phase === 'stepping' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => playStep(currentStep)}
                disabled={!tts.isSupported}
                data-testid="elastic-sentence-play"
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Volume2 size={14} /> Listen
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={advanceStep}
                data-testid="elastic-sentence-next-step"
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <SkipForward size={14} /> {stepIdx >= item.chain.length - 2 ? 'Final step' : 'Next step'}
              </button>
            </div>
          )}

          {phase === 'final' && (
            <div data-testid="elastic-sentence-final">
              <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                Speak the full target sentence — we'll check how many words you got.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => playStep(item.target)}
                  data-testid="elastic-sentence-play-target"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Volume2 size={14} /> Hear target
                </button>
                {!recog.isListening ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={startFinalRecording}
                    data-testid="elastic-sentence-record"
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    disabled={!recog.isSupported}
                  >
                    <Mic size={14} /> Start speaking
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={stopFinalRecording}
                    data-testid="elastic-sentence-stop"
                  >
                    ⏹ Stop &amp; score
                  </button>
                )}
              </div>
              {recog.isListening && recog.interimTranscript && (
                <div style={{ marginTop: 8, fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                  {recog.interimTranscript}
                </div>
              )}
              {!recog.isSupported && (
                <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>
                  Speech recognition is not supported. You can still listen and repeat aloud.
                </p>
              )}
            </div>
          )}

          {phase === 'scoring' && (
            <p style={{ color: 'var(--text-secondary)' }}>Scoring…</p>
          )}

          {phase === 'results' && (
            <div data-testid="elastic-sentence-results" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 18 }}>
                <strong>Target:</strong> “{item.target}”
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Stat label="Accuracy" value={`${(accuracy ?? 0).toFixed(1)}%`} />
                <Stat label="Chain steps" value={`${Math.max(maxReached, item.chain.length)} / ${item.chain.length}`} />
                <Stat label="Longest utterance" value={`${longestWords}w`} highlight />
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Your transcript:</div>
                <div
                  data-testid="elastic-sentence-transcript"
                  style={{
                    padding: '0.5rem 0.6rem', background: 'var(--bg, #f8fafc)',
                    borderRadius: 6, fontSize: 14, border: '1px solid var(--border)',
                  }}
                >
                  {transcriptCaptured || <em style={{ color: 'var(--text-secondary)' }}>(no speech detected)</em>}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Word check:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {diffTokens(item.target, transcriptCaptured).map((w, i) => (
                    <span
                      key={i}
                      data-testid={w.hit ? 'elastic-sentence-word-hit' : 'elastic-sentence-word-miss'}
                      style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 13,
                        background: w.hit ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                        color: w.hit ? '#16a34a' : '#dc2626',
                        textDecoration: w.hit ? 'none' : 'underline',
                      }}
                    >
                      {w.word}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => startSession(difficulty)}
                  data-testid="elastic-sentence-again"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={14} /> New sentence
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={restart}
                  data-testid="elastic-sentence-change-difficulty"
                >
                  Change difficulty
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const color = highlight ? '#8b5cf6' : 'var(--text)';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0.5rem 0.9rem', borderRadius: 10, minWidth: 110,
      border: `1px solid ${highlight ? color : 'var(--border)'}`,
      background: highlight ? 'rgba(139,92,246,0.08)' : 'var(--bg, #f8fafc)',
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
