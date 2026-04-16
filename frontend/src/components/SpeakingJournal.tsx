import { useState, useEffect, useRef, useCallback } from 'react';
import { getSpeakingJournalPrompt, saveSpeakingJournalEntry, getSpeakingJournalEntries, getSpeakingJournalVocabUpgrade, getSpeakingJournalGrammarCheck, getSpeakingJournalModelAnswer, api, type SpeakingJournalEntry, type VocabUpgradeItem, type GrammarCorrection, type GrammarCheckResult, type ModelAnswerResult, type PronunciationFeedback } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useI18n } from '../i18n/I18nContext';

type Phase = 'idle' | 'speaking' | 'saving' | 'done';

import { highlightFillers } from '../utils/fillerWords';

export default function SpeakingJournal() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>(() => {
    return (localStorage.getItem('sj_difficulty') as 'beginner' | 'intermediate' | 'advanced') || 'intermediate';
  });
  const [duration, setDuration] = useState<number>(() => {
    const saved = localStorage.getItem('sj_duration');
    return saved ? parseInt(saved, 10) : 60;
  });
  const [timeLeft, setTimeLeft] = useState(60);
  const [savedEntry, setSavedEntry] = useState<SpeakingJournalEntry | null>(null);
  const [history, setHistory] = useState<SpeakingJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEntryId, setExpandedEntryId] = useState<number | null>(null);
  const [vocabUpgrades, setVocabUpgrades] = useState<VocabUpgradeItem[]>([]);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [vocabExpanded, setVocabExpanded] = useState(false);
  const [grammarResult, setGrammarResult] = useState<GrammarCheckResult | null>(null);
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [grammarExpanded, setGrammarExpanded] = useState(false);
  const [modelAnswer, setModelAnswer] = useState<ModelAnswerResult | null>(null);
  const [modelAnswerLoading, setModelAnswerLoading] = useState(false);
  const [modelAnswerExpanded, setModelAnswerExpanded] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [previousEntry, setPreviousEntry] = useState<SpeakingJournalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const { transcript, isListening, isSupported, start, stop, reset } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
  });

  useEffect(() => {
    Promise.all([
      getSpeakingJournalPrompt(difficulty).then((r) => setPrompt(r.prompt)),
      getSpeakingJournalEntries(5).then((r) => setHistory(r.entries)),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (phase === 'speaking' && timeLeft <= 0) {
      handleStop();
    }
  }, [timeLeft, phase]);

  const handleStart = useCallback(async () => {
    reset();
    setError(null);
    setPhase('speaking');
    setTimeLeft(duration);
    startTimeRef.current = Date.now();
    await start();
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [start, reset, duration]);

  const handleStop = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stop();
    setError(null);
    const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    if (!transcript.trim()) {
      setPhase('idle');
      setError('No speech detected. Please try again and speak clearly into your microphone.');
      return;
    }
    setPhase('saving');
    try {
      const entry = await saveSpeakingJournalEntry(prompt, transcript, duration);
      setSavedEntry(entry);
      setHistory((prev) => [entry, ...prev].slice(0, 5));
      setPhase('done');
    } catch {
      setPhase('idle');
      setError('Failed to save your entry. Please try again.');
    }
  }, [stop, prompt, transcript]);

    const handleReset = useCallback(() => {
    reset();
    setSavedEntry(null);
    setPreviousEntry(null);
    setError(null);
    setPhase('idle');
    setTimeLeft(duration);
    setVocabUpgrades([]);
    setVocabLoading(false);
    setVocabExpanded(false);
    setGrammarResult(null);
    setGrammarLoading(false);
    setGrammarExpanded(false);
    setModelAnswer(null);
    setModelAnswerLoading(false);
    setModelAnswerExpanded(false);
    setTranscriptExpanded(false);
    getSpeakingJournalPrompt(difficulty).then((r) => setPrompt(r.prompt)).catch(() => {});
  }, [reset, duration, difficulty]);

  const handleRetry = useCallback(() => {
    setPreviousEntry(savedEntry);
    reset();
    setSavedEntry(null);
    setPhase('idle');
    setTimeLeft(duration);
    setVocabUpgrades([]);
    setVocabLoading(false);
    setVocabExpanded(false);
    setGrammarResult(null);
    setGrammarLoading(false);
    setGrammarExpanded(false);
    setModelAnswer(null);
    setModelAnswerLoading(false);
    setModelAnswerExpanded(false);
    setTranscriptExpanded(false);
  }, [reset, savedEntry, duration]);

  if (loading || !prompt) return null;

  const maxWpm = Math.max(1, ...history.map((e) => e.wpm));

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.2rem' }}>📖</span>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('speakingJournal')}</h3>
        </div>

        {/* Prompt */}
        <div style={{
          background: 'var(--bg-secondary, #f3f4f6)',
          borderRadius: 8,
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem',
          fontStyle: 'italic',
          fontSize: '0.9rem',
          color: 'var(--text-primary, #1f2937)',
        }}>
          "{prompt}"
        </div>

        {/* Error message */}
        {error && (
          <div
            data-testid="speaking-journal-error"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '0.6rem 0.75rem',
              marginBottom: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              fontSize: '0.85rem',
              color: '#991b1b',
            }}
          >
            <span>⚠️ {error}</span>
            <button
              onClick={() => setError(null)}
              data-testid="dismiss-error"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1rem',
                color: '#991b1b',
                padding: '0 0.25rem',
                lineHeight: 1,
              }}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* Phase: idle */}
        {phase === 'idle' && (
          <div>
            {/* Difficulty & Duration selectors */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.25rem', flex: 1 }}>
                {(['beginner', 'intermediate', 'advanced'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setDifficulty(d);
                      localStorage.setItem('sj_difficulty', d);
                      getSpeakingJournalPrompt(d).then((r) => setPrompt(r.prompt)).catch(() => {});
                    }}
                    data-testid={`difficulty-${d}`}
                    style={{
                      flex: 1,
                      padding: '0.35rem 0.25rem',
                      border: '1px solid',
                      borderColor: difficulty === d ? 'var(--primary, #6366f1)' : 'var(--border, #d1d5db)',
                      background: difficulty === d ? 'var(--primary, #6366f1)' : 'transparent',
                      color: difficulty === d ? '#fff' : 'var(--text-secondary, #6b7280)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: difficulty === d ? 600 : 400,
                    }}
                  >
                    {d === 'beginner' ? '🌱' : d === 'intermediate' ? '📗' : '🚀'} {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {[30, 60, 90].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setDuration(s);
                      setTimeLeft(s);
                      localStorage.setItem('sj_duration', String(s));
                    }}
                    data-testid={`duration-${s}`}
                    style={{
                      padding: '0.35rem 0.5rem',
                      border: '1px solid',
                      borderColor: duration === s ? 'var(--primary, #6366f1)' : 'var(--border, #d1d5db)',
                      background: duration === s ? 'var(--primary, #6366f1)' : 'transparent',
                      color: duration === s ? '#fff' : 'var(--text-secondary, #6b7280)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: duration === s ? 600 : 400,
                    }}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleStart}
              disabled={!isSupported}
              style={{
                width: '100%',
                padding: '0.6rem',
                background: 'var(--primary, #6366f1)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: isSupported ? 'pointer' : 'not-allowed',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              🎙️ {t('startSpeaking')} ({duration}s)
            </button>
          </div>
        )}

        {/* Phase: speaking */}
        {phase === 'speaking' && (
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#ef4444',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #6b7280)' }}>
                  {isListening ? t('listeningLabel') : t('startingLabel')}
                </span>
              </div>
              <span style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: timeLeft <= 10 ? '#ef4444' : 'var(--text-primary, #1f2937)',
              }}>
                {timeLeft}s
              </span>
            </div>
            {/* Progress bar */}
            <div style={{
              height: 4,
              background: 'var(--bg-secondary, #e5e7eb)',
              borderRadius: 2,
              marginBottom: '0.5rem',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${((duration - timeLeft) / duration) * 100}%`,
                background: 'var(--primary, #6366f1)',
                borderRadius: 2,
                transition: 'width 1s linear',
              }} />
            </div>
            {transcript && (
              <p style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary, #6b7280)',
                margin: '0.5rem 0',
                maxHeight: 60,
                overflow: 'hidden',
              }}>
                {transcript.slice(-120)}
              </p>
            )}
            <button
              onClick={handleStop}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
              }}
            >
              ⏹️ {t('stopAndSave')}
            </button>
          </div>
        )}

        {/* Phase: saving */}
        {phase === 'saving' && (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary, #6b7280)', fontSize: '0.85rem' }}>
            {t('savingLabel')}
          </p>
        )}

        {/* Phase: done */}
        {phase === 'done' && savedEntry && (
          <div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '0.5rem',
              marginBottom: '0.75rem',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
                  {savedEntry.word_count}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>
                  {t('wordsLabel')}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
                  {savedEntry.wpm}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>WPM</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary, #6366f1)' }}>
                  {savedEntry.unique_word_count > 0
                    ? Math.round((savedEntry.unique_word_count / savedEntry.word_count) * 100)
                    : 0}%
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>
                  {t('uniqueWords')}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  color: (savedEntry.filler_word_count ?? 0) === 0
                    ? '#22c55e'
                    : (savedEntry.filler_word_count ?? 0) <= 2
                      ? '#eab308'
                      : '#ef4444',
                }}>
                  {savedEntry.filler_word_count ?? 0}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>
                  {t('fillersLabel')}
                </div>
              </div>
            </div>

            {/* Transcript Review Panel */}
            <div style={{ marginBottom: '0.75rem' }}>
              <button
                onClick={() => setTranscriptExpanded(!transcriptExpanded)}
                data-testid="transcript-review-toggle"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: transcriptExpanded ? 'var(--primary, #6366f1)' : 'var(--bg-secondary, #f3f4f6)',
                  color: transcriptExpanded ? '#fff' : 'var(--text-primary, #1f2937)',
                  border: '1px solid var(--border, #d1d5db)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                📝 Review My Response {transcriptExpanded ? '▲' : '▼'}
              </button>
              {transcriptExpanded && (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  background: 'var(--bg-secondary, #f9fafb)',
                  borderRadius: 8,
                  border: '1px solid var(--border, #e5e7eb)',
                }}>
                  <p style={{
                    margin: '0 0 0.5rem',
                    fontSize: '0.85rem',
                    lineHeight: 1.6,
                    color: 'var(--text-primary, #1f2937)',
                    whiteSpace: 'pre-wrap',
                  }}
                    dangerouslySetInnerHTML={{ __html: highlightFillers(savedEntry.transcript) }}
                  />
                  <button
                    onClick={() => {
                      if (window.speechSynthesis.speaking) {
                        window.speechSynthesis.cancel();
                        return;
                      }
                      const utter = new SpeechSynthesisUtterance(savedEntry.transcript);
                      utter.lang = 'en-US';
                      utter.rate = 0.9;
                      window.speechSynthesis.speak(utter);
                    }}
                    data-testid="tts-my-response"
                    style={{
                      padding: '0.35rem 0.75rem',
                      background: 'var(--primary, #6366f1)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}
                  >
                    🔊 Hear My Response
                  </button>
                </div>
              )}
            </div>

            {/* Retry Comparison Card */}
            {previousEntry && (
              <div style={{
                marginBottom: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: 'var(--surface-alt, #f0f9ff)',
                borderRadius: 8,
                border: '1px solid var(--border, #e5e7eb)',
              }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary, #6b7280)', marginBottom: '0.35rem' }}>
                  vs Previous Attempt
                </div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {(() => {
                    const metrics: { label: string; prev: number; curr: number; lowerBetter?: boolean }[] = [
                      { label: 'WPM', prev: previousEntry.wpm, curr: savedEntry.wpm },
                      { label: 'Words', prev: previousEntry.word_count, curr: savedEntry.word_count },
                      { label: 'Unique %', prev: previousEntry.unique_word_count > 0 ? Math.round((previousEntry.unique_word_count / previousEntry.word_count) * 100) : 0, curr: savedEntry.unique_word_count > 0 ? Math.round((savedEntry.unique_word_count / savedEntry.word_count) * 100) : 0 },
                      { label: 'Fillers', prev: previousEntry.filler_word_count ?? 0, curr: savedEntry.filler_word_count ?? 0, lowerBetter: true },
                    ];
                    return metrics.map((m) => {
                      const delta = m.curr - m.prev;
                      const improved = m.lowerBetter ? delta < 0 : delta > 0;
                      const same = delta === 0;
                      return (
                        <div key={m.label} style={{ fontSize: '0.75rem' }}>
                          <span style={{ color: 'var(--text-secondary, #6b7280)' }}>{m.label}: </span>
                          <span>{m.prev} → {m.curr} </span>
                          <span style={{ color: same ? 'var(--text-secondary, #6b7280)' : improved ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                            {same ? '—' : `${improved ? '↑' : '↓'}${Math.abs(delta)}`}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Vocab Upgrade Panel */}
            <div style={{ marginBottom: '0.5rem' }}>
              <button
                onClick={() => {
                  if (vocabUpgrades.length > 0) {
                    setVocabExpanded(!vocabExpanded);
                    return;
                  }
                  setVocabLoading(true);
                  setVocabExpanded(true);
                  getSpeakingJournalVocabUpgrade(savedEntry.transcript)
                    .then((r) => setVocabUpgrades(r.upgrades))
                    .catch(() => setVocabUpgrades([]))
                    .finally(() => setVocabLoading(false));
                }}
                disabled={vocabLoading}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: vocabExpanded ? 'var(--primary, #6366f1)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: vocabLoading ? 'wait' : 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  opacity: vocabLoading ? 0.7 : 1,
                }}
              >
                {vocabLoading ? '⏳ Analyzing...' : `💡 Level Up Your Words ${vocabExpanded ? '▲' : '▼'}`}
              </button>
              {vocabExpanded && vocabUpgrades.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  {vocabUpgrades.map((u, i) => (
                    <div key={i} style={{
                      padding: '0.5rem',
                      marginBottom: '0.35rem',
                      background: 'var(--bg-secondary, #f3f4f6)',
                      borderRadius: 8,
                      fontSize: '0.8rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
                        <span style={{ color: 'var(--text-secondary, #6b7280)', textDecoration: 'line-through' }}>{u.original}</span>
                        <span>→</span>
                        <span style={{ color: 'var(--primary, #6366f1)', fontWeight: 700 }}>{u.upgraded}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.75rem', marginBottom: '0.15rem' }}>
                        {u.explanation}
                      </div>
                      <div style={{ color: 'var(--text-primary, #1f2937)', fontStyle: 'italic', fontSize: '0.75rem' }}>
                        "{u.example}"
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {vocabExpanded && !vocabLoading && vocabUpgrades.length === 0 && (
                <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', textAlign: 'center' }}>
                  Great vocabulary! No upgrades suggested.
                </div>
              )}
            </div>

            {/* Grammar Check Panel */}
            <div style={{ marginBottom: '0.5rem' }}>
              <button
                onClick={() => {
                  if (grammarResult) {
                    setGrammarExpanded(!grammarExpanded);
                    return;
                  }
                  setGrammarLoading(true);
                  setGrammarExpanded(true);
                  getSpeakingJournalGrammarCheck(savedEntry.transcript)
                    .then((r) => setGrammarResult(r))
                    .catch(() => setGrammarResult(null))
                    .finally(() => setGrammarLoading(false));
                }}
                disabled={grammarLoading}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: grammarExpanded ? 'var(--primary, #6366f1)' : 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: grammarLoading ? 'wait' : 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  opacity: grammarLoading ? 0.7 : 1,
                }}
              >
                {grammarLoading ? '⏳ Checking...' : `📝 Check Grammar ${grammarExpanded ? '▲' : '▼'}`}
              </button>
              {grammarExpanded && grammarResult && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.4rem',
                    padding: '0.4rem 0.6rem',
                    background: 'var(--bg-secondary, #f3f4f6)',
                    borderRadius: 8,
                  }}>
                    <span style={{ fontWeight: 700, fontSize: '1.1rem', color: grammarResult.grammar_score >= 8 ? '#10b981' : grammarResult.grammar_score >= 5 ? '#f59e0b' : '#ef4444' }}>
                      {grammarResult.grammar_score.toFixed(1)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>/10 Grammar Score</span>
                  </div>
                  {grammarResult.corrections.length > 0 ? grammarResult.corrections.map((c: GrammarCorrection, i: number) => (
                    <div key={i} style={{
                      padding: '0.5rem',
                      marginBottom: '0.35rem',
                      background: 'var(--bg-secondary, #f3f4f6)',
                      borderRadius: 8,
                      fontSize: '0.8rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
                        <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{c.original}</span>
                        <span>→</span>
                        <span style={{ color: '#10b981', fontWeight: 700 }}>{c.corrected}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.75rem' }}>
                        {c.explanation}
                      </div>
                    </div>
                  )) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', textAlign: 'center', padding: '0.3rem' }}>
                      Perfect grammar! No corrections needed. 🎉
                    </div>
                  )}
                  {grammarResult.overall_feedback && (
                    <div style={{
                      marginTop: '0.3rem',
                      padding: '0.4rem 0.6rem',
                      background: 'var(--bg-secondary, #f3f4f6)',
                      borderRadius: 8,
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary, #6b7280)',
                      fontStyle: 'italic',
                    }}>
                      {grammarResult.overall_feedback}
                    </div>
                  )}
                </div>
              )}
              {grammarExpanded && !grammarLoading && !grammarResult && (
                <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', textAlign: 'center' }}>
                  Unable to check grammar right now.
                </div>
              )}
            </div>

            {/* Model Answer Panel */}
            <div style={{ marginBottom: '0.5rem' }}>
              <button
                onClick={() => {
                  if (modelAnswer) {
                    setModelAnswerExpanded(!modelAnswerExpanded);
                    return;
                  }
                  setModelAnswerLoading(true);
                  setModelAnswerExpanded(true);
                  getSpeakingJournalModelAnswer(prompt, savedEntry.transcript)
                    .then((r) => setModelAnswer(r))
                    .catch(() => setModelAnswer(null))
                    .finally(() => setModelAnswerLoading(false));
                }}
                disabled={modelAnswerLoading}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: modelAnswerExpanded ? 'var(--primary, #6366f1)' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: modelAnswerLoading ? 'wait' : 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  opacity: modelAnswerLoading ? 0.7 : 1,
                }}
              >
                {modelAnswerLoading ? '⏳ Generating...' : `🎯 See Model Answer ${modelAnswerExpanded ? '▲' : '▼'}`}
              </button>
              {modelAnswerExpanded && modelAnswer && modelAnswer.model_answer && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{
                    padding: '0.6rem',
                    background: 'var(--bg-secondary, #f3f4f6)',
                    borderRadius: 8,
                    fontSize: '0.85rem',
                    lineHeight: 1.5,
                    color: 'var(--text-primary, #1f2937)',
                    marginBottom: '0.4rem',
                  }}>
                    {modelAnswer.model_answer}
                  </div>
                  <button
                    onClick={() => {
                      const u = new SpeechSynthesisUtterance(modelAnswer.model_answer);
                      u.lang = 'en-US';
                      u.rate = 0.9;
                      window.speechSynthesis.cancel();
                      window.speechSynthesis.speak(u);
                    }}
                    style={{
                      padding: '0.35rem 0.7rem',
                      background: 'var(--primary, #6366f1)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      marginBottom: '0.4rem',
                    }}
                  >
                    🔊 Listen to Model Answer
                  </button>
                  {/* Echo Practice */}
                  <ModelAnswerEchoPractice modelAnswer={modelAnswer.model_answer} />
                  {modelAnswer.key_phrases.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.4rem' }}>
                      {modelAnswer.key_phrases.map((phrase, i) => (
                        <span key={i} style={{
                          padding: '0.2rem 0.5rem',
                          background: 'var(--primary, #6366f1)',
                          color: '#fff',
                          borderRadius: 12,
                          fontSize: '0.72rem',
                          fontWeight: 600,
                        }}>
                          {phrase}
                        </span>
                      ))}
                    </div>
                  )}
                  {modelAnswer.comparison_tip && (
                    <div style={{
                      padding: '0.4rem 0.6rem',
                      background: 'var(--bg-secondary, #f3f4f6)',
                      borderRadius: 8,
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary, #6b7280)',
                      fontStyle: 'italic',
                    }}>
                      💡 {modelAnswer.comparison_tip}
                    </div>
                  )}
                </div>
              )}
              {modelAnswerExpanded && !modelAnswerLoading && (!modelAnswer || !modelAnswer.model_answer) && (
                <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', textAlign: 'center' }}>
                  Unable to generate model answer right now.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleRetry}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: 8,
                  border: '1px solid var(--primary, #6366f1)',
                  background: 'transparent',
                  color: 'var(--primary, #6366f1)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                }}
              >
                🔄 Try Again
              </button>
              <button
                onClick={handleReset}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--primary, #6366f1)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                }}
              >
                ➡️ New Prompt
              </button>
            </div>
          </div>
        )}

        {/* WPM trend sparkline */}
        {history.length > 1 && (
          <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', marginBottom: '0.25rem' }}>
              WPM {t('trendLabel')}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 30 }}>
              {[...history].reverse().map((e, i) => (
                <div
                  key={e.id || i}
                  style={{
                    flex: 1,
                    background: 'var(--primary, #6366f1)',
                    borderRadius: 2,
                    height: `${Math.max(4, (e.wpm / maxWpm) * 30)}px`,
                    opacity: 0.6 + (i / history.length) * 0.4,
                  }}
                  title={`${e.wpm} WPM`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Expandable history */}
        {history.length > 0 && (
          <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', marginBottom: '0.5rem', fontWeight: 600 }}>
              {t('journalHistory')}
            </div>
            {[...history].slice(0, 10).map((entry) => {
              const isExpanded = expandedEntryId === entry.id;
              const fillerColor = (entry.filler_word_count ?? 0) === 0
                ? '#22c55e'
                : (entry.filler_word_count ?? 0) <= 2
                  ? '#eab308'
                  : '#ef4444';
              const relTime = entry.created_at
                ? new Date(entry.created_at + 'Z').toLocaleDateString()
                : '';
              return (
                <div key={entry.id} style={{ marginBottom: '0.25rem' }}>
                  <button
                    onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.35rem 0.5rem',
                      background: isExpanded ? 'var(--bg-tertiary, #e5e7eb)' : 'var(--bg-secondary, #f3f4f6)',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      color: 'var(--text-primary, #1f2937)',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{entry.wpm} WPM</span>
                    <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color: fillerColor, fontWeight: 600 }}>
                        {entry.filler_word_count ?? 0} {t('fillersLabel').toLowerCase()}
                      </span>
                      <span style={{ color: 'var(--text-secondary, #6b7280)' }}>{relTime}</span>
                      <span>{isExpanded ? '▲' : '▼'}</span>
                    </span>
                  </button>
                  {isExpanded && (
                    <div style={{
                      padding: '0.5rem',
                      background: 'var(--bg-secondary, #f3f4f6)',
                      borderRadius: '0 0 6px 6px',
                      fontSize: '0.75rem',
                      marginTop: -2,
                    }}>
                      <div style={{ color: 'var(--text-secondary, #6b7280)', fontStyle: 'italic', marginBottom: '0.35rem' }}>
                        {t('promptLabel')}: {entry.prompt}
                      </div>
                      <div style={{ marginBottom: '0.35rem', lineHeight: 1.4, color: 'var(--text-primary, #1f2937)' }}>
                        {entry.transcript}
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: 'var(--text-secondary, #6b7280)', fontSize: '0.7rem' }}>
                        <span>{entry.word_count} {t('wordsLabel')}</span>
                        <span>{entry.unique_word_count > 0 ? Math.round((entry.unique_word_count / entry.word_count) * 100) : 0}% {t('uniqueWords')}</span>
                        <span>{Math.floor(entry.duration_seconds / 60)}:{String(entry.duration_seconds % 60).padStart(2, '0')} {t('durationLabel')}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type EchoPhase = 'idle' | 'listening' | 'recording' | 'evaluating' | 'result';

function ModelAnswerEchoPractice({ modelAnswer }: { modelAnswer: string }) {
  const [echoPhase, setEchoPhase] = useState<EchoPhase>('idle');
  const [feedback, setFeedback] = useState<PronunciationFeedback | null>(null);
  const { transcript, isSupported, start, stop, reset } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
  });

  const handleEchoPractice = useCallback(() => {
    setFeedback(null);
    reset();
    setEchoPhase('listening');
    const u = new SpeechSynthesisUtterance(modelAnswer);
    u.lang = 'en-US';
    u.rate = 0.85;
    u.onend = () => {
      setEchoPhase('recording');
      start();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [modelAnswer, start, reset]);

  const handleStopEcho = useCallback(async () => {
    stop();
    if (!transcript.trim()) {
      setEchoPhase('idle');
      return;
    }
    setEchoPhase('evaluating');
    try {
      const result = await api.checkPronunciation(modelAnswer, transcript.trim());
      setFeedback(result);
      setEchoPhase('result');
    } catch {
      setEchoPhase('idle');
    }
  }, [stop, transcript, modelAnswer]);

  if (!isSupported) return null;

  return (
    <div style={{ marginTop: '0.4rem' }}>
      {echoPhase === 'idle' && (
        <button
          onClick={handleEchoPractice}
          style={{
            padding: '0.35rem 0.7rem',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.78rem',
          }}
        >
          🎙️ Practice Speaking This
        </button>
      )}

      {echoPhase === 'listening' && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.3rem 0' }}>
          🔊 Listening to model... Speak after it finishes.
        </div>
      )}

      {echoPhase === 'recording' && (
        <div>
          <div style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600, marginBottom: '0.3rem' }}>
            🔴 Recording... Repeat the model answer now!
          </div>
          {transcript && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '0.3rem' }}>
              {transcript}
            </div>
          )}
          <button
            onClick={handleStopEcho}
            style={{
              padding: '0.3rem 0.6rem',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.75rem',
            }}
          >
            ⏹ Stop &amp; Evaluate
          </button>
        </div>
      )}

      {echoPhase === 'evaluating' && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.3rem 0' }}>
          ⏳ Evaluating your pronunciation...
        </div>
      )}

      {echoPhase === 'result' && feedback && (
        <div style={{ marginTop: '0.3rem', padding: '0.5rem', background: 'var(--bg-secondary, #f3f4f6)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.4rem' }}>
            <span style={{
              fontSize: 20,
              fontWeight: 700,
              color: (feedback.overall_score ?? 0) >= 80 ? '#22c55e' : (feedback.overall_score ?? 0) >= 50 ? '#eab308' : '#ef4444',
            }}>
              {feedback.overall_score ?? '–'}%
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {feedback.overall_feedback}
            </span>
          </div>

          {feedback.word_feedback.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: '0.3rem' }}>
              {feedback.word_feedback.map((w, i) => (
                <span
                  key={i}
                  title={w.tip}
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: w.is_correct ? '#dcfce7' : '#fee2e2',
                    color: w.is_correct ? '#166534' : '#991b1b',
                    fontWeight: 500,
                  }}
                >
                  {w.expected}
                </span>
              ))}
            </div>
          )}

          {feedback.focus_areas.length > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Focus: {feedback.focus_areas.join(', ')}
            </div>
          )}

          <button
            onClick={() => { setEchoPhase('idle'); setFeedback(null); reset(); }}
            style={{
              marginTop: '0.3rem',
              padding: '0.25rem 0.5rem',
              background: 'var(--primary, #6366f1)',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.72rem',
            }}
          >
            🔄 Try Again
          </button>
        </div>
      )}
    </div>
  );
}
