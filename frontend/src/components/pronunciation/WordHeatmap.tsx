import { useState, useEffect, useMemo } from 'react';
import { Volume2, Mic, Check } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { normalizeWord, transcriptMatches } from './MissedWordDrill';

const MAX_ATTEMPTS = 3;

export interface WordHeatmapWordFeedback {
  expected: string;
  heard: string;
  is_correct: boolean;
  tip: string;
  phoneme_issues?: { target?: string; produced?: string; tip?: string; position?: string }[];
}

export interface WordHeatmapTtsLike {
  speak: (text: string, lang?: string, rateOverride?: number) => void;
  isSpeaking?: boolean;
}

export interface WordHeatmapProps {
  /** Reference sentence the user attempted. */
  referenceText: string;
  /** Per-word evaluation for the current attempt. */
  wordFeedback: WordHeatmapWordFeedback[];
  /** Speech synthesis facade (so the parent's tts state/voice settings are reused). */
  tts: WordHeatmapTtsLike;
  /** Test-only: pre-expand a token by index. */
  defaultExpandedIndex?: number | null;
  /** Test-only: pre-resolved indices. */
  defaultResolvedIndices?: number[];
}

export type TokenStatus = 'correct' | 'missed' | 'neutral';

export interface ResolvedToken {
  /** Original text token from reference (with punctuation preserved). */
  raw: string;
  /** Normalized text used for matching. */
  normalized: string;
  /** Index in word_feedback this token aligned to, or -1. */
  feedbackIndex: number;
  /** The aligned feedback entry, if any. */
  feedback: WordHeatmapWordFeedback | null;
  status: TokenStatus;
}

/**
 * Tokenize the reference text and align each whitespace-separated token to
 * an entry in `word_feedback` by normalized expected match (first unused
 * occurrence wins). Tokens with no aligned entry get status="neutral" and
 * are not interactive.
 *
 * Exported for unit tests.
 */
export function alignTokens(
  referenceText: string,
  wordFeedback: WordHeatmapWordFeedback[]
): ResolvedToken[] {
  const rawTokens = (referenceText || '').split(/\s+/).filter(Boolean);
  const used = new Set<number>();
  return rawTokens.map((raw): ResolvedToken => {
    const normalized = normalizeWord(raw);
    let feedbackIndex = -1;
    if (normalized) {
      for (let i = 0; i < wordFeedback.length; i++) {
        if (used.has(i)) continue;
        const exp = normalizeWord(wordFeedback[i]?.expected || '');
        if (exp && exp === normalized) {
          feedbackIndex = i;
          used.add(i);
          break;
        }
      }
    }
    const feedback = feedbackIndex >= 0 ? wordFeedback[feedbackIndex] : null;
    let status: TokenStatus = 'neutral';
    if (feedback) status = feedback.is_correct ? 'correct' : 'missed';
    return { raw, normalized, feedbackIndex, feedback, status };
  });
}

/** CSS class for a token's status. Exported for unit tests. */
export function tokenColorClass(status: TokenStatus, resolved: boolean): string {
  if (resolved) return 'word-heatmap-token word-heatmap-resolved';
  switch (status) {
    case 'correct':
      return 'word-heatmap-token word-heatmap-correct';
    case 'missed':
      return 'word-heatmap-token word-heatmap-missed';
    default:
      return 'word-heatmap-token word-heatmap-neutral';
  }
}

/**
 * WordHeatmap: at-a-glance view of which words the user nailed vs. missed
 * for the *current* shadowing attempt. Missed words are clickable buttons
 * that reveal a tip + 🔊 model-the-word + 🎤 retry-just-this-word panel.
 */
