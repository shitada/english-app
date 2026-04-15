import { useState } from 'react';
import { FileText, Copy, Check } from 'lucide-react';
import type { WeeklyReport as WeeklyReportData } from '../../api';

interface Props {
  report: WeeklyReportData | null;
}

export function WeeklyReport({ report }: Props) {
  const [copied, setCopied] = useState(false);

  if (!report) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report.text_summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = report.text_summary;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <FileText size={20} color="#6366f1" />
          Weekly Report
        </h3>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            fontSize: 13,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: copied ? '#10b981' : 'var(--bg)',
            color: copied ? '#fff' : 'var(--text)',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          aria-label="Copy weekly report to clipboard"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy Report'}
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {report.week_start} — {report.week_end}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
        <MiniStat label="Conversations" value={String(report.conversations)} />
        <MiniStat label="Messages Sent" value={String(report.messages_sent)} />
        <MiniStat label="Words Reviewed" value={String(report.vocabulary_reviewed)} />
        <MiniStat label="Quiz Accuracy" value={`${report.quiz_accuracy}%`} />
        <MiniStat label="Pronunciation" value={String(report.pronunciation_attempts)} />
        <MiniStat label="Avg Score" value={`${report.avg_pronunciation_score}/10`} />
        <MiniStat label="Journal Entries" value={String(report.speaking_journal_entries ?? 0)} />
        <MiniStat label="Listening Quizzes" value={String(report.listening_quizzes ?? 0)} />
      </div>

      {report.highlights.length > 0 && (
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 12 }}>
          <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>✨ Highlights</p>
          {report.highlights.map((h, i) => (
            <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0' }}>• {h}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg)', borderRadius: 6 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}
