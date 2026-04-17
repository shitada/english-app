import { useState, useEffect, useCallback } from 'react';
import { Volume2, Check, X, ArrowRight, Zap, Mic, SkipForward, RotateCcw } from 'lucide-react';
import { api, type QuizQuestion, type FillBlankQuestion, type SentenceBuildExercise, type SentenceCraftWord, type SentenceCraftResult, type TiersResponse, type EtymologyInfo, getSentenceBuildExercises, checkSentenceBuild, getSentenceCraftWords, evaluateSentenceCraft, getVocabularyTiers, getWordEtymology } from '../api';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import VocabSRSProgress, { type SRSChange } from '../components/VocabSRSProgress';
import VocabDrillMode from '../components/VocabDrillMode';
import VocabFlashcardMode from '../components/VocabFlashcardMode';
import VocabSpeakRecallMode from '../components/VocabSpeakRecallMode';
import VocabContextListenDrill from '../components/VocabContextListenDrill';
import VocabSpellingBee from '../components/VocabSpellingBee';
import InlineErrorBanner from '../components/InlineErrorBanner';

const TOPIC_EMOJIS: Record<string, string> = {
  hotel_checkin: '🏨',
  restaurant_order: '🍽️',
  job_interview: '💼',
  doctor_visit: '🏥',
  shopping: '🛍️',
  airport: '✈️',
};

