import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'onboarding_completed';

export interface OnboardingStep {
  target: string;
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: OnboardingStep[] = [
  {
    target: '.home-hero',
    title: 'Welcome to English App!',
    description: 'This app helps you practice English through AI-powered conversations, pronunciation drills, and vocabulary quizzes.',
    position: 'bottom',
  },
  {
    target: '.feature-card:nth-child(1)',
    title: 'Conversation Practice',
    description: 'Role-play real-life scenarios like hotel check-ins, job interviews, and restaurant orders with an AI partner.',
    position: 'bottom',
  },
  {
    target: '.feature-card:nth-child(2)',
    title: 'Pronunciation Training',
    description: 'Listen to sentences, repeat them, and get instant feedback on your accuracy and fluency.',
    position: 'bottom',
  },
  {
    target: '.feature-card:nth-child(3)',
    title: 'Vocabulary Building',
    description: 'Learn scenario-specific words through spaced repetition quizzes that adapt to your level.',
    position: 'bottom',
  },
  {
    target: '.feature-card:nth-child(4)',
    title: 'Track Your Progress',
    description: 'View your learning streak, statistics, and improvement trends across all activities.',
    position: 'bottom',
  },
];

export function useOnboarding() {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      setIsActive(true);
    }
  }, []);

  const next = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      localStorage.setItem(STORAGE_KEY, 'true');
      setIsActive(false);
      setCurrentStep(0);
    }
  }, [currentStep]);

  const prev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const skip = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsActive(false);
    setCurrentStep(0);
  }, []);

  const restartTour = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  return {
    isActive,
    currentStep,
    totalSteps: TOUR_STEPS.length,
    step: TOUR_STEPS[currentStep],
    steps: TOUR_STEPS,
    next,
    prev,
    skip,
    restartTour,
  };
}
