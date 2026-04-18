import { useState, useEffect } from 'react';
import { Volume2, X } from 'lucide-react';
import { getWordFamily, type WordFamilyForm } from '../api';

const POS_COLORS: Record<string, { bg: string; text: string }> = {
  noun: { bg: '#3b82f6', text: '#ffffff' },
  verb: { bg: '#22c55e', text: '#ffffff' },
  adjective: { bg: '#f97316', text: '#ffffff' },
  adverb: { bg: '#a855f7', text: '#ffffff' },
};

function getPosStyle(pos: string) {
  const key = pos.toLowerCase();
  return POS_COLORS[key] ?? { bg: 'var(--text-secondary)', text: '#ffffff' };
}

interface WordFamilyPanelProps {
  word: string;
  wordId: number;
  onClose: () => void;
}

export default function WordFamilyPanel({ word, wordId, onClose }: WordFamilyPanelProps) {
  const [forms, setForms] = useState<WordFamilyForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mini quiz state
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizFormIndex, setQuizFormIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);
  const [quizRevealed, setQuizRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getWordFamily(wordId)
      .then((res) => {
        if (!cancelled) setForms(res.forms || []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load word family.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [wordId]);

  const speakWord = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'en-US';
      window.speechSynthesis.speak(utt);
    }
  };

  const startQuiz = () => {
    setQuizStarted(true);
    setQuizFormIndex(0);
    setQuizAnswer(null);
    setQuizRevealed(false);
  };

  const currentQuizForm = forms[quizFormIndex] as WordFamilyForm | undefined;

  const handleQuizPick = (form: string) => {
    if (quizRevealed) return;
    setQuizAnswer(form);
    setQuizRevealed(true);
  };

  const nextQuizQuestion = () => {
    const next = quizFormIndex + 1;
    if (next >= forms.length) {
      setQuizStarted(false);
      return;
    }
    setQuizFormIndex(next);
    setQuizAnswer(null);
    setQuizRevealed(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label={`Word family for ${word}`}
    >
      <div
        className="card"
        style={{
          maxWidth: 520,
          width: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          padding: 24,
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close word family panel"
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <X size={20} />
        </button>

        <h3 style={{ marginBottom: 4 }}>🔤 Word Family</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
          Explore all forms of <strong>{word}</strong>
        </p>

        {loading && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <span>⏳ Loading word family...</span>
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--danger-text-vivid)' }}>
            {error}
          </div>
        )}

        {!loading && !error && forms.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
            No word forms found.
          </div>
        )}

        {!loading && !error && forms.length > 0 && !quizStarted && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {forms.map((f, i) => {
                const posStyle = getPosStyle(f.part_of_speech);
                return (
                  <div
                    key={i}
                    className="card"
                    style={{ padding: '12px 16px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 600,
                          background: posStyle.bg,
                          color: posStyle.text,
                        }}
                      >
                        {f.part_of_speech}
                      </span>
                      <strong style={{ fontSize: 16 }}>{f.form}</strong>
                      <button
                        onClick={() => speakWord(f.form)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--primary)', padding: 2,
                        }}
                        aria-label={`Listen to ${f.form}`}
                        title="Listen"
                      >
                        <Volume2 size={16} />
                      </button>
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
                      {f.example_sentence}
                    </p>
                    {f.pronunciation_tip && (
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, fontStyle: 'italic' }}>
                        💡 {f.pronunciation_tip}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {forms.length >= 2 && (
              <button
                className="btn btn-primary"
                onClick={startQuiz}
                style={{ marginTop: 16, width: '100%' }}
              >
                🧩 Mini Quiz: Pick the correct form
              </button>
            )}
          </>
        )}

        {quizStarted && currentQuizForm && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Question {quizFormIndex + 1} of {forms.length}
            </p>
            <p style={{ marginBottom: 4, fontWeight: 600 }}>
              Which form is the <em>{currentQuizForm.part_of_speech}</em>?
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              "{currentQuizForm.example_sentence}"
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {forms.map((f, i) => {
                const isCorrect = f.form === currentQuizForm.form;
                const isSelected = quizAnswer === f.form;
                let bg = 'var(--card-bg, #f9fafb)';
                let border = '1px solid var(--border, #e5e7eb)';
                if (quizRevealed && isCorrect) {
                  bg = 'var(--success-bg)';
                  border = '2px solid var(--success-border, #22c55e)';
                }
                if (quizRevealed && isSelected && !isCorrect) {
                  bg = 'var(--danger-bg)';
                  border = '2px solid var(--danger-border, #ef4444)';
                }
                return (
                  <button
                    key={i}
                    onClick={() => handleQuizPick(f.form)}
                    style={{
                      padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                      background: bg, border, fontWeight: 500,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {f.form}
                  </button>
                );
              })}
            </div>
            {quizRevealed && (
              <button
                className="btn btn-primary"
                onClick={nextQuizQuestion}
                style={{ marginTop: 16 }}
              >
                {quizFormIndex + 1 >= forms.length ? 'Finish' : 'Next →'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
