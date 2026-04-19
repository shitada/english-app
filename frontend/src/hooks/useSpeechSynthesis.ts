import { useState, useCallback, useRef, useEffect } from 'react';
import { sanitizeForSpeech } from '../utils/sanitizeForSpeech';

interface UseSpeechSynthesisReturn {
  speak: (text: string, lang?: string, rateOverride?: number) => void;
  stop: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
  volume: number;
  setVolume: (v: number) => void;
  rate: number;
  setRate: (r: number) => void;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolumeState] = useState(0.7);
  const [rate, setRateState] = useState(0.9);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const volumeRef = useRef(0.7);
  const rateRef = useRef(0.9);

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

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  // Cancel TTS on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  return { speak, stop, isSpeaking, isSupported, volume, setVolume, rate, setRate };
}
