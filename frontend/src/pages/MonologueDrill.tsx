import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, MicOff, Clock, CheckCircle2, Circle } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  getMonologueScenarios,
  submitMonologueAttempt,
  type MonologueScenario,
  type MonologueAttemptResponse,
} from '../api';

type Phase = 'loading' | 'select' | 'prep' | 'recording' | 'scoring' | 'feedback' | 'error';

export function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 13, marginBottom: 4, color: 'var(--text-secondary)',
      }}>
        <span>{label}</span>
        <span data-testid={`monologue-score-${label.toLowerCase()}`}>{pct}</span>
      </div>
      <div style={{
        background: 'var(--border, #e5e7eb)', borderRadius: 4, height: 10, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: scoreColor(pct),
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

export default function MonologueDrill() {
  const recog = useSpeechRecognition({ lang: 'en-US', continuous: true, interimResults: true });

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [scenarios, setScenarios] = useState<MonologueScenario[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<MonologueAttemptResponse | null>(null);

  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selected = useMemo(
    () => scenarios.find((s) => s.id === selectedId) || null,
    [scenarios, selectedId],
  );

  const loadScenarios = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    try {
      const data = await getMonologueScenarios();
      setScenarios(data.scenarios);
      setPhase('select');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to load scenarios');
      setPhase('error');
    }
  }, []);

  useEffect(() => { void loadScenarios(); }, [loadScenarios]);

  // Capture speech recognition results into the transcript buffer.
  useEffect(() => {
    if (recog.transcript) {
      setTranscript((prev) => (prev ? `${prev} ${recog.transcript}`.trim() : recog.transcript));
      recog.reset();
    }
  }, [recog.transcript, recog]);

  // Timer tick
  useEffect(() => {
    if (phase !== 'recording') return;
    timerRef.current = setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }
    }, 250);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [phase]);

  const pickScenario = (id: string) => {
    setSelectedId(id);
    setTranscript('');
    setElapsed(0);
    setResult(null);
    setPhase('prep');
  };

  const startRecording = () => {
    setTranscript('');
    setElapsed(0);
    startedAtRef.current = Date.now();
    if (recog.isSupported) {
      recog.reset();
      recog.start();
    }
    setPhase('recording');
  };

  const stopRecording = async () => {
    if (recog.isListening) recog.stop();
    const duration = Math.max(
      1,
      Math.round(
        startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : elapsed,
      ),
    );
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    if (!selected || !transcript.trim()) {
      setPhase('prep');
      return;
    }
    setPhase('scoring');
    try {
      const res = await submitMonologueAttempt(selected.id, transcript.trim(), duration);
      setResult(res);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Scoring failed');
      setPhase('error');
    }
  };

  const tryAgain = () => {
    setTranscript('');
    setElapsed(0);
    setResult(null);
    setPhase('prep');
  };

  const coveredSet = useMemo(
    () => new Set(result?.feedback.beats_covered ?? []),
    [result],
  );

  const progressPct = selected
    ? Math.min(100, (elapsed / selected.target_seconds) * 100)
    : 0;

  return (
    <div
      data-testid="monologue-page"
      style={{
        maxWidth: 720, margin: '0 auto', padding: '1rem',
        background: 'var(--bg-card)', color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/" aria-label="Back to home" style={{ display: 'flex', color: 'var(--text-secondary)' }}>
          <ArrowLeft size={20} />
        </Link>
        <h2 data-testid="monologue-title" style={{ margin: 0, flex: 1 }}>
          🎤 Situational Monologue Drill
        </h2>
      </div>

      {phase === 'loading' && (
        <div data-testid="monologue-loading" style={{ padding: '2rem', textAlign: 'center' }}>
          Loading scenarios…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="monologue-error"
          style={{
            padding: '1rem', border: '1px solid #ef4444', borderRadius: 8,
            color: '#ef4444', marginBottom: 12,
          }}
        >
          {errorMsg || 'Something went wrong.'}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => loadScenarios()}>Retry</button>
          </div>
        </div>
      )}

      {phase === 'select' && (
        <div data-testid="monologue-scenarios" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: 14 }}>
            Pick a real-life situation. Hit a target duration and cover the key content beats.
          </p>
          {scenarios.map((s) => (
            <button
              key={s.id}
              data-testid={`monologue-scenario-${s.id}`}
              onClick={() => pickScenario(s.id)}
              style={{
                textAlign: 'left', padding: '12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {s.target_seconds}s · {s.content_beats.length} beats
              </div>
            </button>
          ))}
        </div>
      )}

      {(phase === 'prep' || phase === 'recording' || phase === 'scoring') && selected && (
        <div
          className="card"
          style={{
            border: '1px solid var(--border)', borderRadius: 12,
            padding: '1rem', marginBottom: 16, background: 'var(--bg-card)',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{selected.title}</div>
          <p data-testid="monologue-prompt" style={{ margin: '4px 0 8px', fontSize: 14 }}>
            {selected.prompt}
          </p>
          <div
            data-testid="monologue-target"
            style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}
          >
            🎯 Target: {selected.target_seconds}s
          </div>

          <ul data-testid="monologue-beats" style={{ padding: 0, margin: '0 0 12px', listStyle: 'none' }}>
            {selected.content_beats.map((b) => (
              <li
                key={b}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 0', fontSize: 14,
                }}
              >
                <Circle size={14} style={{ color: 'var(--text-secondary)' }} />
                {b}
              </li>
            ))}
          </ul>

          {phase === 'recording' && (
            <div style={{ marginBottom: 10 }}>
              <div
                data-testid="monologue-timer"
                style={{
                  fontSize: 28, fontWeight: 700, textAlign: 'center',
                  color: elapsed >= selected.target_seconds ? '#f59e0b' : 'var(--text-primary)',
                }}
              >
                {formatDuration(elapsed)} / {formatDuration(selected.target_seconds)}
              </div>
              <div style={{
                height: 6, background: 'var(--border)', borderRadius: 3,
                overflow: 'hidden', marginTop: 6,
              }}>
                <div style={{
                  width: `${progressPct}%`, height: '100%',
                  background: progressPct >= 100 ? '#f59e0b' : '#3b82f6',
                  transition: 'width 0.2s ease',
                }} />
              </div>
            </div>
          )}

          <textarea
            data-testid="monologue-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Your speech transcript will appear here. You can also type."
            rows={4}
            disabled={phase === 'scoring'}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--border)', fontSize: 14,
              fontFamily: 'inherit', resize: 'vertical',
              background: 'var(--bg-card)', color: 'var(--text-primary)',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {phase === 'prep' && (
              <button
                data-testid="monologue-start"
                onClick={startRecording}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: '#10b981', color: 'white',
                  fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Mic size={16} /> Start recording
              </button>
            )}
            {phase === 'recording' && (
              <button
                data-testid="monologue-stop"
                onClick={stopRecording}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: '#ef4444', color: 'white',
                  fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <MicOff size={16} /> Stop &amp; score
              </button>
            )}
            {phase === 'scoring' && (
              <div data-testid="monologue-scoring" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                Scoring…
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'feedback' && result && selected && (
        <div
          data-testid="monologue-feedback"
          className="card"
          style={{
            border: '1px solid var(--border)', borderRadius: 12,
            padding: '1rem', marginBottom: 16, background: 'var(--bg-card)',
          }}
        >
          <ScoreBar label="Fluency" value={result.fluency_score} />
          <ScoreBar label="Structure" value={result.structure_score} />
          <div
            data-testid="monologue-overall"
            style={{
              fontSize: 22, fontWeight: 700, marginTop: 8,
              color: scoreColor(result.overall_score),
            }}
          >
            Overall: {result.overall_score}
          </div>

          <div style={{
            display: 'flex', gap: 12, flexWrap: 'wrap',
            margin: '12px 0', fontSize: 13, color: 'var(--text-secondary)',
          }}>
            <span data-testid="monologue-wpm">WPM: {result.wpm}</span>
            <span data-testid="monologue-fillers">Fillers: {result.filler_count}</span>
            <span data-testid="monologue-duration">Duration: {formatDuration(result.duration_seconds)}</span>
            <span data-testid="monologue-coverage">
              Coverage: {Math.round(result.coverage_ratio * 100)}%
            </span>
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Beats checklist</div>
            <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
              {selected.content_beats.map((b) => {
                const ok = coveredSet.has(b);
                return (
                  <li key={b} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '3px 0', fontSize: 14,
                    color: ok ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}>
                    {ok
                      ? <CheckCircle2 size={16} color="#10b981" />
                      : <Circle size={16} color="#9ca3af" />}
                    {b}
                  </li>
                );
              })}
            </ul>
          </div>

          <p data-testid="monologue-feedback-text" style={{ margin: '12px 0 8px', fontSize: 14 }}>
            {result.feedback.one_line_feedback}
          </p>
          {result.feedback.suggested_rewrite_opening && (
            <div
              data-testid="monologue-suggested"
              style={{
                padding: 10, borderRadius: 8,
                background: 'var(--bg-secondary, #f3f4f6)',
                fontStyle: 'italic', fontSize: 14, marginTop: 8,
              }}
            >
              💡 {result.feedback.suggested_rewrite_opening}
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button
              data-testid="monologue-retry"
              onClick={tryAgain}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: 'var(--primary, #3b82f6)', color: 'white',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              data-testid="monologue-change-scenario"
              onClick={() => { setSelectedId(null); setResult(null); setPhase('select'); }}
              style={{
                padding: '8px 16px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Pick another scenario
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
