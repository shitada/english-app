import { useState, useCallback, useEffect, useRef } from 'react';
import { Headphones, Mic, RotateCcw } from 'lucide-react';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { api } from '../../api';

/**
 * Pure helper: split a piece of assistant text into "shadowable" lines.
 * Rules:
 *   - sentence-split on . ! ?
 *   - keep sentences whose word count is between 4 and 18 inclusive
 *   - return all qualifying sentences in original order (caller may pick first)
 */
export function splitIntoShadowableLines(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  // Normalize whitespace; split on sentence-terminating punctuation while keeping delimiter.
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const rawSentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of rawSentences) {
    // Strip trailing terminal punctuation for word counting
    const wordCount = s
      .replace(/[.,!?;:'"()\[\]]/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;
    if (wordCount >= 4 && wordCount <= 18) {
      out.push(s);
    }
  }
  return out;
}

type Phase = 'idle' | 'playing' | 'recording' | 'evaluating' | 'result' | 'error';

interface Props {
  text: string;
  onComplete?: (score: number) => void;
}

const RECORDING_TIMEOUT_MS = 6000;

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--success, #22c55e)';
  if (score >= 60) return 'var(--warning, #f59e0b)';
  return 'var(--danger, #ef4444)';
}

export function InlineShadowButton({ text, onComplete }: Props) {
  const lines = splitIntoShadowableLines(text);
  const targetLine = lines[0];

  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition();
  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evaluatingRef = useRef(false);

  // Keep playing-state in sync with TTS isSpeaking transitions.
  useEffect(() => {
    if (phase === 'playing' && !tts.isSpeaking) {
      setPhase('idle');
    }
  }, [tts.isSpeaking, phase]);

  // When recording ends and we have a transcript, evaluate.
  useEffect(() => {
    if (phase !== 'recording') return;
    if (speech.isListening) return;
    if (evaluatingRef.current) return;
    const transcript = speech.transcript.trim();
    if (!transcript) return;
    evaluatingRef.current = true;
    setPhase('evaluating');
    (async () => {
      try {
        const res = await api.checkPronunciation(targetLine, transcript);
        const s = typeof res.overall_score === 'number' ? Math.round(res.overall_score) : 0;
        setScore(s);
        setPhase('result');
        onComplete?.(s);
      } catch {
        setErrMsg('Could not score pronunciation. Try again.');
        setPhase('error');
      } finally {
        evaluatingRef.current = false;
      }
    })();
  }, [phase, speech.isListening, speech.transcript, targetLine, onComplete]);

  // Surface speech errors inline.
  useEffect(() => {
    if (speech.error && (phase === 'recording' || phase === 'evaluating')) {
      setErrMsg(speech.error);
      setPhase('error');
    }
  }, [speech.error, phase]);

  // Cleanup any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  const handlePlay = useCallback(() => {
    if (!targetLine) return;
    setErrMsg('');
    setPhase('playing');
    // 0.85x rate for comfortable shadowing
    tts.speak(targetLine, 'en-US', 0.85);
  }, [targetLine, tts]);

  const handleRecord = useCallback(() => {
    if (!targetLine) return;
    if (!speech.isSupported) {
      setErrMsg('Speech recognition not supported in this browser.');
      setPhase('error');
      return;
    }
    setErrMsg('');
    setScore(null);
    speech.reset();
    setPhase('recording');
    speech.start();
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      speech.stop();
    }, RECORDING_TIMEOUT_MS);
  }, [targetLine, speech]);

  const handleRetry = useCallback(() => {
    setScore(null);
    setErrMsg('');
    speech.reset();
    setPhase('idle');
  }, [speech]);

  if (!targetLine) return null;

  // Compact inline UI (icon-only, bottom-right of bubble).
  const baseBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 6px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'var(--primary, #6366f1)',
    opacity: 0.75,
  };

  return (
    <span
      data-testid="inline-shadow-button"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}
    >
      {(phase === 'idle' || phase === 'playing') && (
        <button
          type="button"
          onClick={handlePlay}
          disabled={phase === 'playing' || tts.isSpeaking}
          aria-label="Shadow this line"
          title="Shadow this line"
          style={{ ...baseBtnStyle, opacity: phase === 'playing' ? 1 : 0.75 }}
        >
          <Headphones size={14} />
          <Mic size={14} />
          {phase === 'playing' && (
            <span style={{ fontSize: 10, marginLeft: 2 }}>Playing…</span>
          )}
        </button>
      )}

      {phase === 'idle' && targetLine && tts.isSpeaking === false && score === null && (
        <button
          type="button"
          onClick={handleRecord}
          aria-label="Record your shadow attempt"
          title="Record your shadow"
          style={baseBtnStyle}
        >
          <Mic size={14} />
        </button>
      )}

      {phase === 'recording' && (
        <button
          type="button"
          onClick={() => {
            if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
            speech.stop();
          }}
          aria-label="Stop recording"
          title="Stop recording"
          style={{ ...baseBtnStyle, color: 'var(--danger, #ef4444)', opacity: 1 }}
        >
          <Mic size={14} />
          <span style={{ fontSize: 10 }}>Listening…</span>
        </button>
      )}

      {phase === 'evaluating' && (
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Scoring…</span>
      )}

      {phase === 'result' && score !== null && (
        <span
          data-testid="inline-shadow-result"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 999,
            background: scoreColor(score),
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Pronunciation: {score}%
          <button
            type="button"
            onClick={handleRetry}
            aria-label="Retry shadow"
            title="Retry"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <RotateCcw size={12} />
          </button>
        </span>
      )}

      {phase === 'error' && (
        <span
          role="alert"
          style={{ fontSize: 11, color: 'var(--danger, #ef4444)', display: 'inline-flex', gap: 4, alignItems: 'center' }}
        >
          {errMsg || 'Something went wrong.'}
          <button
            type="button"
            onClick={handleRetry}
            aria-label="Retry shadow"
            title="Retry"
            style={{ ...baseBtnStyle, color: 'var(--danger, #ef4444)', opacity: 1, padding: '0 4px' }}
          >
            <RotateCcw size={12} />
          </button>
        </span>
      )}
    </span>
  );
}

export default InlineShadowButton;
