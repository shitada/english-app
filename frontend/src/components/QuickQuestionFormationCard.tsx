import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { HelpCircle, Mic, Volume2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { wordSimilarity, classifySimilarity } from '../utils/similarity';

// ─────────────────────────────────────────────────────────────────────────────
// Prompt bank: ~30 statement → Wh-question pairs covering varied
// tenses/auxiliaries (do/does/did/have/has/will/can/are/is/was…).
// ─────────────────────────────────────────────────────────────────────────────

export type QFDifficulty = 'beginner' | 'intermediate' | 'advanced';

export type WhWord =
  | 'What'
  | 'Where'
  | 'When'
  | 'Why'
  | 'Who'
  | 'How'
  | 'How long'
  | 'How often'
  | 'How many'
  | 'How much'
  | 'Which';

export interface QuestionFormationPrompt {
  id: string;
  statement: string;
  targetWh: WhWord;
  modelQuestion: string;
  difficulty: QFDifficulty;
}

export const QUESTION_FORMATION_PROMPTS: QuestionFormationPrompt[] = [
  // Beginner — present simple (do/does), be (is/are), basic past (was/were)
  { id: 'b1', statement: 'She works at a bank.', targetWh: 'Where', modelQuestion: 'Where does she work?', difficulty: 'beginner' },
  { id: 'b2', statement: 'They live in Osaka.', targetWh: 'Where', modelQuestion: 'Where do they live?', difficulty: 'beginner' },
  { id: 'b3', statement: 'He likes pizza.', targetWh: 'What', modelQuestion: 'What does he like?', difficulty: 'beginner' },
  { id: 'b4', statement: 'I drink coffee in the morning.', targetWh: 'When', modelQuestion: 'When do you drink coffee?', difficulty: 'beginner' },
  { id: 'b5', statement: 'My sister is a teacher.', targetWh: 'What', modelQuestion: 'What is your sister?', difficulty: 'beginner' },
  { id: 'b6', statement: 'The keys are on the table.', targetWh: 'Where', modelQuestion: 'Where are the keys?', difficulty: 'beginner' },
  { id: 'b7', statement: 'They are happy because they won.', targetWh: 'Why', modelQuestion: 'Why are they happy?', difficulty: 'beginner' },
  { id: 'b8', statement: 'She is reading a novel.', targetWh: 'What', modelQuestion: 'What is she reading?', difficulty: 'beginner' },
  { id: 'b9', statement: 'He goes to the gym three times a week.', targetWh: 'How often', modelQuestion: 'How often does he go to the gym?', difficulty: 'beginner' },
  { id: 'b10', statement: 'I have two brothers.', targetWh: 'How many', modelQuestion: 'How many brothers do you have?', difficulty: 'beginner' },

  // Intermediate — past simple (did), modals (can/will/should), present continuous
  { id: 'i1', statement: 'She visited Kyoto last summer.', targetWh: 'When', modelQuestion: 'When did she visit Kyoto?', difficulty: 'intermediate' },
  { id: 'i2', statement: 'They bought a new car yesterday.', targetWh: 'What', modelQuestion: 'What did they buy yesterday?', difficulty: 'intermediate' },
  { id: 'i3', statement: 'He moved to Berlin in 2020.', targetWh: 'Where', modelQuestion: 'Where did he move in 2020?', difficulty: 'intermediate' },
  { id: 'i4', statement: 'I will start the project on Monday.', targetWh: 'When', modelQuestion: 'When will you start the project?', difficulty: 'intermediate' },
  { id: 'i5', statement: 'She can speak three languages.', targetWh: 'How many', modelQuestion: 'How many languages can she speak?', difficulty: 'intermediate' },
  { id: 'i6', statement: 'We should leave at six.', targetWh: 'When', modelQuestion: 'When should we leave?', difficulty: 'intermediate' },
  { id: 'i7', statement: 'They are meeting the client tomorrow.', targetWh: 'Who', modelQuestion: 'Who are they meeting tomorrow?', difficulty: 'intermediate' },
  { id: 'i8', statement: 'The flight takes about twelve hours.', targetWh: 'How long', modelQuestion: 'How long does the flight take?', difficulty: 'intermediate' },
  { id: 'i9', statement: 'This jacket costs fifty dollars.', targetWh: 'How much', modelQuestion: 'How much does this jacket cost?', difficulty: 'intermediate' },
  { id: 'i10', statement: 'I prefer the blue one.', targetWh: 'Which', modelQuestion: 'Which one do you prefer?', difficulty: 'intermediate' },

  // Advanced — present perfect, past perfect, passives, embedded modals
  { id: 'a1', statement: 'She has lived in Paris for ten years.', targetWh: 'How long', modelQuestion: 'How long has she lived in Paris?', difficulty: 'advanced' },
  { id: 'a2', statement: 'They have already finished the report.', targetWh: 'What', modelQuestion: 'What have they already finished?', difficulty: 'advanced' },
  { id: 'a3', statement: 'He has been studying since morning.', targetWh: 'How long', modelQuestion: 'How long has he been studying?', difficulty: 'advanced' },
  { id: 'a4', statement: 'The package was delivered by a courier.', targetWh: 'Who', modelQuestion: 'Who was the package delivered by?', difficulty: 'advanced' },
  { id: 'a5', statement: 'The meeting had ended before I arrived.', targetWh: 'When', modelQuestion: 'When had the meeting ended?', difficulty: 'advanced' },
  { id: 'a6', statement: 'She would have called you sooner.', targetWh: 'Who', modelQuestion: 'Who would she have called sooner?', difficulty: 'advanced' },
  { id: 'a7', statement: 'They might be waiting at the lobby.', targetWh: 'Where', modelQuestion: 'Where might they be waiting?', difficulty: 'advanced' },
  { id: 'a8', statement: 'The proposal will be reviewed next week.', targetWh: 'When', modelQuestion: 'When will the proposal be reviewed?', difficulty: 'advanced' },
  { id: 'a9', statement: 'He must have forgotten the password.', targetWh: 'What', modelQuestion: 'What must he have forgotten?', difficulty: 'advanced' },
  { id: 'a10', statement: 'The book was written by a Japanese author.', targetWh: 'Who', modelQuestion: 'Who was the book written by?', difficulty: 'advanced' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

export function filterPromptsByDifficulty(
  prompts: QuestionFormationPrompt[],
  difficulty: QFDifficulty,
): QuestionFormationPrompt[] {
  return prompts.filter(p => p.difficulty === difficulty);
}

export function pickRandomPrompt(
  pool: QuestionFormationPrompt[],
  excludeId: string | null = null,
  rng: () => number = Math.random,
): QuestionFormationPrompt | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const filtered = excludeId ? pool.filter(p => p.id !== excludeId) : pool;
  const arr = filtered.length > 0 ? filtered : pool;
  return arr[Math.floor(rng() * arr.length)];
}

export const BEST_STREAK_KEY = 'quick-question-formation-best-streak';

export function loadBestStreak(): number {
  try {
    const v = localStorage.getItem(BEST_STREAK_KEY);
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveBestStreak(n: number): void {
  try { localStorage.setItem(BEST_STREAK_KEY, String(n)); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type Phase = 'prompt' | 'evaluating' | 'feedback';

const ACCENT = '#0ea5e9'; // sky-500

export default function QuickQuestionFormationCard() {
  const speech = useSpeechRecognition();
  const tts = useSpeechSynthesis();

  const [difficulty, setDifficulty] = useState<QFDifficulty>(() => {
    try {
      const saved = localStorage.getItem('quick-practice-difficulty') as QFDifficulty;
      if (saved === 'beginner' || saved === 'intermediate' || saved === 'advanced') return saved;
    } catch { /* ignore */ }
    return 'intermediate';
  });

  const [current, setCurrent] = useState<QuestionFormationPrompt | null>(() => {
    let initialDiff: QFDifficulty = 'intermediate';
    try {
      const saved = localStorage.getItem('quick-practice-difficulty') as QFDifficulty;
      if (saved === 'beginner' || saved === 'intermediate' || saved === 'advanced') initialDiff = saved;
    } catch { /* ignore */ }
    const initialPool = filterPromptsByDifficulty(QUESTION_FORMATION_PROMPTS, initialDiff);
    return pickRandomPrompt(initialPool, null);
  });
  const [phase, setPhase] = useState<Phase>('prompt');
  const [showAnswer, setShowAnswer] = useState(false);
  const [lastPercent, setLastPercent] = useState<number>(0);
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const [attempted, setAttempted] = useState(0);
  const [great, setGreat] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState<number>(() => loadBestStreak());
  const wasListeningRef = useRef(false);

  const pool = useMemo(() => filterPromptsByDifficulty(QUESTION_FORMATION_PROMPTS, difficulty), [difficulty]);

  const advance = useCallback(() => {
    setCurrent(prev => pickRandomPrompt(pool, prev?.id ?? null));
    setShowAnswer(false);
    setLastPercent(0);
    setLastTranscript('');
    setPhase('prompt');
  }, [pool]);

  // Initial load + when pool (difficulty) changes
  useEffect(() => {
    setCurrent(pickRandomPrompt(pool, null));
    setShowAnswer(false);
    setLastPercent(0);
    setLastTranscript('');
    setPhase('prompt');
  }, [pool]);

  // React to global difficulty changes from the hub
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        const v = e.newValue;
        if (v === 'beginner' || v === 'intermediate' || v === 'advanced') {
          setDifficulty(v);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const evaluate = useCallback((transcript: string) => {
    if (!current) return;
    setPhase('evaluating');
    const sim = wordSimilarity(current.modelQuestion, transcript);
    const verdict = classifySimilarity(sim);
    setLastPercent(verdict.percent);
    setLastTranscript(transcript);
    setAttempted(a => a + 1);
    if (verdict.tier === 'green') {
      setGreat(g => g + 1);
      setStreak(s => {
        const next = s + 1;
        if (next > bestStreak) {
          setBestStreak(next);
          saveBestStreak(next);
        }
        return next;
      });
    } else {
      setStreak(0);
    }
    setShowAnswer(true);
    setPhase('feedback');
  }, [current, bestStreak]);

  // Auto-evaluate when speech recognition stops while in prompt phase
  useEffect(() => {
    if (wasListeningRef.current && !speech.isListening && phase === 'prompt') {
      const t = speech.transcript || speech.interimTranscript || '';
      if (t.trim()) evaluate(t);
    }
    wasListeningRef.current = speech.isListening;
  }, [speech.isListening, speech.transcript, speech.interimTranscript, phase, evaluate]);

  const handleMic = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
    } else {
      speech.reset();
      setLastTranscript('');
      setLastPercent(0);
      setPhase('prompt');
      speech.start();
    }
  }, [speech]);

  const handleSpeakAnswer = useCallback(() => {
    if (current) tts.speak(current.modelQuestion);
  }, [current, tts]);

  const handleNext = useCallback(() => {
    speech.reset();
    advance();
  }, [advance, speech]);

  const handleDifficultyChange = useCallback((d: QFDifficulty) => {
    setDifficulty(d);
  }, []);

  if (!speech.isSupported || !tts.isSupported) return null;

  const tierColor = (pct: number) =>
    pct >= 90 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
  const verdictBadge = (pct: number) => {
    if (pct >= 90) return { bg: '#dcfce7', color: '#166534', label: 'Great!' };
    if (pct >= 60) return { bg: '#fef3c7', color: '#854d0e', label: 'Good — close' };
    return { bg: '#fee2e2', color: '#991b1b', label: 'Try again' };
  };

  return (
    <div
      data-testid="quick-question-formation-card"
      className="card"
      style={{
        background: 'var(--card-bg, white)',
        borderRadius: 16,
        padding: 20,
        border: '1px solid var(--border)',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <HelpCircle size={20} color={ACCENT} />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Question Formation</h3>
        <span
          data-testid="qqf-stats"
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
          }}
        >
          {great}/{attempted} • streak {streak} • best {bestStreak}
        </span>
      </div>

      {/* Local difficulty selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['beginner', 'intermediate', 'advanced'] as QFDifficulty[]).map(d => (
          <button
            key={d}
            data-testid={`qqf-difficulty-${d}`}
            aria-pressed={difficulty === d}
            onClick={() => handleDifficultyChange(d)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: '0.75rem',
              cursor: 'pointer',
              border: '1px solid',
              borderColor: difficulty === d ? ACCENT : 'var(--border)',
              background: difficulty === d ? ACCENT : 'transparent',
              color: difficulty === d ? '#fff' : 'var(--text-secondary)',
              fontWeight: difficulty === d ? 600 : 400,
            }}
          >
            {d === 'beginner' ? '🌱' : d === 'intermediate' ? '📗' : '🚀'}{' '}
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>

      {current ? (
        <div>
          {/* Statement + Wh badge */}
          <div
            data-testid="qqf-statement"
            style={{
              padding: 14,
              borderRadius: 10,
              background: 'var(--bg-secondary, #f9fafb)',
              marginBottom: 10,
              fontSize: '1.05rem',
              fontWeight: 600,
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              data-testid="qqf-wh-badge"
              style={{
                padding: '2px 10px',
                borderRadius: 999,
                background: ACCENT,
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {current.targetWh}?
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{current.statement}</span>
          </div>

          {/* Reveal answer */}
          {!showAnswer ? (
            <button
              data-testid="qqf-reveal"
              onClick={() => setShowAnswer(true)}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                background: 'transparent',
                border: '1px dashed var(--border)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                marginBottom: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Eye size={12} /> Reveal answer
            </button>
          ) : (
            <div
              data-testid="qqf-model-answer"
              style={{
                padding: 10,
                marginBottom: 10,
                borderRadius: 8,
                background: 'var(--bg, white)',
                border: '1px solid var(--border)',
                fontSize: '0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{current.modelQuestion}</span>
              <button
                data-testid="qqf-tts"
                onClick={handleSpeakAnswer}
                aria-label="Speak model question"
                style={{
                  padding: 6,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '0.75rem',
                }}
              >
                <Volume2 size={14} /> 🔊
              </button>
              {phase === 'prompt' && (
                <button
                  data-testid="qqf-hide"
                  onClick={() => setShowAnswer(false)}
                  aria-label="Hide answer"
                  style={{
                    padding: 6,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontSize: '0.75rem',
                  }}
                >
                  <EyeOff size={14} />
                </button>
              )}
            </div>
          )}

          {/* Feedback */}
          {phase === 'feedback' && (
            <div
              data-testid="qqf-feedback"
              style={{
                padding: 10,
                marginBottom: 10,
                borderRadius: 8,
                background: 'var(--bg-secondary, #f9fafb)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              {(() => {
                const b = verdictBadge(lastPercent);
                return (
                  <span
                    data-testid="qqf-verdict-badge"
                    data-verdict={lastPercent >= 90 ? 'great' : lastPercent >= 60 ? 'good' : 'try-again'}
                    style={{
                      padding: '2px 10px',
                      borderRadius: 999,
                      background: b.bg,
                      color: b.color,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    {b.label}
                  </span>
                );
              })()}
              <span
                style={{
                  fontSize: '0.85rem',
                  color: tierColor(lastPercent),
                  fontWeight: 700,
                }}
              >
                {lastPercent}%
              </span>
              {lastTranscript && (
                <span
                  data-testid="qqf-transcript"
                  style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}
                >
                  “{lastTranscript}”
                </span>
              )}
            </div>
          )}

          {/* Live transcript */}
          {speech.isListening && (
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.85rem',
                fontStyle: 'italic',
                margin: '0 0 10px',
              }}
            >
              🎙️ Listening… {speech.interimTranscript || speech.transcript || ''}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              data-testid="qqf-mic"
              onClick={handleMic}
              disabled={phase === 'evaluating'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                cursor: 'pointer',
                border: 'none',
                background: speech.isListening ? '#ef4444' : ACCENT,
                color: 'white',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              <Mic size={16} /> {speech.isListening ? 'Stop' : '🎤 Speak'}
            </button>

            <button
              data-testid="qqf-next"
              onClick={handleNext}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '0.85rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <RefreshCw size={14} /> Next
            </button>
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading prompts…</p>
      )}
    </div>
  );
}
