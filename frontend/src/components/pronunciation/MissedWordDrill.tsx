import { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, RotateCcw, SkipForward, Volume2, Check } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';

const MAX_ATTEMPTS = 3;

/**
 * Lowercase + strip punctuation around a word for tolerant comparison.
 * Exported for unit tests.
 */
export function normalizeWord(s: string): string {
  if (!s || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, '')
    .trim();
}

/**
 * Check if recognized transcript contains an exact (case-insensitive,
 * punctuation-stripped) match for the target word.
 * Exported for unit tests.
 */
export function transcriptMatches(transcript: string, target: string): boolean {
  const t = normalizeWord(target);
  if (!t) return false;
  const heard = normalizeWord(transcript);
  if (!heard) return false;
  // Token-level exact match
  const tokens = heard.split(/\s+/).filter(Boolean);
  return tokens.includes(t);
}

/**
 * Build a short example phrase the drill speaks for context.
 * Exported for unit tests.
 */
export function buildExamplePhrase(word: string): string {
  const w = (word || '').trim();
  return `Say: ${w}. ${w}.`;
}

export interface MissedWordDrillProps {
  /** Non-correct words from feedback.word_feedback (already filtered). */
  words: string[];
  /** Called when user clicks "Retry sentence" on the summary card. */
  onRetrySentence: () => void;
  /** Called when user clicks "Done" on the summary card. */
  onDone: () => void;
}

type WordResult = 'correct' | 'skipped';

export function MissedWordDrill({ words, onRetrySentence, onDone }: MissedWordDrillProps) {
  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition();

  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [results, setResults] = useState<WordResult[]>([]);
  const [heard, setHeard] = useState<string>('');
  const [stage, setStage] = useState<'preview' | 'listening' | 'feedback' | 'summary'>('preview');
  const previewTimerRef = useRef<number | null>(null);
  const listeningTimerRef = useRef<number | null>(null);

  const total = words.length;
  const currentWord = index < total ? words[index] : '';
  const isFinished = stage === 'summary';

  const clearTimers = useCallback(() => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (listeningTimerRef.current) {
      window.clearTimeout(listeningTimerRef.current);
      listeningTimerRef.current = null;
    }
  }, []);

  // Preview stage: speak the word, then the example phrase, then auto-listen.
  useEffect(() => {
    if (isFinished || !currentWord || stage !== 'preview') return;
    try {
      tts.speak(currentWord);
      previewTimerRef.current = window.setTimeout(() => {
        tts.speak(buildExamplePhrase(currentWord));
        previewTimerRef.current = window.setTimeout(() => {
          speech.reset();
          setHeard('');
          setStage('listening');
          try { speech.start(); } catch (_) { /* noop */ }
        }, 1400);
      }, 700);
    } catch (_) {
      // tts may be unsupported in tests; just move forward.
      setStage('listening');
    }
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, index, currentWord, isFinished]);

  // Listening stage: when transcript arrives (or speech stops), evaluate.
  useEffect(() => {
    if (stage !== 'listening') return;
    if (!speech.transcript) return;
    const ok = transcriptMatches(speech.transcript, currentWord);
    setHeard(speech.transcript);
    if (ok) {
      try { speech.stop(); } catch (_) { /* noop */ }
      const newResults = [...results, 'correct' as WordResult];
      setResults(newResults);
      setAttempts(0);
      // Move on
      if (index + 1 >= total) {
        setStage('summary');
      } else {
        setIndex(index + 1);
        setStage('preview');
      }
    } else {
      try { speech.stop(); } catch (_) { /* noop */ }
      setAttempts((a) => a + 1);
      setStage('feedback');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.transcript, stage]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearTimers();
      try { tts.stop(); } catch (_) { /* noop */ }
      try { speech.stop(); } catch (_) { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTryAgain = () => {
    if (attempts >= MAX_ATTEMPTS) return;
    setHeard('');
    setStage('preview');
  };

  const handleSkip = () => {
    clearTimers();
    try { speech.stop(); } catch (_) { /* noop */ }
    const newResults = [...results, 'skipped' as WordResult];
    setResults(newResults);
    setAttempts(0);
    setHeard('');
    if (index + 1 >= total) {
      setStage('summary');
    } else {
      setIndex(index + 1);
      setStage('preview');
    }
  };

  if (!total) return null;

  // Progress strip: ✓ for correct, · for skipped, ○ for upcoming, * for current
  const strip = words.map((_, i) => {
    if (i < results.length) return results[i] === 'correct' ? '✓' : '·';
    if (i === index && !isFinished) return '*';
    return '○';
  }).join('');

  if (isFinished) {
    const correctCount = results.filter((r) => r === 'correct').length;
    return (
      <div
        className="card"
        data-testid="missed-word-drill-summary"
        style={{ marginTop: 16, padding: 16, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}
      >
        <h4 style={{ marginBottom: 8 }}>🎯 Drill Complete</h4>
        <p style={{ fontSize: 15, marginBottom: 12 }}>
          You nailed <strong>{correctCount}</strong> of <strong>{total}</strong>
          {correctCount === total ? ' — perfect!' : ' — Retry whole sentence?'}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            className="btn btn-primary"
            data-testid="missed-word-drill-retry-sentence"
            onClick={onRetrySentence}
          >
            <RotateCcw size={16} /> Retry sentence
          </button>
          <button
            className="btn btn-secondary"
            data-testid="missed-word-drill-done"
            onClick={onDone}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      data-testid="missed-word-drill-panel"
      style={{ marginTop: 16, padding: 16, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>🎯 Drill Missed Words</h4>
        <span
          data-testid="missed-word-drill-progress"
          style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}
        >
          Word {index + 1} / {total} {strip}
        </span>
      </div>

      <div
        data-testid="missed-word-drill-current"
        style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', margin: '12px 0' }}
      >
        {currentWord}
      </div>

      {stage === 'preview' && (
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
          <Volume2 size={14} /> Listen carefully…
        </p>
      )}

      {stage === 'listening' && (
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--primary)' }}>
          <Mic size={14} /> Now say it!
        </p>
      )}

      {stage === 'feedback' && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <p style={{ fontSize: 13, color: '#ef4444', marginBottom: 8 }}>
            heard: "{heard}"
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {attempts < MAX_ATTEMPTS && (
              <button
                className="btn btn-secondary"
                data-testid="missed-word-drill-try-again"
                onClick={handleTryAgain}
              >
                <RotateCcw size={14} /> Try Again ({MAX_ATTEMPTS - attempts} left)
              </button>
            )}
            <button
              className="btn btn-secondary"
              data-testid="missed-word-drill-skip"
              onClick={handleSkip}
            >
              <SkipForward size={14} /> Skip
            </button>
          </div>
        </div>
      )}

      {/* Last-correct check icon for visual reinforcement */}
      {results.length > 0 && results[results.length - 1] === 'correct' && stage !== 'feedback' && (
        <p style={{ textAlign: 'center', fontSize: 12, color: '#22c55e' }}>
          <Check size={12} /> Nice!
        </p>
      )}
    </div>
  );
}

export default MissedWordDrill;
