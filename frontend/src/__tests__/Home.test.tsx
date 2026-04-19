import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// --- Mocks (must come before importing Home) ---

vi.mock('react-router-dom', () => ({
  Link: (props: { to: string; children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement(
      'a',
      { ...props, href: typeof props.to === 'string' ? props.to : '#' },
      props.children,
    ),
  useNavigate: () => () => {},
}));

vi.mock('../i18n/I18nContext', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => {},
    t: (k: string) => k,
    tParam: (k: string) => k,
  }),
  I18nContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

vi.mock('../hooks/useOnboarding', () => ({
  useOnboarding: () => ({
    isActive: false,
    currentStep: 0,
    totalSteps: 0,
    step: null,
    next: () => {},
    prev: () => {},
    skip: () => {},
    restartTour: () => {},
  }),
}));

vi.mock('../components/OnboardingOverlay', () => ({ default: () => null }));
vi.mock('../components/AchievementToast', () => ({
  AchievementToastContainer: () => null,
}));
vi.mock('../components/QuickPracticeHub', () => ({ default: () => null }));
vi.mock('../components/SmartReviewQueue', () => ({ default: () => null }));
vi.mock('../components/SpeakingJournal', () => ({ default: () => null }));
vi.mock('../components/FluencySprintCard', () => ({ default: () => null }));
vi.mock('../components/StudyPlanCard', () => ({ default: () => null }));

// Stub `../api` with a Proxy so every named export resolves to a no-op
// async function. This avoids having to enumerate the many functions Home imports.
vi.mock('../api', () => {
  const stubFn = () => Promise.resolve({});
  const apiObj = new Proxy(
    {},
    { get: () => stubFn },
  );
  return new Proxy(
    { api: apiObj, default: apiObj },
    {
      get: (target, prop) => {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        return stubFn;
      },
    },
  ) as unknown as Record<string, unknown>;
});

import Home from '../pages/Home';

describe('Home page — Listening Warmup tile', () => {
  beforeEach(() => {
    // Effects don't run during renderToStaticMarkup, but guard anyway.
    vi.clearAllMocks();
  });

  it('renders the Listening Warmup tile with a stable test id', () => {
    const html = renderToStaticMarkup(React.createElement(Home));
    expect(html).toContain('data-testid="listening-warmup-tile"');
    expect(html).toContain('Listening Warmup');
    expect(html).toContain('60-second passive ear-training');
  });

  it('renders the tile alongside the existing minimal-pairs CTA', () => {
    const html = renderToStaticMarkup(React.createElement(Home));
    expect(html).toContain('data-testid="minimal-pairs-cta"');
    expect(html).toContain('data-testid="listening-warmup-tile"');
  });

  it('does not render the modal panel until the tile is opened', () => {
    const html = renderToStaticMarkup(React.createElement(Home));
    // SSR initial render: warmupOpen state defaults to false → panel not in DOM.
    expect(html).not.toContain('data-testid="listening-warmup-panel"');
  });

  it('does not show a streak badge when no warmup history exists', () => {
    // The default state from readWarmupState() in a node env (no localStorage)
    // is { warmupStreak: 0 }, so the badge should be absent.
    const html = renderToStaticMarkup(React.createElement(Home));
    expect(html).not.toContain('data-testid="warmup-streak-badge"');
  });
});
