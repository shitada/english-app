import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, MicOff, RefreshCw, Volume2, Check, X, AlertCircle } from 'lucide-react';
import {
  generateListenSummarizePassage,
  gradeListenSummarize,
  getListenSummarizeStats,
  type ListenSummarizePassage,
  type ListenSummarizeGradeResult,
  type ListenSummarizeStats,
} from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

type Phase = 'idle' | 'listening' | 'compose' | 'grading' | 'results' | 'error';
type Level = 'beginner' | 'intermediate' | 'advanced';
type Rate = 0.85 | 1.0 | 1.15;

const MAX_PLAYS = 2;

function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const speak = useCallback((text: string, rate: number) => {
    if (!supported) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch {
      setSpeaking(false);
    }
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  return { speak, stop, speaking, supported };
}

function ScoreRing({ overall }: { overall: number }) {
  const pct = Math.max(0, Math.min(1, overall));
  const r = 36;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  const color = pct >= 0.7 ? '#22c55e' : pct >= 0.5 ? '#f59e0b' : '#ef4444';
  return (
    <div data-testid="ls-score-ring" style={{ position: 'relative', width: 96, height: 96 }}>
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} stroke="var(--border, #e5e7eb)" strokeWidth="8" fill="none" />
        <circle
          cx="48" cy="48" r={r} stroke={color} strokeWidth="8" fill="none"
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
          transform="rotate(-90 48 48)"
        />
      </svg>
      <div
        style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 700, color,
        }}
      >
        {Math.round(pct * 100)}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { date: string; avg_overall: number; attempts: number }[] }) {
  if (!points.length) {
    return <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>No attempts yet — try one!</div>;
  }
  const w = 160;
  const h = 32;
  const max = Math.max(1, ...points.map(p => p.avg_overall));
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step},${h - (p.avg_overall / max) * h}`)
    .join(' ');
  return (
    <svg data-testid="ls-sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={path} stroke="#3b82f6" strokeWidth="2" fill="none" />
      {points.map((p, i) => (
        <circle key={p.date} cx={i * step} cy={h - (p.avg_overall / max) * h} r="2" fill="#3b82f6" />
      ))}
    </svg>
  );
}

export default function ListenSummarize() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState<Level>('intermediate');
  const [rate, setRate] = useState<Rate>(1.0);
  const [passage, setPassage] = useState<ListenSummarizePassage | null>(null);
  const [playsUsed, setPlaysUsed] = useState(0);
  const [summary, setSummary] = useState('');
  const [usedVoice, setUsedVoice] = useState(false);
  const [grade, setGrade] = useState<ListenSummarizeGradeResult | null>(null);
  const [stats, setStats] = useState<ListenSummarizeStats | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const tts = useTTS();
  const { isListening, transcript, start, stop, reset, isSupported: srSupported } = useSpeechRecognition();
  const lastAppliedRef = useRef('');

  const refreshStats = useCallback(async () => {
    try {
      setStats(await getListenSummarizeStats(7, 0.7));
    } catch {
      /* non-blocking */
    }
  }, []);

  useEffect(() => { void refreshStats(); }, [refreshStats]);

  // Append dictation transcript to the summary textarea as it streams in.
  useEffect(() => {
    if (!isListening) return;
    if (transcript && transcript !== lastAppliedRef.current) {
      const delta = transcript.startsWith(lastAppliedRef.current)
        ? transcript.slice(lastAppliedRef.current.length)
        : transcript;
      lastAppliedRef.current = transcript;
      setSummary(prev => (prev ? prev + (delta.startsWith(' ') ? '' : ' ') + delta.trim() : delta.trim()));
      setUsedVoice(true);
    }
  }, [transcript, isListening]);

  const beginNew = useCallback(async () => {
    tts.stop();
    setErrorMsg('');
    setPhase('listening');
    setPassage(null);
    setPlaysUsed(0);
    setSummary('');
    setUsedVoice(false);
    setGrade(null);
    reset();
    lastAppliedRef.current = '';
    try {
      const p = await generateListenSummarizePassage(level);
      setPassage(p);
    } catch (e) {
      setErrorMsg('Could not load a passage. Please try again.');
      setPhase('error');
    }
  }, [level, reset, tts]);

  const handlePlay = useCallback(() => {
    if (!passage) return;
    if (playsUsed >= MAX_PLAYS) return;
    tts.speak(passage.text, rate);
    setPlaysUsed(n => n + 1);
  }, [passage, playsUsed, rate, tts]);

  const handleDone = useCallback(() => {
    tts.stop();
    if (isListening) stop();
    setPhase('compose');
  }, [isListening, stop, tts]);

  const handleSubmit = useCallback(async () => {
    if (!passage || !summary.trim()) return;
    setPhase('grading');
    try {
      const result = await gradeListenSummarize({
        passage_id: passage.passage_id,
        passage_text: passage.text,
        key_points: passage.key_points,
        summary: summary.trim(),
        used_voice: usedVoice,
        plays_used: playsUsed,
        level,
        target_min_words: passage.target_min_words,
        target_max_words: passage.target_max_words,
      });
      setGrade(result);
      setPhase('results');
      void refreshStats();
    } catch {
      setErrorMsg('Could not grade your summary. Please try again.');
      setPhase('error');
    }
  }, [level, passage, playsUsed, refreshStats, summary, usedVoice, playsUsed]);

  const toggleMic = useCallback(() => {
    if (!srSupported) return;
    if (isListening) {
      stop();
    } else {
      lastAppliedRef.current = '';
      reset();
      start();
    }
  }, [isListening, reset, srSupported, start, stop]);

  const summaryWordCount = useMemo(
    () => (summary.trim() ? summary.trim().split(/\s+/).length : 0),
    [summary],
  );

  const targetRangeText = passage
    ? `${passage.target_min_words}-${passage.target_max_words} words`
    : '';

  return (
    <div data-testid="listen-summarize-page" style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Link to="/" aria-label="Back to home" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
          <ArrowLeft size={20} />
        </Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>Listen &amp; Summarize</h1>
      </div>

      {/* Stats card */}
      <section
        aria-label="Recent stats"
        style={{
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)' }}>
          <div data-testid="ls-stats-total">Attempts (7d): <strong>{stats?.total ?? 0}</strong></div>
          <div data-testid="ls-stats-average">Average: <strong>{Math.round((stats?.average ?? 0) * 100)}</strong></div>
          <div data-testid="ls-stats-streak">Streak ≥ 70%: <strong>{stats?.streak ?? 0}</strong></div>
        </div>
        <Sparkline points={stats?.sparkline ?? []} />
      </section>

      {/* Controls */}
      {phase === 'idle' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <label style={{ fontSize: 13 }}>
            Level{' '}
            <select
              data-testid="ls-level"
              value={level}
              onChange={(e) => setLevel(e.target.value as Level)}
              style={{ padding: '4px 6px' }}
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <button
            data-testid="ls-start"
            onClick={beginNew}
            style={{
              padding: '10px 18px',
              borderRadius: 6,
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Start drill
          </button>
        </div>
      )}

      {/* Listening / Compose phase shell */}
      {(phase === 'listening' || phase === 'compose' || phase === 'grading') && passage && (
        <section
          style={{
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <button
              data-testid="ls-play"
              onClick={handlePlay}
              disabled={playsUsed >= MAX_PLAYS || tts.speaking}
              aria-label="Play passage"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 6,
                background: playsUsed >= MAX_PLAYS ? '#9ca3af' : '#10b981',
                color: 'white', border: 'none',
                cursor: playsUsed >= MAX_PLAYS ? 'not-allowed' : 'pointer',
                opacity: playsUsed >= MAX_PLAYS ? 0.6 : 1,
              }}
            >
              <Volume2 size={16} />
              Play ({MAX_PLAYS - playsUsed} left)
            </button>
            <label style={{ fontSize: 13 }}>
              Rate{' '}
              <select
                data-testid="ls-rate"
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value) as Rate)}
                style={{ padding: '4px 6px' }}
              >
                <option value={0.85}>0.85x</option>
                <option value={1.0}>1.0x</option>
                <option value={1.15}>1.15x</option>
              </select>
            </label>
            {phase === 'listening' && (
              <button
                data-testid="ls-done-listening"
                onClick={handleDone}
                style={{
                  padding: '8px 14px', borderRadius: 6,
                  background: 'var(--bg-secondary, #f3f4f6)',
                  border: '1px solid var(--border, #d1d5db)',
                  cursor: 'pointer',
                }}
              >
                Done listening — write summary
              </button>
            )}
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', marginBottom: 8 }}>
            Write a {targetRangeText} summary in your own words.
          </div>

          <textarea
            data-testid="ls-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Type or dictate your 1–2 sentence summary…"
            rows={4}
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 6,
              border: '1px solid var(--border, #d1d5db)',
              fontSize: 15,
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
            <div data-testid="ls-wordcount" style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>
              {summaryWordCount} word{summaryWordCount === 1 ? '' : 's'} • target {targetRangeText}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {srSupported && (
                <button
                  data-testid="ls-mic"
                  onClick={toggleMic}
                  aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', borderRadius: 6,
                    background: isListening ? '#ef4444' : 'var(--bg-secondary, #f3f4f6)',
                    color: isListening ? 'white' : 'inherit',
                    border: '1px solid var(--border, #d1d5db)',
                    cursor: 'pointer',
                  }}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                  {isListening ? 'Stop' : 'Dictate'}
                </button>
              )}
              <button
                data-testid="ls-submit"
                onClick={handleSubmit}
                disabled={!summary.trim() || phase === 'grading'}
                style={{
                  padding: '8px 16px', borderRadius: 6,
                  background: '#3b82f6', color: 'white',
                  border: 'none',
                  cursor: !summary.trim() ? 'not-allowed' : 'pointer',
                  opacity: !summary.trim() ? 0.5 : 1,
                  fontWeight: 600,
                }}
              >
                {phase === 'grading' ? 'Grading…' : 'Submit summary'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Results */}
      {phase === 'results' && grade && passage && (
        <section
          data-testid="ls-results"
          style={{
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <ScoreRing overall={grade.overall} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)' }}>
                Coverage: {Math.round(grade.coverage_ratio * 100)}% • Conciseness: {Math.round(grade.conciseness_score * 100)}% • Accuracy: {Math.round(grade.accuracy_score * 100)}%
              </div>
              <div data-testid="ls-feedback" style={{ marginTop: 6, fontSize: 14 }}>{grade.feedback}</div>
            </div>
          </div>

          <h3 style={{ fontSize: 14, margin: '12px 0 6px' }}>Key points</h3>
          <ul data-testid="ls-coverage" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {grade.coverage.map((c, i) => (
              <li
                key={i}
                data-testid={`ls-kp-${i}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '6px 8px',
                  borderRadius: 4,
                  background: c.covered ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  marginBottom: 4,
                }}
              >
                {c.covered
                  ? <Check size={16} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                  : <X size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />}
                <span style={{ fontSize: 14 }}>{c.point}</span>
              </li>
            ))}
          </ul>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }} data-testid="ls-reveal-transcript">
              Reveal full transcript
            </summary>
            <p data-testid="ls-transcript" style={{ marginTop: 8, lineHeight: 1.6, fontSize: 14 }}>
              {passage.text}
            </p>
          </details>

          <button
            data-testid="ls-try-another"
            onClick={beginNew}
            style={{
              marginTop: 16,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 16px',
              borderRadius: 6,
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            <RefreshCw size={16} /> Try another
          </button>
        </section>
      )}

      {phase === 'error' && (
        <div
          data-testid="ls-error"
          style={{
            display: 'flex', gap: 8, alignItems: 'center',
            padding: 12, borderRadius: 6,
            background: 'rgba(239,68,68,0.1)', color: '#b91c1c',
            marginBottom: 16,
          }}
        >
          <AlertCircle size={18} />
          <span>{errorMsg || 'Something went wrong.'}</span>
          <button
            onClick={beginNew}
            style={{
              marginLeft: 'auto', padding: '6px 12px',
              borderRadius: 4, border: '1px solid #b91c1c',
              background: 'transparent', color: '#b91c1c', cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
