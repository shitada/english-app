import { useState, useCallback, useMemo, useId } from 'react';
import { Ear, RotateCcw } from 'lucide-react';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import { submitDictationAttempt } from '../../api';

/**
 * Pure helper: tokenize a piece of text into comparison tokens.
 *  - lowercases
 *  - strips surrounding punctuation
 *  - filters empty strings
 */
export function tokenizeForDictation(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''))
    .filter(Boolean);
}

export type DictationWordStatus = 'correct' | 'missed' | 'extra';

export interface DictationDiffWord {
  word: string;
  status: DictationWordStatus;
}

export interface DictationDiffResult {
  words: DictationDiffWord[];
  /** number of original words typed correctly */
  correctCount: number;
  /** number of original words missed (not present in user's typing) */
  missedCount: number;
  /** number of extra words typed not in original */
  extraCount: number;
  /** total original word count */
  originalCount: number;
  /** accuracy as a percent in [0, 100], correctCount / originalCount */
  accuracy: number;
}

/**
 * Pure helper: compute a word-level diff between original and typed text.
 * Comparison is case- and punctuation-insensitive. Order is not enforced
 * (uses multiset matching) to avoid penalising minor reordering. Output
 * preserves the user's typed order with status, then appends any missed
 * original words at the end.
 */
export function diffDictation(
  original: string,
  typed: string,
): DictationDiffResult {
  const origTokens = tokenizeForDictation(original);
  const typedTokens = tokenizeForDictation(typed);

  // Build a multiset of original tokens for matching.
  const remaining = new Map<string, number>();
  for (const t of origTokens) remaining.set(t, (remaining.get(t) || 0) + 1);

  const words: DictationDiffWord[] = [];
  let correctCount = 0;
  let extraCount = 0;
  for (const t of typedTokens) {
    const c = remaining.get(t) || 0;
    if (c > 0) {
      remaining.set(t, c - 1);
      words.push({ word: t, status: 'correct' });
      correctCount += 1;
    } else {
      words.push({ word: t, status: 'extra' });
      extraCount += 1;
    }
  }

  // Whatever is left in `remaining` is missed.
  let missedCount = 0;
  for (const [w, c] of remaining.entries()) {
    for (let i = 0; i < c; i++) {
      words.push({ word: w, status: 'missed' });
      missedCount += 1;
    }
  }

  const originalCount = origTokens.length;
  const accuracy =
    originalCount === 0 ? 0 : Math.round((correctCount / originalCount) * 100);

  return { words, correctCount, missedCount, extraCount, originalCount, accuracy };
}

type Phase = 'idle' | 'playing' | 'typing' | 'result';

interface Props {
  text: string;
  conversationId?: string | number | null;
  messageId?: string | number | null;
  onComplete?: (accuracy: number) => void;
}

function statusColor(status: DictationWordStatus): string {
  if (status === 'correct') return 'var(--success, #22c55e)';
  if (status === 'missed') return 'var(--danger, #ef4444)';
  return 'var(--warning, #f59e0b)'; // extra
}

