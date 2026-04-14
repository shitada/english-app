import { useState, useEffect, useRef, useCallback } from 'react';
import { getSpeakingJournalPrompt, saveSpeakingJournalEntry, getSpeakingJournalEntries, type SpeakingJournalEntry } from '../api';
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
      </div>
    </div>
  );
}
