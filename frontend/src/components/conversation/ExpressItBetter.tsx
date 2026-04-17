import { useState, useCallback } from 'react';
import { Volume2, Mic, RotateCcw, CheckCircle, XCircle, Sparkles } from 'lucide-react';
import { api } from '../../api';
import type { ExpressBetterPair } from '../../api';

interface Props {
  conversationId: number;
  tts: { speak: (text: string) => void; isSpeaking: boolean };
  speechRecognition: {
    isListening: boolean;
    transcript: string;
    startListening: () => void;
    stopListening: () => void;
  };
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

interface AttemptResult {
  original: string;
  upgraded: string;
  explanation: string;
  transcript: string;
  accuracy: number;
}

export function ExpressItBetter({ conversationId, tts, speechRecognition }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [pairs, setPairs] = useState<ExpressBetterPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hasListened, setHasListened] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [finished, setFinished] = useState(false);

  const handleExpand = useCallback(async () => {
    setExpanded(true);
    setLoading(true);
    setError('');
    try {
      const res = await api.getExpressBetter(conversationId);
      if (res.pairs.length === 0) {
        setError('No messages found to upgrade.');
      } else {
        setPairs(res.pairs);
      }
    } catch {
      setError('Failed to load Express It Better drill.');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const handleListen = useCallback(() => {
    if (pairs[currentIndex]) {
      tts.speak(pairs[currentIndex].upgraded);
      setHasListened(true);
    }
  }, [pairs, currentIndex, tts]);

  const handleRecord = useCallback(() => {
    if (speechRecognition.isListening) {
      speechRecognition.stopListening();
      setHasRecorded(true);
    } else {
      speechRecognition.startListening();
    }
  }, [speechRecognition]);

  const handleSubmit = useCallback(() => {
    const pair = pairs[currentIndex];
    const transcript = speechRecognition.transcript;
    const upgradedWords = normalizeText(pair.upgraded).split(' ');
    const userWords = normalizeText(transcript).split(' ');
    let matches = 0;
    upgradedWords.forEach((w, i) => {
      if (userWords[i] === w) matches++;
    });
    const accuracy = Math.round((matches / upgradedWords.length) * 100);

    setResults(prev => [...prev, {
      original: pair.original,
      upgraded: pair.upgraded,
      explanation: pair.explanation,
      transcript,
      accuracy,
    }]);

    if (currentIndex < pairs.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setHasListened(false);
      setHasRecorded(false);
    } else {
      setFinished(true);
    }
  }, [pairs, currentIndex, speechRecognition.transcript]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setHasListened(false);
    setHasRecorded(false);
    setResults([]);
    setFinished(false);
  }, []);

  if (!expanded) {
    return (
      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        <button
          onClick={handleExpand}
          style={{
            padding: '0.6rem 1.2rem', borderRadius: 8,
            border: '2px solid var(--accent, #8b5cf6)', background: 'transparent',
            color: 'var(--accent, #8b5cf6)', fontWeight: 600,
            fontSize: '0.9rem', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Sparkles size={16} /> Express It Better
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Generating upgraded expressions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
      </div>
    );
  }

  if (finished) {
    const avgAccuracy = Math.round(results.reduce((sum, r) => sum + r.accuracy, 0) / results.length);
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
        <h4 style={{ margin: '0 0 12px', textAlign: 'center' }}>Express It Better — Complete!</h4>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: avgAccuracy >= 80 ? 'var(--success, #22c55e)' : avgAccuracy >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)' }}>
            {avgAccuracy}%
          </span>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>average accuracy</p>
        </div>
        {results.map((r, i) => (
          <div key={i} style={{ padding: 8, marginBottom: 6, background: 'var(--card-bg, #fff)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            {r.accuracy >= 80
              ? <CheckCircle size={16} color="var(--success, #22c55e)" />
              : <XCircle size={16} color="var(--danger, #ef4444)" />}
            <div style={{ flex: 1, fontSize: 13 }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                You said: "{r.original}"
              </div>
              <div style={{ color: 'var(--text)', fontWeight: 600 }}>
                Better: "{r.upgraded}"
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                Your attempt: "{r.transcript}" — {r.accuracy}%
              </div>
            </div>
          </div>
        ))}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            onClick={handleRestart}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.4rem 0.8rem', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--card-bg, #fff)',
              color: 'var(--text)', cursor: 'pointer', fontSize: '0.85rem',
            }}
          >
            <RotateCcw size={14} /> Try Again
          </button>
        </div>
      </div>
    );
  }

  const currentPair = pairs[currentIndex];

  return (
    <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={16} /> Express It Better
        </h4>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {pairs.length}
        </span>
      </div>

      {/* Original (dimmed) */}
      <div style={{ marginBottom: 8 }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>You said:</p>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          "{currentPair.original}"
        </p>
      </div>

      {/* Upgraded (highlighted) */}
      <div style={{ marginBottom: 8, padding: 10, background: 'var(--card-bg, #fff)', borderRadius: 6, borderLeft: '3px solid var(--accent, #8b5cf6)' }}>
        <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-secondary)' }}>A fluent speaker would say:</p>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.5 }}>
          "{currentPair.upgraded}"
        </p>
      </div>

      {/* Explanation */}
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
        💡 {currentPair.explanation}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={handleListen}
          disabled={tts.isSpeaking}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '0.5rem 1rem', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--card-bg, #fff)',
            color: tts.isSpeaking ? 'var(--text-secondary)' : 'var(--primary, #6366f1)',
            cursor: tts.isSpeaking ? 'default' : 'pointer', fontSize: '0.85rem',
            opacity: tts.isSpeaking ? 0.5 : 1,
          }}
        >
          <Volume2 size={16} /> {tts.isSpeaking ? 'Playing...' : 'Listen'}
        </button>

        {hasListened && (
          <button
            onClick={handleRecord}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
              background: speechRecognition.isListening ? 'var(--danger, #ef4444)' : 'var(--primary, #6366f1)',
              color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
            }}
          >
            <Mic size={16} /> {speechRecognition.isListening ? 'Stop' : 'Shadow'}
          </button>
        )}

        {hasRecorded && speechRecognition.transcript && !speechRecognition.isListening && (
          <button
            onClick={handleSubmit}
            style={{
              padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
              background: 'var(--success, #22c55e)', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
            }}
          >
            Submit & Next
          </button>
        )}
      </div>

      {speechRecognition.transcript && hasRecorded && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--card-bg, #fff)', borderRadius: 6, borderLeft: '3px solid var(--primary, #6366f1)' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>You said:</p>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }}>
            "{speechRecognition.transcript}"
          </p>
        </div>
      )}
    </div>
  );
}
