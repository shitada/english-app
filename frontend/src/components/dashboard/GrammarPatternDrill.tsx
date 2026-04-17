import { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, Volume2, Mic, ArrowLeft, CheckCircle, XCircle, Loader } from 'lucide-react';
import { getGrammarPatternDrill, type GrammarPatternExercise } from '../../api';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

interface Props {
  category: string;
  onClose: () => void;
}

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

interface AttemptResult {
  userInput: string;
  correct: string;
  isMatch: boolean;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]+/g, '').replace(/\s+/g, ' ');
}

function WordDiff({ userInput, correct }: { userInput: string; correct: string }) {
  const userWords = userInput.trim().split(/\s+/);
  const correctWords = correct.trim().split(/\s+/);
  const maxLen = Math.max(userWords.length, correctWords.length);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 14 }}>
      {Array.from({ length: maxLen }, (_, i) => {
        const uWord = userWords[i] || '';
        const cWord = correctWords[i] || '';
        const match = normalizeText(uWord) === normalizeText(cWord);
        return (
          <span
            key={i}
            style={{
              color: match ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
              fontWeight: match ? 400 : 700,
              textDecoration: !match && uWord ? 'line-through' : 'none',
            }}
          >
            {uWord || '___'}
          </span>
        );
      })}
    </div>
  );
}

const LS_KEY = 'grammar-pattern-drill-completed';

