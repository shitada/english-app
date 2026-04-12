import { useState, useCallback } from 'react';
import { BookOpen, Volume2, Check, Save, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { extractPassageVocabulary, savePassageVocabulary } from '../api';
import type { PassageVocabWord } from '../api';

interface Props {
  passage: string;
}

export function ListeningKeyVocab({ passage }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [words, setWords] = useState<PassageVocabWord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [savingAll, setSavingAll] = useState(false);

  const handleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (words.length > 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await extractPassageVocabulary(passage);
      setWords(res.words);
    } catch {
      setError('Failed to extract vocabulary. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [expanded, words.length, passage]);

  const handleSpeak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }, []);

  const handleSaveWord = useCallback(async (word: PassageVocabWord) => {
    try {
      await savePassageVocabulary([{ word: word.word, meaning: word.meaning, context_sentence: word.context_sentence }]);
      setSavedWords(prev => new Set(prev).add(word.word));
    } catch {
      // ignore
    }
  }, []);

  const handleSaveAll = useCallback(async () => {
    const unsaved = words.filter(w => !savedWords.has(w.word));
    if (unsaved.length === 0) return;
    setSavingAll(true);
    try {
      await savePassageVocabulary(unsaved.map(w => ({ word: w.word, meaning: w.meaning, context_sentence: w.context_sentence })));
      setSavedWords(new Set(words.map(w => w.word)));
    } catch {
      // ignore
    } finally {
      setSavingAll(false);
    }
  }, [words, savedWords]);

  const allSaved = words.length > 0 && words.every(w => savedWords.has(w.word));

  return (
    <div style={{ marginTop: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, overflow: 'hidden' }}>
      <button
        onClick={handleExpand}
        style={{
          width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-secondary, #f9fafb)', border: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
        }}
      >
        <BookOpen size={16} />
        Key Vocabulary
        <span style={{ marginLeft: 'auto' }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
              <Loader2 size={20} className="spinning" style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: 8, fontSize: 13 }}>Extracting vocabulary...</div>
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--danger, #ef4444)', fontSize: 13, textAlign: 'center', padding: 12 }}>
              {error}
            </div>
          )}

          {words.length > 0 && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {words.map((w, i) => (
                  <div key={i} style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: savedWords.has(w.word) ? 'var(--success-bg, #f0fdf4)' : 'var(--bg-primary, #fff)',
                    border: `1px solid ${savedWords.has(w.word) ? 'var(--success, #22c55e)' : 'var(--border, #e5e7eb)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{w.word}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{w.part_of_speech}</span>
                      <button
                        onClick={() => handleSpeak(w.word)}
                        title="Pronounce"
                        style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary, #3b82f6)', padding: 2 }}
                      >
                        <Volume2 size={14} />
                      </button>
                      <div style={{ marginLeft: 'auto' }}>
                        {savedWords.has(w.word) ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--success, #22c55e)' }}>
                            <Check size={14} /> Saved
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSaveWord(w)}
                            title="Save to Vocab Bank"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6,
                              border: '1px solid var(--border, #e5e7eb)', background: 'var(--bg-primary, #fff)',
                              cursor: 'pointer', fontSize: 12, color: 'var(--primary, #3b82f6)',
                            }}
                          >
                            <Save size={12} /> Save
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{w.meaning}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      "{w.context_sentence}"
                    </div>
                  </div>
                ))}
              </div>

              {!allSaved && (
                <button
                  onClick={handleSaveAll}
                  disabled={savingAll}
                  style={{
                    marginTop: 12, width: '100%', padding: '10px 16px', borderRadius: 8,
                    border: '1px solid var(--primary, #3b82f6)', background: 'var(--primary, #3b82f6)',
                    color: '#fff', cursor: savingAll ? 'not-allowed' : 'pointer',
                    fontSize: 14, fontWeight: 600, opacity: savingAll ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Save size={14} />
                  {savingAll ? 'Saving...' : 'Save All to Vocab Bank'}
                </button>
              )}

              {allSaved && (
                <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13, color: 'var(--success, #22c55e)', fontWeight: 600 }}>
                  ✓ All words saved to your Vocab Bank
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