export function InlineDictationButton({
  text,
  conversationId,
  messageId,
  onComplete,
}: Props) {
  const tts = useSpeechSynthesis();
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState('');
  const [diff, setDiff] = useState<DictationDiffResult | null>(null);
  const inputId = useId();

  const wordCount = useMemo(() => tokenizeForDictation(text).length, [text]);
  // Only show on lines worth dictating (avoid 1-2 word fragments).
  const eligible = wordCount >= 3 && wordCount <= 30;

  const playAudio = useCallback(() => {
    if (!text) return;
    setPhase('playing');
    tts.speak(text, 'en-US', 0.9);
    // Move to typing phase right away — input is shown while audio plays.
    setPhase('typing');
  }, [text, tts]);

  const handleStart = useCallback(() => {
    setTyped('');
    setDiff(null);
    playAudio();
  }, [playAudio]);

  const handleSubmit = useCallback(async () => {
    const result = diffDictation(text, typed);
    setDiff(result);
    setPhase('result');
    onComplete?.(result.accuracy);
    try {
      await submitDictationAttempt({
        conversation_id: conversationId == null ? null : String(conversationId),
        message_id: messageId == null ? null : String(messageId),
        accuracy: result.accuracy,
        word_count: result.originalCount,
        missed_word_count: result.missedCount,
      });
    } catch {
      // Best-effort persistence; ignore network errors so practice still works.
    }
  }, [text, typed, onComplete, conversationId, messageId]);

  const handleRetry = useCallback(() => {
    setTyped('');
    setDiff(null);
    setPhase('typing');
    if (text) tts.speak(text, 'en-US', 0.9);
  }, [text, tts]);

  if (!eligible) return null;

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

  if (phase === 'idle') {
    return (
      <button
        type="button"
        onClick={handleStart}
        aria-label="Type what you hear (dictation)"
        title="Dictation: type what you hear"
        data-testid="inline-dictation-button"
        style={{ ...baseBtnStyle, marginLeft: 2 }}
      >
        <Ear size={14} />
        <span style={{ fontSize: 10 }}>Dictation</span>
      </button>
    );
  }

  return (
    <span
      data-testid="inline-dictation-panel"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6,
        marginLeft: 2,
        marginTop: 4,
        padding: '6px 8px',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 8,
        background: 'var(--bg-subtle, rgba(99,102,241,0.06))',
        minWidth: 220,
      }}
    >
      {phase === 'typing' && (
        <>
          <label
            htmlFor={inputId}
            style={{ fontSize: 11, color: 'var(--text-secondary, #6b7280)' }}
          >
            🎧 Listen and type what you hear:
          </label>
          <input
            id={inputId}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed.trim()) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Type the sentence you heard…"
            aria-label="Dictation input"
            data-testid="inline-dictation-input"
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border, #d1d5db)',
              background: 'var(--bg, #fff)',
              color: 'var(--text, #111)',
              fontSize: 13,
            }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => tts.speak(text, 'en-US', 0.9)}
              disabled={tts.isSpeaking}
              aria-label="Replay audio"
              title="Replay audio (0.9×)"
              data-testid="inline-dictation-replay"
              style={{ ...baseBtnStyle, opacity: tts.isSpeaking ? 0.4 : 0.85 }}
            >
              <Ear size={14} />
              <span style={{ fontSize: 10 }}>Replay</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!typed.trim()}
              data-testid="inline-dictation-submit"
              style={{
                ...baseBtnStyle,
                opacity: typed.trim() ? 1 : 0.4,
                background: 'var(--primary, #6366f1)',
                color: '#fff',
                padding: '4px 10px',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>Submit</span>
            </button>
          </div>
          {/* Original text hidden behind a blurred placeholder */}
          <div
            aria-hidden="true"
            style={{
              fontSize: 11,
              color: 'var(--text-secondary, #6b7280)',
              filter: 'blur(4px)',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            {text}
          </div>
        </>
      )}

      {phase === 'result' && diff && (
        <>
          <div
            data-testid="inline-dictation-result"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              color:
                diff.accuracy >= 80
                  ? 'var(--success, #22c55e)'
                  : diff.accuracy >= 50
                    ? 'var(--warning, #f59e0b)'
                    : 'var(--danger, #ef4444)',
            }}
          >
            Accuracy: {diff.accuracy}%
            <span
              style={{
                fontWeight: 400,
                color: 'var(--text-secondary, #6b7280)',
              }}
            >
              ({diff.correctCount}/{diff.originalCount} words)
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            {diff.words.map((w, i) => (
              <span
                key={`${w.word}-${i}`}
                title={w.status}
                style={{
                  padding: '0 4px',
                  borderRadius: 4,
                  background:
                    w.status === 'correct'
                      ? 'rgba(34,197,94,0.15)'
                      : w.status === 'missed'
                        ? 'rgba(239,68,68,0.15)'
                        : 'rgba(245,158,11,0.15)',
                  color: statusColor(w.status),
                  textDecoration: w.status === 'missed' ? 'line-through' : 'none',
                }}
              >
                {w.word}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRetry}
            data-testid="inline-dictation-retry"
            aria-label="Replay and retry dictation"
            title="Replay & retry"
            style={{ ...baseBtnStyle, alignSelf: 'flex-start', opacity: 1 }}
          >
            <RotateCcw size={12} />
            <span style={{ fontSize: 11 }}>Replay & retry</span>
          </button>
        </>
      )}
    </span>
  );
}

export default InlineDictationButton;
