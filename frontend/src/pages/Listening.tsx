import { useState, useCallback, useEffect } from 'react';
import { Volume2, Eye, EyeOff, CheckCircle, XCircle, RotateCcw, History, Play, ArrowLeft, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { EchoPractice, extractSentences } from '../components/EchoPractice';
import { ClozeListening } from '../components/ClozeListening';
import { ListenAndSummarize } from '../components/ListenAndSummarize';
import { ListeningSpokenQA } from '../components/ListeningSpokenQA';
import { ListeningKeyVocab } from '../components/ListeningKeyVocab';
import { ListeningDiscussion } from '../components/ListeningDiscussion';
import { ListeningParaphrase } from '../components/ListeningParaphrase';
import { ListeningSpeedChallenge } from '../components/ListeningSpeedChallenge';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { api, saveListeningQuizResult, getListeningQuizHistory, getListeningDifficultyRecommendation, getListeningQuizDetail, getListeningSpeed, saveListeningSpeed } from '../api';
import type { ListeningQuizQuestion, ListeningQuizResult, ListeningDifficultyRecommendation } from '../api';
import { findRelevantSentenceIndex } from '../utils/listeningReview';

type Phase = 'setup' | 'listen' | 'quiz' | 'results' | 'speed-challenge';
type Difficulty = 'beginner' | 'intermediate' | 'advanced';

interface QuizResult {
  question: string;
  selectedIndex: number;
  correctIndex: number;
  explanation: string;
  options: string[];
}

// ── Speed Ladder helpers (exported for unit testing) ─────────────────
export const SPEED_LADDER_RUNGS: readonly number[] = [0.85, 1.0, 1.15, 1.3, 1.5];

// ── Inline slow-replay helpers (exported for unit testing) ───────────
export const AUTO_REPLAY_ON_WRONG_KEY = 'listening.autoReplayOnWrong';

/**
 * Pure predicate: should the inline slow-replay panel be visible?
 * Visible only when the question has been answered AND the chosen option
 * was not the correct one.
 */
export function shouldShowInlineReplay(args: {
  answered: boolean;
  selectedIndex: number | null;
  correctIndex: number;
}): boolean {
  const { answered, selectedIndex, correctIndex } = args;
  if (!answered) return false;
  if (selectedIndex === null) return false;
  return selectedIndex !== correctIndex;
}

/**
 * Pure step function for the Speed Ladder.
 * Two consecutive first-try correct answers → step up one rung (cap at top).
 * One wrong (non-first-try-correct) answer → step down one rung (floor at 0).
 * Returns the next ladder index, the next consecutive-correct counter, and a hint.
 */
export function nextLadderStep(
  currentIndex: number,
  consecCorrect: number,
  isCorrectFirstTry: boolean,
  rungs: readonly number[] = SPEED_LADDER_RUNGS,
): { nextIndex: number; nextConsec: number; hint: 'up' | 'down' | null } {
  const max = rungs.length - 1;
  if (!isCorrectFirstTry) {
    if (currentIndex > 0) {
      return { nextIndex: currentIndex - 1, nextConsec: 0, hint: 'down' };
    }
    return { nextIndex: 0, nextConsec: 0, hint: null };
  }
  const newConsec = consecCorrect + 1;
  if (newConsec >= 2 && currentIndex < max) {
    return { nextIndex: currentIndex + 1, nextConsec: 0, hint: 'up' };
  }
  return { nextIndex: currentIndex, nextConsec: newConsec, hint: null };
}

export default function Listening() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [topics, setTopics] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [passage, setPassage] = useState('');
  const [questions, setQuestions] = useState<ListeningQuizQuestion[]>([]);
  const [showText, setShowText] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [history, setHistory] = useState<ListeningQuizResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [saved, setSaved] = useState(false);
  const [recommendation, setRecommendation] = useState<ListeningDifficultyRecommendation | null>(null);
  const [isRetry, setIsRetry] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [playingSentenceIdx, setPlayingSentenceIdx] = useState<number | null>(null);
  const [replayCounts, setReplayCounts] = useState<number[]>([]);
  const [firstListenFlags, setFirstListenFlags] = useState<boolean[]>([]);
  const [answeredFirstListen, setAnsweredFirstListen] = useState<boolean[]>([]);
  const [playingReviewIdx, setPlayingReviewIdx] = useState<number | null>(null);
  const [shownReviewSentences, setShownReviewSentences] = useState<Record<number, boolean>>({});
  const [inlineReplayPlaying, setInlineReplayPlaying] = useState<boolean>(false);
  const [autoReplayOnWrong, setAutoReplayOnWrong] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(AUTO_REPLAY_ON_WRONG_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [autoReplayFiredForIdx, setAutoReplayFiredForIdx] = useState<number | null>(null);

  // ── Speed Ladder mode ─────────────────────────────────────────────
  // Ladder rungs: 0.85, 1.0, 1.15, 1.3, 1.5 (cap)
  const [speedLadder, setSpeedLadder] = useState(false);
  const [ladderIndex, setLadderIndex] = useState(0);
  const [consecCorrect, setConsecCorrect] = useState(0);
  const [ladderHint, setLadderHint] = useState<'up' | 'down' | null>(null);
  const [ladderTopSpeed, setLadderTopSpeed] = useState<number>(0.85);
  const [savedTopSpeed, setSavedTopSpeed] = useState<number>(1.0);

  const sentences = passage ? extractSentences(passage) : [];

  // Effective playback speed depends on whether Speed Ladder mode is active
  const effectiveRate = speedLadder ? SPEED_LADDER_RUNGS[ladderIndex] : playbackRate;

  const playSentence = useCallback((text: string, idx: number) => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = effectiveRate;
    utterance.onend = () => setPlayingSentenceIdx(null);
    utterance.onerror = () => setPlayingSentenceIdx(null);
    setPlayingSentenceIdx(idx);
    window.speechSynthesis.speak(utterance);
    if (phase === 'quiz') {
      setReplayCounts(prev => {
        const next = [...prev];
        if (quizIndex < next.length) next[quizIndex] = (next[quizIndex] || 0) + 1;
        return next;
      });
      setFirstListenFlags(prev => {
        if (quizIndex >= prev.length) return prev;
        const next = [...prev];
        next[quizIndex] = false;
        return next;
      });
    }
  }, [effectiveRate, phase, quizIndex]);

  useEffect(() => {
    getListeningQuizHistory(10).then(setHistory).catch(() => {});
    getListeningDifficultyRecommendation().then(rec => {
      setRecommendation(rec);
      if (rec.recommended_difficulty && rec.stats.quizzes_analyzed > 0) {
        const d = rec.recommended_difficulty as Difficulty;
        setDifficulty(d);
        setPlaybackRate(d === 'beginner' ? 0.75 : d === 'advanced' ? 1.1 : 1.0);
      }
    }).catch(() => {});
    api.getConversationTopics().then(t => setTopics(t.map(({ id, label }) => ({ id, label })))).catch(() => {});
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  // Load saved best ladder speed for the chosen topic; start one rung below it.
  useEffect(() => {
    if (!speedLadder) return;
    let cancelled = false;
    getListeningSpeed(selectedTopic || 'all').then(r => {
      if (cancelled) return;
      setSavedTopSpeed(r.max_speed);
      // Find the highest rung index whose value <= saved max, then drop one
      const idxAtSaved = SPEED_LADDER_RUNGS.reduce(
        (best, val, i) => (val <= r.max_speed ? i : best),
        0,
      );
      const startIdx = Math.max(0, idxAtSaved - 1);
      setLadderIndex(startIdx);
      setLadderTopSpeed(SPEED_LADDER_RUNGS[startIdx]);
      setConsecCorrect(0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [speedLadder, selectedTopic]);

  const generateQuiz = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.generateListeningQuiz(difficulty, 5, selectedTopic || undefined);
      setTitle(data.title);
      setPassage(data.passage);
      setQuestions(data.questions);
      setPhase('listen');
    } catch {
      setError('Failed to generate quiz. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [difficulty, selectedTopic]);

  const playAudio = useCallback(() => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(passage);
    utterance.lang = 'en-US';
    utterance.rate = effectiveRate;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
    if (phase === 'quiz') {
      setReplayCounts(prev => {
        const next = [...prev];
        if (quizIndex < next.length) next[quizIndex] = (next[quizIndex] || 0) + 1;
        return next;
      });
      setFirstListenFlags(prev => {
        if (quizIndex >= prev.length) return prev;
        const next = [...prev];
        next[quizIndex] = false;
        return next;
      });
    }
  }, [passage, effectiveRate, isSpeaking, phase, quizIndex]);

  const handleAnswer = useCallback(() => {
    if (selectedOption === null) return;
    const q = questions[quizIndex];
    const wasFirstListen = firstListenFlags[quizIndex] ?? true;
    const isCorrect = selectedOption === q.correct_index;
    setResults(prev => [...prev, {
      question: q.question,
      selectedIndex: selectedOption,
      correctIndex: q.correct_index,
      explanation: q.explanation,
      options: q.options,
    }]);
    setAnsweredFirstListen(prev => {
      const next = [...prev];
      next[quizIndex] = wasFirstListen;
      return next;
    });
    setAnswered(true);

    // Speed Ladder progression — only when ladder mode is active
    if (speedLadder) {
      const correctFirstTry = isCorrect && wasFirstListen;
      const step = nextLadderStep(ladderIndex, consecCorrect, correctFirstTry);
      if (step.nextIndex !== ladderIndex) {
        setLadderIndex(step.nextIndex);
        const nextSpeed = SPEED_LADDER_RUNGS[step.nextIndex];
        if (nextSpeed > ladderTopSpeed) setLadderTopSpeed(nextSpeed);
      }
      setConsecCorrect(step.nextConsec);
      setLadderHint(step.hint);
      if (step.hint) {
        // auto-clear hint after a moment
        window.setTimeout(() => setLadderHint(null), 1800);
      }
    }
  }, [selectedOption, questions, quizIndex, firstListenFlags, speedLadder, ladderIndex, consecCorrect, ladderTopSpeed]);

  const handleNext = useCallback(() => {
    if (quizIndex < questions.length - 1) {
      setQuizIndex(prev => prev + 1);
      setSelectedOption(null);
      setAnswered(false);
      // Cleanup inline slow-replay state when moving to the next question.
      window.speechSynthesis.cancel();
      setInlineReplayPlaying(false);
    } else {
      setPhase('results');
      if (!isRetry) {
        // Auto-save quiz result (skip on retry)
        const correctCount = results.filter(r => r.selectedIndex === r.correctIndex).length;
        const totalQ = questions.length;
        const scoreVal = Math.round((correctCount / totalQ) * 100);
        // Capture current question's first-listen flag (handleNext fires after handleAnswer for last Q)
        const firstListenForLast = answeredFirstListen[quizIndex] ?? (firstListenFlags[quizIndex] ?? true);
        const flLatest = [...answeredFirstListen];
        if (flLatest[quizIndex] === undefined) flLatest[quizIndex] = firstListenForLast;
        const firstListenTotal = totalQ;
        const firstListenCorrect = results.reduce((acc, r, i) => {
          const wasFirst = flLatest[i] ?? true;
          return acc + (wasFirst && r.selectedIndex === r.correctIndex ? 1 : 0);
        }, 0);
        saveListeningQuizResult({
          title, difficulty, total_questions: totalQ, correct_count: correctCount, score: scoreVal, topic: selectedTopic,
          passage, questions,
          first_listen_correct: firstListenCorrect,
          first_listen_total: firstListenTotal,
        }).then(() => {
          setSaved(true);
          getListeningQuizHistory(10).then(setHistory).catch(() => {});
        }).catch(() => {});
      }
      // Persist speed-ladder top speed (only if ladder mode was active)
      if (speedLadder && ladderTopSpeed > savedTopSpeed) {
        saveListeningSpeed(selectedTopic || '', ladderTopSpeed)
          .then(r => setSavedTopSpeed(r.max_speed))
          .catch(() => {});
      }
    }
  }, [quizIndex, questions, results, selectedOption, title, difficulty, isRetry, passage, selectedTopic, answeredFirstListen, firstListenFlags, speedLadder, ladderTopSpeed, savedTopSpeed]);

  const handleRestart = useCallback(() => {
    setPhase('setup');
    setTitle('');
    setPassage('');
    setQuestions([]);
    setShowText(false);
    setQuizIndex(0);
    setSelectedOption(null);
    setAnswered(false);
    setResults([]);
    setSaved(false);
    setIsRetry(false);
    setError('');
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setShowBreakdown(false);
    setPlayingSentenceIdx(null);
    setConsecCorrect(0);
    setLadderHint(null);
    setInlineReplayPlaying(false);
    setAutoReplayFiredForIdx(null);
    // ladderIndex / ladderTopSpeed re-initialize via the speedLadder effect on next start
  }, []);

  const handleReplay = useCallback(async (quizId: number) => {
    try {
      const detail = await getListeningQuizDetail(quizId);
      if (!detail.passage || !detail.questions || detail.questions.length === 0) return;
      setTitle(detail.title);
      setPassage(detail.passage);
      setDifficulty(detail.difficulty as Difficulty);
      setQuestions(detail.questions);
      setQuizIndex(0);
      setSelectedOption(null);
      setAnswered(false);
      setResults([]);
      setSaved(false);
      setIsRetry(true);
      setShowText(false);
      setError('');
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setPhase('listen');
    } catch {
      // silently ignore replay errors
    }
  }, []);

  const handleRetryWrong = useCallback(() => {
    const wrongResults = results.filter(r => r.selectedIndex !== r.correctIndex);
    if (wrongResults.length === 0) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    // Filter questions to only those the user got wrong
    const wrongQuestions = wrongResults.map(r => {
      return questions.find(q => q.question === r.question)!;
    }).filter(Boolean);
    setQuestions(wrongQuestions);
    setQuizIndex(0);
    setSelectedOption(null);
    setAnswered(false);
    setResults([]);
    setReplayCounts(new Array(wrongQuestions.length).fill(0));
    setFirstListenFlags(new Array(wrongQuestions.length).fill(true));
    setAnsweredFirstListen([]);
    setIsRetry(true);
    setPhase('quiz');
  }, [results, questions]);

  // Cancel any ongoing speech when leaving the results phase.
  useEffect(() => {
    if (phase !== 'results') {
      window.speechSynthesis.cancel();
      setPlayingReviewIdx(null);
    }
  }, [phase]);

  const replayReviewSentence = useCallback((idx: number) => {
    if (!sentences || sentences.length === 0) return;
    const r = results[idx];
    if (!r) return;
    const sentenceIdx = findRelevantSentenceIndex(
      r.question,
      r.options[r.correctIndex] ?? '',
      sentences,
    );
    const text = sentences[sentenceIdx];
    if (!text) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.75;
    utterance.onend = () => setPlayingReviewIdx(prev => (prev === idx ? null : prev));
    utterance.onerror = () => setPlayingReviewIdx(prev => (prev === idx ? null : prev));
    setPlayingReviewIdx(idx);
    window.speechSynthesis.speak(utterance);
  }, [sentences, results]);

  const replayAllMissed = useCallback(() => {
    if (!sentences || sentences.length === 0) return;
    const missedIndices = results
      .map((r, i) => (r.selectedIndex !== r.correctIndex ? i : -1))
      .filter(i => i >= 0);
    if (missedIndices.length === 0) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    let cursor = 0;
    const playNext = () => {
      if (cursor >= missedIndices.length) {
        setPlayingReviewIdx(null);
        return;
      }
      const idx = missedIndices[cursor++];
      const r = results[idx];
      const sentenceIdx = findRelevantSentenceIndex(
        r.question,
        r.options[r.correctIndex] ?? '',
        sentences,
      );
      const text = sentences[sentenceIdx];
      if (!text) {
        playNext();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.75;
      utterance.onend = () => {
        playNext();
      };
      utterance.onerror = () => {
        playNext();
      };
      setPlayingReviewIdx(idx);
      window.speechSynthesis.speak(utterance);
    };
    playNext();
  }, [sentences, results]);

  // Inline slow-replay during the quiz phase: plays the relevant sentence
  // without bumping replayCounts/firstListenFlags (the question is already
  // answered, so we don't want to penalize listening-stat metrics).
  const playInlineReplay = useCallback((rate: number) => {
    if (phase !== 'quiz') return;
    const q = questions[quizIndex];
    if (!q || !sentences || sentences.length === 0) return;
    const sentenceIdx = findRelevantSentenceIndex(
      q.question,
      q.options[q.correct_index] ?? '',
      sentences,
    );
    const text = sentences[sentenceIdx];
    if (!text) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate;
    utterance.onend = () => setInlineReplayPlaying(false);
    utterance.onerror = () => setInlineReplayPlaying(false);
    setInlineReplayPlaying(true);
    window.speechSynthesis.speak(utterance);
  }, [phase, questions, quizIndex, sentences]);

  // Auto-replay slowly once when a wrong answer is registered (if enabled).
  useEffect(() => {
    if (!autoReplayOnWrong) return;
    if (phase !== 'quiz') return;
    if (!answered) return;
    const q = questions[quizIndex];
    if (!q) return;
    if (selectedOption === null || selectedOption === q.correct_index) return;
    if (autoReplayFiredForIdx === quizIndex) return;
    setAutoReplayFiredForIdx(quizIndex);
    playInlineReplay(0.75);
  }, [autoReplayOnWrong, phase, answered, selectedOption, questions, quizIndex, autoReplayFiredForIdx, playInlineReplay]);

  const toggleAutoReplayOnWrong = useCallback(() => {
    setAutoReplayOnWrong(prev => {
      const next = !prev;
      try {
        window.localStorage.setItem(AUTO_REPLAY_ON_WRONG_KEY, next ? 'true' : 'false');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);


  const handleBackToSetup = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setPhase('setup');
    setQuizIndex(0);
    setSelectedOption(null);
    setAnswered(false);
    setResults([]);
    setShowText(false);
    setError('');
    setShowBreakdown(false);
    setPlayingSentenceIdx(null);
  }, []);

  // Keyboard shortcuts for quiz phase
  const isQuizPhase = phase === 'quiz' && questions.length > 0;
  useKeyboardShortcuts([
    { key: '1', handler: () => !answered && setSelectedOption(0), enabled: isQuizPhase },
    { key: '2', handler: () => !answered && questions[quizIndex]?.options.length > 1 && setSelectedOption(1), enabled: isQuizPhase },
    { key: '3', handler: () => !answered && questions[quizIndex]?.options.length > 2 && setSelectedOption(2), enabled: isQuizPhase },
    { key: '4', handler: () => !answered && questions[quizIndex]?.options.length > 3 && setSelectedOption(3), enabled: isQuizPhase },
    { key: 'Enter', handler: () => { if (answered) { handleNext(); } else if (selectedOption !== null) { handleAnswer(); } }, enabled: isQuizPhase },
    { key: ' ', handler: () => playAudio(), enabled: isQuizPhase },
    { key: 'Escape', handler: handleBackToSetup, enabled: isQuizPhase },
  ]);

  return (
    <div className="page-container">
      <h1>🎧 Listening Quiz</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        Listen to a passage and answer comprehension questions
      </p>

      {phase === 'setup' && (
        <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
          <h3 style={{ marginBottom: 16 }}>Choose Difficulty</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {(['beginner', 'intermediate', 'advanced'] as Difficulty[]).map(d => (
              <button
                key={d}
                onClick={() => {
                  setDifficulty(d);
                  setPlaybackRate(d === 'beginner' ? 0.75 : d === 'advanced' ? 1.1 : 1.0);
                }}
                style={{
                  flex: 1, minWidth: 100, padding: '0.6rem 1rem', borderRadius: 8,
                  border: `2px solid ${difficulty === d ? 'var(--primary, #6366f1)' : 'var(--border)'}`,
                  background: difficulty === d ? 'var(--primary, #6366f1)' : 'transparent',
                  color: difficulty === d ? '#fff' : 'var(--text)',
                  fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                }}
              >
                {d}
              </button>
            ))}
          </div>
          {topics.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 8, fontSize: '0.9rem' }}>Topic (optional)</h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  onClick={() => setSelectedTopic('')}
                  style={{
                    padding: '0.4rem 0.8rem', borderRadius: 8, fontSize: '0.85rem',
                    border: `2px solid ${!selectedTopic ? 'var(--primary, #6366f1)' : 'var(--border)'}`,
                    background: !selectedTopic ? 'var(--primary, #6366f1)' : 'transparent',
                    color: !selectedTopic ? '#fff' : 'var(--text)',
                    fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Any Topic
                </button>
                {topics.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTopic(t.id)}
                    style={{
                      padding: '0.4rem 0.8rem', borderRadius: 8, fontSize: '0.85rem',
                      border: `2px solid ${selectedTopic === t.id ? 'var(--primary, #6366f1)' : 'var(--border)'}`,
                      background: selectedTopic === t.id ? 'var(--primary, #6366f1)' : 'transparent',
                      color: selectedTopic === t.id ? '#fff' : 'var(--text)',
                      fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {recommendation && recommendation.stats.quizzes_analyzed > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px',
              borderRadius: 8, background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border, #e5e7eb)',
              fontSize: '0.85rem',
            }}>
              <span>📊</span>
              <div>
                <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                  Recommended: {recommendation.recommended_difficulty}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>
                  {recommendation.reason}
                </div>
              </div>
            </div>
          )}
          {error && <p style={{ color: 'var(--danger, #ef4444)', marginBottom: 12 }}>{error}</p>}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            marginBottom: 12, padding: '10px 12px', borderRadius: 8,
            border: `2px solid ${speedLadder ? 'var(--warning, #f59e0b)' : 'var(--border)'}`,
            background: speedLadder ? 'rgba(245,158,11,0.08)' : 'var(--bg-secondary, #f9fafb)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={16} color={speedLadder ? 'var(--warning, #f59e0b)' : 'var(--text-secondary)'} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Speed Ladder</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Train your ear: 0.85x → 1.5x. 2 right in a row → speed up.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSpeedLadder(v => !v)}
              data-testid="speed-ladder-toggle"
              aria-pressed={speedLadder}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: speedLadder ? 'var(--warning, #f59e0b)' : 'transparent',
                color: speedLadder ? '#fff' : 'var(--text)',
              }}
            >
              {speedLadder ? 'On' : 'Off'}
            </button>
          </div>
          <button
            className="btn btn-primary"
            onClick={generateQuiz}
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Generating…' : 'Generate Quiz'}
          </button>
          {history.length > 0 && (
            <button
              className="btn"
              onClick={() => setShowHistory(v => !v)}
              style={{ width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <History size={16} />
              {showHistory ? 'Hide History' : 'View History'} ({history.length})
            </button>
          )}
          {showHistory && history.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Recent Results</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(h => (
                  <div key={h.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 12px', borderRadius: 8,
                    background: 'var(--bg-secondary, #f9fafb)', border: '1px solid var(--border, #e5e7eb)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {h.difficulty}{h.topic ? ` · ${h.topic}` : ''} · {h.correct_count}/{h.total_questions} correct · {new Date(h.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 18, fontWeight: 700, marginLeft: 12,
                      color: h.score >= 80 ? 'var(--success, #22c55e)' : h.score >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
                    }}>
                      {h.score}%
                    </div>
                    <button
                      onClick={() => handleReplay(h.id)}
                      title="Replay this quiz"
                      style={{
                        marginLeft: 8, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border, #e5e7eb)',
                        background: 'var(--bg-primary, #fff)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        fontSize: 12, color: 'var(--primary, #3b82f6)',
                      }}
                    >
                      <Play size={12} /> Replay
                    </button>
                  </div>
                ))}
              </div>
              {history.length >= 3 && (() => {
                const avg = Math.round(history.reduce((s, h) => s + h.score, 0) / history.length);
                return (
                  <div style={{ marginTop: 8, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                    Average score: <strong style={{ color: avg >= 80 ? 'var(--success)' : avg >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{avg}%</strong>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {phase === 'listen' && (
        <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
          <h3 style={{ marginBottom: 16 }}>{title}</h3>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <button
              onClick={playAudio}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Volume2 size={18} />
              {isSpeaking ? 'Stop Audio' : 'Play Audio'}
            </button>
            <button
              onClick={() => setShowText(!showText)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '0.5rem 1rem', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--card-bg, #fff)',
                color: 'var(--text)', cursor: 'pointer', fontWeight: 500,
              }}
            >
              {showText ? <EyeOff size={16} /> : <Eye size={16} />}
              {showText ? 'Hide Text' : 'Show Text'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Speed:</span>
            {[0.5, 0.75, 1.0, 1.25, 1.5].map(r => (
              <button
                key={r}
                onClick={() => setPlaybackRate(r)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  border: playbackRate === r ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: playbackRate === r ? 'var(--primary)' : 'transparent',
                  color: playbackRate === r ? 'white' : 'var(--text)',
                }}
              >
                {r}x
              </button>
            ))}
          </div>
          {/* Sentence Breakdown Panel - Listen Phase */}
          {sentences.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setShowBreakdown(v => !v)}
                data-testid="sentence-breakdown-toggle"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                  borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary, #f9fafb)',
                  color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: 13, width: '100%',
                }}
              >
                {showBreakdown ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                Sentence Breakdown ({sentences.length} sentences)
              </button>
              {showBreakdown && (
                <div style={{
                  marginTop: 8, borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--bg-secondary, #f9fafb)', overflow: 'hidden',
                }}>
                  {sentences.map((s, i) => (
                    <div
                      key={i}
                      data-testid={`sentence-${i}`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px',
                        borderBottom: i < sentences.length - 1 ? '1px solid var(--border)' : 'none',
                        background: playingSentenceIdx === i ? 'rgba(99,102,241,0.08)' : 'transparent',
                        transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 22, height: 22, borderRadius: 4, flexShrink: 0, fontSize: 11, fontWeight: 700,
                        background: playingSentenceIdx === i ? 'var(--primary, #6366f1)' : 'var(--bg-primary, #e5e7eb)',
                        color: playingSentenceIdx === i ? '#fff' : 'var(--text-secondary)',
                      }}>{i + 1}</span>
                      <span style={{
                        flex: 1, fontSize: 14, lineHeight: 1.5,
                        color: playingSentenceIdx === i ? 'var(--primary, #6366f1)' : 'var(--text)',
                        fontWeight: playingSentenceIdx === i ? 600 : 400,
                      }}>{s}</span>
                      <button
                        onClick={() => playSentence(s, i)}
                        data-testid={`play-sentence-${i}`}
                        title={`Play sentence ${i + 1}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                          border: '1px solid var(--border)', cursor: 'pointer',
                          background: playingSentenceIdx === i ? 'var(--primary, #6366f1)' : 'transparent',
                          color: playingSentenceIdx === i ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        <Volume2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {showText && (
            <div style={{
              padding: 16, borderRadius: 8, marginBottom: 16,
              background: 'var(--bg-secondary, #f5f5f5)',
              lineHeight: 1.8, fontSize: 15,
            }}>
              {passage}
            </div>
          )}
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
            Listen to the passage carefully, then start the questions. You can replay the audio anytime.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                window.speechSynthesis.cancel();
                setIsSpeaking(false);
                setReplayCounts(new Array(questions.length).fill(0));
                setFirstListenFlags(new Array(questions.length).fill(true));
                setAnsweredFirstListen([]);
                setPhase('quiz');
              }}
            >
              Start Questions ({questions.length})
            </button>
            <button
              className="btn"
              onClick={handleBackToSetup}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <ArrowLeft size={14} /> Back to Setup
            </button>
          </div>
        </div>
      )}

      {phase === 'quiz' && (
        <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleBackToSetup}
                title="Back to setup (Esc)"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '0.3rem 0.6rem', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
                }}
              >
                <ArrowLeft size={14} /> Back
              </button>
              <h3 style={{ margin: 0 }}>Question {quizIndex + 1}/{questions.length}</h3>
            </div>
            <button
              onClick={playAudio}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.3rem 0.6rem', borderRadius: 6,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
              }}
            >
              <Volume2 size={14} /> Replay
            </button>
          </div>
          {speedLadder && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span
                data-testid="speed-ladder-chip"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  background: 'var(--warning, #f59e0b)', color: '#fff',
                }}
              >
                ⚡ {SPEED_LADDER_RUNGS[ladderIndex]}x · Level {ladderIndex + 1}/{SPEED_LADDER_RUNGS.length}
              </span>
              {ladderHint === 'up' && (
                <span data-testid="speed-ladder-hint-up"
                      style={{ fontSize: 12, fontWeight: 700, color: 'var(--success, #22c55e)' }}>
                  ⬆️ Speed up!
                </span>
              )}
              {ladderHint === 'down' && (
                <span data-testid="speed-ladder-hint-down"
                      style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger, #ef4444)' }}>
                  ⬇️ Slowing down
                </span>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={toggleAutoReplayOnWrong}
              data-testid="auto-replay-on-wrong-toggle"
              aria-pressed={autoReplayOnWrong}
              title="Automatically replay the relevant sentence slowly after a wrong answer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: autoReplayOnWrong ? 'var(--primary, #6366f1)' : 'transparent',
                color: autoReplayOnWrong ? '#fff' : 'var(--text-secondary)',
              }}
            >
              <Volume2 size={12} /> Auto-replay slowly on wrong: {autoReplayOnWrong ? 'On' : 'Off'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Speed:</span>
            {[0.5, 0.75, 1.0, 1.25, 1.5].map(r => (
              <button
                key={r}
                onClick={() => setPlaybackRate(r)}
                style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: playbackRate === r ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: playbackRate === r ? 'var(--primary)' : 'transparent',
                  color: playbackRate === r ? 'white' : 'var(--text)',
                }}
              >
                {r}x
              </button>
            ))}
          </div>
          {/* Sentence Breakdown Panel - Quiz Phase */}
          {sentences.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => setShowBreakdown(v => !v)}
                data-testid="sentence-breakdown-toggle-quiz"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary, #f9fafb)',
                  color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: 12, width: '100%',
                }}
              >
                {showBreakdown ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Sentence Breakdown ({sentences.length})
              </button>
              {showBreakdown && (
                <div style={{
                  marginTop: 6, borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--bg-secondary, #f9fafb)', overflow: 'hidden',
                }}>
                  {sentences.map((s, i) => (
                    <div
                      key={i}
                      data-testid={`quiz-sentence-${i}`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 6, padding: '8px 10px',
                        borderBottom: i < sentences.length - 1 ? '1px solid var(--border)' : 'none',
                        background: playingSentenceIdx === i ? 'rgba(99,102,241,0.08)' : 'transparent',
                        transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: 4, flexShrink: 0, fontSize: 10, fontWeight: 700,
                        background: playingSentenceIdx === i ? 'var(--primary, #6366f1)' : 'var(--bg-primary, #e5e7eb)',
                        color: playingSentenceIdx === i ? '#fff' : 'var(--text-secondary)',
                      }}>{i + 1}</span>
                      <span style={{
                        flex: 1, fontSize: 13, lineHeight: 1.4,
                        color: playingSentenceIdx === i ? 'var(--primary, #6366f1)' : 'var(--text)',
                        fontWeight: playingSentenceIdx === i ? 600 : 400,
                      }}>{s}</span>
                      <button
                        onClick={() => playSentence(s, i)}
                        data-testid={`quiz-play-sentence-${i}`}
                        title={`Play sentence ${i + 1}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                          border: '1px solid var(--border)', cursor: 'pointer',
                          background: playingSentenceIdx === i ? 'var(--primary, #6366f1)' : 'transparent',
                          color: playingSentenceIdx === i ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        <Volume2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>
            {questions[quizIndex].question}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {questions[quizIndex].options.map((opt, i) => {
              const isCorrect = answered && i === questions[quizIndex].correct_index;
              const isWrong = answered && i === selectedOption && i !== questions[quizIndex].correct_index;
              return (
                <button
                  key={i}
                  onClick={() => !answered && setSelectedOption(i)}
                  disabled={answered}
                  style={{
                    padding: '0.6rem 1rem', borderRadius: 8, textAlign: 'left',
                    border: `2px solid ${isCorrect ? 'var(--success, #22c55e)' : isWrong ? 'var(--danger, #ef4444)' : selectedOption === i ? 'var(--primary, #6366f1)' : 'var(--border)'}`,
                    background: isCorrect ? 'var(--success-bg, #f0fdf4)' : isWrong ? 'var(--danger-bg, #fef2f2)' : selectedOption === i ? 'rgba(99,102,241,0.08)' : 'transparent',
                    color: 'var(--text)', cursor: answered ? 'default' : 'pointer',
                    fontWeight: selectedOption === i ? 600 : 400,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                    fontSize: 11, fontWeight: 700,
                    background: selectedOption === i ? 'var(--primary, #6366f1)' : 'var(--bg-secondary, #f0f0f0)',
                    color: selectedOption === i ? '#fff' : 'var(--text-secondary)',
                  }}>{i + 1}</span>
                  {isCorrect && <CheckCircle size={16} color="var(--success, #22c55e)" />}
                  {isWrong && <XCircle size={16} color="var(--danger, #ef4444)" />}
                  {opt}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16, opacity: 0.7 }}>
            ⌨️ Press 1–{questions[quizIndex].options.length} to select · Enter to submit · Space to replay · Esc to go back
          </p>
          {answered && (
            <div style={{
              padding: 12, borderRadius: 6, marginBottom: 12,
              background: 'var(--bg-secondary, #f5f5f5)',
              fontSize: 13, color: 'var(--text-secondary)',
            }}>
              💡 {questions[quizIndex].explanation}
            </div>
          )}
          {shouldShowInlineReplay({
            answered,
            selectedIndex: selectedOption,
            correctIndex: questions[quizIndex].correct_index,
          }) && sentences.length > 0 && (() => {
            const q = questions[quizIndex];
            const sentenceIdx = findRelevantSentenceIndex(
              q.question,
              q.options[q.correct_index] ?? '',
              sentences,
            );
            const text = sentences[sentenceIdx] ?? '';
            return (
              <div
                data-testid="inline-replay-panel"
                style={{
                  padding: 12, borderRadius: 6, marginBottom: 12,
                  background: 'var(--bg-secondary, #f5f5f5)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
                  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
                }}>
                  🔁 Listen again to repair the gap
                </div>
                <p style={{
                  margin: '0 0 8px', fontSize: 13, lineHeight: 1.4, color: 'var(--text)',
                }}>
                  {text}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => playInlineReplay(0.75)}
                    data-testid="inline-replay-slow"
                    disabled={inlineReplayPlaying}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      border: '1px solid var(--border)',
                      background: inlineReplayPlaying ? 'var(--bg-secondary, #f0f0f0)' : 'var(--primary, #6366f1)',
                      color: inlineReplayPlaying ? 'var(--text-secondary)' : '#fff',
                      cursor: inlineReplayPlaying ? 'default' : 'pointer',
                      opacity: inlineReplayPlaying ? 0.6 : 1,
                    }}
                  >
                    <Volume2 size={12} /> Listen slowly (0.75×)
                  </button>
                  <button
                    type="button"
                    onClick={() => playInlineReplay(1.0)}
                    data-testid="inline-replay-normal"
                    disabled={inlineReplayPlaying}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text)',
                      cursor: inlineReplayPlaying ? 'default' : 'pointer',
                      opacity: inlineReplayPlaying ? 0.6 : 1,
                    }}
                  >
                    <Play size={12} /> Listen normal (1.0×)
                  </button>
                </div>
              </div>
            );
          })()}
          {!answered ? (
            <button
              className="btn btn-primary"
              onClick={handleAnswer}
              disabled={selectedOption === null}
              style={{ opacity: selectedOption === null ? 0.5 : 1 }}
            >
              Submit Answer
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleNext}>
              {quizIndex < questions.length - 1 ? 'Next Question' : 'See Results'}
            </button>
          )}
        </div>
      )}

      {phase === 'results' && (
        <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
          <h3 style={{ textAlign: 'center', marginBottom: 16 }}>Quiz Complete!</h3>
          {speedLadder && (
            <div
              data-testid="speed-ladder-top-speed"
              style={{
                textAlign: 'center', marginBottom: 12, padding: '8px 12px',
                borderRadius: 999, display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
                background: 'var(--warning, #f59e0b)', color: '#fff', fontWeight: 700, fontSize: 13,
                marginLeft: 'auto', marginRight: 'auto',
              }}
            >
              ⚡ Top speed reached: {ladderTopSpeed}x
              {ladderTopSpeed > savedTopSpeed && <span style={{ fontSize: 11, opacity: 0.9 }}>· new best!</span>}
            </div>
          )}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <span style={{
              fontSize: 48, fontWeight: 700,
              color: results.filter(r => r.selectedIndex === r.correctIndex).length === results.length
                ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)',
            }}>
              {results.filter(r => r.selectedIndex === r.correctIndex).length}/{results.length}
            </span>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>correct answers</p>
            {(() => {
              const flTotal = results.length;
              const flCorrect = results.reduce((acc, r, i) => {
                const wasFirst = answeredFirstListen[i] ?? true;
                return acc + (wasFirst && r.selectedIndex === r.correctIndex ? 1 : 0);
              }, 0);
              const pct = flTotal > 0 ? Math.round((flCorrect / flTotal) * 100) : 0;
              return (
                <div
                  data-testid="first-listen-accuracy-badge"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    marginTop: 8, padding: '4px 10px', borderRadius: 999,
                    background: 'var(--bg-secondary, #f5f5f5)',
                    fontSize: 12, fontWeight: 600, color: 'var(--text)',
                  }}
                >
                  🎧 First-listen accuracy: {flCorrect} / {flTotal} ({pct}%)
                </div>
              );
            })()}
          </div>
          {results.some(r => r.selectedIndex !== r.correctIndex) && sentences.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <button
                type="button"
                data-testid="replay-all-missed-btn"
                onClick={replayAllMissed}
                className="btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  border: '2px solid var(--primary, #6366f1)',
                  color: 'var(--primary, #6366f1)', fontWeight: 600,
                  fontSize: 13,
                }}
              >
                🔊 Replay all missed sentences (0.75x)
              </button>
            </div>
          )}
          {results.map((r, i) => (
            <div key={i} style={{
              padding: 12, marginBottom: 8, borderRadius: 6,
              background: 'var(--bg-secondary, #f5f5f5)',
              borderLeft: `3px solid ${r.selectedIndex === r.correctIndex ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {r.selectedIndex === r.correctIndex
                  ? <CheckCircle size={14} color="var(--success, #22c55e)" />
                  : <XCircle size={14} color="var(--danger, #ef4444)" />}
                <span style={{ fontWeight: 600, fontSize: 13 }}>Q{i + 1}: {r.question}</span>
                {(replayCounts[i] ?? 0) > 0 && (
                  <span
                    data-testid={`replay-count-${i}`}
                    style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}
                  >
                    replayed {replayCounts[i]}×
                  </span>
                )}
                {(replayCounts[i] ?? 0) === 0 && (
                  <span
                    data-testid={`replay-count-${i}`}
                    style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--success, #22c55e)', fontWeight: 600 }}
                  >
                    🎧 first listen
                  </span>
                )}
              </div>
              {r.selectedIndex !== r.correctIndex && (
                <p style={{ margin: '4px 0', fontSize: 12 }}>
                  <span style={{ color: 'var(--danger, #ef4444)', textDecoration: 'line-through' }}>{r.options[r.selectedIndex]}</span>
                  {' → '}
                  <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600 }}>{r.options[r.correctIndex]}</span>
                </p>
              )}
              {(r.selectedIndex !== r.correctIndex) && (() => {
                const sentenceIdx = sentences.length > 0
                  ? findRelevantSentenceIndex(r.question, r.options[r.correctIndex] ?? '', sentences)
                  : -1;
                const sentenceText = sentenceIdx >= 0 ? sentences[sentenceIdx] : '';
                const isPlaying = playingReviewIdx === i;
                const isShown = !!shownReviewSentences[i];
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      data-testid={`replay-review-btn-${i}`}
                      onClick={() => replayReviewSentence(i)}
                      disabled={!sentenceText}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', fontSize: 11, fontWeight: 600,
                        borderRadius: 4, cursor: sentenceText ? 'pointer' : 'not-allowed',
                        border: '1px solid var(--primary, #6366f1)',
                        background: isPlaying ? 'var(--primary, #6366f1)' : 'transparent',
                        color: isPlaying ? 'white' : 'var(--primary, #6366f1)',
                      }}
                    >
                      🔊 Replay sentence (0.75x)
                      {isPlaying && (
                        <span
                          data-testid={`replay-review-pulse-${i}`}
                          style={{
                            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                            background: 'white', animation: 'pulse 1s ease-in-out infinite',
                          }}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      data-testid={`toggle-review-sentence-${i}`}
                      onClick={() => setShownReviewSentences(prev => ({ ...prev, [i]: !prev[i] }))}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', fontSize: 11, fontWeight: 500,
                        borderRadius: 4, cursor: 'pointer',
                        border: '1px solid var(--border, #ccc)',
                        background: 'transparent', color: 'var(--text)',
                      }}
                    >
                      {isShown ? 'Hide sentence' : 'Show sentence'}
                    </button>
                    {isShown && sentenceText && (
                      <p
                        data-testid={`review-sentence-text-${i}`}
                        style={{
                          flexBasis: '100%', margin: '4px 0 0', fontSize: 12,
                          fontStyle: 'italic', color: 'var(--text-secondary)',
                        }}
                      >
                        “{sentenceText}”
                      </p>
                    )}
                  </div>
                );
              })()}
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{r.explanation}</p>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleRestart} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={14} /> Try Again
            </button>
            <button
              onClick={playAudio}
              className="btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Volume2 size={14} /> {isSpeaking ? 'Stop' : 'Replay Passage'}
            </button>
            {results.some(r => r.selectedIndex !== r.correctIndex) && (
              <button
                className="btn"
                onClick={handleRetryWrong}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  border: '2px solid var(--warning, #f59e0b)',
                  color: 'var(--warning, #f59e0b)', fontWeight: 600,
                }}
              >
                <Play size={14} /> Retry Wrong ({results.filter(r => r.selectedIndex !== r.correctIndex).length})
              </button>
            )}
            {passage && questions.length > 0 && (
              <button
                className="btn"
                onClick={() => { window.speechSynthesis.cancel(); setIsSpeaking(false); setPhase('speed-challenge'); }}
                data-testid="start-speed-challenge-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  border: '2px solid var(--warning, #f59e0b)',
                  background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(99,102,241,0.1))',
                  color: 'var(--text)', fontWeight: 600,
                }}
              >
                <Zap size={14} color="var(--warning, #f59e0b)" /> Speed Challenge
              </button>
            )}
          </div>
          {/* Playback speed for replay */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Playback speed:</span>
            {[0.5, 0.75, 1.0, 1.25, 1.5].map(r => (
              <button
                key={r}
                onClick={() => setPlaybackRate(r)}
                style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: playbackRate === r ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: playbackRate === r ? 'var(--primary)' : 'transparent',
                  color: playbackRate === r ? 'white' : 'var(--text)',
                }}
              >
                {r}x
              </button>
            ))}
          </div>
          {passage && <EchoPractice passage={passage} />}
          {passage && <ClozeListening passage={passage} />}
          {passage && <ListenAndSummarize passage={passage} />}
          {passage && questions.length > 0 && <ListeningSpokenQA passage={passage} questions={questions} />}
          {passage && <ListeningKeyVocab passage={passage} />}
          {passage && <ListeningDiscussion passage={passage} />}
          {passage && <ListeningParaphrase passage={passage} />}
        </div>
      )}

      {phase === 'speed-challenge' && passage && questions.length > 0 && (
        <ListeningSpeedChallenge
          passage={passage}
          questions={questions}
          onBack={() => setPhase('results')}
        />
      )}
    </div>
  );
}
