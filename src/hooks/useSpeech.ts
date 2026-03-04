import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { sherpaOnnxService } from '../services/tts/SherpaOnnxService';

export interface SpeechState {
  isPlaying: boolean;
  isPaused: boolean;
  voices: (SpeechSynthesisVoice | { id: string, name: string, lang: string, localService: boolean })[];
  selectedVoice: any | null;
  rate: number;
  pitch: number;
  volume: number;
  progress: number; // 0 to 1 (overall)
  currentChunkIndex: number;
  totalChunks: number;
  isModelLoading: boolean;
  modelLoadingProgress: number;
}

const SHERPA_VOICE = {
  id: 'sherpa-onnx-piper-zh',
  name: 'Piper 高质量 (离线)',
  lang: 'zh-CN',
  localService: true,
};

export const useSpeech = (
  text: string, 
  initialIndex: number = 0,
  onProgressUpdate?: (index: number, total: number) => void
) => {
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
    isModelLoading: false,
    modelLoadingProgress: 0,
  });

  const chunksRef = useRef<string[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const synthRef = useRef(window.speechSynthesis);
  
  // Refs to hold latest parameters to avoid closure staleness in recursive calls
  const paramsRef = useRef({
    rate: 1,
    pitch: 1,
    volume: 1,
    selectedVoice: null as SpeechSynthesisVoice | null,
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
    const synth = synthRef.current;
    const loadVoices = () => {
      const systemVoices = synth.getVoices();
      const allVoices = [SHERPA_VOICE, ...systemVoices];
      
      setState((prev) => ({
        ...prev,
        voices: allVoices,
        selectedVoice: prev.selectedVoice || SHERPA_VOICE || systemVoices.find((v) => v.default) || systemVoices[0] || null,
      }));
    };

    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    
    return () => {
      synth.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // Listen to Sherpa model loading progress
  useEffect(() => {
    sherpaOnnxService.onProgress((percent) => {
      setState(prev => ({ ...prev, modelLoadingProgress: percent }));
    });
  }, []);

  const speakChunk = useCallback(async (index: number) => {
    const synth = synthRef.current;
    if (index >= chunksRef.current.length) {
      setState(prev => ({ ...prev, isPlaying: false, isPaused: false, progress: 1 }));
      return;
    }

    // Cancel any ongoing speech
    synth.cancel();
    sherpaOnnxService.stop();

    const chunk = chunksRef.current[index];
    const isSherpa = paramsRef.current.selectedVoice?.id === SHERPA_VOICE.id;

    if (isSherpa) {
      try {
        if (!sherpaOnnxService.isInitialized) {
          setState(prev => ({ ...prev, isModelLoading: true }));
          try {
            await sherpaOnnxService.init();
          } finally {
            setState(prev => ({ ...prev, isModelLoading: false }));
          }
        }
        
        setState(prev => ({ ...prev, isPlaying: true, isPaused: false }));
        await sherpaOnnxService.speak(chunk, paramsRef.current.rate);
        
        // Handle next chunk
        const nextIndex = index + 1;
        if (nextIndex < chunksRef.current.length) {
          setState(prev => ({ 
            ...prev, 
            currentChunkIndex: nextIndex,
            progress: nextIndex / chunksRef.current.length 
          }));
          if (onProgressUpdate) onProgressUpdate(nextIndex, chunksRef.current.length);
          speakChunk(nextIndex);
        } else {
          setState(prev => ({ ...prev, isPlaying: false, isPaused: false, progress: 1 }));
          if (onProgressUpdate) onProgressUpdate(chunksRef.current.length, chunksRef.current.length);
        }
      } catch (error) {
        console.error("Sherpa-ONNX error", error);
        setState(prev => ({ ...prev, isPlaying: false }));
      }
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    utteranceRef.current = utterance;

    // Use refs for latest parameters
    if (paramsRef.current.selectedVoice) {
      utterance.voice = paramsRef.current.selectedVoice;
    }
    utterance.rate = paramsRef.current.rate;
    utterance.pitch = paramsRef.current.pitch;
    utterance.volume = paramsRef.current.volume;

    utterance.onend = () => {
      // Automatically play next chunk
      const nextIndex = index + 1;
      if (nextIndex < chunksRef.current.length) {
        setState(prev => ({ 
          ...prev, 
          currentChunkIndex: nextIndex,
          progress: nextIndex / chunksRef.current.length 
        }));
        
        // Notify parent about progress update
        if (onProgressUpdate) {
          onProgressUpdate(nextIndex, chunksRef.current.length);
        }
        
        speakChunk(nextIndex);
      } else {
        setState(prev => ({ ...prev, isPlaying: false, isPaused: false, progress: 1 }));
        // Notify completion
        if (onProgressUpdate) {
          onProgressUpdate(chunksRef.current.length, chunksRef.current.length);
        }
      }
    };

    utterance.onerror = (e) => {
      console.error("Speech error", e);
      // Don't stop state immediately on error as it might be a cancel event
      // But if it is a real error, we might want to stop.
      // For now, we assume cancel is intentional.
    };

    synth.speak(utterance);
  }, [onProgressUpdate]); // Empty dependency array because we use refs!

  // Debounced restart when parameters change
  useEffect(() => {
    // Only restart if playing and NOT paused
    if (state.isPlaying && !state.isPaused) {
      const timer = setTimeout(() => {
        // Restart current chunk with new parameters
        // We must use the current index from state
        // Since this effect runs on state change, state.currentChunkIndex is fresh
        speakChunk(state.currentChunkIndex);
      }, 500); // 500ms debounce
      return () => clearTimeout(timer);
    }
  }, [state.rate, state.pitch, state.volume, state.selectedVoice]); // Only trigger on these changes

  const speak = useCallback(() => {
    const synth = synthRef.current;
    if (state.isPaused) {
      synth.resume();
      setState((prev) => ({ ...prev, isPlaying: true, isPaused: false }));
      return;
    }

    if (state.isPlaying) {
      synth.cancel();
    }

    setState(prev => ({ ...prev, isPlaying: true, isPaused: false }));
    speakChunk(state.currentChunkIndex);
  }, [state.isPaused, state.isPlaying, state.currentChunkIndex, speakChunk]);

  const pause = useCallback(() => {
    const synth = synthRef.current;
    if (state.isPlaying) {
      synth.pause();
      sherpaOnnxService.stop();
      setState((prev) => ({ ...prev, isPlaying: false, isPaused: true }));
      // Notify pause progress
      if (onProgressUpdate && chunksRef.current.length > 0) {
        onProgressUpdate(state.currentChunkIndex, chunksRef.current.length);
      }
    }
  }, [state.isPlaying, state.currentChunkIndex, onProgressUpdate]);

  const stop = useCallback(() => {
    const synth = synthRef.current;
    synth.cancel();
    setState((prev) => ({ ...prev, isPlaying: false, isPaused: false }));
    // Notify stop progress
    if (onProgressUpdate && chunksRef.current.length > 0) {
      onProgressUpdate(state.currentChunkIndex, chunksRef.current.length);
    }
  }, [state.currentChunkIndex, onProgressUpdate]);

  const skipForward = useCallback(() => {
    if (state.currentChunkIndex < chunksRef.current.length - 1) {
      const nextIndex = state.currentChunkIndex + 1;
      setState(prev => ({ ...prev, currentChunkIndex: nextIndex, progress: nextIndex / chunksRef.current.length }));
      
      // Notify progress
      if (onProgressUpdate) {
        onProgressUpdate(nextIndex, chunksRef.current.length);
      }

      if (state.isPlaying) {
        speakChunk(nextIndex);
      }
    }
  }, [state.currentChunkIndex, state.isPlaying, speakChunk, onProgressUpdate]);

  const skipBackward = useCallback(() => {
    if (state.currentChunkIndex > 0) {
      const prevIndex = state.currentChunkIndex - 1;
      setState(prev => ({ ...prev, currentChunkIndex: prevIndex, progress: prevIndex / chunksRef.current.length }));
      
      // Notify progress
      if (onProgressUpdate) {
        onProgressUpdate(prevIndex, chunksRef.current.length);
      }

      if (state.isPlaying) {
        speakChunk(prevIndex);
      }
    }
  }, [state.currentChunkIndex, state.isPlaying, speakChunk, onProgressUpdate]);

  const setVoice = useCallback((voice: SpeechSynthesisVoice) => {
    setState((prev) => ({ ...prev, selectedVoice: voice }));
  }, []);

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
      
      if (onProgressUpdate) {
        onProgressUpdate(index, chunksRef.current.length);
      }

      if (state.isPlaying) {
        speakChunk(index);
      }
    }
  }, [state.isPlaying, speakChunk, onProgressUpdate]);

  // Cleanup
  useEffect(() => {
    return () => {
      synthRef.current.cancel();
    };
  }, []);

  return useMemo(() => ({
    ...state,
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
  ]);
};
