import { useState, useCallback } from 'react';
import { Volume2, Mic, RotateCcw, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../../api';

interface Phrase {
  text: string;
  word_count: number;
}

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
  phrase: string;
  transcript: string;
  accuracy: number;
}

export function ShadowingExercise({ conversationId, tts, speechRecognition }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
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
      const res = await api.getShadowingPhrases(conversationId);
      if (res.phrases.length === 0) {
        setError('No suitable phrases found in this conversation.');
      } else {
        setPhrases(res.phrases);
      }
    } catch {
      setError('Failed to load shadowing phrases.');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const handleListen = useCallback(() => {
    if (phrases[currentIndex]) {
      tts.speak(phrases[currentIndex].text);
      setHasListened(true);
    }
  }, [phrases, currentIndex, tts]);

  const handleRecord = useCallback(() => {
    if (speechRecognition.isListening) {
      speechRecognition.stopListening();
      setHasRecorded(true);
    } else {
      speechRecognition.startListening();
    }
  }, [speechRecognition]);

  const handleSubmit = useCallback(() => {
    const phrase = phrases[currentIndex];
    const transcript = speechRecognition.transcript;
    const phraseWords = normalizeText(phrase.text).split(' ');
    const userWords = normalizeText(transcript).split(' ');
    let matches = 0;
    phraseWords.forEach((w, i) => {
      if (userWords[i] === w) matches++;
    });
    const accuracy = Math.round((matches / phraseWords.length) * 100);

    setResults(prev => [...prev, { phrase: phrase.text, transcript, accuracy }]);

    if (currentIndex < phrases.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setHasListened(false);
      setHasRecorded(false);
    } else {
      setFinished(true);
    }
  }, [phrases, currentIndex, speechRecognition.transcript]);

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
            border: '2px solid var(--warning, #f59e0b)', background: 'transparent',
            color: 'var(--warning, #f59e0b)', fontWeight: 600,
            fontSize: '0.9rem', cursor: 'pointer',
          }}
        >
          🎤 Shadowing Practice ({'>'}6 phrases)
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading phrases...</p>
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
        <h4 style={{ margin: '0 0 12px', textAlign: 'center' }}>Shadowing Complete!</h4>
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
              <div style={{ color: 'var(--text)' }}>{r.phrase}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                You said: "{r.transcript}" — {r.accuracy}%
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

  const currentPhrase = phrases[currentIndex];

  return (
    <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>🎤 Shadowing Practice</h4>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {phrases.length}
        </span>
      </div>

      <p style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: 'var(--text)' }}>
        "{currentPhrase.text}"
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
            <Mic size={16} /> {speechRecognition.isListening ? 'Stop' : 'Record'}
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
