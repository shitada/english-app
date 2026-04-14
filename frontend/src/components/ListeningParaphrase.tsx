import { useState, useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, ChevronDown, ChevronUp, RotateCcw, Volume2, Shuffle } from 'lucide-react';
import { api } from '../api';
import { extractSentences } from './EchoPractice';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface Props {
  passage: string;
}

interface ParaphraseResult {
  original: string;
  userText: string;
  meaning_preserved: boolean;
  naturalness_score: number;
  variety_score: number;
  overall_score: number;
  feedback: string;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 7 ? 'var(--success, #22c55e)' : score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color }}>{score.toFixed(1)}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-secondary, #e5e7eb)' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export function ListeningParaphrase({ passage }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [sentences] = useState(() => extractSentences(passage));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<'listen' | 'recording' | 'evaluating' | 'result' | 'summary'>('listen');
  const [results, setResults] = useState<ParaphraseResult[]>([]);
  const [currentResult, setCurrentResult] = useState<ParaphraseResult | null>(null);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(20);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speech = useSpeechRecognition({ continuous: true });

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const playSentence = useCallback(() => {
    if ('speechSynthesis' in window && sentences[currentIndex]) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(sentences[currentIndex]);
      utt.rate = 0.85;
      utt.lang = 'en-US';
      window.speechSynthesis.speak(utt);
    }
  }, [sentences, currentIndex]);

  const startRecording = useCallback(() => {
    setTimer(20);
    speech.reset();
    speech.start();
    setPhase('recording');
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          speech.stop();
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speech]);

  const stopRecording = useCallback(() => {
    speech.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [speech]);

  const handleSubmit = async () => {
    if (!speech.transcript.trim()) return;
    setPhase('evaluating');
    setError('');
    try {
      const result = await api.evaluateRephrase(sentences[currentIndex], speech.transcript.trim());
      const pr: ParaphraseResult = {
        original: sentences[currentIndex],
        userText: speech.transcript.trim(),
        ...result,
      };
      setCurrentResult(pr);
      setPhase('result');
    } catch {
      setError('Evaluation failed. Please try again.');
      setPhase('listen');
    }
  };

  const handleNext = () => {
    if (currentResult) {
      setResults(prev => [...prev, currentResult]);
    }
    setCurrentResult(null);
    speech.reset();
    setError('');
    if (currentIndex + 1 < sentences.length) {
      setCurrentIndex(prev => prev + 1);
      setPhase('listen');
    } else {
      setPhase('summary');
    }
  };

  const handleReset = () => {
    setResults([]);
    setCurrentResult(null);
    setCurrentIndex(0);
    setPhase('listen');
    setError('');
    speech.reset();
  };

  if (sentences.length === 0) return null;

  const allResults = currentResult ? [...results, currentResult] : results;
  const avgOverall = allResults.length > 0
    ? allResults.reduce((s, r) => s + r.overall_score, 0) / allResults.length
    : 0;

  return (
    <div style={{
      marginTop: 24,
      padding: 20,
      background: 'var(--bg-secondary, #f5f5f5)',
      borderRadius: 12,
      border: '1px solid var(--border-color, #e5e7eb)',
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, color: 'var(--text-primary, #1f2937)',
        }}
        aria-label={expanded ? 'Collapse paraphrase drill' : 'Expand paraphrase drill'}
      >
        <h4 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shuffle size={18} /> Listening Paraphrase
        </h4>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 14, marginBottom: 14 }}>
            Listen to each sentence (without seeing the text), then say it in your own words.
          </p>

          {phase !== 'summary' && (
            <div style={{
              fontSize: 12, color: 'var(--text-secondary, #6b7280)', marginBottom: 10,
            }}>
              Sentence {currentIndex + 1} of {sentences.length}
            </div>
          )}

          {phase === 'listen' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={playSentence}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              >
                <Volume2 size={14} /> Play Sentence
              </button>
              <button
                className="btn btn-primary"
                onClick={startRecording}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              >
                <Mic size={14} /> Record Paraphrase
              </button>
            </div>
          )}

          {phase === 'recording' && (
            <div style={{
              padding: 16, background: 'var(--bg-primary, #fff)', borderRadius: 8,
              border: '2px solid var(--danger, #ef4444)', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <button
                  className="btn btn-danger"
                  onClick={stopRecording}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <MicOff size={16} /> Stop
                </button>
                <span style={{ fontSize: 13, color: 'var(--danger, #ef4444)', fontWeight: 500 }}>
                  ● {timer}s
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={playSentence}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 10px' }}
                >
                  <Volume2 size={12} /> Replay
                </button>
              </div>
              {speech.transcript && (
                <div style={{
                  padding: 10, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6,
                  fontSize: 14, lineHeight: 1.6, minHeight: 40,
                }}>
                  {speech.transcript}
                </div>
              )}
            </div>
          )}

          {phase === 'recording' && speech.transcript && !speech.isListening && (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              Submit Paraphrase
            </button>
          )}

          {phase === 'evaluating' && (
            <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 14 }}>Evaluating...</p>
          )}

          {error && <p style={{ color: 'var(--danger, #ef4444)', fontSize: 13, marginTop: 8 }}>{error}</p>}

          {phase === 'result' && currentResult && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                textAlign: 'center', marginBottom: 12, fontSize: 24, fontWeight: 700,
                color: currentResult.overall_score >= 7 ? 'var(--success, #22c55e)' : currentResult.overall_score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
              }}>
                {currentResult.overall_score.toFixed(1)}/10
              </div>
              <ScoreBar label="Naturalness" score={currentResult.naturalness_score} />
              <ScoreBar label="Variety" score={currentResult.variety_score} />
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13,
              }}>
                <span>{currentResult.meaning_preserved ? '✅' : '❌'}</span>
                <span>Meaning {currentResult.meaning_preserved ? 'preserved' : 'not preserved'}</span>
              </div>

              {currentResult.feedback && (
                <div style={{
                  padding: 10, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                  borderLeft: '3px solid var(--primary, #6366f1)', marginBottom: 10, fontSize: 13,
                }}>
                  {currentResult.feedback}
                </div>
              )}

              <div style={{
                padding: 10, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                border: '1px solid var(--border-color, #e5e7eb)', marginBottom: 10, fontSize: 13,
                color: 'var(--text-secondary, #6b7280)',
              }}>
                <strong>Original:</strong> {currentResult.original}
              </div>

              <button
                className="btn btn-primary"
                onClick={handleNext}
                style={{ fontSize: 13 }}
              >
                {currentIndex + 1 < sentences.length ? 'Next Sentence →' : 'See Summary'}
              </button>
            </div>
          )}

          {phase === 'summary' && (
            <div>
              <div style={{
                textAlign: 'center', marginBottom: 16, fontSize: 28, fontWeight: 700,
                color: avgOverall >= 7 ? 'var(--success, #22c55e)' : avgOverall >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
              }}>
                Average: {avgOverall.toFixed(1)}/10
              </div>

              {allResults.map((r, i) => (
                <div key={i} style={{
                  padding: 10, background: 'var(--bg-primary, #fff)', borderRadius: 8,
                  border: '1px solid var(--border-color, #e5e7eb)', marginBottom: 8, fontSize: 13,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>Sentence {i + 1}</span>
                    <span style={{
                      fontWeight: 600,
                      color: r.overall_score >= 7 ? 'var(--success, #22c55e)' : r.overall_score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
                    }}>
                      {r.overall_score.toFixed(1)}/10
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
                    {r.meaning_preserved ? '✅' : '❌'} {r.feedback}
                  </div>
                </div>
              ))}

              <button
                className="btn btn-secondary"
                onClick={handleReset}
                style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}
              >
                <RotateCcw size={14} /> Try Again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
