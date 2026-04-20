import { useState, useCallback, useEffect } from 'react';
import { Music, Volume2, Mic, Square, RefreshCw, Check, X } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { getContrastiveStress, type ContrastiveStressItem } from '../api';

type Phase =
  | 'idle'
  | 'listen-played'
  | 'mcq-answered'
  | 'speak-ready'
  | 'recording'
  | 'speak-done';

// Build a sentence rendering with one word visually emphasized (capitalized).
export function buildEmphasizedText(words: string[], stressIndex: number): string {
  return words
    .map((w, i) => (i === stressIndex ? w.replace(/[A-Za-z']+/, m => m.toUpperCase()) : w))
    .join(' ');
}

// Heuristic: did the user "stress" the target word in their transcript?
// We accept it as correct if the transcript contains the target word
// (case-insensitive, ignoring trailing punctuation).
export function transcriptHitsTarget(transcript: string, targetWord: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z']/g, '');
  const target = norm(targetWord);
  if (!target) return false;
  return transcript
    .split(/\s+/)
    .some(tok => norm(tok) === target);
}

export default function QuickContrastiveStressCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [data, setData] = useState<ContrastiveStressItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pickedOption, setPickedOption] = useState<number | null>(null);
  const [speakTargetIndex, setSpeakTargetIndex] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);

  const fetchItem = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getContrastiveStress(difficulty);
      setData(res);
      setPhase('idle');
      setPickedOption(null);
      setSpeakTargetIndex(null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchItem();
    }
  }, [initialized, fetchItem]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        fetchItem();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchItem]);

  const playStressed = useCallback(
    (stressIndex: number) => {
      if (!data) return;
      const text = buildEmphasizedText(data.words, stressIndex);
      tts.speak(text);
    },
    [data, tts],
  );

  const handleListen = useCallback(() => {
    if (!data) return;
    setPhase('listen-played');
    playStressed(data.options[data.correct_index].word_index);
  }, [data, playStressed]);

  const handlePickOption = useCallback(
    (optionIdx: number) => {
      if (!data) return;
      setPickedOption(optionIdx);
      setPhase('mcq-answered');
    },
    [data],
  );

  const handleProceedToSpeak = useCallback(() => {
    if (!data) return;
    // Pick a (possibly different) target word for the speak phase.
    // For variety, pick a random option different from the listen phase if possible.
    const otherIdxs = data.options
      .map((_, i) => i)
      .filter(i => i !== data.correct_index);
    const targetOptIdx = otherIdxs.length > 0
      ? otherIdxs[Math.floor(Math.random() * otherIdxs.length)]
      : data.correct_index;
    setSpeakTargetIndex(targetOptIdx);
    setPhase('speak-ready');
    speech.reset();
  }, [data, speech]);

  const handleStartRecording = useCallback(() => {
    speech.reset();
    speech.start();
    setPhase('recording');
  }, [speech]);

  const handleStopRecording = useCallback(() => {
    speech.stop();
    setPhase('speak-done');
  }, [speech]);

  const handleNew = useCallback(() => {
    speech.stop();
    speech.reset();
    tts.stop();
    fetchItem();
  }, [fetchItem, speech, tts]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const renderSentence = (highlightIdx: number | null, color: string = '#3b82f6') => {
    if (!data) return null;
    return (
      <span>
        {data.words.map((w, i) => {
          const isHL = i === highlightIdx;
          return (
            <span
              key={i}
              style={{
                fontWeight: isHL ? 700 : 400,
                color: isHL ? color : 'inherit',
                textDecoration: isHL ? 'underline' : 'none',
                textUnderlineOffset: '3px',
              }}
            >
              {w}
              {i < data.words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="card" data-testid="quick-contrastive-stress" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Music size={20} color="#a855f7" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Contrastive Stress</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</p>
      ) : !data ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No item available.</p>
      ) : (
        <div>
          {/* Sentence display */}
          <div
            data-testid="qcs-sentence"
            style={{
              padding: '0.75rem',
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              marginBottom: '0.75rem',
              fontSize: '1.05rem',
              lineHeight: 1.6,
            }}
          >
            {phase === 'mcq-answered' && pickedOption !== null
              ? renderSentence(data.options[data.correct_index].word_index, '#22c55e')
              : phase === 'speak-ready' || phase === 'recording' || phase === 'speak-done'
                ? renderSentence(
                    speakTargetIndex !== null ? data.options[speakTargetIndex].word_index : null,
                    '#a855f7',
                  )
                : renderSentence(null)}
          </div>

          {/* Phase: idle / listen-played → MCQ */}
          {(phase === 'idle' || phase === 'listen-played' || phase === 'mcq-answered') && (
            <>
              <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleListen}
                  className="btn btn-secondary"
                  data-testid="qcs-listen"
                  disabled={tts.isSpeaking}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <Volume2 size={14} /> {phase === 'listen-played' ? 'Replay' : 'Listen'}
                </button>
              </div>

              {phase !== 'idle' && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
                  Which implied meaning matches the stress you heard?
                </p>
              )}

              <div
                role="radiogroup"
                aria-label="Implied meaning options"
                style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '0.75rem' }}
              >
                {data.options.map((opt, i) => {
                  const isPicked = pickedOption === i;
                  const isCorrect = i === data.correct_index;
                  let bg = 'transparent';
                  let borderColor = 'var(--border, #d1d5db)';
                  if (phase === 'mcq-answered') {
                    if (isCorrect) {
                      bg = 'rgba(34, 197, 94, 0.10)';
                      borderColor = '#22c55e';
                    } else if (isPicked) {
                      bg = 'rgba(239, 68, 68, 0.08)';
                      borderColor = '#ef4444';
                    }
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      data-testid={`qcs-option-${i}`}
                      onClick={() => phase !== 'mcq-answered' && phase !== 'idle' && handlePickOption(i)}
                      disabled={phase === 'idle' || phase === 'mcq-answered'}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: '1px solid',
                        borderColor,
                        borderRadius: 8,
                        background: bg,
                        cursor: phase === 'listen-played' ? 'pointer' : 'default',
                        fontSize: '0.9rem',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      {phase === 'mcq-answered' && isCorrect && <Check size={14} color="#22c55e" />}
                      {phase === 'mcq-answered' && isPicked && !isCorrect && <X size={14} color="#ef4444" />}
                      <span>{opt.meaning}</span>
                    </button>
                  );
                })}
              </div>

              {phase === 'mcq-answered' && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={handleProceedToSpeak}
                    className="btn btn-primary"
                    data-testid="qcs-speak-phase"
                  >
                    Speak Phase →
                  </button>
                  <button
                    type="button"
                    onClick={handleNew}
                    className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <RefreshCw size={14} /> New
                  </button>
                </div>
              )}
            </>
          )}

          {/* Phase: speak-ready / recording / speak-done */}
          {(phase === 'speak-ready' || phase === 'recording' || phase === 'speak-done') &&
            speakTargetIndex !== null && (
              <div data-testid="qcs-speak-section">
                <div
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: '#faf5ff',
                    border: '1px solid #e9d5ff',
                    borderRadius: 6,
                    marginBottom: '0.5rem',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#7c3aed', marginBottom: 2 }}>
                    Target meaning:
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#581c87' }}>
                    “{data.options[speakTargetIndex].meaning}”
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#7c3aed', marginTop: 4 }}>
                    Stress the highlighted word when you record.
                  </div>
                </div>

                {phase === 'recording' && (speech.transcript || speech.interimTranscript) && (
                  <p
                    data-testid="qcs-transcript"
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.85rem',
                      fontStyle: 'italic',
                      margin: '0 0 0.5rem',
                    }}
                  >
                    {speech.transcript}
                    {speech.interimTranscript && (
                      <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>
                    )}
                  </p>
                )}

                {phase === 'speak-done' && (
                  <div
                    data-testid="qcs-feedback"
                    style={{
                      padding: '0.5rem 0.75rem',
                      background: 'var(--bg-secondary)',
                      borderRadius: 6,
                      marginBottom: '0.5rem',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ marginBottom: 4 }}>
                      <strong>You said:</strong>{' '}
                      <span style={{ fontStyle: 'italic' }}>{speech.transcript || '(nothing captured)'}</span>
                    </div>
                    {speech.transcript && transcriptHitsTarget(
                      speech.transcript,
                      data.words[data.options[speakTargetIndex].word_index],
                    ) ? (
                      <div style={{ color: '#22c55e' }}>
                        <Check size={12} style={{ verticalAlign: 'middle' }} /> Target word recognized.
                      </div>
                    ) : (
                      <div style={{ color: '#f59e0b' }}>
                        Tip: try again and emphasize the highlighted word.
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {phase === 'recording' ? (
                    <button
                      type="button"
                      onClick={handleStopRecording}
                      className="btn btn-primary"
                      data-testid="qcs-stop"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      <Square size={14} /> Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartRecording}
                      className="btn btn-primary"
                      data-testid="qcs-record"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      <Mic size={14} /> {phase === 'speak-done' ? 'Re-record' : 'Record'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => playStressed(data.options[speakTargetIndex].word_index)}
                    className="btn btn-secondary"
                    data-testid="qcs-compare"
                    disabled={tts.isSpeaking}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <Volume2 size={14} /> Compare
                  </button>
                  <button
                    type="button"
                    onClick={handleNew}
                    className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <RefreshCw size={14} /> New
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
