import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  phase: string;
}

export function PhaseTransition({ children, phase }: Props) {
  const [animClass, setAnimClass] = useState('phase-enter');
  const prevPhase = useRef(phase);

  useEffect(() => {
    if (prevPhase.current !== phase) {
      setAnimClass('phase-enter');
      prevPhase.current = phase;
    }
  }, [phase]);

  return (
    <div
      className={`phase-transition ${animClass}`}
      onAnimationEnd={() => setAnimClass('')}
    >
      {children}
    </div>
  );
}
