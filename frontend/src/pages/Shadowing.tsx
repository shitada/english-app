import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, RefreshCw, SkipForward, Volume2 } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  getShadowingSentence,
  submitShadowingAttempt,
  getShadowingStats,
  type ShadowingSentence,
  type ShadowingStats,
} from '../api';

type Phase = 'loading' | 'idle' | 'playing' | 'countdown' | 'recording' | 'scoring' | 'results' | 'error';

const WORD_RE = /[a-z0-9']+/g;

export function normalizeWords(text: string): string[] {
  return (text || '').toLowerCase().match(WORD_RE) || [];
}

export function computeAccuracy(expected: string, transcript: string): number {
  const exp = normalizeWords(expected);
  if (exp.length === 0) return 0;
  const trSet = new Set(normalizeWords(transcript));
  let hits = 0;
  for (const w of exp) {
    if (trSet.has(w)) hits++;
  }
  return Math.round((1000 * hits) / exp.length) / 10;
}

export function computeTimingScore(actualSeconds: number, targetSeconds: number): number {
  if (targetSeconds <= 0) return 0;
  const diffPct = (Math.abs(actualSeconds - targetSeconds) / targetSeconds) * 100;
  const score = 100 - Math.min(100, diffPct);
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

export function diffMissedWords(expected: string, transcript: string): { word: string; hit: boolean }[] {
  const exp = normalizeWords(expected);
  const trSet = new Set(normalizeWords(transcript));
  return exp.map(w => ({ word: w, hit: trSet.has(w) }));
}

export default function Shadowing() {
  const tts = useSpeechSynthesis();
  const recog = useSpeechRecognition({ lang: 'en-US', continuous: false, interimResults: true });

  const [item, setItem] = useState<ShadowingSentence | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [actualSeconds, setActualSeconds] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [timingScore, setTimingScore] = useState<number | null>(null);
  const [transcriptCaptured, setTranscriptCaptured] = useState('');
  const [stats, setStats] = useState<ShadowingStats | null>(null);
  const initialized = useRef(false);

  const refreshStats = useCallback(async () => {
    try {
      const s = await getShadowingStats();
      setStats(s);
    } catch {
      /* best effort */
    }
  }, []);

  const loadSentence = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    setActualSeconds(null);
    setAccuracy(null);
    setTimingScore(null);
    setTranscriptCaptured('');
    recog.reset();
    try {
      const data = await getShadowingSentence();
      setItem(data);
      setPhase('idle');
    } catch {
      setPhase('error');
      setErrorMsg('Could not load a sentence. Please try again.');
    }
  }, [recog]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadSentence();
      refreshStats();
    }
  }, [loadSentence, refreshStats]);

  const playSentence = useCallback(() => {
    if (!item || !tts.isSupported) return;
    tts.setRate(0.95);
    setPhase('playing');
    tts.speak(item.sentence);
  }, [item, tts]);

  // When TTS stops, kick off the countdown
  useEffect(() => {
    if (phase === 'playing' && !tts.isSpeaking) {
      // tts.speak may set isSpeaking asynchronously; small grace check
      // ensures we only advance after speaking actually started+ended.
      const t = setTimeout(() => {
        if (phase === 'playing' && !tts.isSpeaking) {
          setCountdown(3);
          setPhase('countdown');
        }
      }, 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, tts.isSpeaking]);

  // Countdown ticker
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      // Start recording
      recog.reset();
      setRecordingStartedAt(Date.now());
      setPhase('recording');
      try { recog.start(); } catch { /* noop */ }
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 800);
    return () => clearTimeout(t);
  }, [phase, countdown, recog]);

  const finishRecording = useCallback(async () => {
    if (!item || phase !== 'recording') return;
    const stoppedAt = Date.now();
    recog.stop();
    const elapsed = recordingStartedAt ? (stoppedAt - recordingStartedAt) / 1000 : 0;
    setActualSeconds(elapsed);
    // Give recognition a brief moment to flush its final result
    setPhase('scoring');
  }, [item, phase, recog, recordingStartedAt]);

  // Once recognition reports it has stopped (isListening false) after we asked
  // it to stop, perform scoring & POST.
  useEffect(() => {
    if (phase !== 'scoring') return;
    if (recog.isListening) return; // wait for full stop
    if (!item || actualSeconds == null) return;

    const finalTranscript = recog.transcript.trim();
    setTranscriptCaptured(finalTranscript);
    const acc = computeAccuracy(item.sentence, finalTranscript);
    const ts = computeTimingScore(actualSeconds, item.target_seconds);
    setAccuracy(acc);
    setTimingScore(ts);

    submitShadowingAttempt({
      sentence: item.sentence,
      transcript: finalTranscript,
      accuracy: acc,
      timing_score: ts,
      duration_ms: Math.round(actualSeconds * 1000),
    })
      .then(() => { refreshStats(); })
      .catch(() => { /* persistence is best-effort */ });

    setPhase('results');
  }, [phase, recog.isListening, recog.transcript, item, actualSeconds, refreshStats]);

  const tryAgain = useCallback(() => {
    setActualSeconds(null);
    setAccuracy(null);
    setTimingScore(null);
    setTranscriptCaptured('');
    recog.reset();
    setPhase('idle');
  }, [recog]);

  const combined = accuracy != null && timingScore != null
    ? Math.round(((accuracy + timingScore) / 2) * 10) / 10
    : null;

  return (
    <div data-testid="shadowing-page" style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link to="/" style={{ color: 'var(--primary, #6366f1)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Home
        </Link>
      </div>

      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.25rem' }}>
        <Mic size={24} color="#10b981" />
        Shadowing Drill
      </h2>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
        Listen to a native-paced sentence, then repeat it as closely as you can.
      </p>

      {stats && (
        <div
          data-testid="shadowing-stats-badge"
          style={{
            display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
            padding: '6px 10px', marginBottom: 12, borderRadius: 999,
            border: '1px solid var(--border)', background: 'var(--bg, #f8fafc)',
            color: 'var(--text)', fontSize: 13,
          }}
        >
          <span data-testid="shadowing-stats-attempts">
            🎯 Attempts: <strong>{stats.total_attempts}</strong>
          </span>
          {stats.total_attempts > 0 ? (
            <>
              <span style={{ color: 'var(--text-secondary)' }}>·</span>
              <span data-testid="shadowing-stats-avg">
                Avg (last 20): <strong>{stats.avg_combined_last_20.toFixed(1)}</strong>
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>·</span>
              <span data-testid="shadowing-stats-best">
                Best: <strong>{stats.best_combined.toFixed(1)}</strong>
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--text-secondary)' }} data-testid="shadowing-stats-hint">
              Try your first attempt to start tracking progress!
            </span>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="card" style={{ padding: '1rem', borderColor: '#dc2626' }}>
          <p style={{ color: '#dc2626', margin: '0 0 0.5rem' }}>{errorMsg}</p>
          <button className="btn btn-primary" onClick={loadSentence} data-testid="shadowing-retry-load">
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <p style={{ color: 'var(--text-secondary)' }}>Loading a sentence…</p>
      )}

      {item && phase !== 'loading' && phase !== 'error' && (
        <div className="card" style={{
          padding: '1rem 1.1rem', border: '1px solid var(--border)', borderRadius: 12,
          background: 'var(--card-bg, white)', color: 'var(--text)',
        }}>
          <div style={{ fontSize: 18, lineHeight: 1.55, marginBottom: 12 }} data-testid="shadowing-sentence">
            “{item.sentence}”
          </div>
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12,
            display: 'flex', flexWrap: 'wrap', gap: 12,
          }}>
            <span>🎯 {item.focus_tip}</span>
            <span>⏱ Target: {item.target_seconds.toFixed(1)}s</span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button"
              className="btn"
              onClick={playSentence}
              disabled={phase === 'playing' || phase === 'countdown' || phase === 'recording' || phase === 'scoring' || !tts.isSupported}
              data-testid="shadowing-play"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Volume2 size={14} /> {phase === 'playing' ? 'Playing…' : 'Listen'}
            </button>
            {phase === 'recording' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={finishRecording}
                data-testid="shadowing-stop"
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                ⏹ Stop &amp; score
              </button>
            )}
          </div>

          {phase === 'countdown' && (
            <div data-testid="shadowing-countdown" style={{
              fontSize: 32, fontWeight: 700, textAlign: 'center', padding: '0.5rem',
              color: 'var(--primary, #3b82f6)',
            }}>
              {countdown > 0 ? countdown : 'Go!'}
            </div>
          )}

          {phase === 'recording' && (
            <div style={{
              padding: '0.75rem', borderRadius: 8, background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)', fontSize: 14,
            }}>
              🔴 Listening… speak now.
              {recog.interimTranscript && (
                <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  {recog.interimTranscript}
                </div>
              )}
            </div>
          )}

          {phase === 'scoring' && (
            <p style={{ color: 'var(--text-secondary)' }}>Scoring your attempt…</p>
          )}

          {phase === 'results' && (
            <div data-testid="shadowing-results" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <ScorePill label="Accuracy" value={accuracy ?? 0} />
                <ScorePill label="Timing" value={timingScore ?? 0} />
                <ScorePill label="Combined" value={combined ?? 0} highlight />
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Spoken in {actualSeconds?.toFixed(1)}s (target {item.target_seconds.toFixed(1)}s)
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Your transcript:</div>
                <div style={{
                  padding: '0.5rem 0.6rem', background: 'var(--bg, #f8fafc)',
                  borderRadius: 6, fontSize: 14, color: 'var(--text)',
                  border: '1px solid var(--border)',
                }} data-testid="shadowing-transcript">
                  {transcriptCaptured || <em style={{ color: 'var(--text-secondary)' }}>(no speech detected)</em>}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Word check:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {diffMissedWords(item.sentence, transcriptCaptured).map((w, i) => (
                    <span
                      key={i}
                      data-testid={w.hit ? 'shadowing-word-hit' : 'shadowing-word-miss'}
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

              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                💡 {item.focus_tip}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={tryAgain}
                  data-testid="shadowing-try-again"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={14} /> Try again
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={loadSentence}
                  data-testid="shadowing-next"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <SkipForward size={14} /> Next sentence
                </button>
              </div>
            </div>
          )}

          {!tts.isSupported && (
            <p style={{ color: '#dc2626', fontSize: 13 }}>
              Speech synthesis is not supported in this browser.
            </p>
          )}
          {!recog.isSupported && (
            <p style={{ color: '#dc2626', fontSize: 13 }}>
              Speech recognition is not supported in this browser. Try Chrome or Edge.
            </p>
          )}
          {recog.error && (
            <p style={{ color: '#dc2626', fontSize: 13 }}>{recog.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ScorePill({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const color = value >= 85 ? '#16a34a' : value >= 60 ? '#f59e0b' : '#dc2626';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0.5rem 0.9rem', borderRadius: 10, minWidth: 92,
      border: `1px solid ${highlight ? color : 'var(--border)'}`,
      background: highlight ? `${color}14` : 'var(--bg, #f8fafc)',
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value.toFixed(1)}</div>
    </div>
  );
}
