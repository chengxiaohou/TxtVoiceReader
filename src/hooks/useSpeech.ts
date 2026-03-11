import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

export type Voice = SpeechSynthesisVoice;

export type TtsEngine = 'browser' | 'azure';

export interface AzureTtsConfig {
  enabled: boolean;
  region: string;
  key: string;
  voice: string;
  outputFormat: string;
  useChinaEndpoint: boolean;
}

export interface UseSpeechOptions {
  engine: TtsEngine;
  azure?: AzureTtsConfig;
}

export interface SpeechState {
  isPlaying: boolean;
  isPaused: boolean;
  voices: Voice[];
  selectedVoice: Voice | null;
  rate: number;
  pitch: number;
  volume: number;
  progress: number; // 0 to 1 (overall)
  currentChunkIndex: number;
  totalChunks: number;
  status: {
    level: 'idle' | 'info' | 'error';
    message: string;
  };
}

export const useSpeech = (
  text: string, 
  initialIndex: number = 0,
  onProgressUpdate?: (index: number, total: number) => void,
  options: UseSpeechOptions = { engine: 'browser' }
) => {
  const isSupported =
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined';

  const [state, setState] = useState<SpeechState>({
    isPlaying: false,
    isPaused: false,
    voices: [],
    selectedVoice: null,
    rate: 1,
    pitch: 1,
    volume: 1,
    progress: 0,
    currentChunkIndex: initialIndex,
    totalChunks: 0,
    status: { level: 'idle', message: '' },
  });

  const chunksRef = useRef<string[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(isSupported ? window.speechSynthesis : null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  
  // Refs to hold latest parameters to avoid closure staleness in recursive calls
  const paramsRef = useRef({
    rate: 1,
    pitch: 1,
    volume: 1,
    selectedVoice: null as Voice | null,
  });

  // Sync refs with state
  useEffect(() => {
    paramsRef.current = {
      rate: state.rate,
      pitch: state.pitch,
      volume: state.volume,
      selectedVoice: state.selectedVoice,
    };
  }, [state.rate, state.pitch, state.volume, state.selectedVoice]);

  // Persist progress strictly by highlighted chunk index.
  useEffect(() => {
    if (onProgressUpdate && chunksRef.current.length > 0) {
      onProgressUpdate(state.currentChunkIndex, chunksRef.current.length);
    }
  }, [state.currentChunkIndex, onProgressUpdate]);

  // Split text into chunks when text changes
  useEffect(() => {
    if (!text) {
      chunksRef.current = [];
      setState(prev => ({ ...prev, totalChunks: 0, currentChunkIndex: 0, progress: 0 }));
      return;
    }

    // Simple chunking by sentence/newline
    const rawChunks = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    chunksRef.current = rawChunks;
    
    // Ensure initialIndex is within bounds
    const safeInitialIndex = Math.min(Math.max(0, initialIndex), rawChunks.length - 1);

    setState(prev => ({ 
      ...prev, 
      totalChunks: rawChunks.length, 
      currentChunkIndex: safeInitialIndex, 
      progress: safeInitialIndex / rawChunks.length 
    }));
  }, [text, initialIndex]);

  // Load voices
  useEffect(() => {
    if (!isSupported) return;
    const synth = synthRef.current;
    if (!synth) return;
    const loadVoices = () => {
      const systemVoices = synth.getVoices();
      if (systemVoices.length === 0) return; // Wait for voices to load
      
      setState((prev) => ({
        ...prev,
        voices: systemVoices,
        selectedVoice: prev.selectedVoice || systemVoices.find((v) => v.default) || systemVoices[0] || null,
      }));
    };

    loadVoices();
    // Some browsers need a little nudge or multiple calls to getVoices()
    const interval = setInterval(() => {
      if (synth.getVoices().length > 0) {
        loadVoices();
        clearInterval(interval);
      }
    }, 100);

    synth.addEventListener('voiceschanged', loadVoices);
    
    return () => {
      clearInterval(interval);
      synth.removeEventListener('voiceschanged', loadVoices);
    };
  }, [isSupported]);

  // Handle voice change
  const setVoice = useCallback((voice: Voice) => {
    setState((prev) => ({ ...prev, selectedVoice: voice }));
  }, []);

  const speakChunk = useCallback(async (index: number) => {
    const synth = synthRef.current;
    if (!synth && options.engine === 'browser') return;
    if (index >= chunksRef.current.length) {
      setState(prev => ({ ...prev, isPlaying: false, isPaused: false, progress: 1 }));
      return;
    }

    const chunk = chunksRef.current[index];

    if (options.engine === 'azure') {
      const config = options.azure;
      if (!config) {
        setState(prev => ({ ...prev, status: { level: 'error', message: 'Azure TTS is not configured.' } }));
        return;
      }

      const region = (config.region || '').trim();
      const key = (config.key || '').trim();
      const voice = (config.voice || '').trim();

      if (!region || !key || !voice) {
        const missing = [
          !region ? 'region' : null,
          !key ? 'key' : null,
          !voice ? 'voice' : null,
        ].filter(Boolean).join(', ');
        setState(prev => ({
          ...prev,
          status: { level: 'error', message: `Azure TTS requires region, key, and voice name. Missing: ${missing}.` }
        }));
        return;
      }

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const isChina = config.useChinaEndpoint;
      const tokenUrl = isChina
        ? `https://${region}.api.cognitive.azure.cn/sts/v1.0/issueToken`
        : `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;

      const ttsUrl = isChina
        ? `https://${region}.tts.speech.azure.cn/cognitiveservices/v1`
        : `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

      const ssml = `<?xml version="1.0" encoding="utf-8"?>
<speak version="1.0" xml:lang="${voice.split('-').slice(0, 2).join('-')}">
  <voice name="${voice}">${chunk.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</voice>
</speak>`;

      setState(prev => ({ ...prev, status: { level: 'info', message: 'Requesting Azure TTS...' } }));

      try {
        const tokenResp = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
          },
          signal: abortRef.current.signal,
        });

        if (!tokenResp.ok) {
          throw new Error(`Token request failed: ${tokenResp.status}`);
        }

        const token = await tokenResp.text();
        const audioResp = await fetch(ttsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': config.outputFormat,
            'User-Agent': 'txt-voice-reader',
          },
          body: ssml,
          signal: abortRef.current.signal,
        });

        if (!audioResp.ok) {
          throw new Error(`TTS request failed: ${audioResp.status}`);
        }

        const audioBuffer = await audioResp.arrayBuffer();
        const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        if (!audioRef.current) {
          audioRef.current = new Audio();
        }

        const audio = audioRef.current;
        audio.src = url;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          const nextIndex = index + 1;
          if (nextIndex < chunksRef.current.length) {
            setState(prev => ({
              ...prev,
              currentChunkIndex: nextIndex,
              progress: nextIndex / chunksRef.current.length,
              status: { level: 'idle', message: '' },
            }));
            speakChunk(nextIndex);
          } else {
            setState(prev => ({ ...prev, isPlaying: false, isPaused: false, progress: 1, status: { level: 'idle', message: '' } }));
            if (onProgressUpdate) {
              onProgressUpdate(chunksRef.current.length, chunksRef.current.length);
            }
          }
        };

        await audio.play();
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        console.error('Azure TTS error', error);
        setState(prev => ({
          ...prev,
          isPlaying: false,
          isPaused: false,
          status: { level: 'error', message: 'Azure TTS failed. Check region/key/voice.' }
        }));
      }

      return;
    }

    // Web Speech API
    synth.cancel();

    const currentVoice = paramsRef.current.selectedVoice;
    const utterance = new SpeechSynthesisUtterance(chunk);
    utteranceRef.current = utterance;

    if (currentVoice) {
      utterance.voice = currentVoice;
    }
    utterance.rate = paramsRef.current.rate;
    utterance.pitch = paramsRef.current.pitch;
    utterance.volume = paramsRef.current.volume;

    utterance.onend = () => {
      const nextIndex = index + 1;
      if (nextIndex < chunksRef.current.length) {
        setState(prev => ({
          ...prev,
          currentChunkIndex: nextIndex,
          progress: nextIndex / chunksRef.current.length
        }));

        speakChunk(nextIndex);
      } else {
        setState(prev => ({ ...prev, isPlaying: false, isPaused: false, progress: 1 }));
        if (onProgressUpdate) {
          onProgressUpdate(chunksRef.current.length, chunksRef.current.length);
        }
      }
    };

    utterance.onerror = (e) => {
      console.error("Speech error", e);
    };

    synth.speak(utterance);
  }, [onProgressUpdate, options.engine, options.azure]);

  // Debounced restart when parameters change
  useEffect(() => {
    // Only restart if playing and NOT paused
    if (state.isPlaying && !state.isPaused) {
      const timer = setTimeout(() => {
        speakChunk(state.currentChunkIndex);
      }, 500); // 500ms debounce
      return () => clearTimeout(timer);
    }
  }, [state.rate, state.pitch, state.volume, state.selectedVoice]);

  const speak = useCallback(() => {
    const synth = synthRef.current;
    if (options.engine === 'browser' && !synth) return;
    if (state.isPaused) {
      // Resume
      if (options.engine === 'browser') {
        synth.resume();
      } else if (audioRef.current) {
        audioRef.current.play();
      }
      setState((prev) => ({ ...prev, isPlaying: true, isPaused: false }));
      return;
    }

    if (state.isPlaying) {
      if (options.engine === 'browser') {
        synth.cancel();
      } else if (audioRef.current) {
        audioRef.current.pause();
      }
    }

    setState(prev => ({ ...prev, isPlaying: true, isPaused: false }));
    speakChunk(state.currentChunkIndex);
  }, [state.isPaused, state.isPlaying, state.currentChunkIndex, speakChunk, options.engine]);

  const pause = useCallback(() => {
    const synth = synthRef.current;
    if (options.engine === 'browser' && !synth) return;
    if (state.isPlaying) {
      if (options.engine === 'browser') {
        synth.pause();
      } else if (audioRef.current) {
        audioRef.current.pause();
      }
      setState((prev) => ({ ...prev, isPlaying: false, isPaused: true }));
    }
  }, [state.isPlaying, options.engine]);

  const stop = useCallback(() => {
    const synth = synthRef.current;
    if (options.engine === 'browser') {
      if (!synth) return;
      synth.cancel();
    } else {
      abortRef.current?.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    }
    setState((prev) => ({ ...prev, isPlaying: false, isPaused: false }));
  }, [options.engine]);

  const skipForward = useCallback(() => {
    if (state.currentChunkIndex < chunksRef.current.length - 1) {
      const nextIndex = state.currentChunkIndex + 1;
      setState(prev => ({ ...prev, currentChunkIndex: nextIndex, progress: nextIndex / chunksRef.current.length }));
      
      if (state.isPlaying) {
        speakChunk(nextIndex);
      }
    }
  }, [state.currentChunkIndex, state.isPlaying, speakChunk]);

  const skipBackward = useCallback(() => {
    if (state.currentChunkIndex > 0) {
      const prevIndex = state.currentChunkIndex - 1;
      setState(prev => ({ ...prev, currentChunkIndex: prevIndex, progress: prevIndex / chunksRef.current.length }));
      
      if (state.isPlaying) {
        speakChunk(prevIndex);
      }
    }
  }, [state.currentChunkIndex, state.isPlaying, speakChunk]);

  const setRate = useCallback((rate: number) => {
    setState((prev) => ({ ...prev, rate }));
  }, []);

  const setPitch = useCallback((pitch: number) => {
    setState((prev) => ({ ...prev, pitch }));
  }, []);

  const setVolume = useCallback((volume: number) => {
    setState((prev) => ({ ...prev, volume }));
  }, []);

  const jumpTo = useCallback((index: number) => {
    if (index >= 0 && index < chunksRef.current.length) {
      setState(prev => ({ 
        ...prev, 
        currentChunkIndex: index, 
        progress: index / chunksRef.current.length 
      }));
      
      if (state.isPlaying) {
        speakChunk(index);
      }
    }
  }, [state.isPlaying, speakChunk]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (synthRef.current) synthRef.current.cancel();
      abortRef.current?.abort();
    };
  }, []);

  return useMemo(() => ({
    ...state,
    isSupported,
    speak,
    pause,
    stop,
    skipForward,
    skipBackward,
    setVoice,
    setRate,
    setPitch,
    setVolume,
    jumpTo,
    status: state.status,
  }), [
    state,
    speak,
    pause,
    stop,
    skipForward,
    skipBackward,
    setVoice,
    setRate,
    setPitch,
    setVolume,
    jumpTo,
    state.status,
  ]);
};
