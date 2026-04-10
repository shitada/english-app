import { useState, useCallback, useRef } from 'react';
import { Volume2, Headphones, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { api, checkDictation } from '../../api';

interface Phrase {
  text: string;
  word_count: number;
}

interface Props {
  conversationId: number;
  tts: { speak: (text: string) => void; isSpeaking: boolean };
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ');
}

interface AttemptResult {
  phrase: string;
  userInput: string;
  accuracy: number;
}

export function DictationExercise({ conversationId, tts }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [hasListened, setHasListened] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleExpand = useCallback(async () => {
    setExpanded(true);
    setLoading(true);
    setError('');
    try {
      const res = await api.getShadowingPhrases(conversationId);
      if (res.phrases.length === 0) {
        setError('No suitable phrases found in this conversation.');
      } else {
        setPhrases(res.phrases.slice(0, 5));
      }
    } catch {
      setError('Failed to load dictation phrases.');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const handleListen = useCallback(() => {
    if (phrases[currentIndex]) {
      tts.speak(phrases[currentIndex].text);
      setHasListened(true);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [phrases, currentIndex, tts]);

  const handleSubmit = useCallback(async () => {
    const phrase = phrases[currentIndex];
    try {
      const result = await checkDictation(phrase.text, userInput);
      const accuracy = result.total_words > 0
        ? Math.round((result.correct_words / result.total_words) * 100)
        : 0;
      setResults(prev => [...prev, { phrase: phrase.text, userInput, accuracy }]);
    } catch {
      // Fallback to client-side comparison if API fails
      const phraseWords = normalizeText(phrase.text).split(' ');
      const userWords = normalizeText(userInput).split(' ');
      let matches = 0;
      const maxLen = Math.max(phraseWords.length, userWords.length);
      for (let i = 0; i < maxLen; i++) {
        if (phraseWords[i] && userWords[i] && phraseWords[i] === userWords[i]) {
          matches++;
        }
      }
      const accuracy = Math.round((matches / phraseWords.length) * 100);
      setResults(prev => [...prev, { phrase: phrase.text, userInput, accuracy }]);
    }
    setSubmitted(true);
  }, [phrases, currentIndex, userInput]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= phrases.length) {
      setFinished(true);
    } else {
      setCurrentIndex(prev => prev + 1);
      setUserInput('');
      setHasListened(false);
      setSubmitted(false);
    }
  }, [currentIndex, phrases.length]);

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setUserInput('');
    setHasListened(false);
    setSubmitted(false);
    setResults([]);
    setFinished(false);
  }, []);

  if (!expanded) {
    return (
      <div className="card" style={{ marginBottom: 16, textAlign: 'center', padding: 16 }}>
        <Headphones size={24} style={{ marginBottom: 8, color: 'var(--primary, #6366f1)' }} />
        <h4 style={{ margin: '0 0 4px' }}>Dictation Exercise</h4>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Listen and type what you hear to practice listening comprehension
        </p>
        <button className="btn btn-primary" onClick={handleExpand} style={{ fontSize: 14 }}>
          Start Dictation
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16, padding: 16, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading phrases...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ marginBottom: 16, padding: 16, textAlign: 'center' }}>
        <p style={{ color: 'var(--danger, #ef4444)' }}>{error}</p>
      </div>
    );
  }

  if (finished) {
    const avgAccuracy = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.accuracy, 0) / results.length)
      : 0;
    return (
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h4 style={{ marginBottom: 12 }}>Dictation Results</h4>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{
            fontSize: 36, fontWeight: 700,
            color: avgAccuracy >= 80 ? 'var(--success, #22c55e)' : avgAccuracy >= 50 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)',
          }}>
            {avgAccuracy}%
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Overall Accuracy</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {results.map((r, i) => (
            <div key={i} style={{ padding: 8, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>Phrase {i + 1}</span>
                <span style={{ color: r.accuracy >= 80 ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)', fontWeight: 600 }}>
                  {r.accuracy}%
                </span>
              </div>
              <WordComparison original={r.phrase} userInput={r.userInput} />
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={handleReset} style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, margin: '0 auto' }}>
          <RotateCcw size={14} /> Try Again
        </button>
      </div>
    );
  }

  const phrase = phrases[currentIndex];

  return (
    <div className="card" style={{ marginBottom: 16, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>Dictation Exercise</h4>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {phrases.length}
        </span>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <button
          className="btn btn-primary"
          onClick={handleListen}
          disabled={tts.isSpeaking}
          style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Volume2 size={16} /> {hasListened ? 'Listen Again' : 'Listen'}
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
          {hasListened ? 'Type what you heard below' : 'Click to hear the phrase'}
        </p>
      </div>

      {hasListened && !submitted && (
        <div style={{ marginBottom: 12 }}>
          <input
            ref={inputRef}
            type="text"
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && userInput.trim()) handleSubmit(); }}
            placeholder="Type what you heard..."
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-card, #fff)', color: 'var(--text-primary)',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!userInput.trim()}
            style={{ marginTop: 8, fontSize: 14, width: '100%' }}
          >
            Check
          </button>
        </div>
      )}

      {submitted && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ padding: 12, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {results[results.length - 1].accuracy >= 80
                ? <CheckCircle size={18} color="var(--success, #22c55e)" />
                : <XCircle size={18} color="var(--danger, #ef4444)" />}
              <span style={{ fontWeight: 600 }}>
                {results[results.length - 1].accuracy}% accurate
              </span>
            </div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Correct: </span>
              <span style={{ fontWeight: 600 }}>{phrase.text}</span>
            </div>
            <WordComparison original={phrase.text} userInput={userInput} />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleNext}
            style={{ fontSize: 14, width: '100%' }}
          >
            {currentIndex + 1 >= phrases.length ? 'See Results' : 'Next Phrase'}
          </button>
        </div>
      )}
    </div>
  );
}

function WordComparison({ original, userInput }: { original: string; userInput: string }) {
  const origWords = original.trim().split(/\s+/);
  const userWords = userInput.trim().split(/\s+/);
  const maxLen = Math.max(origWords.length, userWords.length);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 13 }}>
      {Array.from({ length: maxLen }, (_, i) => {
        const oWord = origWords[i] || '';
        const uWord = userWords[i] || '';
        const match = normalizeText(oWord) === normalizeText(uWord);
        return (
          <span
            key={i}
            style={{
              color: match ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
              fontWeight: match ? 400 : 700,
            }}
            title={!match && oWord ? `Expected: ${oWord}` : undefined}
          >
            {uWord || '___'}
          </span>
        );
      })}
    </div>
  );
}
