import { useState, useEffect } from 'react';
import { LazySection } from '../hooks/useLazyLoad';
import QuickShadowCard from './QuickShadowCard';
import QuickDictationCard from './QuickDictationCard';
import QuickSpeakCard from './QuickSpeakCard';
import QuickListenRespondCard from './QuickListenRespondCard';
import QuickGrammarCard from './QuickGrammarCard';
import QuickRephraseCard from './QuickRephraseCard';
import QuickTransformCard from './QuickTransformCard';
import QuickVocabSentenceCard from './QuickVocabSentenceCard';
import QuickVocabRecallCard from './QuickVocabRecallCard';
import QuickOpinionCard from './QuickOpinionCard';
import QuickQuestionCard from './QuickQuestionCard';
import QuickStoryCard from './QuickStoryCard';
import QuickFollowUpCard from './QuickFollowUpCard';
import QuickMinimalPairsCard from './QuickMinimalPairsCard';
import QuickListeningCompCard from './QuickListeningCompCard';
import QuickIdiomCard from './QuickIdiomCard';
import QuickWriteCard from './QuickWriteCard';
import QuickExplainCard from './QuickExplainCard';
import QuickRolePlayCard from './QuickRolePlayCard';
import QuickWordAssociationCard from './QuickWordAssociationCard';
import QuickReadingCard from './QuickReadingCard';
import QuickTongueTwisterCard from './QuickTongueTwisterCard';
import QuickCollocationCard from './QuickCollocationCard';
import QuickListenParaphraseCard from './QuickListenParaphraseCard';
import QuickConnectorDrillCard from './QuickConnectorDrillCard';
import QuickSpotErrorCard from './QuickSpotErrorCard';
import QuickPhrasalVerbCard from './QuickPhrasalVerbCard';
import QuickRapidFireCard from './QuickRapidFireCard';
import QuickSentenceStressCard from './QuickSentenceStressCard';
import QuickRegisterSwitchCard from './QuickRegisterSwitchCard';
import QuickDebateCard from './QuickDebateCard';
import QuickSceneDescriptionCard from './QuickSceneDescriptionCard';
import QuickPredictNextCard from './QuickPredictNextCard';
import QuickDictoglossCard from './QuickDictoglossCard';
import QuickSentenceScrambleCard from './QuickSentenceScrambleCard';
import QuickFillerReductionCard from './QuickFillerReductionCard';
import QuickEmotionResponseCard from './QuickEmotionResponseCard';
import QuickDialogueGapCard from './QuickDialogueGapCard';

const STORAGE_KEY = 'quick-practice-tab';
const DIFFICULTY_KEY = 'quick-practice-difficulty';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';
const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate', 'advanced'];

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
  { key: 'writing', emoji: '✏️', label: 'Writing' },
];

export default function QuickPracticeHub() {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && TABS.some(t => t.key === saved)) return saved;
    } catch { /* ignore */ }
    return 'speaking';
  });

  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    try {
      const saved = localStorage.getItem(DIFFICULTY_KEY) as Difficulty;
      if (saved && DIFFICULTIES.includes(saved)) return saved;
    } catch { /* ignore */ }
    return 'intermediate';
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  const handleDifficultyChange = (d: Difficulty) => {
    setDifficulty(d);
    try { localStorage.setItem(DIFFICULTY_KEY, d); } catch { /* ignore */ }
    // Dispatch storage event so child cards can react
    window.dispatchEvent(new StorageEvent('storage', { key: DIFFICULTY_KEY, newValue: d }));
  };

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

        <div style={{
          display: 'flex',
          gap: 4,
          padding: '10px 0 12px',
        }}>
          {DIFFICULTIES.map(d => (
            <button
              key={d}
              onClick={() => handleDifficultyChange(d)}
              data-testid={`qp-difficulty-${d}`}
              aria-pressed={difficulty === d}
              style={{
                flex: 1,
                padding: '6px 4px',
                border: '1px solid',
                borderColor: difficulty === d ? 'var(--primary, #3b82f6)' : 'var(--border, #d1d5db)',
                background: difficulty === d ? 'var(--primary, #3b82f6)' : 'transparent',
                color: difficulty === d ? '#fff' : 'var(--text-secondary, #6b7280)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: difficulty === d ? 600 : 400,
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
              }}
            >
              {d === 'beginner' ? '🌱' : d === 'intermediate' ? '📗' : '🚀'} {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activeTab === 'speaking' && (
          <>
            <LazySection height={180}><QuickSpeakCard /></LazySection>
            <LazySection height={180}><QuickShadowCard /></LazySection>
            <LazySection height={180}><QuickOpinionCard /></LazySection>
            <LazySection height={180}><QuickStoryCard /></LazySection>
            <LazySection height={180}><QuickFollowUpCard /></LazySection>
            <LazySection height={180}><QuickIdiomCard /></LazySection>
            <LazySection height={180}><QuickQuestionCard /></LazySection>
            <LazySection height={180}><QuickExplainCard /></LazySection>
            <LazySection height={180}><QuickRolePlayCard /></LazySection>
            <LazySection height={180}><QuickTongueTwisterCard /></LazySection>
            <LazySection height={180}><QuickRapidFireCard /></LazySection>
            <LazySection height={180}><QuickSentenceStressCard /></LazySection>
            <LazySection height={180}><QuickRegisterSwitchCard /></LazySection>
            <LazySection height={180}><QuickDebateCard /></LazySection>
            <LazySection height={180}><QuickSceneDescriptionCard /></LazySection>
            <LazySection height={180}><QuickFillerReductionCard /></LazySection>
            <LazySection height={180}><QuickEmotionResponseCard /></LazySection>
            <LazySection height={180}><QuickDialogueGapCard /></LazySection>
          </>
        )}
        {activeTab === 'listening' && (
          <>
            <LazySection height={180}><QuickDictationCard /></LazySection>
            <LazySection height={180}><QuickListenRespondCard /></LazySection>
            <LazySection height={180}><QuickListenParaphraseCard /></LazySection>
            <LazySection height={180}><QuickMinimalPairsCard /></LazySection>
            <LazySection height={180}><QuickListeningCompCard /></LazySection>
            <LazySection height={180}><QuickSpotErrorCard /></LazySection>
            <LazySection height={180}><QuickPredictNextCard /></LazySection>
            <LazySection height={180}><QuickDictoglossCard /></LazySection>
          </>
        )}
        {activeTab === 'grammar' && (
          <>
            <LazySection height={180}><QuickGrammarCard /></LazySection>
            <LazySection height={180}><QuickRephraseCard /></LazySection>
            <LazySection height={180}><QuickTransformCard /></LazySection>
            <LazySection height={180}><QuickConnectorDrillCard /></LazySection>
            <LazySection height={180}><QuickPhrasalVerbCard /></LazySection>
            <LazySection height={180}><QuickSentenceScrambleCard /></LazySection>
          </>
        )}
        {activeTab === 'vocabulary' && (
          <>
            <LazySection height={180}><QuickVocabSentenceCard /></LazySection>
            <LazySection height={180}><QuickVocabRecallCard /></LazySection>
            <LazySection height={180}><QuickWordAssociationCard /></LazySection>
            <LazySection height={180}><QuickCollocationCard /></LazySection>
          </>
        )}
        {activeTab === 'writing' && (
          <>
            <LazySection height={180}><QuickWriteCard /></LazySection>
            <LazySection height={180}><QuickReadingCard /></LazySection>
          </>
        )}
      </div>
    </div>
  );
}
