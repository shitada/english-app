import { useState, useEffect } from 'react';
import { api } from '../../api';

interface SkillAxis {
  name: string;
  score: number;
  label: string;
}

const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = 100;
const LEVELS = 5;

function polarToCartesian(angle: number, radius: number): [number, number] {
  // Start from top (- PI/2) and go clockwise
  const rad = (angle - 90) * (Math.PI / 180);
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function getPolygonPoints(scores: number[], maxScore: number): string {
  const angleStep = 360 / scores.length;
  return scores
    .map((score, i) => {
      const r = (score / maxScore) * RADIUS;
      const [x, y] = polarToCartesian(i * angleStep, r);
      return `${x},${y}`;
    })
    .join(' ');
}

function getAxisPoint(index: number, total: number, radius: number): [number, number] {
  const angleStep = 360 / total;
  return polarToCartesian(index * angleStep, radius);
}

export function SkillsRadarChart() {
  const [skills, setSkills] = useState<SkillAxis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSkillRadar()
      .then(data => setSkills(data.skills))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading skills…</p>
      </div>
    );
  }

  if (skills.length === 0) return null;

  const scores = skills.map(s => s.score);
  const dataPoints = getPolygonPoints(scores, 100);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ marginBottom: 16, textAlign: 'center' }}>🎯 Skills Overview</h3>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ maxWidth: '100%' }}>
          {/* Grid levels */}
          {Array.from({ length: LEVELS }, (_, i) => {
            const r = ((i + 1) / LEVELS) * RADIUS;
            const points = skills
              .map((_, j) => {
                const [x, y] = getAxisPoint(j, skills.length, r);
                return `${x},${y}`;
              })
              .join(' ');
            return (
              <polygon
                key={`grid-${i}`}
                points={points}
                fill="none"
                stroke="var(--border, #e5e7eb)"
                strokeWidth={0.5}
                opacity={0.6}
              />
            );
          })}

          {/* Axis lines */}
          {skills.map((_, i) => {
            const [x, y] = getAxisPoint(i, skills.length, RADIUS);
            return (
              <line
                key={`axis-${i}`}
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
                stroke="var(--border, #e5e7eb)"
                strokeWidth={0.5}
                opacity={0.6}
              />
            );
          })}

          {/* Data polygon */}
          <polygon
            points={dataPoints}
            fill="rgba(99, 102, 241, 0.2)"
            stroke="var(--primary, #6366f1)"
            strokeWidth={2}
          />

          {/* Data points */}
          {scores.map((score, i) => {
            const r = (score / 100) * RADIUS;
            const [x, y] = getAxisPoint(i, skills.length, r);
            return (
              <circle
                key={`point-${i}`}
                cx={x}
                cy={y}
                r={3.5}
                fill="var(--primary, #6366f1)"
                stroke="#fff"
                strokeWidth={1.5}
              />
            );
          })}

          {/* Labels */}
          {skills.map((skill, i) => {
            const [x, y] = getAxisPoint(i, skills.length, RADIUS + 22);
            return (
              <text
                key={`label-${i}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--text, #1f2937)"
              >
                {skill.label}
              </text>
            );
          })}

          {/* Score values */}
          {skills.map((skill, i) => {
            const [x, y] = getAxisPoint(i, skills.length, RADIUS + 36);
            return (
              <text
                key={`score-${i}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fill="var(--text-secondary, #6b7280)"
              >
                {skill.score}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
