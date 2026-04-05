import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Check, X, ArrowRight, Zap } from 'lucide-react';
import { api, type QuizQuestion, type FillBlankQuestion } from '../api';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

const TOPIC_EMOJIS: Record<string, string> = {
  hotel_checkin: '🏨',
  restaurant_order: '🍽️',
  job_interview: '💼',
  doctor_visit: '🏥',
  shopping: '🛍️',
  airport: '✈️',
};

export default function Vocabulary() {
  const [phase, setPhase] = useState<'select' | 'quiz' | 'result' | 'drill' | 'drill-result'>('select');
  const [questions, setQuestions] = useState<(QuizQuestion | FillBlankQuestion)[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [quizMode, setQuizMode] = useState<'word-to-meaning' | 'meaning-to-word' | 'fill-blank'>('word-to-meaning');
  const [topics, setTopics] = useState<{ id: string; label: string; description: string }[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [fillBlankInput, setFillBlankInput] = useState('');
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // Drill mode state
  const [drillWords, setDrillWords] = useState<{ id: number; word: string; meaning: string; topic: string; difficulty: number }[]>([]);
  const [drillIndex, setDrillIndex] = useState(0);
  const [drillAnswers, setDrillAnswers] = useState<boolean[]>([]);
  const [drillTimeLeft, setDrillTimeLeft] = useState(60);
  const drillTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const tts = useSpeechSynthesis();

  // Fetch topics from API
  useEffect(() => {
    api.getVocabularyTopics()
      .then((data) => setTopics(data))
      .catch(() => {})
      .finally(() => setTopicsLoading(false));
  }, []);

  const startQuiz = async (topicId: string) => {
    setLoading(true);
    try {
      const apiMode = quizMode === 'fill-blank' ? 'fill_blank' : 'multiple_choice';
      const res = await api.generateQuiz(topicId, 10, apiMode);
      if (!res.questions || res.questions.length === 0) {
        alert('No questions generated. Try again.');
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
      alert('Failed to generate quiz. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const currentQ = questions[currentIndex];

  const selectAnswer = async (answer: string) => {
    if (revealed) return;

    const mcQ = currentQ as QuizQuestion;
    const correctMeaning = mcQ?.correct_meaning || mcQ?.meaning || '';
    const isCorrect = quizMode === 'word-to-meaning'
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
      api.submitAnswer(mcQ.id, isCorrect).catch(() => {});
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
      api.submitAnswer(fbQ.id, isCorrect).catch(() => {});
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
    try {
      const res = await api.getDrillWords(10);
      if (!res.words || res.words.length === 0) {
        alert('No vocabulary words available for drill. Add words via a topic quiz first.');
        return;
      }
      setDrillWords(res.words);
      setDrillIndex(0);
      setDrillAnswers([]);
      setDrillTimeLeft(60);
      setPhase('drill');
      tts.speak(res.words[0].word);
    } catch (err) {
      console.error(err);
      alert('Failed to start drill. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const drillAnswer = useCallback((known: boolean) => {
    const word = drillWords[drillIndex];
    if (!word) return;
    setDrillAnswers((prev) => [...prev, known]);
    api.submitAnswer(word.id, known).catch(() => {});

    const nextIdx = drillIndex + 1;
    if (nextIdx >= drillWords.length) {
      clearInterval(drillTimerRef.current);
      setPhase('drill-result');
    } else {
      setDrillIndex(nextIdx);
      tts.speak(drillWords[nextIdx].word);
    }
  }, [drillWords, drillIndex, tts]);

  // Drill timer
  useEffect(() => {
    if (phase !== 'drill') return;
    drillTimerRef.current = setInterval(() => {
      setDrillTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(drillTimerRef.current);
          setPhase('drill-result');
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(drillTimerRef.current);
  }, [phase]);

  const getOptions = () => {
    if (!currentQ || quizMode === 'fill-blank') return [];
    const mcQ = currentQ as QuizQuestion;
    if (quizMode === 'word-to-meaning') {
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
    : quizMode === 'word-to-meaning'
    ? ((currentQ as QuizQuestion)?.correct_meaning || (currentQ as QuizQuestion)?.meaning || '')
    : ((currentQ as QuizQuestion)?.word || '');

  // Topic selection
  if (phase === 'select') {
    return (
      <div>
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
    const currentDrillWord = drillWords[drillIndex];
    const progress = drillWords.length > 0 ? ((drillIndex) / drillWords.length) * 100 : 0;
    const timerPct = (drillTimeLeft / 60) * 100;

    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: drillTimeLeft <= 10 ? '#ef4444' : '#f59e0b', width: `${timerPct}%`, transition: 'width 1s linear', borderRadius: 3 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, fontSize: 14, color: 'var(--text-secondary)' }}>
          <span>{drillIndex + 1} / {drillWords.length}</span>
          <span style={{ color: drillTimeLeft <= 10 ? '#ef4444' : 'var(--text-secondary)', fontWeight: drillTimeLeft <= 10 ? 700 : 400 }}>{drillTimeLeft}s</span>
        </div>

        <div style={{ padding: 32, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', marginBottom: 24 }}>
          <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>{currentDrillWord?.word}</div>
          <div style={{ fontSize: 16, color: 'var(--text-secondary)' }}>{currentDrillWord?.meaning}</div>
          <button
            onClick={() => currentDrillWord && tts.speak(currentDrillWord.word)}
            style={{ marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}
            aria-label="Hear pronunciation"
          >
            🔊
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button
            onClick={() => drillAnswer(false)}
            style={{ flex: 1, padding: '16px 24px', borderRadius: 12, border: '2px solid #ef4444', background: '#fef2f2', color: '#dc2626', fontSize: 18, fontWeight: 600, cursor: 'pointer' }}
            aria-label="Don't know"
          >
            <X size={20} style={{ verticalAlign: 'middle' }} /> Don&apos;t Know
          </button>
          <button
            onClick={() => drillAnswer(true)}
            style={{ flex: 1, padding: '16px 24px', borderRadius: 12, border: '2px solid #22c55e', background: '#f0fdf4', color: '#16a34a', fontSize: 18, fontWeight: 600, cursor: 'pointer' }}
            aria-label="Know"
          >
            <Check size={20} style={{ verticalAlign: 'middle' }} /> Know
          </button>
        </div>

        <div style={{ marginTop: 16, height: 4, background: 'var(--border)', borderRadius: 2 }}>
          <div style={{ height: '100%', background: 'var(--primary)', width: `${progress}%`, transition: 'width 0.3s', borderRadius: 2 }} />
        </div>
      </div>
    );
  }

  // Drill result
  if (phase === 'drill-result') {
    const answered = drillAnswers.length;
    const known = drillAnswers.filter(Boolean).length;
    const timeUsed = 60 - drillTimeLeft;

    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>⚡ Drill Complete!</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          You reviewed {answered} of {drillWords.length} words in {timeUsed} seconds.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#16a34a' }}>{known}</div>
            <div style={{ fontSize: 14, color: '#166534' }}>Known</div>
          </div>
          <div style={{ padding: 16, background: '#fef2f2', borderRadius: 12, border: '1px solid #fecaca' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#dc2626' }}>{answered - known}</div>
            <div style={{ fontSize: 14, color: '#991b1b' }}>Need Practice</div>
          </div>
        </div>

        {answered > 0 && (
          <div style={{ marginBottom: 24, padding: 16, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>Accuracy</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{Math.round((known / answered) * 100)}%</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={startDrill} style={{ flex: 1 }}>
            ⚡ Drill Again
          </button>
          <button className="btn" onClick={() => { setPhase('select'); setIsOfflineMode(false); }} style={{ flex: 1 }}>
            Back to Topics
          </button>
        </div>
      </div>
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
              return (
              <span
                key={i}
                style={{
                  cursor: 'pointer',
                  background: answers[i] ? '#f0fdf4' : '#fef2f2',
                  color: answers[i] ? '#15803d' : '#b91c1c',
                }}
                onClick={() => tts.speak(displayWord)}
                title="Click to hear pronunciation"
              >
                {answers[i] ? '✓' : '✗'} {displayWord}
              </span>
              );
            })}
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => { setPhase('select'); setIsOfflineMode(false); }}>
          Try Another Topic
        </button>
      </div>
    );
  }

  // Quiz question
  if (!currentQ) return null;

  const offlineBanner = isOfflineMode ? (
    <div style={{ padding: '8px 12px', background: '#fef9c3', borderRadius: 8, marginBottom: 12, fontSize: '0.85rem', color: '#a16207', textAlign: 'center' }}>
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
        {quizMode === 'word-to-meaning' ? 'What does this mean?' : 'Which word matches this meaning?'}
      </h3>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
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
