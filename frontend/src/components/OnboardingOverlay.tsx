import { useEffect, useState, useRef } from 'react';
import type { OnboardingStep } from '../hooks/useOnboarding';

interface Props {
  step: OnboardingStep;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function OnboardingOverlay({ step, currentStep, totalSteps, onNext, onPrev, onSkip }: Props) {
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateRect = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect({
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
        });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [step.target]);

  if (!targetRect) return null;

  const padding = 8;
  const spotlightStyle: React.CSSProperties = {
    position: 'absolute',
    top: targetRect.top - padding,
    left: targetRect.left - padding,
    width: targetRect.width + padding * 2,
    height: targetRect.height + padding * 2,
    borderRadius: 12,
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
    zIndex: 1001,
    pointerEvents: 'none',
  };

  const tooltipHeight = 220;
  const gap = 16;
  const belowTop = targetRect.top + targetRect.height + padding + gap;
  const aboveTop = targetRect.top - padding - gap - tooltipHeight;
  const fitsBelow = belowTop + tooltipHeight < window.innerHeight + window.scrollY;
  const tooltipTop = fitsBelow ? belowTop : Math.max(window.scrollY + 16, aboveTop);
  const tooltipLeft = Math.max(16, Math.min(
    targetRect.left + targetRect.width / 2 - 160,
    window.innerWidth - 336
  ));

  const tooltipStyle: React.CSSProperties = {
    position: 'absolute',
    top: tooltipTop,
    left: tooltipLeft,
    zIndex: 1002,
  };

  const isLast = currentStep === totalSteps - 1;
  const isFirst = currentStep === 0;

  return (
    <div className="onboarding-overlay" onClick={onSkip}>
      <div style={spotlightStyle} />
      <div
        ref={tooltipRef}
        className="onboarding-tooltip"
        style={tooltipStyle}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Onboarding step ${currentStep + 1} of ${totalSteps}: ${step.title}`}
      >
        <div className="onboarding-tooltip-header">
          <span className="onboarding-step-count">
            {currentStep + 1} of {totalSteps}
          </span>
          <button className="onboarding-skip-btn" onClick={onSkip}>
            Skip tour
          </button>
        </div>
        <h4 className="onboarding-tooltip-title">{step.title}</h4>
        <p className="onboarding-tooltip-desc">{step.description}</p>
        <div className="onboarding-dots">
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              className={`onboarding-dot${i === currentStep ? ' active' : ''}`}
            />
          ))}
        </div>
        <div className="onboarding-tooltip-actions">
          {!isFirst && (
            <button className="onboarding-btn secondary" onClick={onPrev}>
              Back
            </button>
          )}
          <button className="onboarding-btn primary" onClick={onNext}>
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
