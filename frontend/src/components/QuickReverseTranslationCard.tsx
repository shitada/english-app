import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Languages, Mic, Volume2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  wordSimilarity,
  classifySimilarity,
  normalizeForCompare,
} from '../utils/similarity';

// ─────────────────────────────────────────────────────────────────────────────
// Prompt bank: ~40 curated JP→EN pairs
// ─────────────────────────────────────────────────────────────────────────────

export type PromptDifficulty = 'beginner' | 'intermediate';

export interface ReverseTranslationPrompt {
  id: string;
  jp: string;
  en: string;
  topic: string;
  difficulty: PromptDifficulty;
}

export const REVERSE_TRANSLATION_PROMPTS: ReverseTranslationPrompt[] = [
  // Beginner — daily life / greetings
  { id: 'b1', jp: '今日はとても暑いですね。', en: 'It is very hot today.', topic: 'weather', difficulty: 'beginner' },
  { id: 'b2', jp: '駅までどのくらいかかりますか。', en: 'How long does it take to the station?', topic: 'travel', difficulty: 'beginner' },
  { id: 'b3', jp: 'コーヒーを一杯ください。', en: 'I would like a cup of coffee.', topic: 'food', difficulty: 'beginner' },
  { id: 'b4', jp: 'はじめまして、よろしくお願いします。', en: 'Nice to meet you.', topic: 'greetings', difficulty: 'beginner' },
  { id: 'b5', jp: '英語を勉強するのが好きです。', en: 'I like studying English.', topic: 'study', difficulty: 'beginner' },
  { id: 'b6', jp: 'もう一度言ってください。', en: 'Could you say that again?', topic: 'communication', difficulty: 'beginner' },
  { id: 'b7', jp: 'トイレはどこですか。', en: 'Where is the bathroom?', topic: 'travel', difficulty: 'beginner' },
  { id: 'b8', jp: '名前は何ですか。', en: 'What is your name?', topic: 'greetings', difficulty: 'beginner' },
  { id: 'b9', jp: '私は東京に住んでいます。', en: 'I live in Tokyo.', topic: 'self', difficulty: 'beginner' },
  { id: 'b10', jp: 'いくらですか。', en: 'How much is it?', topic: 'shopping', difficulty: 'beginner' },
  { id: 'b11', jp: '今、何時ですか。', en: 'What time is it now?', topic: 'time', difficulty: 'beginner' },
  { id: 'b12', jp: '助けてください。', en: 'Please help me.', topic: 'emergency', difficulty: 'beginner' },
  { id: 'b13', jp: '駅はどこですか。', en: 'Where is the station?', topic: 'travel', difficulty: 'beginner' },
  { id: 'b14', jp: 'お腹がすきました。', en: 'I am hungry.', topic: 'food', difficulty: 'beginner' },
  { id: 'b15', jp: '明日また会いましょう。', en: 'See you again tomorrow.', topic: 'greetings', difficulty: 'beginner' },
  { id: 'b16', jp: '少し疲れました。', en: 'I am a little tired.', topic: 'self', difficulty: 'beginner' },
  { id: 'b17', jp: 'おすすめは何ですか。', en: 'What do you recommend?', topic: 'food', difficulty: 'beginner' },
  { id: 'b18', jp: '写真を撮ってもいいですか。', en: 'May I take a picture?', topic: 'travel', difficulty: 'beginner' },
  { id: 'b19', jp: '日本語が話せますか。', en: 'Can you speak Japanese?', topic: 'communication', difficulty: 'beginner' },
  { id: 'b20', jp: 'よく分かりません。', en: 'I do not understand well.', topic: 'communication', difficulty: 'beginner' },

  // Intermediate — opinions, work, hypotheticals
  { id: 'i1', jp: '会議は来週に延期されました。', en: 'The meeting has been postponed to next week.', topic: 'work', difficulty: 'intermediate' },
  { id: 'i2', jp: 'もし時間があれば手伝います。', en: 'I will help you if I have time.', topic: 'conditional', difficulty: 'intermediate' },
  { id: 'i3', jp: 'この問題について話し合いましょう。', en: 'Let us discuss this issue.', topic: 'work', difficulty: 'intermediate' },
  { id: 'i4', jp: 'できるだけ早く返事をください。', en: 'Please reply as soon as possible.', topic: 'work', difficulty: 'intermediate' },
  { id: 'i5', jp: '彼の意見に賛成できません。', en: 'I cannot agree with his opinion.', topic: 'opinion', difficulty: 'intermediate' },
  { id: 'i6', jp: '昨日見た映画は感動的でした。', en: 'The movie I saw yesterday was moving.', topic: 'entertainment', difficulty: 'intermediate' },
  { id: 'i7', jp: '健康のために毎朝走っています。', en: 'I run every morning for my health.', topic: 'health', difficulty: 'intermediate' },
  { id: 'i8', jp: '彼女が来るかどうか分かりません。', en: 'I am not sure whether she will come.', topic: 'uncertainty', difficulty: 'intermediate' },
  { id: 'i9', jp: '私の代わりに電話してくれますか。', en: 'Could you call them on my behalf?', topic: 'work', difficulty: 'intermediate' },
  { id: 'i10', jp: 'もっと早く知っていればよかった。', en: 'I wish I had known earlier.', topic: 'regret', difficulty: 'intermediate' },
  { id: 'i11', jp: '彼は仕事を辞めることに決めた。', en: 'He decided to quit his job.', topic: 'work', difficulty: 'intermediate' },
  { id: 'i12', jp: '電車の遅延で遅刻しました。', en: 'I was late because of a train delay.', topic: 'travel', difficulty: 'intermediate' },
  { id: 'i13', jp: 'この件について確認させてください。', en: 'Let me confirm this matter.', topic: 'work', difficulty: 'intermediate' },
  { id: 'i14', jp: '英語を上達させるために毎日練習します。', en: 'I practice every day to improve my English.', topic: 'study', difficulty: 'intermediate' },
  { id: 'i15', jp: 'あなたの提案はとても興味深いです。', en: 'Your suggestion is very interesting.', topic: 'opinion', difficulty: 'intermediate' },
  { id: 'i16', jp: '新しいプロジェクトを担当することになりました。', en: 'I will be in charge of a new project.', topic: 'work', difficulty: 'intermediate' },
  { id: 'i17', jp: '少し考える時間をください。', en: 'Please give me some time to think.', topic: 'communication', difficulty: 'intermediate' },
  { id: 'i18', jp: 'もう少し詳しく説明してもらえますか。', en: 'Could you explain it in more detail?', topic: 'communication', difficulty: 'intermediate' },
  { id: 'i19', jp: '彼女は会議に出席できません。', en: 'She is unable to attend the meeting.', topic: 'work', difficulty: 'intermediate' },
  { id: 'i20', jp: '結果が楽しみです。', en: 'I am looking forward to the results.', topic: 'opinion', difficulty: 'intermediate' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────────────

export function filterPromptsByDifficulty(
  prompts: ReverseTranslationPrompt[],
  difficulty: PromptDifficulty,
): ReverseTranslationPrompt[] {
  return prompts.filter(p => p.difficulty === difficulty);
}

/**
 * Sample N unique prompts from the pool. Returns at most pool.length items.
 * Uses Math.random by default; tests can pass a deterministic rng.
 */
export function sampleUniquePrompts(
  pool: ReverseTranslationPrompt[],
  n: number,
  rng: () => number = Math.random,
): ReverseTranslationPrompt[] {
  const arr = [...pool];
  // Fisher-Yates shuffle then take first n.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(n, arr.length));
}

export interface AttemptRecord {
  promptId: string;
  transcript: string;
  percent: number; // 0..100
}

/**
 * Returns prompts the user should retry — those whose best score was < 70%.
 * If a prompt has multiple attempts, the BEST percent is used.
 */
export function filterMissedPrompts(
  prompts: ReverseTranslationPrompt[],
  attempts: AttemptRecord[],
  threshold = 70,
): ReverseTranslationPrompt[] {
  const bestById = new Map<string, number>();
  for (const a of attempts) {
    const cur = bestById.get(a.promptId);
    if (cur === undefined || a.percent > cur) bestById.set(a.promptId, a.percent);
  }
  return prompts.filter(p => {
    const best = bestById.get(p.id);
    return best === undefined || best < threshold;
  });
}

export interface SessionSummaryStats {
  count: number;
  averagePercent: number; // rounded to int 0..100
  perfectCount: number;   // attempts with percent >= 90
  missedCount: number;    // attempts with percent < 70
}

export function computeSummaryStats(attempts: AttemptRecord[]): SessionSummaryStats {
  if (attempts.length === 0) {
    return { count: 0, averagePercent: 0, perfectCount: 0, missedCount: 0 };
  }
  const total = attempts.reduce((s, a) => s + a.percent, 0);
  const avg = Math.round(total / attempts.length);
  const perfect = attempts.filter(a => a.percent >= 90).length;
  const missed = attempts.filter(a => a.percent < 70).length;
  return { count: attempts.length, averagePercent: avg, perfectCount: perfect, missedCount: missed };
}

export interface DiffToken {
  word: string;
  status: 'match' | 'partial' | 'missing' | 'extra';
}

/**
 * Token-level diff: for each reference word, if it appears in the transcript
 * mark it 'match', else 'missing'. Then any transcript words not in reference
 * are appended as 'extra'. (Order-aware best-effort.)
 */
export function tokenDiff(reference: string, transcript: string): DiffToken[] {
  const ref = normalizeForCompare(reference);
  const tr = normalizeForCompare(transcript);
  const trCount = new Map<string, number>();
  for (const w of tr) trCount.set(w, (trCount.get(w) || 0) + 1);
  const out: DiffToken[] = [];
  for (const w of ref) {
    const c = trCount.get(w) || 0;
    if (c > 0) {
      out.push({ word: w, status: 'match' });
      trCount.set(w, c - 1);
    } else {
      out.push({ word: w, status: 'missing' });
    }
  }
  // Extras
  for (const [w, c] of trCount) {
    for (let i = 0; i < c; i++) out.push({ word: w, status: 'extra' });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const PROMPTS_PER_SESSION = 5;
const MISSED_THRESHOLD = 70;
const PERFECT_THRESHOLD = 90;

type Phase = 'prompt' | 'evaluating' | 'feedback' | 'summary';

export default function QuickReverseTranslationCard() {
  const speech = useSpeechRecognition();
  const tts = useSpeechSynthesis();

  const [difficulty, setDifficulty] = useState<PromptDifficulty>(() => {
    try {
      const saved = localStorage.getItem('quick-practice-difficulty');
      // 'advanced' falls back to intermediate (we only have two pools)
      if (saved === 'beginner') return 'beginner';
    } catch { /* ignore */ }
    return 'intermediate';
  });

  const [session, setSession] = useState<ReverseTranslationPrompt[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('prompt');
  const [showEnglish, setShowEnglish] = useState(false);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [lastDiff, setLastDiff] = useState<DiffToken[] | null>(null);
  const [lastPercent, setLastPercent] = useState<number>(0);
  const wasListeningRef = useRef(false);

  const startSession = useCallback((diff: PromptDifficulty) => {
    const pool = filterPromptsByDifficulty(REVERSE_TRANSLATION_PROMPTS, diff);
    const picked = sampleUniquePrompts(pool, PROMPTS_PER_SESSION);
    setSession(picked);
    setIndex(0);
    setAttempts([]);
    setShowEnglish(false);
    setLastDiff(null);
    setLastPercent(0);
    setPhase('prompt');
  }, []);

  // Initialize session on mount and re-init when difficulty changes externally.
  useEffect(() => {
    startSession(difficulty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        const v = e.newValue === 'beginner' ? 'beginner' : 'intermediate';
        setDifficulty(v);
        startSession(v);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [startSession]);

  const current = session[index] || null;

  const evaluate = useCallback((transcript: string) => {
    if (!current) return;
    setPhase('evaluating');
    const sim = wordSimilarity(current.en, transcript);
    const verdict = classifySimilarity(sim);
    const diff = tokenDiff(current.en, transcript);
    setLastDiff(diff);
    setLastPercent(verdict.percent);
    setAttempts(prev => [...prev, { promptId: current.id, transcript, percent: verdict.percent }]);
    setShowEnglish(true);
    setPhase('feedback');
  }, [current]);

  // Auto-evaluate when speech recognition stops.
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
      setLastDiff(null);
      setPhase('prompt');
      speech.start();
    }
  }, [speech]);

  const handleSpeakReference = useCallback(() => {
    if (current) tts.speak(current.en);
  }, [current, tts]);

  const handleTryAgain = useCallback(() => {
    speech.reset();
    setLastDiff(null);
    setShowEnglish(false);
    setPhase('prompt');
  }, [speech]);

  const handleNext = useCallback(() => {
    speech.reset();
    setLastDiff(null);
    setShowEnglish(false);
    if (index + 1 >= session.length) {
      setPhase('summary');
    } else {
      setIndex(index + 1);
      setPhase('prompt');
    }
  }, [index, session.length, speech]);

  const handlePracticeMissed = useCallback(() => {
    const missed = filterMissedPrompts(session, attempts, MISSED_THRESHOLD);
    if (missed.length === 0) {
      startSession(difficulty);
      return;
    }
    setSession(missed);
    setIndex(0);
    setAttempts([]);
    setShowEnglish(false);
    setLastDiff(null);
    setLastPercent(0);
    setPhase('prompt');
  }, [session, attempts, difficulty, startSession]);

  const handleNewSession = useCallback(() => {
    startSession(difficulty);
  }, [difficulty, startSession]);

  const handleDifficultyChange = useCallback((d: PromptDifficulty) => {
    setDifficulty(d);
    startSession(d);
  }, [startSession]);

  const summaryStats = useMemo(() => computeSummaryStats(attempts), [attempts]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const tierColor = (pct: number) =>
    pct >= PERFECT_THRESHOLD ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div
      data-testid="quick-reverse-translation-card"
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
        <Languages size={20} color="#8b5cf6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Reverse Translation (和文英訳)</h3>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
          }}
        >
          {phase === 'summary' ? `${session.length}/${session.length}` : `${Math.min(index + 1, session.length)}/${session.length}`}
        </span>
      </div>

      {/* Local difficulty selector (mirrors hub but card-scoped) */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['beginner', 'intermediate'] as PromptDifficulty[]).map(d => (
          <button
            key={d}
            data-testid={`qrt-difficulty-${d}`}
            aria-pressed={difficulty === d}
            onClick={() => handleDifficultyChange(d)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: '0.75rem',
              cursor: 'pointer',
              border: '1px solid',
              borderColor: difficulty === d ? '#8b5cf6' : 'var(--border)',
              background: difficulty === d ? '#8b5cf6' : 'transparent',
              color: difficulty === d ? '#fff' : 'var(--text-secondary)',
              fontWeight: difficulty === d ? 600 : 400,
            }}
          >
            {d === 'beginner' ? '🌱 Beginner' : '📗 Intermediate'}
          </button>
        ))}
      </div>

      {phase === 'summary' ? (
        <div data-testid="qrt-summary">
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--bg-secondary, #f9fafb)',
              marginBottom: 12,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: tierColor(summaryStats.averagePercent) }}>
              {summaryStats.averagePercent}%
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Average match</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 12, fontSize: '0.85rem' }}>
              <div>
                <div data-testid="qrt-summary-perfect" style={{ fontWeight: 700, color: '#22c55e' }}>
                  {summaryStats.perfectCount}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Perfect (≥90%)</div>
              </div>
              <div>
                <div data-testid="qrt-summary-missed" style={{ fontWeight: 700, color: '#ef4444' }}>
                  {summaryStats.missedCount}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Missed (&lt;70%)</div>
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{summaryStats.count}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Attempts</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              data-testid="qrt-practice-missed"
              onClick={handlePracticeMissed}
              disabled={summaryStats.missedCount === 0}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                cursor: summaryStats.missedCount === 0 ? 'not-allowed' : 'pointer',
                border: 'none',
                background: summaryStats.missedCount === 0 ? 'var(--border)' : '#ef4444',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: 600,
                opacity: summaryStats.missedCount === 0 ? 0.6 : 1,
              }}
            >
              Practice missed ones ({summaryStats.missedCount})
            </button>
            <button
              data-testid="qrt-new-session"
              onClick={handleNewSession}
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
              <RefreshCw size={14} /> New Session
            </button>
          </div>
        </div>
      ) : current ? (
        <div>
          {/* Japanese prompt */}
          <div
            data-testid="qrt-jp-prompt"
            lang="ja"
            style={{
              padding: 14,
              borderRadius: 10,
              background: 'var(--bg-secondary, #f9fafb)',
              marginBottom: 10,
              fontSize: '1.1rem',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            {current.jp}
          </div>

          {/* Show English fallback */}
          {!showEnglish ? (
            <button
              data-testid="qrt-show-english"
              onClick={() => setShowEnglish(true)}
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
              <Eye size={12} /> Show English
            </button>
          ) : (
            <div
              data-testid="qrt-en-reference"
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
              <span style={{ flex: 1, minWidth: 0 }}>{current.en}</span>
              <button
                data-testid="qrt-tts"
                onClick={handleSpeakReference}
                aria-label="Speak reference English"
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
                  onClick={() => setShowEnglish(false)}
                  aria-label="Hide English"
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

          {/* Token diff */}
          {phase === 'feedback' && lastDiff && (
            <div
              data-testid="qrt-diff"
              style={{
                padding: 10,
                marginBottom: 10,
                borderRadius: 8,
                background: 'var(--bg-secondary, #f9fafb)',
                border: '1px solid var(--border)',
              }}
            >
              <div
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Word-by-word match —{' '}
                <span style={{ color: tierColor(lastPercent), fontSize: '0.85rem' }}>
                  {lastPercent}%
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {lastDiff.map((tok, i) => {
                  const bg =
                    tok.status === 'match'
                      ? '#dcfce7'
                      : tok.status === 'partial'
                      ? '#fef3c7'
                      : tok.status === 'missing'
                      ? '#fee2e2'
                      : '#e0e7ff';
                  const color =
                    tok.status === 'match'
                      ? '#166534'
                      : tok.status === 'partial'
                      ? '#854d0e'
                      : tok.status === 'missing'
                      ? '#991b1b'
                      : '#3730a3';
                  return (
                    <span
                      key={i}
                      data-testid={`qrt-tok-${tok.status}`}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        fontSize: '0.85rem',
                        background: bg,
                        color,
                        textDecoration: tok.status === 'extra' ? 'line-through' : undefined,
                      }}
                    >
                      {tok.status === 'extra' ? `+${tok.word}` : tok.word}
                    </span>
                  );
                })}
              </div>
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
              data-testid="qrt-mic"
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
                background: speech.isListening ? '#ef4444' : '#8b5cf6',
                color: 'white',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              <Mic size={16} /> {speech.isListening ? 'Stop' : '🎤 Speak'}
            </button>

            {phase === 'feedback' && (
              <>
                <button
                  data-testid="qrt-try-again"
                  onClick={handleTryAgain}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                  }}
                >
                  Try again
                </button>
                <button
                  data-testid="qrt-next"
                  onClick={handleNext}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: 'none',
                    background: '#8b5cf6',
                    color: 'white',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                >
                  {index + 1 >= session.length ? 'See Summary' : 'Next →'}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading prompts…</p>
      )}
    </div>
  );
}
