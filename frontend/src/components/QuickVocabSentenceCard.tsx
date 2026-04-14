import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, RefreshCw, Square, BookOpen } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { api, evaluateVocabSentenceUse, type EvaluateSentenceUseResponse } from '../api';

interface DrillWord {
  id: number;
  word: string;
  meaning: string;
  topic: string;
  example_sentence: string;
}

const MAX_SECONDS = 15;

export default function QuickVocabSentenceCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [word, setWord] = useState<DrillWord | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<EvaluateSentenceUseResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWord = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setPhase('idle');
    setSecondsLeft(MAX_SECONDS);
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

  useEffect(() => {
    if (phase === 'speaking' && !speech.isListening && speech.transcript && word) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setPhase('evaluating');

      evaluateVocabSentenceUse(word.word, word.meaning, speech.transcript)
        .then((res) => {
          setResult(res);
          setPhase('done');
        })
        .catch(() => {
          setResult({
            correctness: 0, naturalness: 0, grammar: 0,
            overall_score: 0, feedback: 'Evaluation failed. Try again.',
            model_sentence: '',
          });
          setPhase('done');
        });
    }
  }, [speech.isListening, speech.transcript, phase, word]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const scoreColor = (score: number) =>
    score >= 8 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444';

  if (!word && !loading) return null;

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>
          <BookOpen size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          Vocab Sentence
        </h3>
        <button
          className="btn btn-secondary"
          onClick={fetchWord}
          disabled={loading || phase === 'evaluating'}
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>Loading word...</p>
      ) : word ? (
        <>
          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 12,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 4 }}>
              {word.word}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {word.meaning}
            </div>
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            Speak a sentence using "<strong>{word.word}</strong>" in context.
          </p>

          {phase === 'idle' && (
            <button
              className="btn btn-primary"
              onClick={startSpeaking}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Mic size={16} /> Start Speaking
            </button>
          )}

          {phase === 'speaking' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '1.5rem', fontWeight: 700, marginBottom: 8,
                color: secondsLeft <= 5 ? '#ef4444' : 'var(--text-primary)',
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

          {phase === 'evaluating' && (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Evaluating your sentence...
            </p>
          )}

          {phase === 'done' && result && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, justifyContent: 'center' }}>
                {[
                  { label: 'Correct', value: result.correctness },
                  { label: 'Natural', value: result.naturalness },
                  { label: 'Grammar', value: result.grammar },
                ].map(({ label, value }) => (
                  <div key={label} style={{
                    textAlign: 'center', padding: '6px 10px', borderRadius: 8,
                    background: `${scoreColor(value)}10`, border: `1px solid ${scoreColor(value)}30`,
                    minWidth: 60,
                  }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: scoreColor(value) }}>{value}/10</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{label}</div>
                  </div>
                ))}
              </div>

              <div style={{
                padding: 10, borderRadius: 8, fontSize: '0.8rem',
                background: 'var(--card-bg)', border: '1px solid var(--border)', marginBottom: 8,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Feedback</div>
                <div style={{ color: 'var(--text-secondary)' }}>{result.feedback}</div>
              </div>

              {result.model_sentence && (
                <div style={{
                  padding: 10, borderRadius: 8, fontSize: '0.8rem',
                  background: '#8b5cf610', border: '1px solid #8b5cf630',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: '#8b5cf6' }}>💡 Model sentence</div>
                  <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{result.model_sentence}</div>
                </div>
              )}

              <button
                className="btn btn-secondary"
                onClick={fetchWord}
                style={{ width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
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
