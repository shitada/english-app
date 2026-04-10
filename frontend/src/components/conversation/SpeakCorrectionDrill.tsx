import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, ChevronDown, ChevronUp, CheckCircle, XCircle, RotateCcw } from 'lucide-react';

interface CorrectionError {
  original: string;
  correction: string;
  explanation: string;
}

interface SpeechRec {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  reset?: () => void;
}

interface Props {
  errors: CorrectionError[];
  tts: { speak: (text: string) => void; isSpeaking: boolean };
  speechRecognition: SpeechRec;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

function wordAccuracy(spoken: string, expected: string): { matches: boolean[]; pct: number } {
  const spokenWords = normalizeText(spoken).split(/\s+/).filter(Boolean);
  const expectedWords = normalizeText(expected).split(/\s+/).filter(Boolean);
  const matches = expectedWords.map((w, i) => spokenWords[i]?.toLowerCase() === w.toLowerCase());
  const correct = matches.filter(Boolean).length;
  const pct = expectedWords.length > 0 ? Math.round((correct / expectedWords.length) * 100) : 0;
  return { matches, pct };
}

export function SpeakCorrectionDrill({ errors, tts, speechRecognition }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<'listen' | 'record' | 'result'>('listen');
  const [results, setResults] = useState<{ spoken: string; correction: string; pct: number }[]>([]);
  const [finished, setFinished] = useState(false);
  const pendingStopRef = useRef(false);

  const current = errors[currentIndex];

  // Capture transcript when recording stops
  useEffect(() => {
    if (pendingStopRef.current && !speechRecognition.isListening && phase === 'record') {
      pendingStopRef.current = false;
      const spoken = speechRecognition.transcript;
      const { pct } = wordAccuracy(spoken, current.correction);
      setResults(prev => [...prev, { spoken, correction: current.correction, pct }]);
      setPhase('result');
    }
  }, [speechRecognition.isListening, speechRecognition.transcript, phase, current]);

  const handleListen = useCallback(() => {
    if (current) tts.speak(current.correction);
  }, [current, tts]);

  const handleStartRecording = () => {
    speechRecognition.reset?.();
    setPhase('record');
    speechRecognition.startListening();
  };

  const handleStopRecording = () => {
    pendingStopRef.current = true;
    speechRecognition.stopListening();
  };

  const handleNext = () => {
    if (currentIndex + 1 >= errors.length) {
      setFinished(true);
    } else {
      setCurrentIndex(currentIndex + 1);
      setPhase('listen');
    }
  };

  const handleReset = () => {
    setCurrentIndex(0);
    setPhase('listen');
    setResults([]);
    setFinished(false);
  };

  const avgAccuracy = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.pct, 0) / results.length)
    : 0;

  if (errors.length === 0) return null;

  return (
    <div style={{
      marginTop: 16,
      padding: 16,
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
        aria-label={expanded ? 'Collapse speak correction drill' : 'Expand speak correction drill'}
      >
        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>🎤 Speak the Correction</h4>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {expanded && !finished && current && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', marginBottom: 12 }}>
            Correction {currentIndex + 1} of {errors.length}
          </div>

          {/* Show the error */}
          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 12,
            background: 'var(--danger-bg, #fef2f2)',
            borderLeft: '3px solid var(--danger, #ef4444)',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', marginBottom: 4 }}>You said:</div>
            <div style={{ fontSize: 15, textDecoration: 'line-through', color: 'var(--danger, #ef4444)' }}>
              {current.original}
            </div>
          </div>

          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 12,
            background: 'var(--success-bg, #f0fdf4)',
            borderLeft: '3px solid var(--success, #22c55e)',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', marginBottom: 4 }}>Correct version:</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--success, #22c55e)' }}>
              {current.correction}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7280)', marginTop: 4 }}>
              💡 {current.explanation}
            </div>
          </div>

          {phase === 'listen' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={handleListen} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Volume2 size={14} /> Listen
              </button>
              <button className="btn btn-primary" onClick={handleStartRecording} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mic size={14} /> Record
              </button>
            </div>
          )}

          {phase === 'record' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <button className="btn btn-danger" onClick={handleStopRecording} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MicOff size={14} /> Stop
                </button>
                <span style={{ fontSize: 13, color: 'var(--danger, #ef4444)', fontWeight: 500 }}>● Recording...</span>
              </div>
              {speechRecognition.transcript && (
                <div style={{
                  padding: 8, background: 'var(--bg-primary, #fff)', borderRadius: 6,
                  fontSize: 14, color: 'var(--text-primary, #1f2937)',
                }}>
                  {speechRecognition.transcript}
                </div>
              )}
            </div>
          )}

          {phase === 'result' && results.length > 0 && (() => {
            const lastResult = results[results.length - 1];
            const { matches } = wordAccuracy(lastResult.spoken, lastResult.correction);
            const correctionWords = normalizeText(lastResult.correction).split(/\s+/).filter(Boolean);
            return (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7280)', marginBottom: 4 }}>Your speech:</div>
                  <div style={{ fontSize: 15, lineHeight: 1.8 }}>
                    {correctionWords.map((word, i) => (
                      <span key={i} style={{
                        color: matches[i] ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
                        fontWeight: matches[i] ? 400 : 600,
                        marginRight: 4,
                      }}>
                        {matches[i] ? <CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> : <XCircle size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />}
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{
                  fontSize: 18, fontWeight: 700, marginBottom: 12,
                  color: lastResult.pct >= 80 ? 'var(--success, #22c55e)' : lastResult.pct >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
                }}>
                  {lastResult.pct}% accurate
                </div>
                <button className="btn btn-primary" onClick={handleNext} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {currentIndex + 1 >= errors.length ? 'See Results' : 'Next Correction →'}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {expanded && finished && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{
            fontSize: 28, fontWeight: 700, marginBottom: 8,
            color: avgAccuracy >= 80 ? 'var(--success, #22c55e)' : avgAccuracy >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
          }}>
            {avgAccuracy}% average accuracy
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary, #6b7280)', marginBottom: 16 }}>
            {results.length} correction{results.length !== 1 ? 's' : ''} practiced
          </div>
          {results.map((r, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 12px', borderRadius: 6, marginBottom: 4,
              background: r.pct >= 80 ? 'var(--success-bg, #f0fdf4)' : 'var(--danger-bg, #fef2f2)',
              fontSize: 13,
            }}>
              <span style={{ flex: 1, textAlign: 'left' }}>{r.correction}</span>
              <span style={{ fontWeight: 600, color: r.pct >= 80 ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)' }}>
                {r.pct}%
              </span>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={handleReset} style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Try Again
          </button>
        </div>
      )}
    </div>
  );
}
