import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Trash2, Volume2 } from 'lucide-react';
import { useRecordingStorage, type RecordingEntry } from '../../hooks/useRecordingStorage';

interface RecordingHistoryProps {
  onBack: () => void;
}

export function RecordingHistory({ onBack }: RecordingHistoryProps) {
  const storage = useRecordingStorage();
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const recs = await storage.getRecordings(50);
        setRecordings(recs);
      } catch (err) {
        console.error('Failed to load recordings:', err);
      } finally {
        setLoading(false);
      }
    };
    // Small delay to let IndexedDB init
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [storage.getRecordings]);

  const togglePlay = (rec: RecordingEntry) => {
    if (playingId === rec.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      setPlayingId(null);
      URL.revokeObjectURL(url);
    };
    audio.play();
    setPlayingId(rec.id ?? null);
  };

  const handleDelete = async (id: number) => {
    try {
      await storage.deleteRecording(id);
      setRecordings(prev => prev.filter(r => r.id !== id));
      if (playingId === id) {
        audioRef.current?.pause();
        setPlayingId(null);
      }
    } catch (err) {
      console.error('Failed to delete recording:', err);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Delete all saved recordings?')) return;
    try {
      await storage.clearAll();
      setRecordings([]);
      audioRef.current?.pause();
      setPlayingId(null);
    } catch (err) {
      console.error('Failed to clear recordings:', err);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        Loading recordings…
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>🎙️ My Recordings</h3>
        <button className="btn btn-secondary" onClick={onBack} style={{ fontSize: '0.85rem' }}>
          ← Back
        </button>
      </div>

      {recordings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          <Volume2 size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p>No recordings saved yet.</p>
          <p style={{ fontSize: '0.85rem' }}>Practice pronunciation to save recordings here.</p>
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12, fontSize: '0.85rem' }}>
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''} • auto-deleted after 30 days
          </p>
          {recordings.map(rec => (
            <div
              key={rec.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                background: 'var(--bg-card)', borderRadius: 10, marginBottom: 8,
                border: playingId === rec.id ? '2px solid var(--primary)' : '1px solid var(--border)',
              }}
            >
              <button
                onClick={() => togglePlay(rec)}
                style={{
                  background: playingId === rec.id ? 'var(--primary)' : 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: '50%',
                  width: 36, height: 36, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
                  color: playingId === rec.id ? 'white' : 'var(--text)',
                }}
                aria-label={playingId === rec.id ? 'Pause' : 'Play'}
              >
                {playingId === rec.id ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rec.referenceText}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {formatDate(rec.createdAt)} • {rec.difficulty}
                </div>
              </div>
              {rec.score != null && (
                <span style={{
                  background: rec.score >= 8 ? '#f0fdf4' : rec.score >= 5 ? '#fffbeb' : '#fef2f2',
                  color: rec.score >= 8 ? '#15803d' : rec.score >= 5 ? '#b45309' : '#b91c1c',
                  borderRadius: 8, padding: '2px 8px', fontSize: '0.8rem', fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {rec.score}/10
                </span>
              )}
              <button
                onClick={() => rec.id != null && handleDelete(rec.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, flexShrink: 0 }}
                aria-label="Delete recording"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={handleClearAll} style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>
              🗑️ Clear All Recordings
            </button>
          </div>
        </>
      )}
    </div>
  );
}