function getCompletedPatterns(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function markPatternCompleted(category: string) {
  const completed = getCompletedPatterns();
  if (!completed.includes(category)) {
    completed.push(category);
    localStorage.setItem(LS_KEY, JSON.stringify(completed));
  }
}

export function GrammarPatternDrill({ category, onClose }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [exercises, setExercises] = useState<GrammarPatternExercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [finished, setFinished] = useState(false);
  const [started, setStarted] = useState(false);
  const [speakMode, setSpeakMode] = useState(false);
  const [spokenResult, setSpokenResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const speech = useSpeechRecognition({ continuous: false });

  const fetchExercises = useCallback(async (diff: Difficulty) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGrammarPatternDrill(category, diff);
      setExercises(data.exercises);
      setCurrentIndex(0);
      setResults([]);
      setUserInput('');
      setShowResult(false);
      setFinished(false);
      setStarted(true);
      setSpeakMode(false);
      setSpokenResult(null);
    } catch {
      setError('Failed to generate exercises. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [category]);

  const handleStart = useCallback(() => {
    fetchExercises(difficulty);
  }, [fetchExercises, difficulty]);

  useEffect(() => {
    if (started && inputRef.current) inputRef.current.focus();
  }, [currentIndex, started]);

  const handleSubmit = useCallback(() => {
    if (!userInput.trim()) return;
    const ex = exercises[currentIndex];
    const isMatch = normalizeText(userInput) === normalizeText(ex.correct);
    setResults(prev => [...prev, { userInput: userInput.trim(), correct: ex.correct, isMatch }]);
    setShowResult(true);
  }, [userInput, currentIndex, exercises]);

  const handleNext = useCallback(() => {
    setShowResult(false);
    setUserInput('');
    setSpeakMode(false);
    setSpokenResult(null);
    speech.reset();
    if (currentIndex < exercises.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
      markPatternCompleted(category);
    }
  }, [currentIndex, exercises.length, category, speech]);

  const handleRestart = useCallback(() => {
    fetchExercises(difficulty);
  }, [fetchExercises, difficulty]);

  const handleSpeak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  const handleSayIt = useCallback(() => {
    setSpeakMode(true);
    setSpokenResult(null);
    speech.reset();
    speech.start();
  }, [speech]);

  const handleStopSpeaking = useCallback(() => {
    speech.stop();
  }, [speech]);

  // Check spoken result when speech stops
  useEffect(() => {
    if (speakMode && !speech.isListening && speech.transcript) {
      const ex = exercises[currentIndex];
      const match = normalizeText(speech.transcript) === normalizeText(ex.correct);
      setSpokenResult(match ? 'correct' : 'incorrect');
    }
  }, [speakMode, speech.isListening, speech.transcript, exercises, currentIndex]);

  // Not started yet – show difficulty picker
  if (!started) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>🎯 Practice: {category}</h3>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Get 5 targeted exercises for this grammar pattern. Choose your difficulty:
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['beginner', 'intermediate', 'advanced'] as Difficulty[]).map(d => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={difficulty === d ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ flex: 1, fontSize: 13, textTransform: 'capitalize' }}
            >
              {d}
            </button>
          ))}
        </div>

        {error && (
          <p style={{ color: 'var(--danger, #ef4444)', fontSize: 13, marginBottom: 8 }}>{error}</p>
        )}

        <button
          onClick={handleStart}
          disabled={loading}
          className="btn btn-primary"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {loading ? <><Loader size={14} className="spin" /> Generating…</> : 'Start Practice'}
        </button>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="card" style={{ marginTop: 12, textAlign: 'center', padding: 32 }}>
        <Loader size={24} className="spin" style={{ color: 'var(--accent)' }} />
        <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13 }}>Generating exercises…</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="card" style={{ marginTop: 12, textAlign: 'center', padding: 24 }}>
        <p style={{ color: 'var(--danger, #ef4444)', marginBottom: 12 }}>{error}</p>
        <button onClick={handleStart} className="btn btn-primary">Retry</button>
      </div>
    );
  }

  // Summary screen
  if (finished) {
    const correctCount = results.filter(r => r.isMatch).length;
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Practice Complete!</h3>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{
            fontSize: 40,
            fontWeight: 700,
            color: correctCount === exercises.length ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)',
          }}>
            {correctCount}/{exercises.length}
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            {correctCount === exercises.length
              ? '🎉 Perfect score!'
              : correctCount >= 3
                ? '👍 Good job! Keep practicing.'
                : '💪 Keep going, you'll get there!'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
            Category: {category} · Difficulty: {difficulty}
          </p>
        </div>

        {results.map((r, i) => (
          <div key={i} style={{
            padding: 8, marginBottom: 6,
            background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {r.isMatch
              ? <CheckCircle size={16} color="var(--success, #22c55e)" />
              : <XCircle size={16} color="var(--danger, #ef4444)" />}
            <span style={{ fontSize: 13, flex: 1 }}>
              {r.isMatch ? r.correct : (
                <>
                  <span style={{ textDecoration: 'line-through', color: 'var(--danger, #ef4444)' }}>{r.userInput}</span>
                  {' → '}
                  <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600 }}>{r.correct}</span>
                </>
              )}
            </span>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={handleRestart} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Try Again
          </button>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    );
  }

  // Active exercise
  const currentExercise = exercises[currentIndex];
  if (!currentExercise) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>🎯 {category}</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {currentIndex + 1} / {exercises.length}
        </span>
      </div>

      {/* Incorrect sentence */}
      <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>
          Fix this sentence:
        </p>
        <p style={{ margin: 0, fontSize: 15, color: 'var(--danger, #ef4444)', fontStyle: 'italic' }}>
          "{currentExercise.incorrect}"
        </p>
      </div>

      {!showResult ? (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Type the corrected version:
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              type="text"
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Type the correction..."
              style={{
                flex: 1, padding: '0.5rem 0.75rem', borderRadius: 6,
                border: '1px solid var(--border)', fontSize: 14,
                background: 'var(--card-bg, #fff)', color: 'var(--text)',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!userInput.trim()}
              className="btn btn-primary"
              style={{ opacity: userInput.trim() ? 1 : 0.5 }}
            >
              Check
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Result feedback */}
          {results[results.length - 1]?.isMatch ? (
            <div style={{
              padding: 10, borderRadius: 6,
              background: 'var(--success-bg, #f0fdf4)', border: '1px solid var(--success, #22c55e)',
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <CheckCircle size={18} color="var(--success, #22c55e)" />
                <span style={{ fontWeight: 600, color: 'var(--success, #22c55e)' }}>Correct!</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{currentExercise.correct}</p>
            </div>
          ) : (
            <div style={{
              padding: 10, borderRadius: 6,
              background: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger, #ef4444)',
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <XCircle size={18} color="var(--danger, #ef4444)" />
                <span style={{ fontWeight: 600, color: 'var(--danger, #ef4444)' }}>Not quite</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Your attempt:</p>
                <WordDiff userInput={results[results.length - 1]?.userInput || ''} correct={currentExercise.correct} />
              </div>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Correct version:</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--success, #22c55e)' }}>
                  {currentExercise.correct}
                </p>
              </div>
            </div>
          )}

          {/* Explanation */}
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
            💡 {currentExercise.explanation}
          </p>

          {/* Say It section */}
          {speakMode && (
            <div style={{
              padding: 10, borderRadius: 6,
              background: 'var(--bg-secondary, #f9fafb)',
              marginBottom: 12, border: '1px solid var(--border)',
            }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                🎤 Say the correct sentence:
              </p>
              {speech.isListening ? (
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--accent)', fontStyle: 'italic' }}>
                    Listening… {speech.interimTranscript || speech.transcript}
                  </p>
                  <button onClick={handleStopSpeaking} className="btn btn-secondary" style={{ fontSize: 12 }}>
                    Done Speaking
                  </button>
                </div>
              ) : speech.transcript ? (
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>You said:</p>
                  <WordDiff userInput={speech.transcript} correct={currentExercise.correct} />
                  {spokenResult === 'correct' && (
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--success, #22c55e)', fontWeight: 600 }}>
                      ✅ Great pronunciation!
                    </p>
                  )}
                  {spokenResult === 'incorrect' && (
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--danger, #ef4444)' }}>
                      Close! Try listening and repeating.
                    </p>
                  )}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {speech.error || 'Click the microphone to start speaking.'}
                </p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => handleSpeak(currentExercise.correct)}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <Volume2 size={14} /> Listen
            </button>
            {speech.isSupported && !speakMode && (
              <button
                onClick={handleSayIt}
                className="btn btn-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              >
                <Mic size={14} /> Say It
              </button>
            )}
            <button onClick={handleNext} className="btn btn-primary" style={{ marginLeft: 'auto' }}>
              {currentIndex < exercises.length - 1 ? 'Next' : 'See Results'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