export default function Vocabulary() {
  const [phase, setPhase] = useState<'select' | 'quiz' | 'result' | 'drill' | 'sentence-build' | 'sentence-build-result' | 'sentence-craft' | 'sentence-craft-result' | 'tiers' | 'word-pronunciation' | 'word-pronunciation-result' | 'flashcard' | 'speak-recall' | 'context-listen' | 'spelling-bee'>('select');
  const [questions, setQuestions] = useState<(QuizQuestion | FillBlankQuestion)[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [quizMode, setQuizMode] = useState<'word-to-meaning' | 'meaning-to-word' | 'fill-blank' | 'sentence-build' | 'sentence-craft' | 'audio-quiz'>('word-to-meaning');
  const [topics, setTopics] = useState<{ id: string; label: string; description: string }[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [fillBlankInput, setFillBlankInput] = useState('');
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [srsChanges, setSrsChanges] = useState<SRSChange[]>([]);
  const [etymologyMap, setEtymologyMap] = useState<Record<number, EtymologyInfo | 'loading'>>({});
  const [expandedEtymology, setExpandedEtymology] = useState<number | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Drill mode state
  const [drillWords, setDrillWords] = useState<{ id: number; word: string; meaning: string; topic: string; difficulty: number }[]>([]);

  // Flashcard review state
  const [fcWords, setFcWords] = useState<{ id: number; word: string; meaning: string; topic: string; difficulty: number }[]>([]);
  const [fcReverse, setFcReverse] = useState(false);

  // Sentence build state
  const [sbExercises, setSbExercises] = useState<SentenceBuildExercise[]>([]);
  const [sbIndex, setSbIndex] = useState(0);
  const [sbBank, setSbBank] = useState<string[]>([]);
  const [sbBuilt, setSbBuilt] = useState<string[]>([]);
  const [sbResults, setSbResults] = useState<{ correct: boolean; correctSentence: string }[]>([]);
  const [sbRevealed, setSbRevealed] = useState(false);
  const [sbCorrect, setSbCorrect] = useState<boolean | null>(null);

  const [craftWords, setCraftWords] = useState<SentenceCraftWord[]>([]);
  const [craftSentence, setCraftSentence] = useState('');
  const [craftResult, setCraftResult] = useState<SentenceCraftResult | null>(null);
  const [craftLoading, setCraftLoading] = useState(false);

  // Tiers state
  const [tiersData, setTiersData] = useState<TiersResponse | null>(null);
  const [tiersLoading, setTiersLoading] = useState(false);
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(new Set(['struggling', 'learning']));

  // Word pronunciation practice state
  const [pronWords, setPronWords] = useState<{ id: number; word: string; meaning: string; topic: string; difficulty: number }[]>([]);
  const [pronIndex, setPronIndex] = useState(0);
  const [pronResults, setPronResults] = useState<{ word: string; matched: boolean; skipped: boolean }[]>([]);
  const [pronChecked, setPronChecked] = useState(false);

  // Speak from memory state
  const [srWords, setSrWords] = useState<{ id: number; word: string; meaning: string; topic: string; difficulty: number }[]>([]);
  const [clWords, setClWords] = useState<{ id: number; word: string; meaning: string; topic: string; difficulty: number; example_sentence: string }[]>([]);
  const [sbWords, setSbWords] = useState<{ id: number; word: string; meaning: string; topic: string; difficulty: number }[]>([]);

  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition({ lang: 'en-US' });

  // Fetch topics from API
  useEffect(() => {
    api.getVocabularyTopics()
      .then((data) => setTopics(data))
      .catch(() => {})
      .finally(() => setTopicsLoading(false));
  }, []);

  const startQuiz = async (topicId: string) => {
    setLoading(true);
    setSrsChanges([]);
    try {
      // Sentence build mode uses a different endpoint
      if (quizMode === 'sentence-build') {
        const res = await getSentenceBuildExercises(topicId, 8);
        if (!res.exercises || res.exercises.length === 0) {
          setInlineError('No sentence exercises available for this topic. Try another topic.');
          return;
        }
        setSbExercises(res.exercises);
        setSbIndex(0);
        setSbResults([]);
        setSbBank([...res.exercises[0].scrambled_words]);
        setSbBuilt([]);
        setSbRevealed(false);
        setSbCorrect(null);
        setPhase('sentence-build');
        return;
      }
      if (quizMode === 'sentence-craft') {
        const res = await getSentenceCraftWords(topicId, 3);
        if (!res.words || res.words.length === 0) {
          setInlineError('No vocabulary words available for this topic. Try another topic.');
          return;
        }
        setCraftWords(res.words);
        setCraftSentence('');
        setCraftResult(null);
        setPhase('sentence-craft');
        return;
      }
      const apiMode = quizMode === 'fill-blank' ? 'fill_blank' : 'multiple_choice';
      const res = await api.generateQuiz(topicId, 10, apiMode);
      if (!res.questions || res.questions.length === 0) {
        setInlineError('No questions generated. Try again.');
        return;
      }
      // Cache for offline use
      try {
        localStorage.setItem(`vocab-quiz-cache-${topicId}-${apiMode}`, JSON.stringify(res));
      } catch { /* quota exceeded — ignore */ }
      setQuestions(res.questions);
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedAnswer(null);
      setRevealed(false);
      setFillBlankInput('');
      setIsOfflineMode(false);
      setPhase('quiz');
    } catch (err) {
      console.error(err);
      // Try loading from cache
      const apiMode = quizMode === 'fill-blank' ? 'fill_blank' : 'multiple_choice';
      const cached = localStorage.getItem(`vocab-quiz-cache-${topicId}-${apiMode}`);
      if (cached) {
        try {
          const res = JSON.parse(cached);
          if (res.questions?.length > 0) {
            setQuestions(res.questions);
            setCurrentIndex(0);
            setAnswers([]);
            setSelectedAnswer(null);
            setRevealed(false);
            setFillBlankInput('');
            setIsOfflineMode(true);
            setPhase('quiz');
            return;
          }
        } catch { /* invalid cache */ }
      }
      setInlineError('Failed to generate quiz. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const currentQ = questions[currentIndex];

  const selectAnswer = async (answer: string) => {
    if (revealed) return;

    const mcQ = currentQ as QuizQuestion;
    const correctMeaning = mcQ?.correct_meaning || mcQ?.meaning || '';
    const isCorrect = quizMode === 'word-to-meaning' || quizMode === 'audio-quiz'
      ? answer === correctMeaning
      : answer === mcQ?.word;

    setSelectedAnswer(answer);
    setRevealed(true);
    setAnswers((prev) => [...prev, isCorrect]);

    // Voice feedback
    if (isCorrect) {
      tts.speak(`Correct! ${mcQ.word} means ${correctMeaning}.`);
    } else {
      tts.speak(`Incorrect. ${mcQ.word} means ${correctMeaning}.`);
    }

    // Submit to backend if word has an ID
    if (mcQ?.id) {
      api.submitAnswer(mcQ.id, isCorrect).then(res => {
        setSrsChanges(prev => [...prev, { word: mcQ.word, newLevel: res.new_level, isCorrect, nextReview: res.next_review }]);
      }).catch(() => {});
    }
  };

  const submitFillBlank = async () => {
    if (revealed) return;
    const fbQ = currentQ as FillBlankQuestion;
    const userAnswer = fillBlankInput.trim().toLowerCase();
    const correctAnswer = fbQ.answer.toLowerCase();
    const isCorrect = userAnswer === correctAnswer;

    setSelectedAnswer(fillBlankInput);
    setRevealed(true);
    setAnswers((prev) => [...prev, isCorrect]);

    if (isCorrect) {
      tts.speak(`Correct! The word is ${fbQ.answer}.`);
    } else {
      tts.speak(`Incorrect. The correct word is ${fbQ.answer}.`);
    }

    if (fbQ?.id) {
      api.submitAnswer(fbQ.id, isCorrect).then(res => {
        setSrsChanges(prev => [...prev, { word: fbQ.answer, newLevel: res.new_level, isCorrect, nextReview: res.next_review }]);
      }).catch(() => {});
    }
  };

  const nextQuestion = () => {
    if (currentIndex + 1 >= questions.length) {
      setPhase('result');
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setRevealed(false);
      setFillBlankInput('');
    }
  };

  // Drill mode functions
  const startDrill = async () => {
    setLoading(true);
    setSrsChanges([]);
    try {
      const res = await api.getDrillWords(10);
      if (!res.words || res.words.length === 0) {
        setInlineError('No vocabulary words available for drill. Add words via a topic quiz first.');
        return;
      }
      setDrillWords(res.words);
      setPhase('drill');
      tts.speak(res.words[0].word);
    } catch (err) {
      console.error(err);
      setInlineError('Failed to start drill. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const openTiers = async () => {
    setTiersLoading(true);
    try {
      const data = await getVocabularyTiers();
      setTiersData(data);
      setPhase('tiers');
    } catch (err) {
      console.error(err);
      setInlineError('Failed to load word tiers.');
    } finally {
      setTiersLoading(false);
    }
  };

  const toggleTier = (tier: string) => {
    setExpandedTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };


  // Auto-play TTS for audio quiz mode
  useEffect(() => {
    if (quizMode === 'audio-quiz' && phase === 'quiz' && currentQ) {
      tts.speak((currentQ as QuizQuestion).word);
    }
  }, [currentIndex, quizMode, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const getOptions = () => {
    if (!currentQ || quizMode === 'fill-blank') return [];
    const mcQ = currentQ as QuizQuestion;
    if (quizMode === 'word-to-meaning' || quizMode === 'audio-quiz') {
      const correct = mcQ.correct_meaning || mcQ.meaning;
      const wrong = mcQ.wrong_options || [];
      const all = [correct, ...wrong];
      return all.sort((a, b) => {
        const hashA = a.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const hashB = b.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        return hashA - hashB;
      });
    } else {
      const correctWord = mcQ.word;
      const otherWords = (questions as QuizQuestion[])
        .filter((q) => q.word !== correctWord)
        .map((q) => q.word)
        .slice(0, 3);
      const all = [correctWord, ...otherWords];
      return all.sort((a, b) => {
        const hashA = a.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const hashB = b.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        return hashA - hashB;
      });
    }
  };

  const correctAnswer = quizMode === 'fill-blank'
    ? (currentQ as FillBlankQuestion)?.answer || ''
    : quizMode === 'word-to-meaning' || quizMode === 'audio-quiz'
    ? ((currentQ as QuizQuestion)?.correct_meaning || (currentQ as QuizQuestion)?.meaning || '')
    : ((currentQ as QuizQuestion)?.word || '');

  // Keyboard shortcuts for multiple-choice quiz modes
  const isMcQuiz = phase === 'quiz' && questions.length > 0 &&
    (quizMode === 'word-to-meaning' || quizMode === 'meaning-to-word' || quizMode === 'audio-quiz');
  useKeyboardShortcuts([
    { key: '1', handler: () => { if (!revealed) { const opts = getOptions(); if (opts.length > 0) selectAnswer(opts[0]); } }, enabled: isMcQuiz },
    { key: '2', handler: () => { if (!revealed) { const opts = getOptions(); if (opts.length > 1) selectAnswer(opts[1]); } }, enabled: isMcQuiz },
    { key: '3', handler: () => { if (!revealed) { const opts = getOptions(); if (opts.length > 2) selectAnswer(opts[2]); } }, enabled: isMcQuiz },
    { key: '4', handler: () => { if (!revealed) { const opts = getOptions(); if (opts.length > 3) selectAnswer(opts[3]); } }, enabled: isMcQuiz },
    { key: 'Enter', handler: () => { if (revealed) nextQuestion(); }, enabled: isMcQuiz },
    { key: ' ', handler: () => { if (currentQ) tts.speak((currentQ as QuizQuestion).word); }, enabled: isMcQuiz },
    { key: 'Escape', handler: () => { setPhase('select'); setIsOfflineMode(false); }, enabled: isMcQuiz },
  ]);

  // Topic selection
  if (phase === 'select') {
    return (
      <div>
        <InlineErrorBanner error={inlineError} onDismiss={() => setInlineError(null)} />
        <h2 style={{ marginBottom: 8 }}>Vocabulary</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Learn words and phrases used in real-life scenarios. Click any word to hear its pronunciation.
        </p>

        <button
          onClick={startDrill}
          disabled={loading || topicsLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '14px 20px', marginBottom: 20, borderRadius: 12, cursor: 'pointer',
            border: '2px solid #f59e0b', background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
            color: '#92400e', fontWeight: 600, fontSize: '1rem',
          }}
          aria-label="Start quick drill"
        >
          <Zap size={20} /> ⚡ Quick Drill — 10 words in 60 seconds
        </button>

        <div style={{ marginBottom: 20 }}>
          <button
            onClick={async () => {
              setLoading(true);
              try {
                const data = await api.getDrillWords(10);
                if (!data.words || data.words.length === 0) {
                  setInlineError('No vocabulary words available for flashcard review. Add words via a topic quiz first.');
                  return;
                }
                setFcWords(data.words.slice(0, 10));
                setPhase('flashcard');
              } catch {
                setInlineError('Failed to load words for flashcard review.');
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading || topicsLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '14px 20px', borderRadius: '12px 12px 0 0', cursor: 'pointer',
              border: '2px solid #06b6d4', borderBottom: '1px solid #06b6d4',
              background: 'linear-gradient(135deg, #ecfeff, #cffafe)',
              color: '#155e75', fontWeight: 600, fontSize: '1rem',
            }}
            aria-label="Start flashcard review"
          >
            🃏 Flashcard Review — self-paced active recall
          </button>
          <div
            style={{
              display: 'flex', borderRadius: '0 0 12px 12px',
              border: '2px solid #06b6d4', borderTop: 'none',
              overflow: 'hidden',
            }}
            role="group"
            aria-label="Flashcard direction"
          >
            <button
              onClick={() => setFcReverse(false)}
              style={{
                flex: 1, padding: '8px 12px', cursor: 'pointer', border: 'none',
                background: !fcReverse ? '#06b6d4' : 'var(--surface)',
                color: !fcReverse ? '#fff' : 'var(--text-secondary)',
                fontWeight: 600, fontSize: '0.85rem',
                transition: 'background 0.2s, color 0.2s',
              }}
              aria-label="Word to Meaning direction"
              aria-pressed={!fcReverse}
            >
              Word → Meaning
            </button>
            <button
              onClick={() => setFcReverse(true)}
              style={{
                flex: 1, padding: '8px 12px', cursor: 'pointer',
                border: 'none', borderLeft: '1px solid #06b6d4',
                background: fcReverse ? '#06b6d4' : 'var(--surface)',
                color: fcReverse ? '#fff' : 'var(--text-secondary)',
                fontWeight: 600, fontSize: '0.85rem',
                transition: 'background 0.2s, color 0.2s',
              }}
              aria-label="Meaning to Word direction"
              aria-pressed={fcReverse}
            >
              Meaning → Word
            </button>
          </div>
        </div>

        <button
          onClick={openTiers}
          disabled={loading || topicsLoading || tiersLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '14px 20px', marginBottom: 20, borderRadius: 12, cursor: 'pointer',
            border: '2px solid #8b5cf6', background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
            color: '#5b21b6', fontWeight: 600, fontSize: '1rem',
          }}
          aria-label="View word tiers"
        >
          📊 Word Tiers — see your mastery levels
        </button>

        <button
          onClick={async () => {
            setLoading(true);
            try {
              const data = await api.getDrillWords(10);
              if (!data.words || data.words.length === 0) {
                setInlineError('No vocabulary words available for pronunciation practice. Add words via a topic quiz first.');
                return;
              }
              setPronWords(data.words.slice(0, 10));
              setPronIndex(0);
              setPronResults([]);
              setPronChecked(false);
              speech.reset();
              setPhase('word-pronunciation');
            } catch {
              setInlineError('Failed to load words for pronunciation practice.');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || topicsLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '14px 20px', marginBottom: 20, borderRadius: 12, cursor: 'pointer',
            border: '2px solid #06b6d4', background: 'linear-gradient(135deg, #cffafe, #a5f3fc)',
            color: '#155e75', fontWeight: 600, fontSize: '1rem',
          }}
          aria-label="Start pronunciation practice"
        >
          <Mic size={20} /> 🎤 Listen &amp; Repeat — practice word pronunciation
        </button>

        <button
          onClick={async () => {
            setLoading(true);
            try {
              const data = await api.getDrillWords(10);
              if (!data.words || data.words.length === 0) {
                setInlineError('No vocabulary words available for speak recall. Add words via a topic quiz first.');
                return;
              }
              setSrWords(data.words.slice(0, 10));
              speech.reset();
              setPhase('speak-recall');
            } catch {
              setInlineError('Failed to load words for speak recall.');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || topicsLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '14px 20px', marginBottom: 20, borderRadius: 12, cursor: 'pointer',
            border: '2px solid #10b981', background: 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
            color: '#065f46', fontWeight: 600, fontSize: '1rem',
          }}
          aria-label="Start speak from memory"
        >
          🧠 Speak from Memory — say the word from its meaning
        </button>

        <button
          onClick={async () => {
            setLoading(true);
            try {
              const data = await api.getDrillWords(10);
              const withSentence = data.words.filter(w => w.example_sentence && w.example_sentence.trim());
              if (withSentence.length === 0) {
                setInlineError('No vocabulary words with example sentences available. Try a topic quiz first.');
                return;
              }
              setClWords(withSentence.slice(0, 10));
              setPhase('context-listen');
            } catch {
              setInlineError('Failed to load words for context listening.');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || topicsLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '14px 20px', marginBottom: 20, borderRadius: 12, cursor: 'pointer',
            border: '2px solid #7c3aed', background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
            color: '#5b21b6', fontWeight: 600, fontSize: '1rem',
          }}
          aria-label="Start context listening drill"
        >
          🎧 Context Listening — hear sentences, find the word
        </button>

        <button
          onClick={async () => {
            setLoading(true);
            try {
              const data = await api.getDrillWords(10);
              if (!data.words || data.words.length === 0) {
                setInlineError('No vocabulary words available for spelling bee. Add words via a topic quiz first.');
                return;
              }
              setSbWords(data.words.slice(0, 10));
              setPhase('spelling-bee');
            } catch {
              setInlineError('Failed to load words for spelling bee.');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || topicsLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '14px 20px', marginBottom: 20, borderRadius: 12, cursor: 'pointer',
            border: '2px solid #f59e0b', background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
            color: '#92400e', fontWeight: 600, fontSize: '1rem',
          }}
          aria-label="Start spelling bee"
        >
          🐝 Spelling Bee — hear and spell the word
        </button>

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8, fontSize: '1rem' }}>Quiz Mode</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setQuizMode('word-to-meaning')}
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem',
                border: quizMode === 'word-to-meaning' ? '2px solid var(--primary)' : '2px solid var(--border)',
                background: quizMode === 'word-to-meaning' ? 'var(--primary)' : 'transparent',
                color: quizMode === 'word-to-meaning' ? 'white' : 'var(--text)',
              }}
            >
              Word → Meaning
            </button>
            <button
              onClick={() => setQuizMode('meaning-to-word')}
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem',
                border: quizMode === 'meaning-to-word' ? '2px solid var(--primary)' : '2px solid var(--border)',
                background: quizMode === 'meaning-to-word' ? 'var(--primary)' : 'transparent',
                color: quizMode === 'meaning-to-word' ? 'white' : 'var(--text)',
              }}
            >
              Meaning → Word
            </button>
            <button
              onClick={() => setQuizMode('fill-blank')}
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem',
                border: quizMode === 'fill-blank' ? '2px solid var(--primary)' : '2px solid var(--border)',
                background: quizMode === 'fill-blank' ? 'var(--primary)' : 'transparent',
                color: quizMode === 'fill-blank' ? 'white' : 'var(--text)',
              }}
            >
              Fill in Blank
            </button>
            <button
              onClick={() => setQuizMode('sentence-build')}
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem',
                border: quizMode === 'sentence-build' ? '2px solid var(--primary)' : '2px solid var(--border)',
                background: quizMode === 'sentence-build' ? 'var(--primary)' : 'transparent',
                color: quizMode === 'sentence-build' ? 'white' : 'var(--text)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              🧩 Sentence Build
            </button>
            <button
              onClick={() => setQuizMode('sentence-craft')}
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem',
                border: quizMode === 'sentence-craft' ? '2px solid var(--primary)' : '2px solid var(--border)',
                background: quizMode === 'sentence-craft' ? 'var(--primary)' : 'transparent',
                color: quizMode === 'sentence-craft' ? 'white' : 'var(--text)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              ✍️ Sentence Craft
            </button>
            <button
              onClick={() => setQuizMode('audio-quiz')}
              style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem',
                border: quizMode === 'audio-quiz' ? '2px solid var(--primary)' : '2px solid var(--border)',
                background: quizMode === 'audio-quiz' ? 'var(--primary)' : 'transparent',
                color: quizMode === 'audio-quiz' ? 'white' : 'var(--text)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              🎧 Audio Quiz
            </button>
          </div>
        </div>

        {loading || topicsLoading ? (
          <div className="topic-grid">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton skeleton-card" style={{ height: 100 }} />
            ))}
          </div>
        ) : (
          <div className="topic-grid">
            {topics.map((topic) => (
              <button
                key={topic.id}
                className="topic-card"
                onClick={() => startQuiz(topic.id)}
              >
                <h3>{TOPIC_EMOJIS[topic.id] || '📚'} {topic.label}</h3>
                <p>{topic.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Drill mode
  if (phase === 'drill') {
    return (
      <VocabDrillMode
        initialWords={drillWords}
        tts={tts}
        onBack={() => { setPhase('select'); setIsOfflineMode(false); }}
      />
    );
  }

  // Flashcard review
  if (phase === 'flashcard') {
    return (
      <VocabFlashcardMode
        initialWords={fcWords}
        tts={tts}
        onBack={() => { setPhase('select'); setIsOfflineMode(false); }}
        reverse={fcReverse}
      />
    );
  }

  // Speak from memory
  if (phase === 'speak-recall') {
    return (
      <VocabSpeakRecallMode
        initialWords={srWords}
        speech={speech}
        onBack={() => { setPhase('select'); setIsOfflineMode(false); }}
      />
    );
  }

  if (phase === 'context-listen') {
    return (
      <VocabContextListenDrill
        initialWords={clWords}
        onBack={() => { setPhase('select'); setIsOfflineMode(false); }}
      />
    );
  }

  if (phase === 'spelling-bee') {
    return (
      <VocabSpellingBee
        initialWords={sbWords}
        onBack={() => { setPhase('select'); setIsOfflineMode(false); }}
      />
    );
  }

  // Quiz result
  if (phase === 'result') {
    const correct = answers.filter(Boolean).length;
    const total = answers.length;
    const pct = Math.round((correct / total) * 100);

    return (
      <div className="card summary-card">
        <h2 style={{ marginBottom: 16 }}>Quiz Complete!</h2>

        <div className={`score-circle ${pct >= 80 ? 'score-high' : pct >= 50 ? 'score-mid' : 'score-low'}`}>
          {pct}%
        </div>

        <p style={{ fontSize: 18, marginBottom: 8 }}>
          {correct} / {total} correct
        </p>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          {pct >= 80 ? 'Excellent work!' : pct >= 50 ? 'Good effort! Keep practicing.' : 'Keep studying! You\'ll improve.'}
        </p>

        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 8 }}>Words Reviewed</h4>
          <div className="vocab-tags">
            {questions.map((q, i) => {
              const displayWord = 'word' in q ? q.word : (q as FillBlankQuestion).answer;
              const wordId = q.id;
              return (
              <span
                key={i}
                style={{
                  cursor: 'pointer',
                  background: answers[i] ? 'var(--success-bg)' : 'var(--danger-bg)',
                  color: answers[i] ? 'var(--success-text-vivid)' : 'var(--danger-text-vivid)',
                }}
                onClick={() => {
                  if (expandedEtymology === wordId) {
                    setExpandedEtymology(null);
                    return;
                  }
                  setExpandedEtymology(wordId);
                  if (!etymologyMap[wordId]) {
                    setEtymologyMap(prev => ({ ...prev, [wordId]: 'loading' }));
                    getWordEtymology(wordId)
                      .then(r => setEtymologyMap(prev => ({ ...prev, [wordId]: r.etymology })))
                      .catch(() => setEtymologyMap(prev => ({ ...prev, [wordId]: { origin_language: '?', root_words: displayWord, evolution: 'Could not load.', fun_fact: '' } })));
                  }
                }}
                title="Click for word origin"
              >
                {answers[i] ? '✓' : '✗'} {displayWord} 📜
              </span>
              );
            })}
          </div>
          {expandedEtymology !== null && etymologyMap[expandedEtymology] && (
            <div className="card" style={{ marginTop: 8, padding: '10px 14px', fontSize: '0.85rem' }}>
              {etymologyMap[expandedEtymology] === 'loading' ? (
                <span>⏳ Loading etymology...</span>
              ) : (
                (() => {
                  const ety = etymologyMap[expandedEtymology] as EtymologyInfo;
                  return (
                    <>
                      <strong>Origin:</strong> {ety.origin_language} &middot; <strong>Root:</strong> {ety.root_words}
                      <div style={{ marginTop: 4 }}>{ety.evolution}</div>
                      {ety.fun_fact && <div style={{ marginTop: 4, color: 'var(--text-secondary, #666)' }}>💡 {ety.fun_fact}</div>}
                    </>
                  );
                })()
              )}
            </div>
          )}
        </div>

        <VocabSRSProgress changes={srsChanges} />

        <button className="btn btn-primary" onClick={() => { setPhase('select'); setIsOfflineMode(false); }} style={{ marginTop: 16 }}>
          Try Another Topic
        </button>
      </div>
    );
  }

  // Sentence Build phase
  if (phase === 'sentence-build' && sbExercises.length > 0) {
    const exercise = sbExercises[sbIndex];
    const progress = `${sbIndex + 1}/${sbExercises.length}`;

    const addWord = (word: string, idx: number) => {
      if (sbRevealed) return;
      setSbBuilt(prev => [...prev, word]);
      setSbBank(prev => prev.filter((_, i) => i !== idx));
    };

    const removeWord = (idx: number) => {
      if (sbRevealed) return;
      const word = sbBuilt[idx];
      setSbBuilt(prev => prev.filter((_, i) => i !== idx));
      setSbBank(prev => [...prev, word]);
    };

    const handleCheck = async () => {
      const sentence = sbBuilt.join(' ');
      try {
        const res = await checkSentenceBuild(exercise.word_id, sentence);
        setSbCorrect(res.is_correct);
        setSbRevealed(true);
        setSbResults(prev => [...prev, { correct: res.is_correct, correctSentence: res.correct_sentence }]);
      } catch {
        setInlineError('Failed to check sentence.');
      }
    };

    const handleNext = () => {
      const nextIdx = sbIndex + 1;
      if (nextIdx >= sbExercises.length) {
        setPhase('sentence-build-result');
        return;
      }
      setSbIndex(nextIdx);
      setSbBank([...sbExercises[nextIdx].scrambled_words]);
      setSbBuilt([]);
      setSbRevealed(false);
      setSbCorrect(null);
    };

    return (
      <div className="card">
        <InlineErrorBanner error={inlineError} onDismiss={() => setInlineError(null)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3>🧩 Sentence Build</h3>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{progress}</span>
        </div>

        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>
          Arrange the words to form a correct sentence for: <strong>{exercise.hint_word}</strong>
        </p>

        {/* Built sentence area */}
        <div style={{
          minHeight: 50, padding: 12, marginBottom: 12, borderRadius: 8,
          border: sbRevealed ? (sbCorrect ? '2px solid #22c55e' : '2px solid #ef4444') : '2px dashed var(--border)',
          background: sbRevealed ? (sbCorrect ? '#f0fdf4' : '#fef2f2') : 'transparent',
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        }}>
          {sbBuilt.length === 0 && !sbRevealed && (
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Tap words below to build the sentence...</span>
          )}
          {sbBuilt.map((w, i) => (
            <button key={i} onClick={() => removeWord(i)} disabled={sbRevealed}
              style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--primary)', color: 'white', cursor: sbRevealed ? 'default' : 'pointer',
                fontSize: 15,
              }}
            >{w}</button>
          ))}
        </div>

        {sbRevealed && !sbCorrect && (
          <p style={{ fontSize: 13, color: '#15803d', marginBottom: 8 }}>
            Correct: <strong>{exercise.correct_sentence}</strong>
          </p>
        )}

        {/* Word bank */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16, justifyContent: 'center' }}>
          {sbBank.map((w, i) => (
            <button key={i} onClick={() => addWord(w, i)} disabled={sbRevealed}
              style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--bg-secondary, #f3f4f6)', cursor: sbRevealed ? 'default' : 'pointer',
                fontSize: 15,
              }}
            >{w}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={() => setPhase('select')}>Quit</button>
          {!sbRevealed && sbBuilt.length > 0 && (
            <button className="btn btn-primary" onClick={handleCheck}>Check</button>
          )}
          {sbRevealed && (
            <>
              <button className="btn btn-secondary" onClick={() => tts.speak(exercise.correct_sentence)}>
                <Volume2 size={16} /> Listen
              </button>
              <button className="btn btn-primary" onClick={handleNext}>
                {sbIndex + 1 >= sbExercises.length ? 'See Results' : 'Next'} <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Sentence Build results
  if (phase === 'sentence-build-result') {
    const correct = sbResults.filter(r => r.correct).length;
    const total = sbResults.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h3 style={{ marginBottom: 16 }}>Sentence Build Results</h3>
        <div className={`score-circle ${pct >= 80 ? 'score-high' : pct >= 50 ? 'score-mid' : 'score-low'}`} style={{ margin: '0 auto 16px' }}>
          {pct}%
        </div>
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{correct} / {total} correct</p>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          {pct >= 80 ? 'Great sentence building!' : pct >= 50 ? 'Good effort!' : 'Keep practicing word order!'}
        </p>

        <div style={{ marginBottom: 24, textAlign: 'left' }}>
          {sbResults.map((r, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{r.correct ? '✅' : '❌'}</span>
              <span style={{ fontSize: 14 }}>{r.correctSentence}</span>
            </div>
          ))}
        </div>

        <button className="btn btn-primary" onClick={() => setPhase('select')}>
          Try Another Topic
        </button>
      </div>
    );
  }

  if (phase === 'sentence-craft' && craftWords.length > 0) {
    return (
      <div className="card">
        <InlineErrorBanner error={inlineError} onDismiss={() => setInlineError(null)} />
        <h3 style={{ marginBottom: 8, textAlign: 'center' }}>✍️ Sentence Craft</h3>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
          Write a sentence using all of these words:
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
          {craftWords.map((w) => (
            <div key={w.id} style={{ padding: '8px 16px', background: 'var(--primary)', color: 'white', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{w.word}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{w.meaning}</div>
            </div>
          ))}
        </div>
        <textarea
          value={craftSentence}
          onChange={(e) => setCraftSentence(e.target.value)}
          placeholder="Write a sentence using all the words above…"
          rows={3}
          style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--border)', fontSize: 16, marginBottom: 16, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            className="btn btn-primary"
            disabled={craftLoading || craftSentence.trim().length === 0}
            onClick={async () => {
              setCraftLoading(true);
              try {
                const res = await evaluateSentenceCraft(craftWords.map(w => w.id), craftSentence);
                setCraftResult(res);
                setPhase('sentence-craft-result');
              } catch (err) { console.error('Evaluation failed:', err); setInlineError('Evaluation failed. Please try again.'); }
              finally { setCraftLoading(false); }
            }}
          >
            {craftLoading ? 'Evaluating…' : '✓ Submit'}
          </button>
          <button className="btn btn-secondary" onClick={() => setPhase('select')}>← Back</button>
        </div>
      </div>
    );
  }

  if (phase === 'sentence-craft-result' && craftResult) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 16, textAlign: 'center' }}>✍️ Sentence Craft Results</h3>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: craftResult.grammar_score >= 7 ? 'var(--success, #4caf50)' : 'var(--warning, #ff9800)' }}>{craftResult.grammar_score}/10</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Grammar</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: craftResult.naturalness_score >= 7 ? 'var(--success, #4caf50)' : 'var(--warning, #ff9800)' }}>{craftResult.naturalness_score}/10</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Naturalness</div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Word Usage</h4>
          {craftResult.word_usage.map((wu, i) => (
            <div key={i} style={{ padding: 8, marginBottom: 4, borderRadius: 6, background: wu.used_correctly ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)' }}>
              <span style={{ fontWeight: 600 }}>{wu.used_correctly ? '✅' : '❌'} {wu.word}</span>
              <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: 14 }}>{wu.feedback}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: 12, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, marginBottom: 16 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Your sentence:</p>
          <p style={{ fontStyle: 'italic' }}>{craftSentence}</p>
        </div>

        {craftResult.model_sentence && (
          <div style={{ padding: 12, background: 'rgba(76,175,80,0.1)', borderRadius: 8, marginBottom: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Model sentence:</p>
            <p style={{ fontStyle: 'italic' }}>{craftResult.model_sentence}</p>
          </div>
        )}

        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>{craftResult.overall_feedback}</p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => { setCraftSentence(''); setCraftResult(null); setPhase('sentence-craft'); }}>Try Again</button>
          <button className="btn btn-secondary" onClick={() => setPhase('select')}>← Back to Topics</button>
        </div>
      </div>
    );
  }

  // Tiers view
  if (phase === 'tiers' && tiersData) {
    const tierConfig: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
      struggling: { label: 'Struggling', color: '#dc2626', bg: '#fef2f2', emoji: '🔴' },
      learning:   { label: 'Learning',   color: '#f59e0b', bg: '#fffbeb', emoji: '🟠' },
      familiar:   { label: 'Familiar',   color: '#3b82f6', bg: '#eff6ff', emoji: '🔵' },
      mastered:   { label: 'Mastered',   color: '#16a34a', bg: '#f0fdf4', emoji: '🟢' },
      new:        { label: 'New',        color: '#6b7280', bg: '#f9fafb', emoji: '⚪' },
    };
    const totalWords = Object.values(tiersData.counts).reduce((a, b) => a + b, 0);
    return (
      <div>
        <h2 style={{ marginBottom: 8 }}>📊 Word Tiers</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
          {totalWords} words across {Object.values(tiersData.counts).filter(c => c > 0).length} tiers
        </p>
        <button className="btn" onClick={() => setPhase('select')} style={{ marginBottom: 20 }}>
          ← Back to Topics
        </button>
        {Object.entries(tierConfig).map(([key, cfg]) => {
          const words = tiersData.tiers[key] || [];
          const count = tiersData.counts[key] || 0;
          const isOpen = expandedTiers.has(key);
          return (
            <div key={key} style={{ marginBottom: 12, borderRadius: 12, border: `2px solid ${cfg.color}22`, overflow: 'hidden' }}>
              <button
                onClick={() => toggleTier(key)}
                style={{
                  width: '100%', padding: '12px 16px', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between',
                  background: cfg.bg, border: 'none', fontSize: '1rem', fontWeight: 600, color: cfg.color,
                }}
                aria-expanded={isOpen}
                aria-label={`${cfg.label} tier, ${count} words`}
              >
                <span>{cfg.emoji} {cfg.label}</span>
                <span style={{
                  background: cfg.color, color: 'white', borderRadius: 20,
                  padding: '2px 10px', fontSize: '0.85rem',
                }}>{count}</span>
              </button>
              {isOpen && words.length > 0 && (
                <div style={{ padding: '8px 16px' }}>
                  {words.map(w => (
                    <div key={w.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <button
                        onClick={() => tts.speak(w.word)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                        aria-label={`Hear ${w.word}`}
                      >
                        <Volume2 size={16} />
                      </button>
                      <span style={{ fontWeight: 600, minWidth: 100 }}>{w.word}</span>
                      <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{w.meaning}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{w.topic}</span>
                      <span style={{
                        fontSize: '0.75rem', background: cfg.bg, color: cfg.color,
                        borderRadius: 6, padding: '2px 6px',
                      }}>Lv{w.level}</span>
                    </div>
                  ))}
                </div>
              )}
              {isOpen && words.length === 0 && (
                <p style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  No words in this tier yet.
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Word pronunciation practice
  if (phase === 'word-pronunciation' && pronWords.length > 0) {
    const w = pronWords[pronIndex];
    const matched = pronChecked && speech.transcript.trim().toLowerCase() === w.word.toLowerCase();

    const handleRecord = () => {
      if (speech.isListening) { speech.stop(); return; }
      setPronChecked(false);
      speech.reset();
      speech.start();
    };

    const handleCheck = () => {
      speech.stop();
      setPronChecked(true);
    };

    const advanceWord = (skipped: boolean) => {
      const result = { word: w.word, matched: !skipped && matched, skipped };
      const newResults = [...pronResults, result];
      setPronResults(newResults);
      if (pronIndex + 1 >= pronWords.length) {
        setPhase('word-pronunciation-result');
      } else {
        setPronIndex(pronIndex + 1);
        setPronChecked(false);
        speech.reset();
      }
    };

    return (
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2>🎤 Listen &amp; Repeat</h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{pronIndex + 1} / {pronWords.length}</span>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 4 }}>{w.word}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{w.meaning}</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => tts.speak(w.word)} disabled={tts.isSpeaking} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Volume2 size={18} /> Listen
          </button>
          <button
            className={`btn ${speech.isListening ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleRecord}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Mic size={18} /> {speech.isListening ? 'Stop' : 'Record'}
          </button>
          {speech.transcript && !pronChecked && (
            <button className="btn btn-primary" onClick={handleCheck} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={18} /> Check
            </button>
          )}
        </div>

        {speech.transcript && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>You said:</p>
            <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>&ldquo;{speech.transcript}&rdquo;</p>
          </div>
        )}

        {pronChecked && (
          <div style={{ textAlign: 'center', marginBottom: 16, padding: 16, background: matched ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 8 }}>
            {matched ? (
              <p style={{ color: 'var(--success, #22c55e)', fontWeight: 700, fontSize: '1.1rem' }}><Check size={20} style={{ verticalAlign: 'middle' }} /> Correct!</p>
            ) : (
              <p style={{ color: 'var(--danger, #ef4444)', fontWeight: 700, fontSize: '1.1rem' }}><X size={20} style={{ verticalAlign: 'middle' }} /> Expected &ldquo;{w.word}&rdquo;</p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          {pronChecked && !matched && (
            <button className="btn btn-secondary" onClick={() => { setPronChecked(false); speech.reset(); }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={16} /> Retry
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => advanceWord(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <SkipForward size={16} /> Skip
          </button>
          {pronChecked && (
            <button className="btn btn-primary" onClick={() => advanceWord(false)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {pronIndex + 1 >= pronWords.length ? 'See Results' : 'Next'} <ArrowRight size={16} />
            </button>
          )}
        </div>

        <button className="btn btn-secondary" onClick={() => setPhase('select')} style={{ marginTop: 16, fontSize: '0.85rem' }}>
          ← Back to Topics
        </button>
      </div>
    );
  }

  // Word pronunciation results
  if (phase === 'word-pronunciation-result') {
    const correct = pronResults.filter(r => r.matched).length;
    const skipped = pronResults.filter(r => r.skipped).length;
    const total = pronResults.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    return (
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 16 }}>🎤 Pronunciation Results</h2>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: pct >= 70 ? 'var(--success, #22c55e)' : pct >= 40 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)' }}>{pct}%</div>
          <p style={{ color: 'var(--text-secondary)' }}>{correct} correct, {skipped} skipped, {total - correct - skipped} missed</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {pronResults.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
              <span style={{ fontWeight: 600 }}>{r.word}</span>
              <span>
                {r.skipped ? <span style={{ color: 'var(--text-secondary)' }}>Skipped</span> : r.matched ? <Check size={16} color="var(--success, #22c55e)" /> : <X size={16} color="var(--danger, #ef4444)" />}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setPhase('select')}>Try Another Topic</button>
        </div>
      </div>
    );
  }

  // Quiz question
  if (!currentQ) return null;

  const offlineBanner = isOfflineMode ? (
    <div style={{ padding: '8px 12px', background: 'var(--warning-bg)', borderRadius: 8, marginBottom: 12, fontSize: '0.85rem', color: 'var(--warning-text-strong)', textAlign: 'center' }}>
      📴 Offline — practicing with cached questions
    </div>
  ) : null;

  // Fill-in-the-blank mode
  if (quizMode === 'fill-blank') {
    const fbQ = currentQ as FillBlankQuestion;
    return (
      <div className="card">
        {offlineBanner}
        <div className="quiz-progress">
          {questions.map((_, i) => (
            <div
              key={i}
              className={`quiz-progress-dot ${
                i < currentIndex ? (answers[i] ? 'done' : 'wrong') :
                i === currentIndex ? 'current' : ''
              }`}
            />
          ))}
        </div>

        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: 4, fontSize: 13 }}>
          Question {currentIndex + 1} of {questions.length}
        </p>

        <h3 style={{ textAlign: 'center', marginBottom: 8 }}>
          Type the missing word
        </h3>

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--primary)' }}>
            {fbQ.meaning}
          </span>
        </div>

        {fbQ.example_with_blank && (
          <p style={{
            textAlign: 'center', color: 'var(--text-secondary)', fontSize: 16,
            marginBottom: 8, fontStyle: 'italic',
          }}>
            &ldquo;{fbQ.example_with_blank}&rdquo;
          </p>
        )}

        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, marginBottom: 24 }}>
          Hint: starts with &ldquo;<strong>{fbQ.hint}</strong>&rdquo;
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
          <input
            type="text"
            value={fillBlankInput}
            onChange={(e) => setFillBlankInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !revealed) submitFillBlank(); }}
            disabled={revealed}
            placeholder="Type your answer..."
            style={{
              padding: '10px 16px', borderRadius: 8, fontSize: 16,
              border: revealed
                ? answers[answers.length - 1] ? '2px solid var(--success)' : '2px solid var(--danger)'
                : '2px solid var(--border)',
              outline: 'none', width: 250, textAlign: 'center',
            }}
            autoFocus
          />
          {!revealed && (
            <button className="btn btn-primary" onClick={submitFillBlank}>
              <Check size={16} /> Check
            </button>
          )}
        </div>

        {revealed && (
          <div style={{ textAlign: 'center', marginBottom: 16 }} role="status" aria-live="polite">
            <p style={{
              fontSize: 16, fontWeight: 600, marginBottom: 12,
              color: answers[answers.length - 1] ? 'var(--success)' : 'var(--danger)',
            }}>
              {answers[answers.length - 1] ? '✓ Correct!' : `✗ The answer is: ${fbQ.answer}`}
            </p>
            <button className="btn btn-primary" onClick={nextQuestion}>
              {currentIndex + 1 >= questions.length ? 'See Results' : 'Next'}
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Multiple choice mode
  const options = getOptions();

  return (
    <div className="card">
      {offlineBanner}
      {/* Progress bar */}
      <div className="quiz-progress">
        {questions.map((_, i) => (
          <div
            key={i}
            className={`quiz-progress-dot ${
              i < currentIndex ? (answers[i] ? 'done' : 'wrong') :
              i === currentIndex ? 'current' : ''
            }`}
          />
        ))}
      </div>

      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: 4, fontSize: 13 }}>
        Question {currentIndex + 1} of {questions.length}
      </p>

      <h3 style={{ textAlign: 'center', marginBottom: 8 }}>
        {quizMode === 'audio-quiz' ? 'Listen and select the meaning' : quizMode === 'word-to-meaning' ? 'What does this mean?' : 'Which word matches this meaning?'}
      </h3>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        {quizMode === 'audio-quiz' ? (
          <>
            <button
              onClick={() => tts.speak((currentQ as QuizQuestion).word)}
              style={{
                background: 'var(--primary)', border: 'none', borderRadius: '50%',
                width: 72, height: 72, cursor: 'pointer', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 32,
              }}
              aria-label="Play word audio"
              title="Click to hear the word"
            >
              🔊
            </button>
            {revealed && (
              <p style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>
                {(currentQ as QuizQuestion).word}
              </p>
            )}
          </>
        ) : (
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            cursor: 'pointer',
            color: 'var(--primary)',
          }}
          onClick={() => tts.speak((currentQ as QuizQuestion).word)}
          title="Click to hear pronunciation"
        >
          {quizMode === 'word-to-meaning' ? (currentQ as QuizQuestion).word : ((currentQ as QuizQuestion).correct_meaning || (currentQ as QuizQuestion).meaning)}
          <Volume2
            size={18}
            style={{ marginLeft: 8, verticalAlign: 'middle', opacity: 0.6 }}
          />
        </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <Volume2 size={14} color="var(--text-secondary)" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={tts.volume}
            onChange={(e) => tts.setVolume(parseFloat(e.target.value))}
            style={{ width: 100, accentColor: 'var(--primary)' }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 36, textAlign: 'right' }}>
            {Math.round(tts.volume * 100)}%
          </span>
        </div>
      </div>

      {(currentQ as QuizQuestion).example_sentence && (
        <p style={{
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: 14,
          marginBottom: 24,
          fontStyle: 'italic',
        }}>
          &quot;{(currentQ as QuizQuestion).example_sentence}&quot;
        </p>
      )}

      <div>
        {options.map((opt, i) => {
          let className = 'quiz-option';
          if (revealed) {
            if (opt === correctAnswer) className += ' correct';
            else if (opt === selectedAnswer) className += ' incorrect';
          } else if (opt === selectedAnswer) {
            className += ' selected';
          }

          return (
            <button
              key={i}
              className={className}
              onClick={() => selectAnswer(opt)}
              disabled={revealed}
              aria-label={`Answer option: ${opt}`}
            >
              {revealed && opt === correctAnswer && <Check size={16} style={{ marginRight: 8, color: 'var(--success)' }} />}
              {revealed && opt === selectedAnswer && opt !== correctAnswer && <X size={16} style={{ marginRight: 8, color: 'var(--danger)' }} />}
              {opt}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16, opacity: 0.7 }}>
        ⌨️ Press 1–{options.length} to select · Enter to advance · Space to replay · Esc to go back
      </p>

      {revealed && (
        <div style={{ textAlign: 'center', marginTop: 16 }} role="status" aria-live="polite">
          <button className="btn btn-primary" onClick={nextQuestion}>
            {currentIndex + 1 >= questions.length ? 'See Results' : 'Next'}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
