import { useState, useEffect } from 'react';
import QuickShadowCard from './QuickShadowCard';
import QuickDictationCard from './QuickDictationCard';
import QuickSpeakCard from './QuickSpeakCard';
import QuickListenRespondCard from './QuickListenRespondCard';
import QuickGrammarCard from './QuickGrammarCard';
import QuickRephraseCard from './QuickRephraseCard';
import QuickTransformCard from './QuickTransformCard';
import QuickVocabSentenceCard from './QuickVocabSentenceCard';
import QuickOpinionCard from './QuickOpinionCard';
import QuickQuestionCard from './QuickQuestionCard';
import QuickStoryCard from './QuickStoryCard';
import QuickFollowUpCard from './QuickFollowUpCard';
import QuickMinimalPairsCard from './QuickMinimalPairsCard';

const STORAGE_KEY = 'quick-practice-tab';

interface TabDef {
  key: string;
  emoji: string;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'speaking', emoji: '🗣️', label: 'Speaking' },
  { key: 'listening', emoji: '👂', label: 'Listening' },
  { key: 'grammar', emoji: '✍️', label: 'Grammar' },
  { key: 'vocabulary', emoji: '📚', label: 'Vocabulary' },
];

export default function QuickPracticeHub() {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && TABS.some(t => t.key === saved)) return saved;
    } catch { /* ignore */ }
    return 'speaking';
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  return (
    <div style={{
      background: 'var(--card-bg, white)',
      borderRadius: 16,
      border: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 20px 0',
        borderBottom: '1px solid var(--border)',
      }}>
        <h3 style={{
          margin: '0 0 12px',
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--text)',
        }}>
          ⚡ Quick Practice
        </h3>
        <div role="tablist" style={{
          display: 'flex',
          gap: 4,
          overflowX: 'auto',
        }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '8px 14px',
                  border: 'none',
                  borderBottom: isActive ? '3px solid var(--primary, #3b82f6)' : '3px solid transparent',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--primary, #3b82f6)' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                }}
              >
                {tab.emoji} {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activeTab === 'speaking' && (
          <>
            <QuickSpeakCard />
            <QuickShadowCard />
            <QuickOpinionCard />
            <QuickStoryCard />
            <QuickFollowUpCard />
            <QuickQuestionCard />
          </>
        )}
        {activeTab === 'listening' && (
          <>
            <QuickDictationCard />
            <QuickListenRespondCard />
            <QuickMinimalPairsCard />
          </>
        )}
        {activeTab === 'grammar' && (
          <>
            <QuickGrammarCard />
            <QuickRephraseCard />
            <QuickTransformCard />
          </>
        )}
        {activeTab === 'vocabulary' && (
          <QuickVocabSentenceCard />
        )}
      </div>
    </div>
  );
}
