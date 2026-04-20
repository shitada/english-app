import { useState, useEffect, type ComponentType, type ReactNode } from 'react';
import { Star, StarOff } from 'lucide-react';
import { LazySection } from '../hooks/useLazyLoad';
import { useFavorites } from '../hooks/useFavorites';
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
import QuickSynonymSwapCard from './QuickSynonymSwapCard';
import QuickSummarizeRespondCard from './QuickSummarizeRespondCard';
import QuickInstructionCard from './QuickInstructionCard';
import QuickEmailCard from './QuickEmailCard';
import QuickProofreadCard from './QuickProofreadCard';
import QuickConnectedSpeechCard from './QuickConnectedSpeechCard';
import QuickConversationRepairCard from './QuickConversationRepairCard';
import QuickNumbersDatesCard from './QuickNumbersDatesCard';
import QuickThoughtGroupCard from './QuickThoughtGroupCard';
import QuickReverseTranslationCard from './QuickReverseTranslationCard';
import QuickQuestionFormationCard from './QuickQuestionFormationCard';
import QuickBackchannelCard from './QuickBackchannelCard';
import QuickPaceMatchCard from './QuickPaceMatchCard';
import QuickContrastiveStressCard from './QuickContrastiveStressCard';
import LinkerDrill from './LinkerDrill';
import ReducedFormsDrill from './ReducedFormsDrill';

const STORAGE_KEY = 'quick-practice-tab';
const DIFFICULTY_KEY = 'quick-practice-difficulty';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';
const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate', 'advanced'];

type TabKey = 'speaking' | 'listening' | 'grammar' | 'vocabulary' | 'writing' | 'favorites';

interface TabDef {
  key: TabKey;
  emoji: string;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'favorites', emoji: '⭐', label: 'Favorites' },
  { key: 'speaking', emoji: '🗣️', label: 'Speaking' },
  { key: 'listening', emoji: '👂', label: 'Listening' },
  { key: 'grammar', emoji: '✍️', label: 'Grammar' },
  { key: 'vocabulary', emoji: '📚', label: 'Vocabulary' },
  { key: 'writing', emoji: '✏️', label: 'Writing' },
];

interface CardDef {
  key: string;
  tab: Exclude<TabKey, 'favorites'>;
  label: string;
  height: number;
  Component: ComponentType;
}

