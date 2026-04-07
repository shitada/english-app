export function HighlightedMessage({ content, keyPhrases, onSpeak }: {
  content: string;
  keyPhrases?: string[];
  onSpeak: (text: string) => void;
}) {
  if (!keyPhrases || keyPhrases.length === 0) return <>{content}</>;

  // Build regex matching any key phrase (case-insensitive, longest first)
  const sorted = [...keyPhrases].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');

  const parts = content.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = keyPhrases.some((kp) => kp.toLowerCase() === part.toLowerCase());
        if (!isMatch) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            onClick={() => onSpeak(part)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSpeak(part); }}
            title="Click to hear pronunciation"
            style={{
              background: '#dbeafe',
              borderRadius: 3,
              padding: '1px 2px',
              cursor: 'pointer',
              borderBottom: '2px solid #3b82f6',
            }}
          >
            {part} <span style={{ fontSize: 10 }}>🔊</span>
          </span>
        );
      })}
    </>
  );
}
