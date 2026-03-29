import { useState, useRef, useCallback, useEffect } from 'react';

interface UseSpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

interface UseSpeechRecognitionReturn {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

function log(level: string, ...args: any[]) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [SpeechRecognition] [${level}]`;
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  if (level === 'ERROR') console.error(prefix, ...args);
  else if (level === 'WARN') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
  // Send to backend log file
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message: `[SpeechRecognition] ${message}` }),
  }).catch(() => {});
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const { lang = 'en-US', continuous = false, interimResults = true } = options;

  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

  const isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const start = useCallback(async () => {
    log('INFO', 'start() called. isSupported=' + isSupported);

    if (!isSupported) {
      const msg = 'Speech recognition is not supported in this browser.';
      log('ERROR', msg);
      setError(msg);
      return;
    }

    // Check if mediaDevices is available (requires secure context)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('WARN', 'navigator.mediaDevices not available, skipping permission request (non-secure context?)');
    } else {
      // Request microphone permission explicitly
      try {
        log('INFO', 'Requesting microphone permission via getUserMedia...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        log('INFO', 'Microphone permission granted.');
      } catch (err: any) {
        const msg = `Microphone access denied: ${err.message || err}`;
        log('ERROR', msg);
        setError(msg);
        return;
      }
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
    }

    setError(null);

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    recognition.onresult = (event: any) => {
      let final = '';
      let interim = '';
      // Only process new results (not previously processed ones)
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (final) {
        log('INFO', 'Final transcript:', final);
        setTranscript((prev) => prev + final);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      log('ERROR', 'Recognition error:', event.error, event.message);
      if (event.error === 'not-allowed') {
        setError('Microphone access was denied. Please allow microphone access in your browser settings.');
      } else if (event.error === 'no-speech') {
        setError('No speech detected. Please try again.');
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onstart = () => {
      log('INFO', 'Recognition started (lang=' + lang + ', continuous=' + continuous + ')');
    };

    recognition.onend = () => {
      log('INFO', 'Recognition ended.');
      setIsListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
      log('INFO', 'recognition.start() called successfully.');
    } catch (err: any) {
      const msg = `Failed to start recognition: ${err.message || err}`;
      log('ERROR', msg);
      setError(msg);
      setIsListening(false);
    }
  }, [isSupported, lang, continuous, interimResults]);

  const stop = useCallback(() => {
    log('INFO', 'Stopping recognition...');
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { transcript, interimTranscript, isListening, isSupported, error, start, stop, reset };
}
