import { useState, useCallback, useEffect } from 'react';
import { Link2, Mic, Square, Volume2, RefreshCw } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import {
  getConnectedSpeech,
  evaluateConnectedSpeech,
  type ConnectedSpeechResponse,
  type ConnectedSpeechEvaluateResponse,
} from '../api';

type Phase = 'idle' | 'listen' | 'annotate' | 'record' | 'evaluating' | 'done';

const PATTERN_COLORS: Record<string, string> = {
  linking: '#3b82f6',
  reduction: '#8b5cf6',
  elision: '#f59e0b',
  assimilation: '#ec4899',
};

const PATTERN_EMOJI: Record<string, string> = {
  linking: '🔗',
  reduction: '🔽',
  elision: '✂️',
  assimilation: '🔄',
};

export default function QuickConnectedSpeechCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [data, setData] = useState<ConnectedSpeechResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ConnectedSpeechEvaluateResponse | null>(null);
  const [initialized, setInitialized] = useState(false);

  const fetchPhrase = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getConnectedSpeech(difficulty);
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
      fetchPhrase();
    }
  }, [initialized, fetchPhrase]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        fetchPhrase();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchPhrase]);

  const handleListen = useCallback(() => {
    if (!data) return;
    setPhase('listen');
    tts.speak(data.phrase);
  }, [data, tts]);

  // When TTS finishes during 'listen' phase, transition to annotate
  useEffect(() => {
    if (phase === 'listen' && !tts.isSpeaking) {
      const timeout = setTimeout(() => {
        setPhase('annotate');
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [phase, tts.isSpeaking]);

  const handleStartRecording = useCallback(() => {
    speech.reset();
    speech.start();
    setPhase('record');
  }, [speech]);

  const handleStopRecording = useCallback(async () => {
    speech.stop();
    const transcript = speech.transcript || speech.interimTranscript || '';
    if (!data || !transcript.trim()) {
      setPhase('annotate');
      return;
    }
    setPhase('evaluating');
    try {
      const evalResult = await evaluateConnectedSpeech(data.phrase, data.pattern_type, transcript);
      setResult(evalResult);
      setPhase('done');
    } catch {
      setPhase('annotate');
    }
  }, [speech, data]);

  const handleNewPhrase = useCallback(() => {
    speech.stop();
    speech.reset();
    tts.stop();
    setPhase('idle');
    setResult(null);
    fetchPhrase();
  }, [fetchPhrase, speech, tts]);

  const handleTryAgain = useCallback(() => {
    speech.reset();
    setResult(null);
    setPhase('annotate');
  }, [speech]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  const patternColor = data ? (PATTERN_COLORS[data.pattern_type] || '#6b7280') : '#6b7280';
  const patternEmoji = data ? (PATTERN_EMOJI[data.pattern_type] || '🔊') : '🔊';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Link2 size={20} color="#3b82f6" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Connected Speech</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading phrase…</p>
      ) : !data ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No phrase available.</p>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your connected speech…</p>
      ) : phase === 'done' && result ? (
        <div>
          {/* Pattern type badge */}
          <span style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 12,
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#fff',
            background: patternColor,
            marginBottom: '0.5rem',
          }}>
            {patternEmoji} {data.pattern_type.charAt(0).toUpperCase() + data.pattern_type.slice(1)}
          </span>

          {/* Phrase display */}
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            marginBottom: '0.75rem',
          }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.25rem' }}>{data.phrase}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.15rem', fontWeight: 600 }}>Formal</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{data.formal_pronunciation}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.65rem', color: patternColor, marginBottom: '0.15rem', fontWeight: 600 }}>Natural</div>
                <div style={{ fontSize: '0.85rem', color: patternColor, fontWeight: 500 }}>{data.natural_pronunciation}</div>
              </div>
            </div>
          </div>

          {/* Scores */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Overall', score: result.overall_score },
              { label: 'Natural', score: result.naturalness_score },
              { label: 'Accuracy', score: result.accuracy_score },
              { label: 'Rhythm', score: result.rhythm_score },
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

          {/* Pronunciation tip */}
          {result.pronunciation_tip && (
            <div style={{
              padding: '0.5rem 0.75rem',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: 6,
              marginBottom: '0.75rem',
            }}>
              <span style={{ fontSize: '0.8rem', color: '#0369a1' }}>💡 {result.pronunciation_tip}</span>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleTryAgain} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPhrase} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <RefreshCw size={14} /> New Phrase
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Pattern type badge */}
          <span style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 12,
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#fff',
            background: patternColor,
            marginBottom: '0.5rem',
          }}>
            {patternEmoji} {data.pattern_type.charAt(0).toUpperCase() + data.pattern_type.slice(1)}
          </span>

          {/* Phrase with formal/natural pronunciations */}
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            marginBottom: '0.5rem',
          }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.25rem' }}>{data.phrase}</div>
            {(phase === 'annotate' || phase === 'record') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.15rem', fontWeight: 600 }}>Formal</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{data.formal_pronunciation}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.65rem', color: patternColor, marginBottom: '0.15rem', fontWeight: 600 }}>Natural</div>
                  <div style={{ fontSize: '0.85rem', color: patternColor, fontWeight: 500 }}>{data.natural_pronunciation}</div>
                </div>
              </div>
            )}
          </div>

          {/* Explanation */}
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.75rem', fontStyle: 'italic' }}>
            {data.explanation}
          </p>

          {/* Live transcript while recording */}
          {phase === 'record' && (speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleListen}
              className="btn btn-secondary"
              disabled={phase === 'listen' || phase === 'record'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Volume2 size={14} /> {phase === 'listen' ? 'Playing…' : 'Listen'}
            </button>

            {phase === 'record' ? (
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
                disabled={phase === 'idle' || phase === 'listen'}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Mic size={14} /> Speak
              </button>
            )}

            <button
              onClick={handleNewPhrase}
              className="btn btn-secondary"
              disabled={phase === 'record' || phase === 'listen'}
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
