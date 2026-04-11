import { useState, useCallback, useEffect, useRef } from 'react';
import { Volume2, Mic, RefreshCw } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api } from '../api';

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

export default function QuickShadowCard() {
  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition();

  const [sentence, setSentence] = useState<{ text: string; topic: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'done'>('idle');
  const [accuracy, setAccuracy] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const wasListeningRef = useRef(false);

  // Compute accuracy when speech recognition stops
  useEffect(() => {
    if (wasListeningRef.current && !speech.isListening && sentence && phase === 'listening') {
      const acc = computeAccuracy(sentence.text, speech.transcript);
      setAccuracy(acc);
      setPhase('done');
    }
    wasListeningRef.current = speech.isListening;
  }, [speech.isListening, speech.transcript, sentence, phase]);

  if (!tts.isSupported || !speech.isSupported) return null;

  const loadSentence = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPronunciationSentences();
      if (data.sentences.length > 0) {
        const random = data.sentences[Math.floor(Math.random() * data.sentences.length)];
        setSentence(random);
        setPhase('idle');
        setAccuracy(0);
        setInitialized(true);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const handleListen = useCallback(() => {
    if (!sentence) return;
    tts.speak(sentence.text);
  }, [sentence, tts]);

  const handleRecord = useCallback(() => {
    if (speech.isListening) {
      speech.stop();
    } else {
      speech.reset();
      setPhase('listening');
      speech.start();
    }
  }, [speech]);

  const accentColor = accuracy >= 80 ? '#22c55e' : accuracy >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{
      background: 'var(--card-bg, white)', borderRadius: 16, padding: 20,
      border: '1px solid var(--border)', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '1.3rem' }}>🗣️</span>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Shadow Practice</h3>
      </div>

      {!initialized ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12, fontSize: '0.9rem' }}>
            Listen to a sentence and repeat it. Practice your speaking every day!
          </p>
          <button onClick={loadSentence} disabled={loading} style={{
            padding: '10px 24px', borderRadius: 8, cursor: 'pointer',
            border: 'none', background: 'var(--primary)', color: 'white',
            fontWeight: 600, opacity: loading ? 0.6 : 1,
          }}>
            {loading ? 'Loading...' : 'Start Practice'}
          </button>
        </div>
      ) : sentence ? (
        <div>
          <p style={{
            fontSize: '1.05rem', lineHeight: 1.5, marginBottom: 12,
            color: 'var(--text)', fontStyle: 'italic',
          }}>
            "{sentence.text}"
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={handleListen} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
            }}>
              <Volume2 size={16} /> Listen
            </button>

            <button onClick={handleRecord} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', border: 'none',
              background: speech.isListening ? '#ef4444' : 'var(--primary)',
              color: 'white', fontSize: '0.9rem', fontWeight: 600,
            }}>
              <Mic size={16} /> {speech.isListening ? 'Stop' : 'Speak'}
            </button>

            <button onClick={loadSentence} disabled={loading} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
            }}>
              <RefreshCw size={16} /> New
            </button>
          </div>

          {speech.isListening && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>
              🎙️ Listening... {speech.interimTranscript || speech.transcript || ''}
            </p>
          )}

          {phase === 'done' && (
            <div style={{
              padding: 12, borderRadius: 8, marginTop: 4,
              background: accuracy >= 80 ? 'var(--success-bg, #d1fae5)'
                : accuracy >= 50 ? 'var(--warning-bg, #fef3c7)'
                : 'var(--error-bg, #fee2e2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: accentColor }}>
                  {accuracy}%
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {accuracy >= 80 ? 'Great job!' : accuracy >= 50 ? 'Good try!' : 'Keep practicing!'}
                </span>
              </div>
              {speech.transcript && (
                <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  You said: "{speech.transcript}"
                </p>
              )}
            </div>
          )}

          <a href="/pronunciation" style={{
            display: 'block', marginTop: 12, fontSize: '0.85rem',
            color: 'var(--primary)', textDecoration: 'none',
          }}>
            → Go to Pronunciation for detailed practice
          </a>
        </div>
      ) : null}
    </div>
  );
}
