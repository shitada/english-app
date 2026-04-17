import { useState, useCallback, useEffect } from 'react';
import { Music, Mic, Square, Volume2, RefreshCw } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  getSentenceStress,
  evaluateSentenceStress,
  type SentenceStressResponse,
  type SentenceStressEvaluateResponse,
} from '../api';

type Phase = 'idle' | 'listening' | 'recording' | 'evaluating' | 'done';

export default function QuickSentenceStressCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [data, setData] = useState<SentenceStressResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SentenceStressEvaluateResponse | null>(null);
  const [initialized, setInitialized] = useState(false);

  const fetchSentence = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getSentenceStress(difficulty);
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchSentence();
    }
  }, [initialized, fetchSentence]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        fetchSentence();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchSentence]);

  const handleListen = useCallback(() => {
    if (!data) return;
    setPhase('listening');
    tts.speak(data.sentence);
  }, [data, tts]);

  // When TTS finishes during 'listening' phase, transition to ready for recording
  useEffect(() => {
    if (phase === 'listening' && !tts.isSpeaking) {
      const timeout = setTimeout(() => {
        setPhase('idle');
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [phase, tts.isSpeaking]);

  const handleStartRecording = useCallback(() => {
    speech.reset();
    speech.start();
    setPhase('recording');
  }, [speech]);

  const handleStopRecording = useCallback(async () => {
    speech.stop();
    const transcript = speech.transcript || speech.interimTranscript || '';
    if (!data || !transcript.trim()) {
      setPhase('idle');
      return;
    }
    setPhase('evaluating');
    try {
      const evalResult = await evaluateSentenceStress(data.sentence, data.stressed_words, transcript);
      setResult(evalResult);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [speech, data]);

  const handleNewSentence = useCallback(() => {
    speech.stop();
    speech.reset();
    tts.stop();
    setPhase('idle');
    setResult(null);
    fetchSentence();
  }, [fetchSentence, speech, tts]);

  const handleTryAgain = useCallback(() => {
    speech.reset();
    setResult(null);
    setPhase('idle');
  }, [speech]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  const renderStressedSentence = (sentence: string, stressedWords: string[]) => {
    const stressedLower = new Set(stressedWords.map(w => w.toLowerCase()));
    const words = sentence.split(/(\s+)/);
    return words.map((word, i) => {
      const cleaned = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
      const isStressed = cleaned && stressedLower.has(cleaned);
      if (isStressed) {
        return (
          <span key={i} style={{
            fontWeight: 700,
            color: '#3b82f6',
            textDecoration: 'underline',
            textDecorationColor: '#3b82f6',
            textUnderlineOffset: '3px',
          }}>
            {word}
          </span>
        );
      }
      return <span key={i}>{word}</span>;
    });
  };

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Music size={20} color="#8b5cf6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Sentence Stress</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading sentence…</p>
      ) : !data ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No sentence available.</p>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your stress patterns…</p>
      ) : phase === 'done' && result ? (
        <div>
          {/* Sentence display */}
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            marginBottom: '0.75rem',
            fontSize: '1.05rem',
            lineHeight: 1.6,
          }}>
            {renderStressedSentence(data.sentence, data.stressed_words)}
          </div>

          {/* Scores */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Overall', score: result.overall_score },
              { label: 'Stress', score: result.stress_accuracy_score },
              { label: 'Rhythm', score: result.rhythm_score },
              { label: 'Pronun.', score: result.pronunciation_score },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Feedback */}
          {result.feedback && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
              {result.feedback}
            </p>
          )}

          {/* Stress tip */}
          {result.stress_tip && (
            <div style={{
              padding: '0.5rem 0.75rem',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: 6,
              marginBottom: '0.75rem',
            }}>
              <span style={{ fontSize: '0.8rem', color: '#0369a1' }}>💡 {result.stress_tip}</span>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleTryAgain} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewSentence} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <RefreshCw size={14} /> New Sentence
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Sentence with stressed words highlighted */}
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            marginBottom: '0.5rem',
            fontSize: '1.05rem',
            lineHeight: 1.6,
          }}>
            {renderStressedSentence(data.sentence, data.stressed_words)}
          </div>

          {/* Explanation */}
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.75rem', fontStyle: 'italic' }}>
            {data.explanation}
          </p>

          {/* Live transcript while recording */}
          {phase === 'recording' && (speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleListen}
              className="btn btn-secondary"
              disabled={phase === 'listening' || phase === 'recording'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Volume2 size={14} /> {phase === 'listening' ? 'Playing…' : 'Listen'}
            </button>

            {phase === 'recording' ? (
              <button
                onClick={handleStopRecording}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Square size={14} /> Stop
              </button>
            ) : (
              <button
                onClick={handleStartRecording}
                className="btn btn-primary"
                disabled={phase === 'listening'}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Mic size={14} /> Speak
              </button>
            )}

            <button
              onClick={handleNewSentence}
              className="btn btn-secondary"
              disabled={phase === 'recording' || phase === 'listening'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <RefreshCw size={14} /> New
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