const CARDS: CardDef[] = [
  // Speaking
  { key: 'speak', tab: 'speaking', label: 'Quick Speak', height: 180, Component: QuickSpeakCard },
  { key: 'shadow', tab: 'speaking', label: 'Shadowing', height: 180, Component: QuickShadowCard },
  { key: 'reduced-forms', tab: 'speaking', label: 'Reduced Forms', height: 380, Component: ReducedFormsDrill },
  { key: 'opinion', tab: 'speaking', label: 'Opinion', height: 180, Component: QuickOpinionCard },
  { key: 'story', tab: 'speaking', label: 'Story', height: 180, Component: QuickStoryCard },
  { key: 'follow-up', tab: 'speaking', label: 'Follow-up', height: 180, Component: QuickFollowUpCard },
  { key: 'idiom', tab: 'speaking', label: 'Idiom', height: 180, Component: QuickIdiomCard },
  { key: 'question', tab: 'speaking', label: 'Question', height: 180, Component: QuickQuestionCard },
  { key: 'explain', tab: 'speaking', label: 'Explain', height: 180, Component: QuickExplainCard },
  { key: 'role-play', tab: 'speaking', label: 'Role-play', height: 180, Component: QuickRolePlayCard },
  { key: 'tongue-twister', tab: 'speaking', label: 'Tongue Twister', height: 180, Component: QuickTongueTwisterCard },
  { key: 'rapid-fire', tab: 'speaking', label: 'Rapid Fire', height: 180, Component: QuickRapidFireCard },
  { key: 'sentence-stress', tab: 'speaking', label: 'Sentence Stress', height: 180, Component: QuickSentenceStressCard },
  { key: 'connected-speech', tab: 'speaking', label: 'Connected Speech', height: 180, Component: QuickConnectedSpeechCard },
  { key: 'register-switch', tab: 'speaking', label: 'Register Switch', height: 180, Component: QuickRegisterSwitchCard },
  { key: 'debate', tab: 'speaking', label: 'Debate', height: 180, Component: QuickDebateCard },
  { key: 'scene-description', tab: 'speaking', label: 'Scene Description', height: 180, Component: QuickSceneDescriptionCard },
  { key: 'filler-reduction', tab: 'speaking', label: 'Filler Reduction', height: 180, Component: QuickFillerReductionCard },
  { key: 'emotion-response', tab: 'speaking', label: 'Emotion Response', height: 180, Component: QuickEmotionResponseCard },
  { key: 'dialogue-gap', tab: 'speaking', label: 'Dialogue Gap', height: 180, Component: QuickDialogueGapCard },
  { key: 'summarize-respond', tab: 'speaking', label: 'Summarize & Respond', height: 180, Component: QuickSummarizeRespondCard },
  { key: 'instruction', tab: 'speaking', label: 'Instruction', height: 180, Component: QuickInstructionCard },
  { key: 'conversation-repair', tab: 'speaking', label: 'Conversation Repair', height: 180, Component: QuickConversationRepairCard },
  { key: 'reverse-translation', tab: 'speaking', label: 'Reverse Translation', height: 260, Component: QuickReverseTranslationCard },
  { key: 'question-formation', tab: 'speaking', label: 'Question Formation', height: 260, Component: QuickQuestionFormationCard },
  { key: 'pace-match', tab: 'speaking', label: 'Pace Match', height: 320, Component: QuickPaceMatchCard },
  { key: 'contrastive-stress', tab: 'speaking', label: 'Contrastive Stress', height: 380, Component: QuickContrastiveStressCard },
  { key: 'linker-drill', tab: 'speaking', label: 'Linker Speak Drill', height: 420, Component: LinkerDrill },
  // Listening
  { key: 'dictation', tab: 'listening', label: 'Dictation', height: 180, Component: QuickDictationCard },
  { key: 'listen-respond', tab: 'listening', label: 'Listen & Respond', height: 180, Component: QuickListenRespondCard },
  { key: 'listen-paraphrase', tab: 'listening', label: 'Listen & Paraphrase', height: 180, Component: QuickListenParaphraseCard },
  { key: 'minimal-pairs', tab: 'listening', label: 'Minimal Pairs', height: 180, Component: QuickMinimalPairsCard },
  { key: 'listening-comp', tab: 'listening', label: 'Listening Comprehension', height: 180, Component: QuickListeningCompCard },
  { key: 'spot-error', tab: 'listening', label: 'Spot the Error', height: 180, Component: QuickSpotErrorCard },
  { key: 'predict-next', tab: 'listening', label: 'Predict Next', height: 180, Component: QuickPredictNextCard },
  { key: 'dictogloss', tab: 'listening', label: 'Dictogloss', height: 180, Component: QuickDictoglossCard },
  { key: 'numbers-dates', tab: 'listening', label: 'Numbers & Dates', height: 220, Component: QuickNumbersDatesCard },
  { key: 'thought-group', tab: 'listening', label: 'Thought Group', height: 260, Component: QuickThoughtGroupCard },
  { key: 'backchannel', tab: 'listening', label: '💬 Quick Backchannel / あいづち練習', height: 320, Component: QuickBackchannelCard },
  // Grammar
  { key: 'grammar', tab: 'grammar', label: 'Grammar', height: 180, Component: QuickGrammarCard },
  { key: 'rephrase', tab: 'grammar', label: 'Rephrase', height: 180, Component: QuickRephraseCard },
  { key: 'transform', tab: 'grammar', label: 'Transform', height: 180, Component: QuickTransformCard },
  { key: 'connector-drill', tab: 'grammar', label: 'Connector Drill', height: 180, Component: QuickConnectorDrillCard },
  { key: 'phrasal-verb', tab: 'grammar', label: 'Phrasal Verb', height: 180, Component: QuickPhrasalVerbCard },
  { key: 'sentence-scramble', tab: 'grammar', label: 'Sentence Scramble', height: 180, Component: QuickSentenceScrambleCard },
  // Vocabulary
  { key: 'vocab-sentence', tab: 'vocabulary', label: 'Vocab Sentence', height: 180, Component: QuickVocabSentenceCard },
  { key: 'vocab-recall', tab: 'vocabulary', label: 'Vocab Recall', height: 180, Component: QuickVocabRecallCard },
  { key: 'word-association', tab: 'vocabulary', label: 'Word Association', height: 180, Component: QuickWordAssociationCard },
  { key: 'collocation', tab: 'vocabulary', label: 'Collocation', height: 180, Component: QuickCollocationCard },
  { key: 'synonym-swap', tab: 'vocabulary', label: 'Synonym Swap', height: 180, Component: QuickSynonymSwapCard },
  // Writing
  { key: 'write', tab: 'writing', label: 'Write', height: 180, Component: QuickWriteCard },
  { key: 'reading', tab: 'writing', label: 'Reading', height: 180, Component: QuickReadingCard },
  { key: 'email', tab: 'writing', label: 'Email', height: 180, Component: QuickEmailCard },
  { key: 'proofread', tab: 'writing', label: 'Proofread', height: 180, Component: QuickProofreadCard },
];

