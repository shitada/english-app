import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, RefreshCw, Square, Brain, Volume2, Eye } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api } from '../api';

interface DrillWord {
  id: number;
  word: string;
  meaning: string;
  topic: string;
  example_sentence: string;
}

const MAX_SECONDS = 10;

export default function QuickVocabRecallCard() {
  const speech = useSpeechRecognition({ continuous: false, interimResults: true });
  const tts = useSpeechSynthesis();

  const [word, setWord] = useState<DrillWord | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'done'>('idle');
  const [correct, setCorrect] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWord = useCallback(async () => {
    setLoading(true);
    setPhase('idle');
    setCorrect(false);
    setShowHint(false);
    setSecondsLeft(MAX_SECONDS);
    speech.reset?.();
    try {
      const res = await api.getDrillWords(1);
      if (res.words.length > 0) {
        setWord(res.words[0]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchWord();
    }
  }, [initialized, fetchWord]);

  const startSpeaking = useCallback(() => {
    setPhase('speaking');
    setSecondsLeft(MAX_SECONDS);
    speech.start();
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          speech.stop();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [speech]);

  const stopSpeaking = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    speech.stop();
  }, [speech]);

  // Check answer when speech recognition ends
  useEffect(() => {
    if (phase === 'speaking' && !speech.isListening && speech.transcript && word) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;

      const spoken = speech.transcript.trim().toLowerCase().replace(/[.,!?]/g, '');
      const target = word.word.toLowerCase().replace(/[.,!?]/g, '');
      const isCorrect = spoken === target || spoken.includes(target) || target.includes(spoken);

      setCorrect(isCorrect);
      setPhase('done');
    }
  }, [speech.isListening, speech.transcript, phase, word]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const playWord = useCallback(() => {
    if (word) tts.speak(word.word);
  }, [word, tts]);

  if (!word && !loading) return null;

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>
          <Brain size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          Vocab Recall
        </h3>
        <button
          className="btn btn-secondary"
          onClick={fetchWord}
          disabled={loading || phase === 'speaking'}
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>Loading word...</p>
      ) : word ? (
        <>
          {/* Show meaning and topic — user must recall the English word */}
          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 12,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              {word.topic}
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
              {word.meaning}
            </div>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Say the English word for this meaning.
          </p>

          {/* Hint toggle */}
          {phase === 'idle' && (
            <button
              onClick={() => setShowHint(!showHint)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', color: 'var(--primary, #3b82f6)',
                marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4, padding: 0,
              }}
            >
              <Eye size={12} /> {showHint ? 'Hide hint' : 'Show hint'}
            </button>
          )}

          {showHint && phase === 'idle' && word.example_sentence && (
            <div style={{
              padding: 8, borderRadius: 6, marginBottom: 10,
              background: '#f59e0b10', border: '1px solid #f59e0b30',
              fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic',
            }}>
              💡 {word.example_sentence.replace(new RegExp(word.word, 'gi'), '___')}
            </div>
          )}

          {phase === 'idle' && (
            <button
              className="btn btn-primary"
              onClick={startSpeaking}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Mic size={16} /> Say the Word
            </button>
          )}

          {phase === 'speaking' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '1.5rem', fontWeight: 700, marginBottom: 8,
                color: secondsLeft <= 3 ? '#ef4444' : 'var(--text-primary)',
              }}>
                {secondsLeft}s
              </div>
              {speech.transcript && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8, fontStyle: 'italic' }}>
                  "{speech.transcript}"
                </p>
              )}
              <button
                className="btn btn-primary"
                onClick={stopSpeaking}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Square size={14} /> Done
              </button>
            </div>
          )}

          {phase === 'done' && (
            <div style={{ marginTop: 4 }}>
              <div style={{
                textAlign: 'center', padding: 16, borderRadius: 8, marginBottom: 12,
                background: correct ? '#22c55e10' : '#ef444410',
                border: `1px solid ${correct ? '#22c55e30' : '#ef444430'}`,
              }}>
                <div style={{ fontSize: '2rem', marginBottom: 4 }}>
                  {correct ? '✅' : '❌'}
                </div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: correct ? '#22c55e' : '#ef4444' }}>
                  {correct ? 'Correct!' : 'Not quite'}
                </div>
                {speech.transcript && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    You said: "{speech.transcript}"
                  </div>
                )}
              </div>

              {/* Reveal the correct word */}
              <div style={{
                padding: 12, borderRadius: 8, marginBottom: 12,
                background: '#8b5cf610', border: '1px solid #8b5cf630',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Answer</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#8b5cf6' }}>{word.word}</div>
                </div>
                <button
                  onClick={playWord}
                  className="btn btn-secondary"
                  style={{ padding: '6px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Volume2 size={14} /> Listen
                </button>
              </div>

              <button
                className="btn btn-secondary"
                onClick={fetchWord}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <RefreshCw size={14} /> Next Word
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
