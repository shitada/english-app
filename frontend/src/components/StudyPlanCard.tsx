import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Clock, ChevronRight, PartyPopper } from 'lucide-react';
import { getStudyPlan, type StudyPlanStep } from '../api';

function getTodayKey(): string {
  return `study-plan-completed-${new Date().toISOString().slice(0, 10)}`;
}

function loadCompletedSteps(): Set<number> {
  try {
    const raw = localStorage.getItem(getTodayKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveCompletedSteps(completed: Set<number>): void {
  try {
    localStorage.setItem(getTodayKey(), JSON.stringify([...completed]));
  } catch { /* ignore */ }
}

export default function StudyPlanCard() {
  const [steps, setSteps] = useState<StudyPlanStep[]>([]);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(loadCompletedSteps);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getStudyPlan()
      .then((res) => {
        setSteps(res.steps);
        setTotalMinutes(res.total_minutes);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const toggleStep = useCallback((index: number) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      saveCompletedSteps(next);
      return next;
    });
  }, []);

  if (error || (!loading && steps.length === 0)) return null;

  if (loading) {
    return (
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ height: 20, width: '50%', background: 'var(--border, #e5e7eb)', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 12, width: '80%', background: 'var(--border, #e5e7eb)', borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 12, width: '60%', background: 'var(--border, #e5e7eb)', borderRadius: 4 }} />
      </div>
    );
  }

  const completedCount = steps.filter((_, i) => completed.has(i)).length;
  const allDone = completedCount === steps.length && steps.length > 0;
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  return (
    <div
      className="card"
      style={{
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: allDone ? '2px solid var(--success, #10b981)' : undefined,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.05rem' }}>
          <span style={{ fontSize: 20 }}>📋</span>
          Today's Study Plan
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>
          <Clock size={14} />
          <span>{totalMinutes} min</span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', marginBottom: 4 }}>
          <span>{completedCount}/{steps.length} steps</span>
          <span>{progressPct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--border, #e5e7eb)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              borderRadius: 3,
              background: allDone
                ? 'var(--success, #10b981)'
                : 'linear-gradient(90deg, var(--primary, #6366f1), #8b5cf6)',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Celebration */}
      {allDone && (
        <div
          data-testid="study-plan-celebration"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0.75rem 1rem',
            marginBottom: 16,
            borderRadius: 10,
            background: 'var(--success-bg, #f0fdf4)',
            color: 'var(--success, #10b981)',
          }}
        >
          <PartyPopper size={22} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>All done for today! 🎉</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>Great work completing your study plan.</div>
          </div>
        </div>
      )}

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, index) => {
          const isDone = completed.has(index);
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: isDone ? 'var(--success-bg, #f0fdf4)' : 'var(--bg-secondary, #f9fafb)',
                border: `1px solid ${isDone ? 'var(--success, #10b981)' : 'var(--border, #e5e7eb)'}`,
                opacity: isDone ? 0.75 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              {/* Step number / check button */}
              <button
                data-testid={`study-plan-step-${index}`}
                onClick={() => toggleStep(index)}
                aria-label={isDone ? `Mark step ${index + 1} incomplete` : `Mark step ${index + 1} complete`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: isDone ? 'none' : '2px solid var(--border, #d1d5db)',
                  background: isDone ? 'var(--success, #10b981)' : 'transparent',
                  color: isDone ? '#fff' : 'var(--text-secondary, #6b7280)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: 0,
                  transition: 'all 0.2s',
                }}
              >
                {isDone ? <CheckCircle size={16} /> : index + 1}
              </button>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 2,
                }}>
                  <span style={{ fontSize: 16 }}>{step.icon}</span>
                  <span style={{
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    color: 'var(--text, #111827)',
                    textDecoration: isDone ? 'line-through' : 'none',
                  }}>
                    {step.title}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary, #6b7280)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {step.description}
                </div>
              </div>

              {/* Time + go button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                  {step.estimated_minutes}m
                </span>
                <Link
                  to={step.route}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'var(--primary, #6366f1)',
                    color: '#fff',
                    textDecoration: 'none',
                    flexShrink: 0,
                  }}
                  aria-label={`Go to ${step.title}`}
                >
                  <ChevronRight size={16} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
