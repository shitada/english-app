import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Volume2, Mic, RotateCcw, CheckCircle, XCircle } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import type { PronunciationWeaknessItem } from '../../api';

interface Props {
  words: PronunciationWeaknessItem[];
  onClose: () => void;
}

interface AttemptResult {
  word: string;
  spoken: string;
  isMatch: boolean;
}

function normalizeWord(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]+/g, '').replace(/\s+/g, ' ');
}

const LS_KEY = 'pronunciation-word-drill-completed';

function getCompletedWords(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function markWordCompleted(word: string) {
  const completed = getCompletedWords();
  if (!completed.includes(word)) {
    completed.push(word);
    localStorage.setItem(LS_KEY, JSON.stringify(completed));
  }
}

export function PronunciationWordDrill({ words, onClose }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [finished, setFinished] = useState(false);
  const [hasListened, setHasListened] = useState(false);

  const speech = useSpeechRecognition({ continuous: false });
  const tts = useSpeechSynthesis();

  const currentWord = words[currentIndex];

  // Speak the word slowly via TTS
  const handleListen = useCallback(() => {
    if (!currentWord) return;
    const prevRate = tts.rate;
    tts.setRate(0.6);
    tts.speak(currentWord.word);
    // Restore rate after a tick so the utterance picks up the slow rate
    setTimeout(() => tts.setRate(prevRate), 100);
    setHasListened(true);
  }, [currentWord, tts]);

  // Start recording user's pronunciation
  const handleRecord = useCallback(() => {
    speech.reset();
    speech.start();
  }, [speech]);

  // Stop recording
  const handleStopRecording = useCallback(() => {
    speech.stop();
  }, [speech]);

  // Check result when speech recognition finishes
  useEffect(() => {
    if (!speech.isListening && speech.transcript && !showResult) {
      const isMatch = normalizeWord(speech.transcript) === normalizeWord(currentWord.word);
      setResults(prev => [...prev, {
        word: currentWord.word,
        spoken: speech.transcript,
        isMatch,
      }]);
      setShowResult(true);
    }
  }, [speech.isListening, speech.transcript, showResult, currentWord]);

  // Advance to next word
  const handleNext = useCallback(() => {
    setShowResult(false);
    setHasListened(false);
    speech.reset();
    if (currentIndex < words.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
      words.forEach(w => markWordCompleted(w.word));
    }
  }, [currentIndex, words, speech]);

  // Retry all words
  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setResults([]);
    setShowResult(false);
    setFinished(false);
    setHasListened(false);
    speech.reset();
  }, [speech]);

  // Summary screen
  if (finished) {
    const correctCount = results.filter(r => r.isMatch).length;
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
            <ArrowLeft size={18} />
          </button>
          <h3 style={{ margin: 0 }}>Pronunciation Drill Complete!</h3>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{
            fontSize: 40,
            fontWeight: 700,
            color: correctCount === words.length ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)',
          }}>
            {correctCount}/{words.length}
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            {correctCount === words.length
              ? '🎉 Perfect pronunciation!'
              : correctCount >= Math.ceil(words.length / 2)
                ? '👍 Good job! Keep practicing.'
                : '💪 Keep going, you'll get there!'}
          </p>
        </div>

        {results.map((r, i) => (
          <div key={i} style={{
            padding: 8, marginBottom: 6,
            background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {r.isMatch
              ? <CheckCircle size={16} color="var(--success, #22c55e)" />
              : <XCircle size={16} color="var(--danger, #ef4444)" />}
            <span style={{ fontSize: 13, flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{r.word}</span>
              {!r.isMatch && (
                <>
                  {' — heard: '}
                  <span style={{ color: 'var(--danger, #ef4444)', fontStyle: 'italic' }}>{r.spoken}</span>
                </>
              )}
            </span>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={handleRestart} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={14} /> Try Again
          </button>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!currentWord) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
          <ArrowLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>🎤 Pronunciation Drill</h3>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {currentIndex + 1} / {words.length}
        </span>
      </div>

      {/* Cumulative score */}
      {results.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
          Score: {results.filter(r => r.isMatch).length}/{results.length}
        </div>
      )}

      {/* Target word */}
      <div style={{
        marginBottom: 12, padding: '12px 16px',
        background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8,
        textAlign: 'center',
      }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>
          Say this word:
        </p>
        <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
          {currentWord.word}
        </p>
        {currentWord.common_heard_as.length > 0 && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
            Often misheard as: {currentWord.common_heard_as.slice(0, 2).map(h => h[0]).join(', ')}
          </p>
        )}
      </div>

      {!showResult ? (
        <div>
          {/* Step 1: Listen */}
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Step 1: Listen to the correct pronunciation
          </p>
          <button
            onClick={handleListen}
            disabled={tts.isSpeaking}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 16, width: '100%', justifyContent: 'center' }}
          >
            <Volume2 size={14} /> {tts.isSpeaking ? 'Playing…' : 'Listen 🔊'}
          </button>

          {/* Step 2: Record */}
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Step 2: Record your pronunciation
          </p>
          {speech.isListening ? (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--accent)', fontStyle: 'italic' }}>
                🎙️ Listening… {speech.interimTranscript || speech.transcript || ''}
              </p>
              <button
                onClick={handleStopRecording}
                className="btn btn-secondary"
                style={{ width: '100%', fontSize: 13 }}
              >
                Done Speaking
              </button>
            </div>
          ) : (
            <button
              onClick={handleRecord}
              disabled={!speech.isSupported}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, width: '100%', justifyContent: 'center' }}
            >
              <Mic size={14} /> {hasListened ? 'Record 🎤' : 'Record 🎤 (listen first!)'}
            </button>
          )}

          {speech.error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--danger, #ef4444)' }}>
              {speech.error}
            </p>
          )}
        </div>
      ) : (
        <div>
          {/* Result feedback */}
          {results[results.length - 1]?.isMatch ? (
            <div style={{
              padding: 10, borderRadius: 6,
              background: 'var(--success-bg, #f0fdf4)', border: '1px solid var(--success, #22c55e)',
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={18} color="var(--success, #22c55e)" />
                <span style={{ fontWeight: 600, color: 'var(--success, #22c55e)' }}>✅ Great pronunciation!</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text)' }}>
                You said: <strong>{results[results.length - 1]?.spoken}</strong>
              </p>
            </div>
          ) : (
            <div style={{
              padding: 10, borderRadius: 6,
              background: 'var(--danger-bg, #fef2f2)', border: '1px solid var(--danger, #ef4444)',
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <XCircle size={18} color="var(--danger, #ef4444)" />
                <span style={{ fontWeight: 600, color: 'var(--danger, #ef4444)' }}>❌ Not quite right</span>
              </div>
              <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text)' }}>
                Expected: <strong style={{ color: 'var(--success, #22c55e)' }}>{currentWord.word}</strong>
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>
                You said: <strong style={{ color: 'var(--danger, #ef4444)' }}>{results[results.length - 1]?.spoken}</strong>
              </p>
            </div>
          )}

          {/* Tips */}
          {currentWord.tips.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {currentWord.tips.map((tip, i) => (
                <p key={i} style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  💡 {tip}
                </p>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleListen}
              disabled={tts.isSpeaking}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <Volume2 size={14} /> Listen Again
            </button>
            <button
              onClick={() => { setShowResult(false); speech.reset(); }}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <Mic size={14} /> Retry
            </button>
            <button onClick={handleNext} className="btn btn-primary" style={{ marginLeft: 'auto' }}>
              {currentIndex < words.length - 1 ? 'Next Word →' : 'See Results'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
