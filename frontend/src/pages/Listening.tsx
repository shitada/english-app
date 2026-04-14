import { useState, useCallback, useEffect } from 'react';
import { Volume2, Eye, EyeOff, CheckCircle, XCircle, RotateCcw, History, Play } from 'lucide-react';
import { EchoPractice } from '../components/EchoPractice';
import { ClozeListening } from '../components/ClozeListening';
import { ListenAndSummarize } from '../components/ListenAndSummarize';
import { ListeningSpokenQA } from '../components/ListeningSpokenQA';
import { ListeningKeyVocab } from '../components/ListeningKeyVocab';
import { ListeningDiscussion } from '../components/ListeningDiscussion';
import { ListeningParaphrase } from '../components/ListeningParaphrase';
import { api, saveListeningQuizResult, getListeningQuizHistory, getListeningDifficultyRecommendation, getListeningQuizDetail } from '../api';
import type { ListeningQuizQuestion, ListeningQuizResult, ListeningDifficultyRecommendation } from '../api';

type Phase = 'setup' | 'listen' | 'quiz' | 'results';
type Difficulty = 'beginner' | 'intermediate' | 'advanced';

interface QuizResult {
  question: string;
  selectedIndex: number;
  correctIndex: number;
  explanation: string;
  options: string[];
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
  }, []);

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
    utterance.rate = playbackRate;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [passage, playbackRate, isSpeaking]);

  const handleAnswer = useCallback(() => {
    if (selectedOption === null) return;
    const q = questions[quizIndex];
    setResults(prev => [...prev, {
      question: q.question,
      selectedIndex: selectedOption,
      correctIndex: q.correct_index,
      explanation: q.explanation,
      options: q.options,
    }]);
    setAnswered(true);
  }, [selectedOption, questions, quizIndex]);

  const handleNext = useCallback(() => {
    if (quizIndex < questions.length - 1) {
      setQuizIndex(prev => prev + 1);
      setSelectedOption(null);
      setAnswered(false);
    } else {
      setPhase('results');
      if (!isRetry) {
        // Auto-save quiz result (skip on retry)
        const correctCount = results.filter(r => r.selectedIndex === r.correctIndex).length;
        const totalQ = questions.length;
        const scoreVal = Math.round((correctCount / totalQ) * 100);
        saveListeningQuizResult({
          title, difficulty, total_questions: totalQ, correct_count: correctCount, score: scoreVal, topic: selectedTopic,
          passage, questions,
        }).then(() => {
          setSaved(true);
          getListeningQuizHistory(10).then(setHistory).catch(() => {});
        }).catch(() => {});
      }
    }
  }, [quizIndex, questions, results, selectedOption, title, difficulty, isRetry, passage, selectedTopic]);

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
    setIsRetry(true);
    setPhase('quiz');
  }, [results, questions]);

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
          <button
            className="btn btn-primary"
            onClick={() => { window.speechSynthesis.cancel(); setIsSpeaking(false); setPhase('quiz'); }}
          >
            Start Questions ({questions.length})
          </button>
        </div>
      )}

      {phase === 'quiz' && (
        <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Question {quizIndex + 1}/{questions.length}</h3>
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
          <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>
            {questions[quizIndex].question}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
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
                  {isCorrect && <CheckCircle size={16} color="var(--success, #22c55e)" />}
                  {isWrong && <XCircle size={16} color="var(--danger, #ef4444)" />}
                  {opt}
                </button>
              );
            })}
          </div>
          {answered && (
            <div style={{
              padding: 12, borderRadius: 6, marginBottom: 12,
              background: 'var(--bg-secondary, #f5f5f5)',
              fontSize: 13, color: 'var(--text-secondary)',
            }}>
              💡 {questions[quizIndex].explanation}
            </div>
          )}
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
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <span style={{
              fontSize: 48, fontWeight: 700,
              color: results.filter(r => r.selectedIndex === r.correctIndex).length === results.length
                ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)',
            }}>
              {results.filter(r => r.selectedIndex === r.correctIndex).length}/{results.length}
            </span>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>correct answers</p>
          </div>
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
              </div>
              {r.selectedIndex !== r.correctIndex && (
                <p style={{ margin: '4px 0', fontSize: 12 }}>
                  <span style={{ color: 'var(--danger, #ef4444)', textDecoration: 'line-through' }}>{r.options[r.selectedIndex]}</span>
                  {' → '}
                  <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600 }}>{r.options[r.correctIndex]}</span>
                </p>
              )}
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
    </div>
  );
}
