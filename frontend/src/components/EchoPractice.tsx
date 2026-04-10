import { useState, useCallback } from 'react';
import { Mic, MicOff, Volume2, RotateCcw, ArrowRight } from 'lucide-react';
import { api } from '../api';
import type { PronunciationFeedback } from '../api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface Props {
  passage: string;
}

interface SentenceResult {
  sentence: string;
  transcript: string;
  feedback: PronunciationFeedback;
}

type Phase = 'idle' | 'playing' | 'recording' | 'evaluating' | 'result' | 'summary';

/** Split passage into 4-6 meaningful sentences */
export function extractSentences(passage: string): string[] {
  const raw = passage
    .replace(/([.!?])\s+/g, '$1|||')
    .split('|||')
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.split(/\s+/).length >= 4);
  if (raw.length <= 6) return raw;
  const step = raw.length / 5;
  return Array.from({ length: 5 }, (_, i) => raw[Math.min(Math.round(i * step), raw.length - 1)]);
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = Math.min((score / 100) * 100, 100);
  const color = score >= 70 ? 'var(--success, #22c55e)' : score >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color }}>{score}%</span>
      </div>
      <div style={{ height: 5, background: 'var(--border, #e5e7eb)', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export function EchoPractice({ passage }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sentences] = useState(() => extractSentences(passage));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<SentenceResult[]>([]);
  const [currentFeedback, setCurrentFeedback] = useState<PronunciationFeedback | null>(null);
  const [error, setError] = useState('');
  const speech = useSpeechRecognition({ continuous: true });

  const playSentence = useCallback((text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    utterance.onend = () => setPhase('recording');
    setPhase('playing');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const startEcho = useCallback(() => {
    setCurrentIndex(0);
    setResults([]);
    setCurrentFeedback(null);
    setError('');
    playSentence(sentences[0]);
  }, [sentences, playSentence]);

  const startRecording = useCallback(() => {
    speech.reset();
    speech.start();
  }, [speech]);

  const stopAndEvaluate = useCallback(async () => {
    speech.stop();
    setPhase('evaluating');
    const sentence = sentences[currentIndex];
    const transcript = speech.transcript || '';
    if (!transcript.trim()) {
      setError('No speech detected. Try again.');
      setPhase('recording');
      return;
    }
    try {
      const feedback = await api.checkPronunciation(sentence, transcript);
      setCurrentFeedback(feedback);
      setResults(prev => [...prev, { sentence, transcript, feedback }]);
      setPhase('result');
    } catch {
      setError('Evaluation failed. Try again.');
      setPhase('recording');
    }
  }, [speech, sentences, currentIndex]);

  const handleNext = useCallback(() => {
    setCurrentFeedback(null);
    speech.reset();
    if (currentIndex < sentences.length - 1) {
      const next = currentIndex + 1;
      setCurrentIndex(next);
      playSentence(sentences[next]);
    } else {
      setPhase('summary');
    }
  }, [currentIndex, sentences, playSentence, speech]);

  if (sentences.length === 0) return null;

  if (phase === 'idle') {
    return (
      <div style={{ marginTop: 20, padding: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary, #f9fafb)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Volume2 size={18} color="var(--primary)" />
          <h4 style={{ margin: 0, fontSize: 15 }}>Echo Practice</h4>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Listen to {sentences.length} key sentences from the passage and repeat them aloud to practice pronunciation.
        </p>
        <button className="btn btn-primary" onClick={startEcho} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Volume2 size={14} /> Start Echo Practice
        </button>
      </div>
    );
  }

  if (phase === 'summary') {
    const scores = results.map(r => r.feedback.overall_score ?? 0);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return (
      <div style={{ marginTop: 20, padding: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary, #f9fafb)' }}>
        <h4 style={{ textAlign: 'center', marginBottom: 12 }}>🎯 Echo Practice Complete!</h4>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 36, fontWeight: 700, color: avgScore >= 70 ? 'var(--success)' : avgScore >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
            {avgScore}%
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>Average Accuracy</p>
        </div>
        {results.map((r, i) => (
          <div key={i} style={{ padding: '8px 12px', marginBottom: 6, borderRadius: 6, background: 'var(--bg-card, #fff)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Sentence {i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: (r.feedback.overall_score ?? 0) >= 70 ? 'var(--success)' : 'var(--warning)' }}>
                {r.feedback.overall_score ?? 0}%
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>"{r.sentence.substring(0, 60)}{r.sentence.length > 60 ? '…' : ''}"</p>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={() => { setPhase('idle'); setResults([]); setCurrentIndex(0); }} style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RotateCcw size={14} /> Try Again
        </button>
      </div>
    );
  }

  const currentSentence = sentences[currentIndex];

  return (
    <div style={{ marginTop: 20, padding: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary, #f9fafb)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 15 }}>🔊 Echo Practice</h4>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{currentIndex + 1}/{sentences.length}</span>
      </div>

      <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-card, #fff)', border: '1px solid var(--border)', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>"{currentSentence}"</p>
      </div>

      {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{error}</p>}

      {phase === 'playing' && (
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--primary)' }}>🔊 Listening… Get ready to repeat!</p>
      )}

      {phase === 'recording' && (
        <div>
          {speech.isListening ? (
            <>
              {speech.transcript && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: 8 }}>"{speech.transcript}"</p>
              )}
              <button className="btn btn-danger" onClick={stopAndEvaluate} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <MicOff size={16} /> Done
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={startRecording} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Mic size={16} /> Repeat Now
            </button>
          )}
        </div>
      )}

      {phase === 'evaluating' && (
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>Evaluating…</p>
      )}

      {phase === 'result' && currentFeedback && (
        <div>
          <ScoreBar label="Overall Accuracy" score={currentFeedback.overall_score ?? 0} />
          {currentFeedback.fluency_score !== undefined && (
            <ScoreBar label="Fluency" score={currentFeedback.fluency_score} />
          )}
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>{currentFeedback.overall_feedback}</p>
          {currentFeedback.word_feedback.filter(w => !w.is_correct).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Words to review:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {currentFeedback.word_feedback.filter(w => !w.is_correct).slice(0, 5).map((w, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--danger-bg, #fef2f2)', color: 'var(--danger, #ef4444)', border: '1px solid var(--danger, #ef4444)' }}>
                    {w.expected} → {w.heard}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button className="btn btn-primary" onClick={handleNext} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ArrowRight size={14} /> {currentIndex < sentences.length - 1 ? 'Next Sentence' : 'View Summary'}
          </button>
        </div>
      )}
    </div>
  );
}
