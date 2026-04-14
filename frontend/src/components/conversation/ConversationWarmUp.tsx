import { useState, useCallback, useEffect } from 'react';
import { Volume2, Mic, MicOff, ArrowRight, Loader2, RotateCcw } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import { getTopicWarmup, type WarmupPhrase } from '../../api';

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

function computeAccuracy(reference: string, spoken: string): number {
  const refWords = normalizeText(reference).split(' ');
  const spokenWords = normalizeText(spoken).split(' ');
  if (refWords.length === 0) return 0;
  let matched = 0;
  for (const rw of refWords) {
    if (spokenWords.includes(rw)) matched++;
  }
  return Math.round((matched / refWords.length) * 100);
}

interface Props {
  topicId: string;
  topicLabel: string;
  difficulty: string;
  onDone: () => void;
  onStartConversation: () => void;
}

export default function ConversationWarmUp({ topicId, topicLabel, difficulty, onDone, onStartConversation }: Props) {
  const [phrases, setPhrases] = useState<WarmupPhrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [results, setResults] = useState<Map<number, { transcript: string; accuracy: number }>>(new Map());
  const [recording, setRecording] = useState(false);

  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getTopicWarmup(topicId, difficulty)
      .then((data) => {
        if (!cancelled) {
          setPhrases(data.phrases);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load warm-up phrases');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [topicId, difficulty]);

  useEffect(() => {
    if (recording && !speech.isListening && speech.transcript) {
      const accuracy = computeAccuracy(phrases[currentIdx].phrase, speech.transcript);
      setResults((prev) => new Map(prev).set(currentIdx, { transcript: speech.transcript, accuracy }));
      setRecording(false);
    }
  }, [speech.isListening, speech.transcript, recording, currentIdx, phrases]);

  const handleListen = useCallback((phrase: string) => {
    tts.speak(phrase);
  }, [tts]);

  const handleRecord = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
      return;
    }
    setRecording(true);
    speech.start();
  }, [speech]);

  const handleRetry = useCallback((idx: number) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.delete(idx);
      return next;
    });
    setCurrentIdx(idx);
  }, []);

  const allDone = phrases.length > 0 && results.size === phrases.length;
  const avgAccuracy = allDone
    ? Math.round([...results.values()].reduce((sum, r) => sum + r.accuracy, 0) / results.size)
    : 0;

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <Loader2 size={24} className="spin" />
        <p style={{ marginTop: 8, color: 'var(--text-secondary)' }}>Generating warm-up phrases for {topicLabel}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <p style={{ color: 'var(--error)' }}>{error}</p>
        <button className="btn btn-secondary" onClick={onDone} style={{ marginTop: 12 }}>Back</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>🔥 Warm Up: {topicLabel}</h3>
        <button className="btn btn-secondary" onClick={onDone} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>✕ Close</button>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
        Listen to each phrase, then practice saying it. Aim for high accuracy before starting the conversation.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {phrases.map((p, idx) => {
          const result = results.get(idx);
          const isActive = idx === currentIdx;
          const accuracyColor = result ? (result.accuracy >= 80 ? '#22c55e' : result.accuracy >= 50 ? '#f59e0b' : '#ef4444') : undefined;

          return (
            <div
              key={idx}
              style={{
                padding: 14,
                borderRadius: 10,
                border: isActive ? '2px solid var(--primary)' : '1px solid var(--border)',
                background: result ? `${accuracyColor}08` : 'var(--card-bg)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onClick={() => setCurrentIdx(idx)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{p.phrase}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>{p.hint}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={(e) => { e.stopPropagation(); handleListen(p.phrase); }}
                    style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    title="Listen"
                  >
                    <Volume2 size={14} />
                  </button>
                  {isActive && (
                    <button
                      className={`btn ${recording && speech.isListening ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={(e) => { e.stopPropagation(); handleRecord(); }}
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                      title={recording && speech.isListening ? 'Stop recording' : 'Record'}
                    >
                      {recording && speech.isListening ? <MicOff size={14} /> : <Mic size={14} />}
                    </button>
                  )}
                </div>
              </div>

              {result && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: accuracyColor,
                    minWidth: 50,
                  }}>
                    {result.accuracy}%
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', flex: 1 }}>
                    "{result.transcript}"
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={(e) => { e.stopPropagation(); handleRetry(idx); }}
                    style={{ padding: '4px 6px', fontSize: '0.7rem' }}
                    title="Retry"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allDone && (
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <div style={{
            fontSize: '1.1rem', fontWeight: 700, marginBottom: 8,
            color: avgAccuracy >= 80 ? '#22c55e' : avgAccuracy >= 50 ? '#f59e0b' : '#ef4444',
          }}>
            Average Accuracy: {avgAccuracy}%
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            {avgAccuracy >= 80 ? "Great job! You're ready for the conversation." : "Keep practicing or start the conversation when ready."}
          </p>
          <button
            className="btn btn-primary"
            onClick={onStartConversation}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            Start Conversation <ArrowRight size={16} />
          </button>
        </div>
      )}

      {!allDone && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {results.size}/{phrases.length} phrases practiced
          </span>
        </div>
      )}
    </div>
  );
}
