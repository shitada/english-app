import { useState, useCallback, useRef, useEffect } from 'react';
import { sanitizeForSpeech } from '../utils/sanitizeForSpeech';

interface UseSpeechSynthesisReturn {
  speak: (text: string, lang?: string, rateOverride?: number) => void;
  /**
   * Append a sentence (or short fragment) to a FIFO playback queue.
   * Unlike `speak`, this does NOT cancel the currently-playing utterance —
   * pending items are drained sequentially via `utterance.onend` chaining.
   * Used by streaming AI replies so the voice can start within ~1-2s of the
   * first token instead of waiting for the full response.
   */
  enqueue: (text: string, lang?: string, rateOverride?: number) => void;
  /**
   * End-of-stream marker. Currently a no-op: any pending queued utterances
   * will continue to drain naturally. Call this after the stream finishes
   * so callers express intent (and we have a hook for future buffering).
   */
  flush: () => void;
  stop: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
  volume: number;
  setVolume: (v: number) => void;
  rate: number;
  setRate: (r: number) => void;
}

interface QueuedItem {
  text: string;
  lang: string;
  rate?: number;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolumeState] = useState(0.7);
  const [rate, setRateState] = useState(0.9);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const volumeRef = useRef(0.7);
  const rateRef = useRef(0.9);
  const queueRef = useRef<QueuedItem[]>([]);
  const drainingRef = useRef(false);
  const drainNextRef = useRef<() => void>(() => {});

  const isSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Load voices (they load async in some browsers)
  useEffect(() => {
    if (!isSupported) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [isSupported]);

  const setVolume = useCallback((v: number) => {
    volumeRef.current = v;
    setVolumeState(v);
    // Update volume on currently playing utterance
    if (utteranceRef.current) {
      utteranceRef.current.volume = v;
    }
  }, []);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
  }, []);

  const speak = useCallback(
    (text: string, lang = 'en-US', rateOverride?: number) => {
      if (!isSupported) return;

      // Strip emoji/decorative icons so TTS does not read them aloud
      // as their literal Unicode names (e.g. "smiling face").
      const speakable = sanitizeForSpeech(text);
      if (!speakable) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(speakable);
      utterance.lang = lang;
      utterance.rate = typeof rateOverride === 'number' ? rateOverride : rateRef.current;
      utterance.pitch = 1;
      utterance.volume = volumeRef.current;

      // Prefer a native English voice if available
      const englishVoice = voices.find(
        (v) => v.lang.startsWith('en') && v.localService
      );
      if (englishVoice) utterance.voice = englishVoice;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [isSupported, voices]
  );

  const drainNext = useCallback(() => {
    if (!isSupported) return;
    const next = queueRef.current.shift();
    if (!next) {
      drainingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    drainingRef.current = true;
    const utterance = new SpeechSynthesisUtterance(next.text);
    utterance.lang = next.lang;
    utterance.rate = typeof next.rate === 'number' ? next.rate : rateRef.current;
    utterance.pitch = 1;
    utterance.volume = volumeRef.current;

    const englishVoice = voices.find(
      (v) => v.lang.startsWith('en') && v.localService
    );
    if (englishVoice) utterance.voice = englishVoice;

    utterance.onstart = () => setIsSpeaking(true);
    // Use ref so that chained onend invocations always call the latest
    // drain function (avoids stale closure capturing old `voices`).
    utterance.onend = () => drainNextRef.current();
    utterance.onerror = () => drainNextRef.current();

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [isSupported, voices]);

  useEffect(() => {
    drainNextRef.current = drainNext;
  }, [drainNext]);
  // Also assign during render so SSR/synchronous callers (e.g. enqueue
  // invoked before commit) get the latest implementation, not the
  // initial no-op stub.
  drainNextRef.current = drainNext;

  const enqueue = useCallback(
    (text: string, lang = 'en-US', rateOverride?: number) => {
      if (!isSupported) return;
      const speakable = sanitizeForSpeech(text);
      if (!speakable) return;
      queueRef.current.push({ text: speakable, lang, rate: rateOverride });
      if (!drainingRef.current) {
        drainNextRef.current();
      }
    },
    [isSupported]
  );

  const flush = useCallback(() => {
    // No-op marker: queued items will continue to drain naturally via
    // onend chaining. Reserved for future end-of-stream buffering logic.
  }, []);

  const stop = useCallback(() => {
    queueRef.current = [];
    drainingRef.current = false;
    if (isSupported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [isSupported]);

  // Cancel TTS on unmount
  useEffect(() => {
    return () => {
      queueRef.current = [];
      drainingRef.current = false;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { speak, enqueue, flush, stop, isSpeaking, isSupported, volume, setVolume, rate, setRate };
}