interface PinnableProps {
  cardKey: string;
  label: string;
  pinned: boolean;
  onToggle: (key: string) => void;
  children: ReactNode;
}

function Pinnable({ cardKey, label, pinned, onToggle, children }: PinnableProps) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid={`qp-pin-${cardKey}`}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${label} from favorites` : `Pin ${label} to favorites`}
        title={pinned ? 'Unpin from favorites' : 'Pin to favorites'}
        onClick={() => onToggle(cardKey)}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 2,
          width: 32,
          height: 32,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--border, #d1d5db)',
          borderRadius: '50%',
          background: pinned ? 'rgba(250, 204, 21, 0.18)' : 'var(--card-bg, white)',
          color: pinned ? '#ca8a04' : 'var(--text-secondary, #6b7280)',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.15s',
        }}
      >
        {pinned ? <Star size={16} fill="currentColor" /> : <StarOff size={16} />}
      </button>
      {children}
    </div>
  );
}

export default function QuickPracticeHub() {
  const { favorites, isFavorite, toggle } = useFavorites();

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && TABS.some(t => t.key === saved)) return saved as TabKey;
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

  const renderCard = (card: CardDef) => {
    const Component = card.Component;
    return (
      <Pinnable
        key={card.key}
        cardKey={card.key}
        label={card.label}
        pinned={isFavorite(card.key)}
        onToggle={toggle}
      >
        <LazySection height={card.height}><Component /></LazySection>
      </Pinnable>
    );
  };

  const cardsForTab = (tab: Exclude<TabKey, 'favorites'>) =>
    CARDS.filter(c => c.tab === tab);

  const favoriteCards = favorites
    .map(key => CARDS.find(c => c.key === key))
    .filter((c): c is CardDef => Boolean(c));

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
                data-testid={`qp-tab-${tab.key}`}
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
                {tab.key === 'favorites' && favorites.length > 0 && (
                  <span style={{
                    marginLeft: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'var(--primary, #3b82f6)',
                    color: '#fff',
                    borderRadius: 999,
                    padding: '1px 7px',
                  }}>
                    {favorites.length}
                  </span>
                )}
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

      <div role="tabpanel" data-testid={`qp-tabpanel-${activeTab}`} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activeTab === 'favorites' && (
          favoriteCards.length === 0 ? (
            <div
              data-testid="qp-favorites-empty"
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: 'var(--text-secondary, #6b7280)',
                fontSize: 14,
                lineHeight: 1.5,
                border: '1px dashed var(--border, #d1d5db)',
                borderRadius: 12,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>⭐</div>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                No favorites yet
              </div>
              <div>
                Tap the star on any practice card to pin it here for quick access.
              </div>
            </div>
          ) : (
            <>{favoriteCards.map(renderCard)}</>
          )
        )}
        {activeTab === 'speaking' && <>{cardsForTab('speaking').map(renderCard)}</>}
        {activeTab === 'listening' && <>{cardsForTab('listening').map(renderCard)}</>}
        {activeTab === 'grammar' && <>{cardsForTab('grammar').map(renderCard)}</>}
        {activeTab === 'vocabulary' && <>{cardsForTab('vocabulary').map(renderCard)}</>}
        {activeTab === 'writing' && <>{cardsForTab('writing').map(renderCard)}</>}
      </div>
    </div>
  );
}