export function WordHeatmap({
  referenceText,
  wordFeedback,
  tts,
  defaultExpandedIndex = null,
  defaultResolvedIndices,
}: WordHeatmapProps) {
  const tokens = useMemo(
    () => alignTokens(referenceText, wordFeedback),
    [referenceText, wordFeedback]
  );

  const speech = useSpeechRecognition();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(defaultExpandedIndex);
  const [resolvedSet, setResolvedSet] = useState<Set<number>>(
    () => new Set<number>(defaultResolvedIndices ?? [])
  );
  const [attemptsByIndex, setAttemptsByIndex] = useState<Record<number, number>>({});
  const [heardByIndex, setHeardByIndex] = useState<Record<number, string>>({});

  // React to ASR transcript: if the expanded token's expected word is heard,
  // mark it resolved; otherwise record the heard text and bump attempt count.
  useEffect(() => {
    if (expandedIndex === null) return;
    if (!speech.transcript) return;
    const tok = tokens[expandedIndex];
    if (!tok || !tok.feedback) return;
    const target = tok.feedback.expected;
    const ok = transcriptMatches(speech.transcript, target);
    if (ok) {
      setResolvedSet((prev) => {
        if (prev.has(expandedIndex)) return prev;
        const next = new Set(prev);
        next.add(expandedIndex);
        return next;
      });
      try { speech.stop(); } catch (_) { /* noop */ }
    } else {
      setHeardByIndex((prev) => ({ ...prev, [expandedIndex]: speech.transcript }));
      setAttemptsByIndex((prev) => ({
        ...prev,
        [expandedIndex]: (prev[expandedIndex] || 0) + 1,
      }));
      try { speech.stop(); } catch (_) { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.transcript]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try { speech.stop(); } catch (_) { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived "is resolved" — also accounts for an in-flight matching transcript
  // even if the effect hasn't run yet (helps SSR-style tests).
  const isResolved = (i: number): boolean => {
    if (resolvedSet.has(i)) return true;
    if (
      expandedIndex === i &&
      speech.transcript &&
      tokens[i]?.feedback &&
      transcriptMatches(speech.transcript, tokens[i].feedback!.expected)
    ) {
      return true;
    }
    return false;
  };

  const handleTokenClick = (i: number) => {
    const tok = tokens[i];
    if (!tok || tok.status !== 'missed') return;
    if (isResolved(i)) return;
    if (expandedIndex === i) {
      setExpandedIndex(null);
    } else {
      setExpandedIndex(i);
      try { speech.reset(); } catch (_) { /* noop */ }
    }
  };

  const handlePlayWord = (word: string) => {
    try { tts.speak(word); } catch (_) { /* noop */ }
  };

  const handleRetry = () => {
    if (expandedIndex === null) return;
    const attempts = attemptsByIndex[expandedIndex] || 0;
    if (attempts >= MAX_ATTEMPTS) return;
    try { speech.reset(); } catch (_) { /* noop */ }
    try { speech.start(); } catch (_) { /* noop */ }
  };

  if (!tokens.length) return null;

  return (
    <div
      className="word-heatmap"
      data-testid="word-heatmap"
      style={{
        margin: '0 0 16px',
        padding: 12,
        background: 'var(--bg-secondary, #f9fafb)',
        borderRadius: 8,
        border: '1px solid var(--border, #e5e7eb)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 8,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        Word Heatmap
      </div>
      <div
        data-testid="word-heatmap-tokens"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, lineHeight: 1.8 }}
      >
        {tokens.map((tok, i) => {
          const resolved = isResolved(i);
          const cls = tokenColorClass(tok.status, resolved);
          const baseStyle: React.CSSProperties = {
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 15,
            fontWeight: 500,
          };
          if (tok.status === 'missed' && !resolved) {
            return (
              <button
                key={i}
                className={cls}
                data-testid={`word-heatmap-token-${i}`}
                data-status={tok.status}
                onClick={() => handleTokenClick(i)}
                style={{
                  ...baseStyle,
                  background: '#fef3c7',
                  color: '#b45309',
                  border: '1px solid #fbbf24',
                  cursor: 'pointer',
                }}
                aria-expanded={expandedIndex === i}
                aria-label={`Missed word: ${tok.raw}. Click to drill.`}
              >
                {tok.raw}
              </button>
            );
          }
          let bg = 'transparent';
          let color = 'var(--text-secondary)';
          let border = '1px solid transparent';
          if (resolved) {
            bg = '#dcfce7';
            color = '#166534';
            border = '1px solid #86efac';
          } else if (tok.status === 'correct') {
            bg = '#dcfce7';
            color = '#166534';
            border = '1px solid #bbf7d0';
          }
          return (
            <span
              key={i}
              className={cls}
              data-testid={`word-heatmap-token-${i}`}
              data-status={tok.status}
              data-resolved={resolved ? 'true' : 'false'}
              style={{ ...baseStyle, background: bg, color, border }}
            >
              {tok.raw}
              {resolved && (
                <Check size={12} style={{ marginLeft: 4 }} aria-hidden="true" />
              )}
            </span>
          );
        })}
      </div>

      {expandedIndex !== null && tokens[expandedIndex]?.feedback && (() => {
        const tok = tokens[expandedIndex]!;
        const fb = tok.feedback!;
        const attempts = attemptsByIndex[expandedIndex] || 0;
        const resolved = isResolved(expandedIndex);
        const heard = heardByIndex[expandedIndex] || '';
        return (
          <div
            data-testid="word-heatmap-panel"
            style={{
              marginTop: 12,
              padding: 12,
              background: 'var(--bg-primary, #fff)',
              borderRadius: 6,
              border: '1px solid var(--border, #e5e7eb)',
              opacity: resolved ? 0.7 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 15 }}>
                {fb.expected}
                {resolved && (
                  <span data-testid="word-heatmap-resolved-indicator" style={{ marginLeft: 6, color: '#22c55e' }}>
                    <Check size={14} /> nailed it
                  </span>
                )}
              </strong>
              <button
                className="btn btn-text"
                data-testid="word-heatmap-close"
                onClick={() => setExpandedIndex(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-secondary)' }}
                aria-label="Close drill panel"
              >
                ×
              </button>
            </div>
            {fb.tip && (
              <p data-testid="word-heatmap-tip" style={{ fontSize: 13, marginBottom: 6, color: 'var(--text-secondary)' }}>
                💡 {fb.tip}
              </p>
            )}
            {fb.phoneme_issues && fb.phoneme_issues.length > 0 && (
              <div data-testid="word-heatmap-phoneme-issues" style={{ marginBottom: 8 }}>
                {fb.phoneme_issues.map((p, j) => (
                  <span
                    key={j}
                    className="phoneme-badge"
                    style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      marginRight: 4,
                      fontSize: 11,
                      background: '#fee2e2',
                      color: '#991b1b',
                      borderRadius: 4,
                    }}
                  >
                    {p.target && p.produced ? `${p.target}→${p.produced}` : (p.tip || '?')}
                    {p.position ? ` (${p.position})` : ''}
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                data-testid="word-heatmap-play"
                onClick={() => handlePlayWord(fb.expected)}
                disabled={!!tts.isSpeaking}
              >
                <Volume2 size={14} /> Play word
              </button>
              {!resolved && (
                <button
                  className="btn btn-primary"
                  data-testid="word-heatmap-retry"
                  onClick={handleRetry}
                  disabled={attempts >= MAX_ATTEMPTS || speech.isListening}
                >
                  <Mic size={14} /> {speech.isListening ? 'Listening…' : `Retry (${MAX_ATTEMPTS - attempts} left)`}
                </button>
              )}
            </div>
            {!resolved && heard && (
              <p
                data-testid="word-heatmap-heard"
                style={{ fontSize: 12, marginTop: 8, color: '#ef4444' }}
              >
                heard: "{heard}" — try again
              </p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default WordHeatmap;
