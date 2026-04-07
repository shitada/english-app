import { useEffect, useRef } from 'react';

interface AudioWaveformProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  width?: number;
  height?: number;
  barCount?: number;
  barColor?: string;
  inactiveColor?: string;
}

export default function AudioWaveform({
  analyser,
  isActive,
  width = 280,
  height = 60,
  barCount = 40,
  barColor = 'var(--primary, #4f46e5)',
  inactiveColor = 'var(--border, #e0e0e0)',
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!analyser || !isActive) {
      // Draw idle bars
      ctx.clearRect(0, 0, width, height);
      const barW = (width / barCount) * 0.7;
      const gap = width / barCount;
      for (let i = 0; i < barCount; i++) {
        ctx.fillStyle = inactiveColor;
        const h = 4;
        ctx.fillRect(i * gap + gap * 0.15, (height - h) / 2, barW, h);
      }
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, width, height);
      const barW = (width / barCount) * 0.7;
      const gap = width / barCount;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255;
        const barH = Math.max(4, value * height * 0.9);
        ctx.fillStyle = value > 0.05 ? barColor : inactiveColor;
        ctx.fillRect(i * gap + gap * 0.15, (height - barH) / 2, barW, barH);
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [analyser, isActive, width, height, barCount, barColor, inactiveColor]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', margin: '0 auto' }}
      aria-label="Audio waveform visualization"
    />
  );
}
