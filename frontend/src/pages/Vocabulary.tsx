import { useState } from 'react';
import { Volume2, Check, X, ArrowRight } from 'lucide-react';
import { api, type QuizQuestion } from '../api';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

const TOPICS = [
  { id: 'hotel_checkin', label: 'Hotel & Accommodation', description: 'Reservation, check-in, amenities, complaints', emoji: '🏨' },
  { id: 'restaurant_order', label: 'Restaurant & Dining', description: 'Menu, ordering, allergies, tipping', emoji: '🍽️' },
  { id: 'job_interview', label: 'Job Interview', description: 'Resume, qualifications, strengths, salary', emoji: '💼' },
  { id: 'doctor_visit', label: 'Health & Medical', description: 'Symptoms, diagnosis, prescription, insurance', emoji: '🏥' },
  { id: 'shopping', label: 'Shopping & Retail', description: 'Sizes, colors, prices, returns, discounts', emoji: '🛍️' },
  { id: 'airport', label: 'Travel & Transport', description: 'Boarding, delays, luggage, immigration', emoji: '✈️' },
];

export default function Vocabulary() {
  const [phase, setPhase] = useState<'select' | 'quiz' | 'result'>('select');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const tts = useSpeechSynthesis();

  const startQuiz = async (topicId: string) => {
    setLoading(true);
    try {
      const res = await api.generateQuiz(topicId, 10);
      if (!res.questions || res.questions.length === 0) {
        alert('No questions generated. Try again.');
        return;
      }
      setQuestions(res.questions);
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedAnswer(null);
      setRevealed(false);
      setPhase('quiz');
    } catch (err) {
      console.error(err);
      alert('Failed to generate quiz. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const currentQ = questions[currentIndex];

  const selectAnswer = async (answer: string) => {
    if (revealed) return;

    const correctMeaning = currentQ?.correct_meaning || currentQ?.meaning || '';
    const isCorrect = answer === correctMeaning;

    setSelectedAnswer(answer);
    setRevealed(true);
    setAnswers((prev) => [...prev, isCorrect]);

    // Voice feedback
    if (isCorrect) {
      tts.speak(`Correct! ${currentQ.word} means ${correctMeaning}.`);
    } else {
      tts.speak(`Incorrect. ${currentQ.word} means ${correctMeaning}.`);
    }

    // Submit to backend if word has an ID
    if (currentQ?.id) {
      api.submitAnswer(currentQ.id, isCorrect).catch(() => {});
    }
  };

  const nextQuestion = () => {
    if (currentIndex + 1 >= questions.length) {
      setPhase('result');
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setRevealed(false);
    }
  };

  const getOptions = () => {
    if (!currentQ) return [];
    const correct = currentQ.correct_meaning || currentQ.meaning;
    const wrong = currentQ.wrong_options || [];
    const all = [correct, ...wrong];
    // Deterministic shuffle based on word
    return all.sort((a, b) => {
      const hashA = a.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const hashB = b.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return hashA - hashB;
    });
  };

  // Topic selection
  if (phase === 'select') {
    return (
      <div>
        <h2 style={{ marginBottom: 8 }}>Vocabulary</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
          Learn words and phrases used in real-life scenarios. Click any word to hear its pronunciation.
        </p>
        {loading ? (
          <div className="topic-grid">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton skeleton-card" style={{ height: 100 }} />
            ))}
          </div>
        ) : (
          <div className="topic-grid">
            {TOPICS.map((topic) => (
              <button
                key={topic.id}
                className="topic-card"
                onClick={() => startQuiz(topic.id)}
              >
                <h3>{topic.emoji} {topic.label}</h3>
                <p>{topic.description}</p>
              </button>
            ))}
          </div>
        )}
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
            {questions.map((q, i) => (
              <span
                key={i}
                style={{
                  cursor: 'pointer',
                  background: answers[i] ? '#f0fdf4' : '#fef2f2',
                  color: answers[i] ? '#15803d' : '#b91c1c',
                }}
                onClick={() => tts.speak(q.word)}
                title="Click to hear pronunciation"
              >
                {answers[i] ? '✓' : '✗'} {q.word}
              </span>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => setPhase('select')}>
          Try Another Topic
        </button>
      </div>
    );
  }

  // Quiz question
  if (!currentQ) return null;
  const correctMeaning = currentQ.correct_meaning || currentQ.meaning;
  const options = getOptions();

  return (
    <div className="card">
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

      <h3 style={{ textAlign: 'center', marginBottom: 8 }}>What does this mean?</h3>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            cursor: 'pointer',
            color: 'var(--primary)',
          }}
          onClick={() => tts.speak(currentQ.word)}
          title="Click to hear pronunciation"
        >
          {currentQ.word}
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

      {currentQ.example_sentence && (
        <p style={{
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: 14,
          marginBottom: 24,
          fontStyle: 'italic',
        }}>
          "{currentQ.example_sentence}"
        </p>
      )}

      <div>
        {options.map((opt, i) => {
          let className = 'quiz-option';
          if (revealed) {
            if (opt === correctMeaning) className += ' correct';
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
              {revealed && opt === correctMeaning && <Check size={16} style={{ marginRight: 8, color: 'var(--success)' }} />}
              {revealed && opt === selectedAnswer && opt !== correctMeaning && <X size={16} style={{ marginRight: 8, color: 'var(--danger)' }} />}
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
