import { useState, useCallback, useEffect, useRef } from 'react';
import { Headphones, Mic, RefreshCw, Square, RotateCcw } from 'lucide-react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { getDictoglossPassage, evaluateDictogloss, DictoglossPassageResponse, DictoglossEvaluateResponse } from '../api';

const MAX_SECONDS = 60;

export default function QuickDictoglossCard() {
  const speech = useSpeechRecognition({ continuous: true, interimResults: true });
  const tts = useSpeechSynthesis();

  const [passage, setPassage] = useState<DictoglossPassageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'reconstructing' | 'evaluating' | 'done'>('idle');
  const [result, setResult] = useState<DictoglossEvaluateResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS);
  const [replayUsed, setReplayUsed] = useState(false);
  const [replayAvailable, setReplayAvailable] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const fetchPassage = useCallback(async () => {
    setLoading(true);
    try {
      const difficulty = localStorage.getItem('quick-practice-difficulty') || 'intermediate';
      const res = await getDictoglossPassage(difficulty);
      setPassage(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) {
      setInitialized(true);
      fetchPassage();
    }
  }, [initialized, fetchPassage]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'quick-practice-difficulty') {
        setPhase('idle');
        setResult(null);
        setReplayUsed(false);
        setReplayAvailable(true);
        fetchPassage();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchPassage]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleFinish = useCallback(async () => {
    stopTimer();
    speech.stop();
    setPhase('evaluating');

    const elapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    const transcript = speech.transcript || speech.interimTranscript || '';

    if (!passage || !transcript.trim()) {
      setPhase('idle');
      return;
    }

    try {
      const res = await evaluateDictogloss({
        passage_text: passage.passage_text,
        user_reconstruction: transcript,
        replay_used: replayUsed,
        duration_seconds: elapsed,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('idle');
    }
  }, [passage, speech, stopTimer, replayUsed]);

  const startRecording = useCallback(async () => {
    if (!passage) return;
    speech.reset();
    setSecondsLeft(MAX_SECONDS);
    startTimeRef.current = Date.now();
    setPhase('reconstructing');

    await speech.start();

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          handleFinish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [passage, speech, handleFinish]);

  const handleListen = useCallback(() => {
    if (!passage) return;
    setPhase('listening');
    setReplayUsed(false);
    setReplayAvailable(true);
    tts.speak(passage.passage_text);
  }, [passage, tts]);

  const handleReplay = useCallback(() => {
    if (!passage || !replayAvailable || replayUsed) return;
    setReplayUsed(true);
    setReplayAvailable(false);
    tts.speak(passage.passage_text);
  }, [passage, tts, replayAvailable, replayUsed]);

  // When TTS finishes speaking, transition from listening to reconstructing
  useEffect(() => {
    if (phase === 'listening' && !tts.isSpeaking) {
      const timeout = setTimeout(() => {
        if (phase === 'listening') {
          startRecording();
        }
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [phase, tts.isSpeaking, startRecording]);

  const handleNewPassage = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setReplayUsed(false);
    setReplayAvailable(true);
    speech.reset();
    fetchPassage();
  }, [fetchPassage, speech]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  if (!speech.isSupported || !tts.isSupported) return null;

  const scoreColor = (s: number) => s >= 7 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Headphones size={20} color="#06b6d4" />
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Dictogloss</h3>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading passage…</p>
      ) : !passage ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No passage available.</p>
      ) : phase === 'idle' ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
            Listen to a passage, then reconstruct it from memory by speaking.
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
            Topic: <strong>{passage.topic}</strong> · {passage.sentence_count} sentences · 1 optional replay
          </p>
          <button onClick={handleListen} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Headphones size={16} /> Listen & Reconstruct
          </button>
        </div>
      ) : phase === 'listening' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#06b6d4', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Headphones size={18} color="white" />
            </div>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
              Listening to passage…
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Pay close attention — you'll need to reconstruct this from memory!
          </p>
        </div>
      ) : phase === 'reconstructing' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse 1.5s infinite',
            }}>
              <Mic size={18} color="white" />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {secondsLeft}s
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            Now reconstruct the passage from memory!
          </p>
          {(speech.transcript || speech.interimTranscript) && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic', margin: '0 0 0.5rem' }}>
              {speech.transcript}{speech.interimTranscript && <span style={{ opacity: 0.5 }}> {speech.interimTranscript}</span>}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={handleFinish} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Square size={14} /> Done
            </button>
            {!replayUsed && (
              <button
                onClick={handleReplay}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
              >
                <RotateCcw size={14} /> Replay Once
              </button>
            )}
            {replayUsed && (
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', alignSelf: 'center' }}>
                ✓ Replay used
              </span>
            )}
          </div>
        </div>
      ) : phase === 'evaluating' ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Evaluating your reconstruction…</p>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Overall', score: result?.overall_score ?? 0 },
              { label: 'Coverage', score: result?.content_coverage_score ?? 0 },
              { label: 'Grammar', score: result?.grammar_score ?? 0 },
              { label: 'Vocabulary', score: result?.vocabulary_score ?? 0 },
              { label: 'Quality', score: result?.reconstruction_quality_score ?? 0 },
            ].map(({ label, score }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: scoreColor(score) }}>{score}/10</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {result?.feedback}
          </p>
          {result?.model_reconstruction && (
            <div style={{ padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Model reconstruction:</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>"{result.model_reconstruction}"</div>
            </div>
          )}
          <div style={{ padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Original passage:</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>"{passage?.passage_text}"</div>
          </div>
          {replayUsed && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
              📢 Replay was used
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => { setResult(null); setReplayUsed(false); setReplayAvailable(true); setPhase('idle'); }} className="btn btn-secondary">
              Try Again
            </button>
            <button onClick={handleNewPassage} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <RefreshCw size={14} /> New Passage
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
