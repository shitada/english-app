import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, MicOff, Volume2 } from 'lucide-react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  getParaphraseSession,
  scoreParaphrase,
  type ParaphraseLevel,
  type ParaphraseSentence,
  type ParaphraseScoreResponse,
} from '../api';

type Phase = 'loading' | 'attempt' | 'scoring' | 'feedback' | 'summary' | 'error';

export const SESSION_SIZE = 5;

export function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 13, marginBottom: 4, color: 'var(--text-secondary)',
        }}
      >
        <span>{label}</span>
        <span data-testid={`paraphrase-score-${label.toLowerCase()}`}>{pct}</span>
      </div>
      <div
        style={{
          background: 'var(--border, #e5e7eb)', borderRadius: 4,
          height: 10, overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`, height: '100%',
            background: scoreColor(pct),
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

export default function Paraphrase() {
  const tts = useSpeechSynthesis();
  const recog = useSpeechRecognition({
    lang: 'en-US', continuous: false, interimResults: true,
  });

  const [level, setLevel] = useState<ParaphraseLevel>('easy');
  const [items, setItems] = useState<ParaphraseSentence[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [attempt, setAttempt] = useState('');
  const [score, setScore] = useState<ParaphraseScoreResponse | null>(null);
  const [history, setHistory] = useState<ParaphraseScoreResponse[]>([]);

  const current = items[index] || null;

  const loadSession = useCallback(async (lvl: ParaphraseLevel) => {
    setPhase('loading');
    setErrorMsg('');
    setAttempt('');
    setScore(null);
    setHistory([]);
    setIndex(0);
    try {
      const data = await getParaphraseSession(lvl, SESSION_SIZE);
      setItems(data.items);
      setPhase('attempt');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to load sentences');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void loadSession(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture speech recognition transcript into the textarea.
  useEffect(() => {
    if (recog.transcript) {
      setAttempt((prev) => (prev ? `${prev} ${recog.transcript}`.trim() : recog.transcript));
      recog.reset();
    }
  }, [recog.transcript, recog]);

  const handleLevelChange = (lvl: ParaphraseLevel) => {
    setLevel(lvl);
    void loadSession(lvl);
  };

  const handleSpeak = () => {
    if (current) {
      tts.speak(current.text, 'en-US');
    }
  };

  const handleMicToggle = () => {
    if (recog.isListening) {
      recog.stop();
    } else {
      recog.reset();
      recog.start();
    }
  };

  const handleSubmit = async () => {
    if (!current || !attempt.trim()) return;
    setPhase('scoring');
    try {
      const result = await scoreParaphrase(current.text, attempt.trim());
      setScore(result);
      setHistory((h) => [...h, result]);
      setPhase('feedback');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Scoring failed');
      setPhase('error');
    }
  };

  const handleNext = () => {
    if (index + 1 >= items.length) {
      setPhase('summary');
      return;
    }
    setIndex((i) => i + 1);
    setAttempt('');
    setScore(null);
    setPhase('attempt');
  };

  const averageOverall = useMemo(() => {
    if (history.length === 0) return 0;
    const sum = history.reduce((a, h) => a + (h.overall || 0), 0);
    return Math.round(sum / history.length);
  }, [history]);

  const canSubmit = phase === 'attempt' && attempt.trim().length > 0 && !!current;
  const isLast = index + 1 >= items.length;

  return (
    <div
      data-testid="paraphrase-page"
      style={{
        maxWidth: 720, margin: '0 auto', padding: '1rem',
        background: 'var(--bg-card)', color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link
          to="/"
          aria-label="Back to home"
          style={{ display: 'flex', color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={20} />
        </Link>
        <h2 data-testid="paraphrase-title" style={{ margin: 0, flex: 1 }}>
          ✍️ Paraphrase Practice
        </h2>
        <div
          data-testid="paraphrase-progress"
          style={{ fontSize: 13, color: 'var(--text-secondary)' }}
        >
          {Math.min(index + 1, items.length || SESSION_SIZE)} / {items.length || SESSION_SIZE}
        </div>
      </div>

      <div
        role="group"
        aria-label="Difficulty level"
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        {(['easy', 'medium', 'hard'] as ParaphraseLevel[]).map((lvl) => (
          <button
            key={lvl}
            data-testid={`paraphrase-level-${lvl}`}
            onClick={() => handleLevelChange(lvl)}
            disabled={phase === 'loading' || phase === 'scoring'}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              border: '1px solid var(--border)',
              background: level === lvl ? 'var(--primary, #3b82f6)' : 'var(--bg-card)',
              color: level === lvl ? 'white' : 'var(--text-primary)',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {lvl}
          </button>
        ))}
      </div>

      {phase === 'loading' && (
        <div data-testid="paraphrase-loading" style={{ padding: '2rem', textAlign: 'center' }}>
          Loading sentences…
        </div>
      )}

      {phase === 'error' && (
        <div
          data-testid="paraphrase-error"
          style={{
            padding: '1rem', border: '1px solid #ef4444',
            borderRadius: 8, color: '#ef4444', marginBottom: 12,
          }}
        >
          {errorMsg || 'Something went wrong.'}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => loadSession(level)}>Retry</button>
          </div>
        </div>
      )}

      {(phase === 'attempt' || phase === 'scoring' || phase === 'feedback') && current && (
        <div
          className="card"
          style={{
            border: '1px solid var(--border)', borderRadius: 12,
            padding: '1rem', marginBottom: 16, background: 'var(--bg-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
            <p
              data-testid="paraphrase-source"
              style={{ margin: 0, flex: 1, fontSize: 16, lineHeight: 1.5 }}
            >
              {current.text}
            </p>
            <button
              data-testid="paraphrase-speak"
              onClick={handleSpeak}
              aria-label="Listen to original"
              title="Listen"
              style={{
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 8, padding: 6, cursor: 'pointer',
                color: 'var(--text-primary)',
              }}
            >
              <Volume2 size={18} />
            </button>
          </div>

          <textarea
            data-testid="paraphrase-input"
            value={attempt}
            onChange={(e) => setAttempt(e.target.value)}
            placeholder="Rewrite this sentence in your own words…"
            disabled={phase !== 'attempt'}
            rows={3}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--border)', fontSize: 14,
              fontFamily: 'inherit', resize: 'vertical',
              background: 'var(--bg-card)', color: 'var(--text-primary)',
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {recog.isSupported && (
              <button
                data-testid="paraphrase-mic"
                onClick={handleMicToggle}
                disabled={phase !== 'attempt'}
                aria-pressed={recog.isListening}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: recog.isListening ? '#ef4444' : 'var(--bg-card)',
                  color: recog.isListening ? 'white' : 'var(--text-primary)',
                  cursor: 'pointer', fontSize: 13,
                }}
              >
                {recog.isListening ? <MicOff size={16} /> : <Mic size={16} />}
                {recog.isListening ? 'Stop' : 'Speak'}
              </button>
            )}
            <button
              data-testid="paraphrase-submit"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: canSubmit ? 'var(--primary, #3b82f6)' : 'var(--border)',
                color: 'white', fontWeight: 600, fontSize: 14,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {phase === 'scoring' ? 'Scoring…' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      {phase === 'feedback' && score && (
        <div
          data-testid="paraphrase-feedback"
          className="card"
          style={{
            border: '1px solid var(--border)', borderRadius: 12,
            padding: '1rem', marginBottom: 16, background: 'var(--bg-card)',
          }}
        >
          <ScoreBar label="Meaning" value={score.meaning_score} />
          <ScoreBar label="Grammar" value={score.grammar_score} />
          <ScoreBar label="Naturalness" value={score.naturalness_score} />
          <div
            data-testid="paraphrase-overall"
            style={{
              fontSize: 22, fontWeight: 700, marginTop: 8,
              color: scoreColor(score.overall),
            }}
          >
            Overall: {score.overall}
          </div>
          <p
            data-testid="paraphrase-feedback-text"
            style={{ margin: '12px 0 8px', fontSize: 14 }}
          >
            {score.feedback}
          </p>
          {score.suggested_paraphrase && (
            <div
              data-testid="paraphrase-suggested"
              style={{
                padding: 10, borderRadius: 8,
                background: 'var(--bg-secondary, #f3f4f6)',
                fontStyle: 'italic', fontSize: 14, marginTop: 8,
              }}
            >
              💡 {score.suggested_paraphrase}
            </div>
          )}
          <div style={{ marginTop: 14, textAlign: 'right' }}>
            <button
              data-testid="paraphrase-next"
              onClick={handleNext}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: 'var(--primary, #3b82f6)', color: 'white',
                fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              {isLast ? 'Finish' : 'Next →'}
            </button>
          </div>
        </div>
      )}

      {phase === 'summary' && (
        <div
          data-testid="paraphrase-summary"
          className="card"
          style={{
            border: '1px solid var(--border)', borderRadius: 12,
            padding: '1.25rem', textAlign: 'center', background: 'var(--bg-card)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Session complete! 🎉</h3>
          <div
            data-testid="paraphrase-summary-average"
            style={{
              fontSize: 36, fontWeight: 700, margin: '12px 0',
              color: scoreColor(averageOverall),
            }}
          >
            {averageOverall}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Average overall score across {history.length} sentences
          </div>
          <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              data-testid="paraphrase-restart"
              onClick={() => loadSession(level)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none',
                background: 'var(--primary, #3b82f6)', color: 'white',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Practice again
            </button>
            <Link
              to="/"
              style={{
                padding: '8px 16px', borderRadius: 8,
                border: '1px solid var(--border)',
                color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600,
              }}
            >
              Home
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
