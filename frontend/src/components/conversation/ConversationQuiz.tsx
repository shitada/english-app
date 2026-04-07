import type { ConversationQuizQuestion } from '../../api';

interface ConversationQuizProps {
  questions: ConversationQuizQuestion[];
  quizIndex: number;
  quizAnswers: (number | null)[];
  quizRevealed: boolean;
  quizFinished: boolean;
  quizLoading: boolean;
  quizError: string;
  onAnswer: (optionIndex: number) => void;
  onNext: () => void;
  onStart: () => void;
}

export function ConversationQuiz({
  questions,
  quizIndex,
  quizAnswers,
  quizRevealed,
  quizFinished,
  quizLoading,
  quizError,
  onAnswer,
  onNext,
  onStart,
}: ConversationQuizProps) {
  if (quizFinished && questions.length > 0) {
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8, textAlign: 'center' }}>
        <h4 style={{ marginBottom: 8 }}>Quiz Complete!</h4>
        <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--primary)' }}>
          {quizAnswers.filter((a, i) => a === questions[i].correct_index).length}/{questions.length}
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>correct answers</p>
      </div>
    );
  }

  if (questions.length > 0) {
    return (
      <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 8 }}>
        <h4 style={{ marginBottom: 12 }}>📝 Quick Quiz ({quizIndex + 1}/{questions.length})</h4>
        <p style={{ marginBottom: 12, fontWeight: 500 }}>{questions[quizIndex].question}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {questions[quizIndex].options.map((opt, i) => {
            const isSelected = quizAnswers[quizIndex] === i;
            const isCorrect = i === questions[quizIndex].correct_index;
            let bg = 'var(--card-bg, #fff)';
            let border = '1px solid var(--border, #e5e7eb)';
            if (quizRevealed) {
              if (isCorrect) { bg = '#dcfce7'; border = '2px solid var(--success, #22c55e)'; }
              else if (isSelected && !isCorrect) { bg = '#fee2e2'; border = '2px solid var(--danger, #ef4444)'; }
            }
            return (
              <button
                key={i}
                onClick={() => onAnswer(i)}
                disabled={quizRevealed}
                style={{ padding: '10px 14px', background: bg, border, borderRadius: 6, cursor: quizRevealed ? 'default' : 'pointer', textAlign: 'left', fontSize: 14 }}
              >
                {String.fromCharCode(65 + i)}. {opt}
              </button>
            );
          })}
        </div>
        {quizRevealed && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {quizAnswers[quizIndex] === questions[quizIndex].correct_index ? '✅ Correct!' : '❌ Incorrect.'}{' '}
              {questions[quizIndex].explanation}
            </p>
            <button className="btn btn-primary" onClick={onNext} style={{ fontSize: 14, padding: '6px 16px' }}>
              {quizIndex < questions.length - 1 ? 'Next Question →' : 'See Results'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Quiz not started yet
  return (
    <>
      {!quizLoading && !quizError && (
        <button className="btn" onClick={onStart} style={{ background: 'var(--primary-light, #e0e7ff)', color: 'var(--primary-dark, #4338ca)' }}>
          📝 Take Quick Quiz
        </button>
      )}
      {quizError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--danger, #ef4444)', fontSize: 14 }}>{quizError}</span>
          <button className="btn" onClick={onStart} style={{ background: 'var(--primary-light, #e0e7ff)', color: 'var(--primary-dark, #4338ca)', fontSize: 13 }}>
            Retry
          </button>
        </div>
      )}
      {quizLoading && (
        <button className="btn" disabled style={{ opacity: 0.6 }}>
          Generating quiz…
        </button>
      )}
    </>
  );
}
