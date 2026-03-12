import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getCachedAudio, setCachedAudio, hashString } from '../utils/audioCache';

export type Voice = SpeechSynthesisVoice;

export type TtsEngine = 'browser' | 'azure';

export interface AzureTtsConfig {
  enabled: boolean;
  region: string;
  key: string;
  voice: string;
  outputFormat: string;
  useChinaEndpoint: boolean;
  cacheMaxEntries: number;
  cacheMaxBytes: number;
  trimStartSec: number;
  trimEndSec: number;
}

export interface UseSpeechOptions {
  engine: TtsEngine;
  azure?: AzureTtsConfig;
}

export interface SpeechState {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  preloadingChunkIndex: number | null;
  preloadedChunkIndex: number | null;
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
    isLoading: false,
    preloadingChunkIndex: null,
    preloadedChunkIndex: null,
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
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());

  const stopCurrentPlayback = useCallback(() => {
    const synth = synthRef.current;
    if (options.engine === 'browser') {
      if (synth) synth.cancel();
    } else {
      abortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      cacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      cacheRef.current.clear();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    }
    setState(prev => ({
      ...prev,
      preloadingChunkIndex: null,
      preloadedChunkIndex: null,
    }));
  }, [options.engine]);
  
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

  useEffect(() => {
    if (state.preloadingChunkIndex === state.currentChunkIndex || state.preloadedChunkIndex === state.currentChunkIndex) {
      setState(prev => ({
        ...prev,
        preloadingChunkIndex: prev.preloadingChunkIndex === prev.currentChunkIndex ? null : prev.preloadingChunkIndex,
        preloadedChunkIndex: prev.preloadedChunkIndex === prev.currentChunkIndex ? null : prev.preloadedChunkIndex,
      }));
    }
  }, [state.currentChunkIndex, state.preloadingChunkIndex, state.preloadedChunkIndex]);

  // Split text into chunks when text changes
  useEffect(() => {
    if (!text) {
      chunksRef.current = [];
      setState(prev => ({ 
        ...prev, 
        totalChunks: 0, 
        currentChunkIndex: 0, 
        progress: 0,
        preloadingChunkIndex: null,
        preloadedChunkIndex: null,
      }));
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
      progress: safeInitialIndex / rawChunks.length,
      preloadingChunkIndex: null,
      preloadedChunkIndex: null,
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

    let safeIndex = index;
    while (safeIndex < chunksRef.current.length && !chunksRef.current[safeIndex].trim()) {
      safeIndex += 1;
    }
    if (safeIndex >= chunksRef.current.length) {
      setState(prev => ({ ...prev, isPlaying: false, isPaused: false, progress: 1 }));
      return;
    }
    if (safeIndex !== index) {
      setState(prev => ({
        ...prev,
        currentChunkIndex: safeIndex,
        progress: safeIndex / chunksRef.current.length,
      }));
    }

    const chunk = chunksRef.current[safeIndex];

    if (options.engine === 'azure') {
      const config = options.azure;
      if (!config) {
        setState(prev => ({ ...prev, status: { level: 'error', message: 'Online TTS is not configured.' } }));
        return;
      }

      const region = (config.region || '').trim();
      const key = (config.key || '').trim();
      const voice = (config.voice || '').trim();

      if (!region || !key || !voice) {
        const missing = [
          !region ? 'region' : null,
          !key ? 'activation code' : null,
          !voice ? 'voice' : null,
        ].filter(Boolean).join(', ');
        setState(prev => ({
          ...prev,
          status: { level: 'error', message: `Online TTS requires region, activation code, and voice name. Missing: ${missing}.` }
        }));
        return;
      }

      const isChina = config.useChinaEndpoint;
      const tokenUrl = isChina
        ? `https://${region}.api.cognitive.azure.cn/sts/v1.0/issueToken`
        : `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;

      const ttsUrl = isChina
        ? `https://${region}.tts.speech.azure.cn/cognitiveservices/v1`
        : `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const findNextNonEmptyIndex = (startIndex: number) => {
      let idx = startIndex;
      while (idx < chunksRef.current.length && !chunksRef.current[idx].trim()) {
        idx += 1;
      }
      return idx < chunksRef.current.length ? idx : -1;
    };

      const fetchAzureAudio = async (targetIndex: number, signal: AbortSignal) => {
        const effectiveIndex = findNextNonEmptyIndex(targetIndex);
        if (effectiveIndex < 0) return null;
        const currentChunk = chunksRef.current[effectiveIndex] || '';
        const cacheMaxEntries = Number.isFinite(config.cacheMaxEntries) ? config.cacheMaxEntries : 200;
        const cacheMaxBytes = Number.isFinite(config.cacheMaxBytes) ? config.cacheMaxBytes : 0;
        const cacheEnabled = cacheMaxEntries > 0 || cacheMaxBytes > 0;
        const rate = Number.isFinite(paramsRef.current.rate) ? paramsRef.current.rate : 1;
        const clampedRate = Math.max(0.5, Math.min(2, rate));
        const ratePercent = Math.round(clampedRate * 100);
        const pitch = Number.isFinite(paramsRef.current.pitch) ? paramsRef.current.pitch : 1;
        const clampedPitch = Math.max(0.5, Math.min(2, pitch));
        const pitchDeltaPercent = Math.round((clampedPitch - 1) * 100);
        const pitchAttr = `${pitchDeltaPercent >= 0 ? '+' : ''}${pitchDeltaPercent}%`;
        const cacheKey = cacheEnabled
          ? `az:${hashString([
              config.region,
              config.voice,
              config.outputFormat,
              config.useChinaEndpoint ? 'cn' : 'global',
              `rate:${ratePercent}`,
              `pitch:${pitchAttr}`,
              currentChunk,
            ].join('|'))}:${currentChunk.length}`
          : null;

        if (cacheKey) {
          try {
            const cachedBuffer = await getCachedAudio(cacheKey);
            if (cachedBuffer) {
              const cachedBlob = new Blob([cachedBuffer], { type: 'audio/mpeg' });
              return { url: URL.createObjectURL(cachedBlob), index: effectiveIndex };
            }
          } catch {
            // ignore cache read errors
          }
        }
        const tokenResp = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
          },
          signal,
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
          body: `<?xml version="1.0" encoding="utf-8"?>\n<speak version="1.0" xml:lang="${voice.split('-').slice(0, 2).join('-')}">\n  <voice name="${voice}"><prosody rate="${ratePercent}%" pitch="${pitchAttr}">${currentChunk.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</prosody></voice>\n</speak>`,
          signal,
        });

        if (!audioResp.ok) {
          throw new Error(`TTS request failed: ${audioResp.status}`);
        }

        const audioBuffer = await audioResp.arrayBuffer();
        if (cacheKey) {
          setCachedAudio(cacheKey, audioBuffer, cacheMaxEntries, cacheMaxBytes).catch(() => {
            // ignore cache write errors
          });
        }
        const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        return { url: URL.createObjectURL(blob), index: effectiveIndex };
      };

      const prefetchNext = (nextIndex: number) => {
        const effectiveIndex = findNextNonEmptyIndex(nextIndex);
        if (effectiveIndex < 0) return;
        if (cacheRef.current.has(effectiveIndex)) {
          setState(prev => ({
            ...prev,
            preloadingChunkIndex: null,
            preloadedChunkIndex: effectiveIndex,
          }));
          return;
        }
        prefetchAbortRef.current?.abort();
        prefetchAbortRef.current = new AbortController();
        setState(prev => ({
          ...prev,
          preloadingChunkIndex: effectiveIndex,
          preloadedChunkIndex: prev.preloadedChunkIndex === effectiveIndex ? prev.preloadedChunkIndex : null,
        }));
        fetchAzureAudio(effectiveIndex, prefetchAbortRef.current.signal)
          .then((result) => {
            if (!result) return;
            cacheRef.current.set(result.index, result.url);
            setState(prev => ({
              ...prev,
              preloadingChunkIndex: prev.preloadingChunkIndex === result.index ? null : prev.preloadingChunkIndex,
              preloadedChunkIndex: result.index,
            }));
          })
          .catch(() => {
            setState(prev => ({
              ...prev,
              preloadingChunkIndex: prev.preloadingChunkIndex === effectiveIndex ? null : prev.preloadingChunkIndex,
            }));
            // ignore prefetch errors
          });
      };

      const startAzurePlayback = (playIndex: number, playUrl: string, audioEl: HTMLAudioElement) => {
        const playChunk = chunksRef.current[playIndex] || '';
        audioEl.preload = 'auto';
        audioEl.src = playUrl;
        const startAt = performance.now();
        console.log(`[AzureTTS] start chunk=${playIndex} t=${startAt.toFixed(1)}ms`);

        const nextIndex = findNextNonEmptyIndex(playIndex + 1);

        const trimStartSec = Number.isFinite(config.trimStartSec) ? Math.max(0, Math.min(3, config.trimStartSec)) : 0;
        const trimEndSec = Number.isFinite(config.trimEndSec) ? Math.max(0, Math.min(3, config.trimEndSec)) : 0;
        let finished = false;

        const finalizeChunk = () => {
          if (finished) return;
          finished = true;
          audioEl.onended = null;
          audioEl.ontimeupdate = null;
          audioEl.onloadedmetadata = null;
          audioEl.oncanplay = null;
          const endAt = performance.now();
          console.log(`[AzureTTS] end chunk=${playIndex} t=${endAt.toFixed(1)}ms dur=${(endAt - startAt).toFixed(1)}ms`);
          URL.revokeObjectURL(playUrl);
          if (nextIndex >= 0) {
            const startNext = () => {
              setState(prev => ({
                ...prev,
                currentChunkIndex: nextIndex,
                progress: nextIndex / chunksRef.current.length,
                status: { level: 'idle', message: '' },
              }));
              const cachedNext = cacheRef.current.get(nextIndex) || null;
              if (cachedNext) {
                cacheRef.current.delete(nextIndex);
                prefetchNext(nextIndex + 1);
                startAzurePlayback(nextIndex, cachedNext, audioRef.current || audioEl);
                return;
              }
              prefetchNext(nextIndex + 1);
              speakChunk(nextIndex);
            };

            startNext();
            return;
          }

          setState(prev => ({ ...prev, isPlaying: false, isPaused: false, isLoading: false, progress: 1, status: { level: 'idle', message: '' } }));
          if (onProgressUpdate) {
            onProgressUpdate(chunksRef.current.length, chunksRef.current.length);
          }
        };

        const applyTrim = () => {
          const duration = audioEl.duration;
          if (!Number.isFinite(duration) || duration <= 0) {
            if (trimStartSec > 0) {
              try {
                audioEl.currentTime = trimStartSec;
              } catch {
                // ignore seek errors
              }
            }
            return;
          }
          const startTime = Math.min(Math.max(trimStartSec, 0), Math.max(0, duration - 0.01));
          const endTime = Math.max(0, duration - trimEndSec);
          if (endTime <= startTime + 0.02) {
            audioEl.pause();
            finalizeChunk();
            return;
          }
          if (startTime > 0) {
            try {
              audioEl.currentTime = startTime;
            } catch {
              // ignore seek errors
            }
          }
          if (trimEndSec > 0) {
            audioEl.ontimeupdate = () => {
              if (audioEl.currentTime >= endTime) {
                audioEl.pause();
                finalizeChunk();
              }
            };
          }
        };

        audioEl.onloadedmetadata = applyTrim;
        audioEl.oncanplay = applyTrim;
        audioEl.onended = () => finalizeChunk();

        audioEl.play().finally(() => {
          setState(prev => ({ ...prev, isLoading: false }));
        });
      };

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        let url = cacheRef.current.get(safeIndex) || null;
        if (url) {
          cacheRef.current.delete(safeIndex);
        } else {
          setState(prev => ({ ...prev, isLoading: true, status: { level: 'info', message: 'Requesting online speech...' } }));
          const result = await fetchAzureAudio(safeIndex, abortRef.current.signal);
          url = result ? result.url : null;
        }
        if (!url) {
          setState(prev => ({ ...prev, isLoading: false }));
          return;
        }
        prefetchNext(safeIndex + 1);
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        startAzurePlayback(safeIndex, url, audioRef.current);
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        console.error('Online TTS error', error);
        setState(prev => ({
          ...prev,
          isPlaying: false,
          isPaused: false,
          isLoading: false,
          status: { level: 'error', message: 'Online speech failed. Check region/activation code/voice.' }
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
      const nextIndex = safeIndex + 1;
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
      prefetchAbortRef.current?.abort();
      cacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      cacheRef.current.clear();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    }
    setState((prev) => ({ ...prev, isPlaying: false, isPaused: false, isLoading: false }));
  }, [options.engine]);

  const findNextNonEmptyIndex = useCallback((startIndex: number) => {
    let idx = startIndex;
    while (idx < chunksRef.current.length && !chunksRef.current[idx].trim()) {
      idx += 1;
    }
    return idx < chunksRef.current.length ? idx : -1;
  }, []);

  const findPrevNonEmptyIndex = useCallback((startIndex: number) => {
    let idx = startIndex;
    while (idx >= 0 && !chunksRef.current[idx].trim()) {
      idx -= 1;
    }
    return idx >= 0 ? idx : -1;
  }, []);

  const skipForward = useCallback(() => {
    const nextIndex = findNextNonEmptyIndex(state.currentChunkIndex + 1);
    if (nextIndex < 0) return;
    setState(prev => ({ ...prev, currentChunkIndex: nextIndex, progress: nextIndex / chunksRef.current.length }));
    if (state.isPlaying) {
      stopCurrentPlayback();
      speakChunk(nextIndex);
    }
  }, [state.currentChunkIndex, state.isPlaying, speakChunk, stopCurrentPlayback, findNextNonEmptyIndex]);

  const skipBackward = useCallback(() => {
    const prevIndex = findPrevNonEmptyIndex(state.currentChunkIndex - 1);
    if (prevIndex < 0) return;
    setState(prev => ({ ...prev, currentChunkIndex: prevIndex, progress: prevIndex / chunksRef.current.length }));
    if (state.isPlaying) {
      stopCurrentPlayback();
      speakChunk(prevIndex);
    }
  }, [state.currentChunkIndex, state.isPlaying, speakChunk, stopCurrentPlayback, findPrevNonEmptyIndex]);

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
        progress: index / chunksRef.current.length,
        isPlaying: prev.isPlaying ? prev.isPlaying : false,
        isPaused: prev.isPaused ? false : prev.isPaused,
        isLoading: false,
      }));
      
      if (state.isPlaying || state.isPaused) {
        stopCurrentPlayback();
      }
      if (state.isPlaying) {
        speakChunk(index);
      }
    }
  }, [state.isPlaying, speakChunk, stopCurrentPlayback]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (synthRef.current) synthRef.current.cancel();
      abortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      cacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      cacheRef.current.clear();
    };
  }, []);

  // When switching engine, stop current playback and clear play/pause state.
  useEffect(() => {
    stopCurrentPlayback();
    setState((prev) => ({
      ...prev,
      isPlaying: false,
      isPaused: false,
      isLoading: false,
    }));
  }, [options.engine, stopCurrentPlayback]);

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
    isLoading: state.isLoading,
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
    state.isLoading,
  ]);
};
