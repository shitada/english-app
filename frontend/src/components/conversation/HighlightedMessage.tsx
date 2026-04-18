import { useState, useCallback, useEffect, useRef } from 'react';
import type { GrammarNote } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

/** Word-level diff: returns array of { word, match } */
function wordDiff(expected: string, spoken: string): { word: string; match: boolean }[] {
  const expectedWords = normalizeText(expected).split(' ').filter(Boolean);
  const spokenWords = normalizeText(spoken).split(' ').filter(Boolean);
  const maxLen = Math.max(expectedWords.length, spokenWords.length);
  return Array.from({ length: maxLen }, (_, i) => {
    const eWord = expectedWords[i] || '';
    const sWord = spokenWords[i] || '';
    return { word: sWord || '___', match: eWord === sWord };
  });
}

function computeAccuracy(expected: string, spoken: string): number {
  const expectedWords = normalizeText(expected).split(' ').filter(Boolean);
  const spokenWords = normalizeText(spoken).split(' ').filter(Boolean);
  if (expectedWords.length === 0) return 0;
  let matches = 0;
  expectedWords.forEach((w, i) => { if (spokenWords[i] === w) matches++; });
  return Math.round((matches / expectedWords.length) * 100);
}

interface ShadowDrillState {
  phase: 'listening' | 'recording' | 'result';
  accuracy?: number;
  diff?: { word: string; match: boolean }[];
  spokenText?: string;
}

