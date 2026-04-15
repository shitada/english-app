import { useState, useEffect, useRef, useCallback } from 'react';
import { getSpeakingJournalPrompt, saveSpeakingJournalEntry, getSpeakingJournalEntries, getSpeakingJournalVocabUpgrade, getSpeakingJournalGrammarCheck, type SpeakingJournalEntry, type VocabUpgradeItem, type GrammarCorrection, type GrammarCheckResult } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useI18n } from '../i18n/I18nContext';

type Phase = 'idle' | 'speaking' | 'saving' | 'done';

export default function SpeakingJournal() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const { transcript, isListening, isSupported, start, stop, reset } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
  });

  useEffect(() => {
    Promise.all([
      getSpeakingJournalPrompt().then((r) => setPrompt(r.prompt)),
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
    setPhase('speaking');
    setTimeLeft(60);
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
  }, [start, reset]);

  const handleStop = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stop();
    setPhase('saving');
    const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    try {
      const entry = await saveSpeakingJournalEntry(prompt, transcript, duration);
      setSavedEntry(entry);
      setHistory((prev) => [entry, ...prev].slice(0, 5));
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [stop, prompt, transcript]);

    const handleReset = useCallback(() => {
    reset();
    setSavedEntry(null);
    setPhase('idle');
    setTimeLeft(60);
    setVocabUpgrades([]);
    setVocabLoading(false);
    setVocabExpanded(false);
    setGrammarResult(null);
    setGrammarLoading(false);
    setGrammarExpanded(false);
    getSpeakingJournalPrompt().then((r) => setPrompt(r.prompt)).catch(() => {});
  }, [reset]);

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

        {/* Phase: idle */}
        {phase === 'idle' && (
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
            🎙️ {t('startSpeaking')} (60s)
          </button>
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
                width: `${((60 - timeLeft) / 60) * 100}%`,
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

            <button
              onClick={handleReset}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--bg-secondary, #f3f4f6)',
                color: 'var(--text-primary, #1f2937)',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
              }}
            >
              {t('tryAnother')}
            </button>
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
