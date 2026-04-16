import { useState, useCallback, useEffect, useRef } from 'react';
import { Volume2, Mic, RefreshCw } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { api } from '../api';

interface TongueTwister {
  text: string;
  target_sounds: string[];
  slow_hint: string;
  difficulty: string;
}

interface WordResult {
  word: string;
  matched: boolean;
}

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[.,!?;:'"()—–-]/g, '').trim();
}

function computeWordResults(reference: string, spoken: string): WordResult[] {
  const refWords = reference.split(/\s+/).filter(Boolean);
  const spokenNormalized = spoken.split(/\s+/).filter(Boolean).map(normalizeWord);
  return refWords.map(word => ({
    word,
    matched: spokenNormalized.includes(normalizeWord(word)),
  }));
}

function computeClarity(results: WordResult[]): number {
  if (results.length === 0) return 0;
  const matched = results.filter(r => r.matched).length;
  return Math.round((matched / results.length) * 100);
}

export default function QuickTongueTwisterCard() {
  const tts = useSpeechSynthesis();
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });

  const [twister, setTwister] = useState<TongueTwister | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'speaking' | 'done'>('idle');
  const [wordResults, setWordResults] = useState<WordResult[]>([]);
  const [clarity, setClarity] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const wasListeningRef = useRef(false);

  const fetchTwister = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const data = await api.getTongueTwister(difficulty);
      setTwister(data);
      setPhase('idle');
      setWordResults([]);
      setClarity(0);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchTwister();
    }
  }, [initialized, fetchTwister]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setWordResults([]);
        setClarity(0);
        fetchTwister();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchTwister]);

  // Compute results when speech recognition stops
  useEffect(() => {
    if (wasListeningRef.current && !speech.isListening && twister && phase === 'speaking') {
      const transcript = speech.transcript || '';
      if (transcript.trim()) {
        const results = computeWordResults(twister.text, transcript);
        setWordResults(results);
        setClarity(computeClarity(results));
      }
      setPhase('done');
    }
    wasListeningRef.current = speech.isListening;
  }, [speech.isListening, speech.transcript, twister, phase]);

  if (!tts.isSupported || !speech.isSupported) return null;

  const handleListen = useCallback(() => {
    if (!twister) return;
    tts.speak(twister.text);
    setPhase('listening');
  }, [twister, tts]);

  const handleListenSlow = useCallback(() => {
    if (!twister) return;
    const prevRate = tts.rate;
    tts.setRate(0.6);
    tts.speak(twister.text);
    // Restore rate after speaking finishes
    setTimeout(() => tts.setRate(prevRate), 100);
  }, [twister, tts]);

  const handleStartSpeaking = useCallback(() => {
    speech.reset();
    setWordResults([]);
    setClarity(0);
    setPhase('speaking');
    speech.start();
  }, [speech]);

  const handleStopSpeaking = useCallback(() => {
    speech.stop();
  }, [speech]);

  const handleRetry = useCallback(() => {
    speech.reset();
    setWordResults([]);
    setClarity(0);
    setPhase('idle');
  }, [speech]);

  const handleNew = useCallback(() => {
    speech.reset();
    setWordResults([]);
    setClarity(0);
    setPhase('idle');
    fetchTwister();
  }, [speech, fetchTwister]);

  const clarityColor = clarity >= 80 ? '#22c55e' : clarity >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{
      background: 'var(--card-bg, white)', borderRadius: 16, padding: 20,
      border: '1px solid var(--border)', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '1.3rem' }}>👅</span>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Tongue Twister</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading tongue twister…</p>
      ) : !twister ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No tongue twister available.</p>
      ) : (
        <div>
          {/* Tongue twister text */}
          <p style={{
            fontSize: '1.1rem', lineHeight: 1.6, marginBottom: 8,
            color: 'var(--text)', fontWeight: 600, fontStyle: 'italic',
          }}>
            "{twister.text}"
          </p>

          {/* Target sounds */}
          {twister.target_sounds.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {twister.target_sounds.map((sound, i) => (
                <span key={i} style={{
                  padding: '2px 8px', borderRadius: 12,
                  background: 'var(--primary-light, #eff6ff)',
                  color: 'var(--primary, #3b82f6)', fontSize: '0.8rem', fontWeight: 600,
                }}>
                  /{sound}/
                </span>
              ))}
            </div>
          )}

          {/* Slow hint */}
          {twister.slow_hint && phase === 'idle' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 12px', fontStyle: 'italic' }}>
              💡 Slow: {twister.slow_hint}
            </p>
          )}

          {/* Action buttons */}
          {(phase === 'idle' || phase === 'listening') && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button onClick={handleListen} disabled={tts.isSpeaking} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
                opacity: tts.isSpeaking ? 0.6 : 1,
              }}>
                <Volume2 size={16} /> Listen
              </button>
              <button onClick={handleListenSlow} disabled={tts.isSpeaking} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
                opacity: tts.isSpeaking ? 0.6 : 1,
              }}>
                🐢 Slow
              </button>
              <button onClick={handleStartSpeaking} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', border: 'none',
                background: 'var(--primary)', color: 'white', fontSize: '0.9rem', fontWeight: 600,
              }}>
                <Mic size={16} /> Speak
              </button>
            </div>
          )}

          {/* Speaking phase */}
          {phase === 'speaking' && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'pulse 1.5s infinite',
                }}>
                  <Mic size={16} color="white" />
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  🎙️ Listening…
                </span>
              </div>
              {(speech.transcript || speech.interimTranscript) && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 8px' }}>
                  {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
                </p>
              )}
              <button onClick={handleStopSpeaking} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, cursor: 'pointer', border: 'none',
                background: '#ef4444', color: 'white', fontSize: '0.9rem', fontWeight: 600,
              }}>
                ⏹ Done
              </button>
            </div>
          )}

          {/* Results phase */}
          {phase === 'done' && (
            <div>
              {/* Clarity score */}
              <div style={{
                padding: 12, borderRadius: 8, marginBottom: 12,
                background: clarity >= 80 ? 'var(--success-bg, #d1fae5)'
                  : clarity >= 50 ? 'var(--warning-bg, #fef3c7)'
                  : 'var(--error-bg, #fee2e2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 700, color: clarityColor }}>
                    {clarity}%
                  </span>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {clarity >= 80 ? 'Excellent clarity!' : clarity >= 50 ? 'Good attempt!' : 'Keep practicing!'}
                  </span>
                </div>

                {/* Word-by-word results */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {wordResults.map((wr, i) => (
                    <span key={i} style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: '0.9rem',
                      background: wr.matched ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                      color: wr.matched ? '#16a34a' : '#dc2626',
                      fontWeight: 500,
                      textDecoration: wr.matched ? 'none' : 'underline wavy',
                    }}>
                      {wr.word}
                    </span>
                  ))}
                </div>
              </div>

              {speech.transcript && (
                <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  You said: "{speech.transcript}"
                </p>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={handleRetry} className="btn btn-secondary" style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                  borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)',
                  background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem',
                }}>
                  🔄 Retry
                </button>
                <button onClick={handleNew} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                  borderRadius: 8, cursor: 'pointer', border: 'none',
                  background: 'var(--primary)', color: 'white', fontSize: '0.9rem', fontWeight: 600,
                }}>
                  <RefreshCw size={16} /> New Twister
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