function InlineShadowDrill({ phrase, onSpeak, onClose }: {
  phrase: string;
  onSpeak: (text: string) => void;
  onClose: () => void;
}) {
  const { transcript, isListening, isSupported, start, stop, reset } = useSpeechRecognition();
  const [phase, setPhase] = useState<ShadowDrillState['phase']>('listening');
  const [result, setResult] = useState<{ accuracy: number; diff: { word: string; match: boolean }[]; spokenText: string } | null>(null);
  const hasPlayedRef = useRef(false);

  // Auto-play TTS on mount
  useEffect(() => {
    if (!hasPlayedRef.current) {
      hasPlayedRef.current = true;
      onSpeak(phrase);
      // Give TTS a moment, then transition to recording phase
      const timer = setTimeout(() => setPhase('recording'), 1500);
      return () => clearTimeout(timer);
    }
  }, [phrase, onSpeak]);

  const handleRecord = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      reset();
      start();
    }
  }, [isListening, start, stop, reset]);

  const handleSubmit = useCallback(() => {
    const accuracy = computeAccuracy(phrase, transcript);
    const diff = wordDiff(phrase, transcript);
    setResult({ accuracy, diff, spokenText: transcript });
    setPhase('result');
    // Auto-dismiss on success after a short delay
    if (accuracy >= 80) {
      setTimeout(() => onClose(), 2000);
    }
  }, [phrase, transcript, onClose]);

  const handleRetry = useCallback(() => {
    reset();
    setResult(null);
    setPhase('listening');
    hasPlayedRef.current = false;
  }, [reset]);

  return (
    <div
      data-testid="shadow-drill-panel"
      style={{
        display: 'block', marginTop: 6, padding: '8px 10px',
        background: 'var(--bg-secondary, #f0f4ff)', borderRadius: 6,
        border: '1px solid var(--border, #e2e8f0)', fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: 'var(--primary, #6366f1)' }}>
          {phase === 'listening' ? '🔊 Listen...' : phase === 'recording' ? '🎤 Your turn!' : '📊 Result'}
        </span>
        <button
          onClick={onClose}
          data-testid="shadow-drill-close"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, color: 'var(--text-secondary, #6b7280)', padding: '0 2px',
          }}
          aria-label="Close shadow drill"
        >
          ✕
        </button>
      </div>

      {phase === 'recording' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {isSupported ? (
            <>
              <button
                onClick={handleRecord}
                data-testid="shadow-drill-record"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 5, border: 'none',
                  background: isListening ? 'var(--danger, #ef4444)' : 'var(--primary, #6366f1)',
                  color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}
              >
                🎤 {isListening ? 'Stop' : 'Record'}
              </button>
              {!isListening && transcript && (
                <button
                  onClick={handleSubmit}
                  data-testid="shadow-drill-submit"
                  style={{
                    padding: '4px 10px', borderRadius: 5, border: 'none',
                    background: 'var(--success, #22c55e)', color: '#fff',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}
                >
                  Check
                </button>
              )}
              {transcript && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)' }}>
                  "{transcript}"
                </span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Speech recognition not supported in this browser.
            </span>
          )}
        </div>
      )}

      {phase === 'result' && result && (
        <div>
          <div style={{ marginBottom: 4 }}>
            <span style={{
              fontWeight: 700, fontSize: 14,
              color: result.accuracy >= 80 ? 'var(--success, #22c55e)' : result.accuracy >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
            }}>
              {result.accuracy >= 80 ? '✅ Great!' : result.accuracy >= 50 ? '🔶 Almost!' : '❌ Try again'}
              {' '}{result.accuracy}%
            </span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            {result.diff.map((d, i) => (
              <span key={i} style={{
                color: d.match ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
                fontWeight: d.match ? 400 : 600,
              }}>
                {d.word}{i < result.diff.length - 1 ? ' ' : ''}
              </span>
            ))}
          </div>
          {result.accuracy < 80 && (
            <button
              onClick={handleRetry}
              data-testid="shadow-drill-retry"
              style={{
                marginTop: 6, padding: '4px 10px', borderRadius: 5,
                border: '1px solid var(--border, #e2e8f0)', background: 'var(--card-bg, #fff)',
                color: 'var(--text, #111)', cursor: 'pointer', fontSize: 12,
              }}
            >
              🔄 Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function HighlightedMessage({ content, keyPhrases, grammarNotes, onSpeak, onSavePhrase, savedPhrases }: {
  content: string;
  keyPhrases?: string[];
  grammarNotes?: GrammarNote[];
  onSpeak: (text: string) => void;
  onSavePhrase?: (phrase: string) => Promise<void>;
  savedPhrases?: Set<string>;
}) {
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const [activeDrill, setActiveDrill] = useState<number | null>(null);
  const [savingPhrases, setSavingPhrases] = useState<Set<string>>(new Set());

  const handleSave = useCallback(async (phrase: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (!onSavePhrase || savedPhrases?.has(phrase.toLowerCase()) || savingPhrases.has(phrase.toLowerCase())) return;
    setSavingPhrases((prev) => new Set(prev).add(phrase.toLowerCase()));
    try {
      await onSavePhrase(phrase);
    } finally {
      setSavingPhrases((prev) => { const next = new Set(prev); next.delete(phrase.toLowerCase()); return next; });
    }
  }, [onSavePhrase, savedPhrases, savingPhrases]);

  const hasKey = keyPhrases && keyPhrases.length > 0;
  const hasGrammar = grammarNotes && grammarNotes.length > 0;
  if (!hasKey && !hasGrammar) return <>{content}</>;

  // Combine all phrases: key phrases + grammar note phrases
  const allPhrases: { text: string; type: 'key' | 'grammar'; note?: GrammarNote }[] = [];
  if (hasKey) {
    for (const kp of keyPhrases) {
      allPhrases.push({ text: kp, type: 'key' });
    }
  }
  if (hasGrammar) {
    for (const gn of grammarNotes) {
      // Don't add if already covered by a key phrase
      if (!allPhrases.some((p) => p.text.toLowerCase() === gn.phrase.toLowerCase())) {
        allPhrases.push({ text: gn.phrase, type: 'grammar', note: gn });
      }
    }
  }

  // Build regex (longest first)
  const sorted = [...allPhrases].sort((a, b) => b.text.length - a.text.length);
  const escaped = sorted.map((p) => p.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = content.split(regex);

  // Lookup helpers
  const findKeyPhrase = (text: string) => keyPhrases?.find((kp) => kp.toLowerCase() === text.toLowerCase());
  const findGrammarNote = (text: string) => grammarNotes?.find((gn) => gn.phrase.toLowerCase() === text.toLowerCase());

  return (
    <>
      {parts.map((part, i) => {
        const isKey = !!findKeyPhrase(part);
        const grammarNote = findGrammarNote(part);

        if (!isKey && !grammarNote) return <span key={i}>{part}</span>;

        if (isKey && !grammarNote) {
          return (
            <span key={i} style={{ display: 'inline' }}>
              <span
                onClick={() => onSpeak(part)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onSpeak(part); }}
                title="Click to hear pronunciation"
                style={{
                  background: 'var(--highlight-bg, #dbeafe)',
                  borderRadius: 3,
                  padding: '1px 2px',
                  cursor: 'pointer',
                  borderBottom: '2px solid var(--highlight-border, #3b82f6)',
                  color: 'var(--highlight-text, #1e3a5f)',
                }}
              >
                {part} <span style={{ fontSize: 10 }}>🔊</span>
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); setActiveDrill(activeDrill === i ? null : i); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setActiveDrill(activeDrill === i ? null : i); }}
                title="Shadow this phrase"
                data-testid="shadow-drill-mic"
                style={{ fontSize: 10, cursor: 'pointer', marginLeft: 2 }}
              >
                🎤
              </span>
              {onSavePhrase && (
                <span
                  onClick={(e) => { if (!savedPhrases?.has(part.toLowerCase()) && !savingPhrases.has(part.toLowerCase())) handleSave(part, e); else e.stopPropagation(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(part, e); }}
                  title={savedPhrases?.has(part.toLowerCase()) ? 'Saved to vocabulary bank' : 'Save to vocabulary bank'}
                  data-testid="save-phrase-btn"
                  style={{ fontSize: 10, cursor: savedPhrases?.has(part.toLowerCase()) ? 'default' : 'pointer', marginLeft: 2 }}
                >
                  {savedPhrases?.has(part.toLowerCase()) ? '✅' : savingPhrases.has(part.toLowerCase()) ? '⏳' : '📌'}
                </span>
              )}
              {activeDrill === i && (
                <InlineShadowDrill
                  phrase={part}
                  onSpeak={onSpeak}
                  onClose={() => setActiveDrill(null)}
                />
              )}
            </span>
          );
        }

        // Grammar note (with or without key phrase)
        return (
          <span
            key={i}
            style={{ position: 'relative', display: 'inline' }}
          >
            <span
              onClick={() => setActiveTooltip(activeTooltip === i ? null : i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveTooltip(activeTooltip === i ? null : i); }}
              onMouseEnter={() => setActiveTooltip(i)}
              onMouseLeave={() => setActiveTooltip(null)}
              style={{
                borderBottom: '2px dashed #22c55e',
                cursor: 'pointer',
                padding: '1px 2px',
                borderRadius: 3,
                background: isKey ? 'var(--highlight-bg, #dbeafe)' : 'transparent',
                color: isKey ? 'var(--highlight-text, #1e3a5f)' : undefined,
              }}
            >
              {part}
              {isKey && <span style={{ fontSize: 10 }}> 🔊</span>}
              {isKey && (
                <span
                  onClick={(e) => { e.stopPropagation(); setActiveDrill(activeDrill === i ? null : i); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setActiveDrill(activeDrill === i ? null : i); } }}
                  title="Shadow this phrase"
                  data-testid="shadow-drill-mic"
                  style={{ fontSize: 10, cursor: 'pointer', marginLeft: 2 }}
                >
                  🎤
                </span>
              )}
              {isKey && onSavePhrase && (
                <span
                  onClick={(e) => { if (!savedPhrases?.has(part.toLowerCase()) && !savingPhrases.has(part.toLowerCase())) handleSave(part, e); else e.stopPropagation(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(part, e); }}
                  title={savedPhrases?.has(part.toLowerCase()) ? 'Saved to vocabulary bank' : 'Save to vocabulary bank'}
                  data-testid="save-phrase-btn"
                  style={{ fontSize: 10, cursor: savedPhrases?.has(part.toLowerCase()) ? 'default' : 'pointer', marginLeft: 2 }}
                >
                  {savedPhrases?.has(part.toLowerCase()) ? '✅' : savingPhrases.has(part.toLowerCase()) ? '⏳' : '📌'}
                </span>
              )}
              <span style={{ fontSize: 10 }}> 📖</span>
            </span>
            {activeTooltip === i && grammarNote && (
              <span style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                background: 'var(--card-bg, #1f2937)', color: 'var(--text-primary, #f9fafb)',
                border: '1px solid var(--border-color, #374151)', borderRadius: 8, padding: '8px 12px',
                fontSize: 12, zIndex: 50, whiteSpace: 'nowrap', maxWidth: 260,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', marginBottom: 4,
              }}>
                <div style={{ fontWeight: 600, color: '#22c55e', marginBottom: 2 }}>{grammarNote.grammar_point}</div>
                <div style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>{grammarNote.explanation}</div>
              </span>
            )}
            {isKey && activeDrill === i && (
              <InlineShadowDrill
                phrase={part}
                onSpeak={onSpeak}
                onClose={() => setActiveDrill(null)}
              />
            )}
          </span>
        );
      })}
    </>
  );
}

export { normalizeText as _normalizeText, wordDiff as _wordDiff, computeAccuracy as _computeAccuracy };
