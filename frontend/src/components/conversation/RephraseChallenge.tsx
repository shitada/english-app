import { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import { api } from '../../api';
import { ScoreBar } from './ScoreBar';

interface Props {
  conversationId: number;
}

interface Sentence {
  text: string;
  word_count: number;
}

interface EvalResult {
  meaning_preserved: boolean;
  naturalness_score: number;
  variety_score: number;
  overall_score: number;
  feedback: string;
}

interface AttemptResult {
  original: string;
  userRephrase: string;
  eval: EvalResult;
}


export function RephraseChallenge({ conversationId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [currentEval, setCurrentEval] = useState<EvalResult | null>(null);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchSentences = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getRephraseSentences(conversationId);
      setSentences(data.sentences || []);
    } catch {
      setSentences([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (expanded && sentences.length === 0 && !loading) {
      fetchSentences();
    }
  }, [expanded, sentences.length, loading, fetchSentences]);

  useEffect(() => {
    if (expanded && !evaluating && !currentEval && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded, currentIndex, evaluating, currentEval]);

  const handleSubmit = useCallback(async () => {
    if (!userInput.trim() || evaluating) return;
    const original = sentences[currentIndex].text;
    setEvaluating(true);
    try {
      const evalResult = await api.evaluateRephrase(original, userInput.trim());
      setCurrentEval(evalResult);
      setResults(prev => [...prev, { original, userRephrase: userInput.trim(), eval: evalResult }]);
    } catch {
      setCurrentEval({
        meaning_preserved: false,
        naturalness_score: 0,
        variety_score: 0,
        overall_score: 0,
        feedback: 'Evaluation failed. Please try again.',
      });
    } finally {
      setEvaluating(false);
    }
  }, [userInput, evaluating, sentences, currentIndex]);

  const handleNext = useCallback(() => {
    setCurrentEval(null);
    setUserInput('');
    if (currentIndex < sentences.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setFinished(true);
    }
  }, [currentIndex, sentences.length]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setUserInput('');
    setResults([]);
    setCurrentEval(null);
    setFinished(false);
  }, []);

  if (!expanded) {
    return (
      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        <button
          onClick={() => setExpanded(true)}
          style={{
            padding: '0.6rem 1.2rem',
            borderRadius: 8,
            border: '2px solid var(--primary, #6366f1)',
            background: 'transparent',
            color: 'var(--primary, #6366f1)',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          🔄 Rephrase Challenge
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, textAlign: 'center' }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading sentences…</p>
      </div>
    );
  }

  if (sentences.length === 0) {
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, textAlign: 'center' }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>No sentences available for rephrasing.</p>
      </div>
    );
  }

  if (finished) {
    const avgScore = results.reduce((s, r) => s + r.eval.overall_score, 0) / results.length;
    const meaningKept = results.filter(r => r.eval.meaning_preserved).length;
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
        <h4 style={{ margin: '0 0 12px', textAlign: 'center' }}>Rephrase Challenge Complete!</h4>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: avgScore >= 7 ? 'var(--success, #22c55e)' : 'var(--primary, #6366f1)' }}>
              {avgScore.toFixed(1)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Avg Score</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: meaningKept === results.length ? 'var(--success, #22c55e)' : 'var(--warning, #f59e0b)' }}>
              {meaningKept}/{results.length}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Meaning Kept</div>
          </div>
        </div>
        {results.map((r, i) => (
          <div key={i} style={{ padding: 10, marginBottom: 8, background: 'var(--card-bg, #fff)', borderRadius: 6, borderLeft: `3px solid ${r.eval.overall_score >= 7 ? 'var(--success, #22c55e)' : r.eval.overall_score >= 5 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {r.eval.meaning_preserved
                ? <CheckCircle size={14} color="var(--success, #22c55e)" />
                : <XCircle size={14} color="var(--danger, #ef4444)" />}
              <span style={{ fontSize: 13, fontWeight: 600 }}>Score: {r.eval.overall_score.toFixed(1)}</span>
            </div>
            <p style={{ margin: '0 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}>Original: {r.original}</p>
            <p style={{ margin: '0 0 2px', fontSize: 13 }}>Your rephrase: {r.userRephrase}</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{r.eval.feedback}</p>
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

  const currentSentence = sentences[currentIndex];

  return (
    <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>🔄 Rephrase Challenge</h4>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {sentences.length}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Say the same thing using different words:
        </p>
        <p style={{
          margin: 0, fontSize: 15, lineHeight: 1.5, padding: 10,
          background: 'var(--card-bg, #fff)', borderRadius: 6,
          borderLeft: '3px solid var(--primary, #6366f1)',
        }}>
          "{currentSentence.text}"
        </p>
      </div>

      {!currentEval ? (
        <div>
          <textarea
            ref={inputRef}
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Type your rephrase here…"
            rows={2}
            style={{
              width: '100%', padding: '0.5rem 0.75rem', borderRadius: 6,
              border: '1px solid var(--border)', fontSize: 14, resize: 'vertical',
              background: 'var(--card-bg, #fff)', color: 'var(--text)',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!userInput.trim() || evaluating}
            style={{
              marginTop: 8, padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
              background: 'var(--primary, #6366f1)', color: '#fff',
              fontWeight: 600, cursor: userInput.trim() && !evaluating ? 'pointer' : 'not-allowed',
              opacity: userInput.trim() && !evaluating ? 1 : 0.5,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {evaluating ? 'Evaluating…' : 'Submit'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{
            padding: 12, borderRadius: 6, marginBottom: 12,
            background: currentEval.meaning_preserved ? 'var(--success-bg, #f0fdf4)' : 'var(--danger-bg, #fef2f2)',
            border: `1px solid ${currentEval.meaning_preserved ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {currentEval.meaning_preserved
                ? <CheckCircle size={18} color="var(--success, #22c55e)" />
                : <XCircle size={18} color="var(--danger, #ef4444)" />}
              <span style={{ fontWeight: 600, color: currentEval.meaning_preserved ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)' }}>
                {currentEval.meaning_preserved ? 'Meaning preserved!' : 'Meaning changed'}
              </span>
              <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 18 }}>
                {currentEval.overall_score.toFixed(1)}/10
              </span>
            </div>
            <ScoreBar label="Naturalness" score={currentEval.naturalness_score} />
            <ScoreBar label="Variety" score={currentEval.variety_score} />
            <p style={{ margin: '8px 0 0', fontSize: 13, fontStyle: 'italic', color: 'var(--text-secondary)' }}>
              {currentEval.feedback}
            </p>
          </div>
          <button
            onClick={handleNext}
            style={{
              padding: '0.4rem 0.8rem', borderRadius: 6, border: 'none',
              background: 'var(--primary, #6366f1)', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {currentIndex < sentences.length - 1 ? (
              <>Next <ArrowRight size={14} /></>
            ) : 'See Results'}
          </button>
        </div>
      )}
    </div>
  );
}
