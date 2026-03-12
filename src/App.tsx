import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Reader } from './components/Reader';
import { SettingsPanel } from './components/SettingsPanel';
import { Library } from './components/Library';
import { useSpeech, AzureTtsConfig, TtsEngine } from './hooks/useSpeech';
import { Settings, Play, Pause, Check, ChevronLeft, BookOpen, Loader2, Mic } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { addBook, updateProgress, getBook, Book } from './utils/db';
import { translations, Language } from './i18n';

type Theme = 'light' | 'dark' | 'sepia';
type View = 'library' | 'reader';
type ActivationStage = 'required' | 'voices' | 'done';
type AzureVoice = { shortName: string; locale: string; localName?: string; gender?: string };
const LAST_READING_BOOK_KEY = 'txt-voice-reader-last-reading-book-id-v1';
const AZURE_TTS_CONFIG_KEY = 'txt-voice-reader-azure-tts-config-v1';
const ACTIVATION_VOICE_CONFIRMED_KEY = 'txt-voice-reader-activation-voice-confirmed-v1';
const AZURE_VOICE_LIST_KEY = 'txt-voice-reader-azure-tts-voices-v1';
const APP_VERSION = '1.2.0';

export default function App() {
  const envRegion = (import.meta as any).env?.VITE_AZURE_REGION || '';
  const envKey = (import.meta as any).env?.VITE_AZURE_KEY || '';
  const envVoice = (import.meta as any).env?.VITE_AZURE_VOICE || '';
  const envOutputFormat = (import.meta as any).env?.VITE_AZURE_OUTPUT_FORMAT || '';
  const envUseChina = (import.meta as any).env?.VITE_AZURE_USE_CHINA_ENDPOINT === 'true';
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [view, setView] = useState<View>('library');
  const [isOpeningBook, setIsOpeningBook] = useState(false);
  const [playScrollSignal, setPlayScrollSignal] = useState(0);
  const openingStartedAtRef = useRef<number>(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<Theme>('dark');
  const [language, setLanguage] = useState<Language>('zh');
  const [ttsEngine, setTtsEngine] = useState<TtsEngine>('azure');
  const [azureConfig, setAzureConfig] = useState<AzureTtsConfig>({
    enabled: true,
    region: envRegion || 'eastasia',
    key: envKey || '',
    voice: envVoice || 'zh-CN-XiaoxiaoNeural',
    outputFormat: envOutputFormat || 'audio-24khz-48kbitrate-mono-mp3',
    useChinaEndpoint: envUseChina || false,
    overlapEnabled: false,
    overlapMs: 0,
  });
  const [isAzureConfigHydrated, setIsAzureConfigHydrated] = useState(false);

  const [isJumpModalOpen, setIsJumpModalOpen] = useState(false);
  const [activationStage, setActivationStage] = useState<ActivationStage>('done');
  const [activationKeyInput, setActivationKeyInput] = useState('');
  const [activationVoices, setActivationVoices] = useState<AzureVoice[]>([]);
  const [activationStatus, setActivationStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [activationError, setActivationError] = useState('');
  const [activationSkipped, setActivationSkipped] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [activationVoiceConfirmed, setActivationVoiceConfirmed] = useState(false);
  const [returnViewAfterActivation, setReturnViewAfterActivation] = useState<View | null>(null);
  const [debugActivationEnabled] = useState(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('debug');
  });
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const activationPageRef = useRef<HTMLDivElement | null>(null);
  const activationVoicePageRef = useRef<HTMLDivElement | null>(null);

  const t = translations[language];

  const hasActivation = Boolean(azureConfig.key.trim());
  const hasActivationVoice = activationVoiceConfirmed && Boolean(azureConfig.voice.trim());
  const isActivationMissing = !hasActivation;
  const requireActivationCode = useCallback(() => {
    if (ttsEngine !== 'azure' || hasActivation) return true;
    setIsSettingsOpen(false);
    setActivationStage('required');
    return false;
  }, [hasActivation, ttsEngine]);

  const persistLastReadingBook = useCallback((bookId: string) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LAST_READING_BOOK_KEY, bookId);
    } catch {
      // no-op
    }
  }, []);

  const clearLastReadingBook = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(LAST_READING_BOOK_KEY);
    } catch {
      // no-op
    }
  }, []);

  const getLastReadingBookId = useCallback(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(LAST_READING_BOOK_KEY) || '';
    } catch {
      return '';
    }
  }, []);

  // Callback to save progress to IndexedDB
  const handleProgressUpdate = useCallback((index: number, total: number) => {
    if (currentBook) {
      updateProgress(currentBook.id, index, total);
    }
  }, [currentBook]);

  const {
    speak,
    pause,
    stop,
    skipForward,
    skipBackward,
    isPlaying,
    isPaused,
    voices,
    selectedVoice,
    setVoice,
    rate,
    setRate,
    pitch,
    setPitch,
    volume,
    setVolume,
    progress,
    currentChunkIndex,
    totalChunks,
    jumpTo,
    status,
    isLoading,
  } = useSpeech(
    currentBook?.content || '', 
    currentBook?.progress || 0,
    handleProgressUpdate,
    {
      engine: ttsEngine,
      azure: azureConfig,
    }
  );

  const handleImportBook = async (text: string, name: string) => {
    try {
      openingStartedAtRef.current = Date.now();
      setIsOpeningBook(true);
      const newBook = await addBook(name, text);
      // Let loading overlay paint first, then switch to reader.
      window.setTimeout(() => {
        setCurrentBook(newBook);
        setView('reader');
        persistLastReadingBook(newBook.id);
      }, 0);
    } catch (error) {
      console.error("Failed to import book:", error);
      alert(t.saveError);
      setIsOpeningBook(false);
    }
  };

  const handleSelectBook = (book: Book) => {
    openingStartedAtRef.current = Date.now();
    setIsOpeningBook(true);
    // Let loading overlay paint first, then switch to reader.
    window.setTimeout(() => {
      setCurrentBook(book);
      setView('reader');
      persistLastReadingBook(book.id);
    }, 0);
  };

  const handleBack = () => {
    if (currentBook && totalChunks > 0) {
      handleProgressUpdate(currentChunkIndex, totalChunks);
    }
    stop();
    setCurrentBook(null);
    setView('library');
    setIsOpeningBook(false);
    clearLastReadingBook();
  };

  const handleReaderReady = useCallback(() => {
    const minVisibleMs = 450;
    const elapsed = Date.now() - openingStartedAtRef.current;
    const remaining = Math.max(0, minVisibleMs - elapsed);
    window.setTimeout(() => {
      setIsOpeningBook(false);
    }, remaining);
  }, []);

  const handleStartPlayback = useCallback(() => {
    if (!requireActivationCode()) return;
    setPlayScrollSignal((prev) => prev + 1);
    speak();
  }, [speak, requireActivationCode]);

  const handleTogglePlayback = useCallback(() => {
    if (!requireActivationCode()) return;
    if (isPlaying) {
      pause();
      return;
    }
    setPlayScrollSignal((prev) => prev + 1);
    speak();
  }, [isPlaying, pause, speak, requireActivationCode]);

  const handleJump = (e: any) => {
    e.preventDefault();
    const percent = parseFloat(jumpValue);
    if (!isNaN(percent) && percent >= 0 && percent <= 100) {
      if (totalChunks > 0) {
        const targetIndex = Math.floor((percent / 100) * totalChunks);
        jumpTo(Math.min(targetIndex, totalChunks - 1));
        setJumpValue('');
        setIsJumpModalOpen(false);
      }
    }
  };

  const getLanguageName = useCallback((langCode: string) => {
    try {
      const displayNames = new Intl.DisplayNames([language], { type: 'language' });
      const name = displayNames.of(langCode.split('-')[0]);
      return name ? `${name} (${langCode})` : langCode;
    } catch {
      return langCode;
    }
  }, [language]);

  const groupedActivationVoices = useMemo(() => {
    const groups: Record<string, AzureVoice[]> = {};
    activationVoices.forEach((voice) => {
      const lang = voice.locale || 'und';
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push(voice);
    });
    return Object.entries(groups).sort(([a], [b]) => {
      const aIsZh = a.startsWith('zh');
      const bIsZh = b.startsWith('zh');
      if (aIsZh && !bIsZh) return -1;
      if (!aIsZh && bIsZh) return 1;
      const aIsCurrent = a.startsWith(language);
      const bIsCurrent = b.startsWith(language);
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      return a.localeCompare(b);
    });
  }, [activationVoices, language]);

  const fetchAzureVoices = useCallback(async (key: string) => {
    const region = (azureConfig.region || '').trim();
    if (!region || !key.trim()) {
      setActivationStatus('error');
      setActivationError(t.activationFetchError);
      return;
    }

    const endpoint = azureConfig.useChinaEndpoint
      ? `https://${region}.tts.speech.azure.cn/cognitiveservices/voices/list`
      : `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

    setActivationStatus('loading');
    setActivationError('');
    try {
      const resp = await fetch(endpoint, {
        headers: {
          'Ocp-Apim-Subscription-Key': key.trim(),
        },
      });
      if (!resp.ok) {
        throw new Error(`Voice list failed: ${resp.status}`);
      }
      const data = await resp.json();
      const mapped = Array.isArray(data)
        ? data.map((v: any) => ({
            shortName: String(v.ShortName || v.shortName || ''),
            locale: String(v.Locale || v.locale || ''),
            localName: v.LocalName || v.localName,
            gender: v.Gender || v.gender,
          }))
        : [];
      if (mapped.length === 0) {
        throw new Error('Voice list empty');
      }
      setActivationVoices(mapped);
      try {
        window.localStorage.setItem(AZURE_VOICE_LIST_KEY, JSON.stringify(mapped));
      } catch {
        // no-op
      }
      setActivationStatus('idle');
      setActivationStage('voices');
    } catch (error) {
      console.error('Activation voice fetch failed', error);
      setActivationStatus('error');
      setActivationError(t.activationFetchError);
    }
  }, [azureConfig.region, azureConfig.useChinaEndpoint, t.activationFetchError]);

  const openActivationVoices = useCallback(() => {
    if (!hasActivation) {
      setIsSettingsOpen(false);
      setActivationStage('required');
      return;
    }
    setActivationStage('voices');
    setActivationKeyInput(azureConfig.key || '');
    setActivationStatus('idle');
    setActivationError('');
    if (activationVoices.length === 0) {
      fetchAzureVoices(azureConfig.key || '');
    }
  }, [activationVoices.length, azureConfig.key, fetchAzureVoices, hasActivation]);

  const previewVoice = useCallback(async (voice: AzureVoice) => {
    const region = (azureConfig.region || '').trim();
    const key = (azureConfig.key || '').trim();
    if (!region || !key || !voice?.shortName) {
      setPreviewStatus('error');
      setPreviewError(t.activationFetchError);
      setPreviewingVoiceId(null);
      return;
    }
    const tokenUrl = azureConfig.useChinaEndpoint
      ? `https://${region}.api.cognitive.azure.cn/sts/v1.0/issueToken`
      : `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
    const ttsUrl = azureConfig.useChinaEndpoint
      ? `https://${region}.tts.speech.azure.cn/cognitiveservices/v1`
      : `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    previewAbortRef.current?.abort();
    previewAbortRef.current = new AbortController();
    setPreviewStatus('loading');
    setPreviewError('');
    setPreviewingVoiceId(voice.shortName);
    try {
      const tokenResp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
        },
        signal: previewAbortRef.current.signal,
      });
      if (!tokenResp.ok) {
        throw new Error(`Token request failed: ${tokenResp.status}`);
      }
      const token = await tokenResp.text();
      const sampleText = language === 'zh'
        ? '你好，这是语音试听示例。'
        : 'Hello, this is a voice preview sample.';
      const audioResp = await fetch(ttsUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': azureConfig.outputFormat,
          'User-Agent': 'txt-voice-reader',
        },
        body: `<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<speak version=\"1.0\" xml:lang=\"${voice.locale}\">\n  <voice name=\"${voice.shortName}\">${sampleText.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</voice>\n</speak>`,
        signal: previewAbortRef.current.signal,
      });
      if (!audioResp.ok) {
        throw new Error(`TTS request failed: ${audioResp.status}`);
      }
      const audioBuffer = await audioResp.arrayBuffer();
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
      }
      previewAudioRef.current.src = url;
      previewAudioRef.current.onplaying = () => {
        setPreviewStatus('playing');
      };
      previewAudioRef.current.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewStatus('idle');
        setPreviewingVoiceId(null);
      };
      previewAudioRef.current.play().catch(() => {
        URL.revokeObjectURL(url);
        setPreviewStatus('error');
        setPreviewError(t.activationFetchError);
        setPreviewingVoiceId(null);
      });
    } catch (error) {
      if ((error as any)?.name === 'AbortError') return;
      console.error('Preview voice failed', error);
      setPreviewStatus('error');
      setPreviewError(t.activationFetchError);
      setPreviewingVoiceId(null);
    }
  }, [azureConfig.region, azureConfig.key, azureConfig.outputFormat, azureConfig.useChinaEndpoint, language, t.activationFetchError]);

  // Apply theme to body for overscroll colors
  useEffect(() => {
    let cancelled = false;

    const restoreLastReadingSession = async () => {
      const bookId = getLastReadingBookId();
      if (!bookId) return;

      try {
        openingStartedAtRef.current = Date.now();
        setIsOpeningBook(true);
        const restoredBook = await getBook(bookId);
        if (cancelled) return;
        if (!restoredBook) {
          clearLastReadingBook();
          setIsOpeningBook(false);
          return;
        }

        setCurrentBook(restoredBook);
        setView('reader');
      } catch (error) {
        console.error('Failed to restore last reading session:', error);
        setIsOpeningBook(false);
      }
    };

    restoreLastReadingSession();

    return () => {
      cancelled = true;
    };
  }, [clearLastReadingBook, getLastReadingBookId]);

  useEffect(() => {
    if (view === 'reader' && currentBook) {
      persistLastReadingBook(currentBook.id);
    }
  }, [view, currentBook, persistLastReadingBook]);

  useEffect(() => {
    if (view !== 'reader') return;
    if (isSettingsOpen) return;
    if (activationStage !== 'done') return;

    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(
        el &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.isContentEditable)
      );
    };

    const shouldHandle = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return false;
      return (
        e.code === 'Space' ||
        e.key === ' ' ||
        e.key === 'Spacebar' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldHandle(e)) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        handleTogglePlayback();
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        skipBackward();
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        skipForward();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!shouldHandle(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('keydown', onKeyDown, { capture: true });
    document.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true } as any);
      document.removeEventListener('keyup', onKeyUp, { capture: true } as any);
    };
  }, [view, handleTogglePlayback, skipBackward, skipForward, isSettingsOpen, activationStage]);

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    
    // Remove all theme-related classes first to avoid conflicts
    html.classList.remove('dark', 'theme-sepia', 'theme-light');
    
    if (theme === 'dark') {
      body.style.backgroundColor = '#020617'; // slate-950
      html.classList.add('dark');
    } else if (theme === 'sepia') {
      body.style.backgroundColor = '#f4ecd8';
      html.classList.add('theme-sepia');
    } else {
      body.style.backgroundColor = '#ffffff';
      html.classList.add('theme-light');
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };
    const preventTouchMove = (event: TouchEvent) => {
      if (activationStage === 'required') {
        event.preventDefault();
      }
    };
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });
    document.addEventListener('touchmove', preventTouchMove, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
      document.removeEventListener('touchmove', preventTouchMove);
    };
  }, [activationStage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(AZURE_TTS_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AzureTtsConfig & { engine?: TtsEngine };
        if (parsed) {
          setAzureConfig({
            enabled: Boolean(parsed.enabled),
            region: parsed.region || envRegion || 'eastasia',
            key: parsed.key || envKey || '',
            voice: parsed.voice || envVoice || 'zh-CN-XiaoxiaoNeural',
            outputFormat: parsed.outputFormat || envOutputFormat || 'audio-24khz-48kbitrate-mono-mp3',
            useChinaEndpoint: parsed.useChinaEndpoint ?? envUseChina ?? false,
            overlapEnabled: parsed.overlapEnabled ?? false,
            overlapMs: typeof parsed.overlapMs === 'number' ? parsed.overlapMs : 0,
          });
          if (parsed.engine === 'browser' || parsed.engine === 'azure') {
            setTtsEngine(parsed.engine);
          }
        }
      }
    } catch {
      // no-op
    }
    try {
      const confirmed = window.localStorage.getItem(ACTIVATION_VOICE_CONFIRMED_KEY);
      setActivationVoiceConfirmed(confirmed === 'true');
    } catch {
      // no-op
    }
    try {
      const cachedVoices = window.localStorage.getItem(AZURE_VOICE_LIST_KEY);
      if (cachedVoices) {
        const parsed = JSON.parse(cachedVoices) as AzureVoice[];
        if (Array.isArray(parsed)) {
          setActivationVoices(parsed);
        }
      }
    } catch {
      // no-op
    }
    setIsAzureConfigHydrated(true);
  }, []);

  useEffect(() => {
    if (!isAzureConfigHydrated) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AZURE_TTS_CONFIG_KEY, JSON.stringify({
        ...azureConfig,
        engine: ttsEngine,
      }));
    } catch {
      // no-op
    }
  }, [azureConfig, ttsEngine, isAzureConfigHydrated]);

  useEffect(() => {
    if (!isAzureConfigHydrated) return;
    try {
      window.localStorage.setItem(ACTIVATION_VOICE_CONFIRMED_KEY, activationVoiceConfirmed ? 'true' : 'false');
    } catch {
      // no-op
    }
  }, [activationVoiceConfirmed, isAzureConfigHydrated]);

  useEffect(() => {
    if (!isAzureConfigHydrated) return;
    if (activationStage === 'voices') return;
    if (activationSkipped) {
      setActivationStage('done');
      return;
    }
    if (hasActivation && hasActivationVoice) {
      setActivationStage('done');
      return;
    }
    setActivationStage('required');
    setActivationKeyInput(azureConfig.key || '');
  }, [hasActivation, hasActivationVoice, activationSkipped, isAzureConfigHydrated, azureConfig.key, activationStage]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (activationStage === 'required') {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  }, [activationStage]);

  useEffect(() => {
    if (!isAzureConfigHydrated) return;
    if (activationStage === 'required') {
      activationPageRef.current?.focus();
    } else if (activationStage === 'voices') {
      activationVoicePageRef.current?.focus();
    }
  }, [activationStage, isAzureConfigHydrated]);


  // Flush latest highlighted chunk progress when app is backgrounded/closed.
  useEffect(() => {
    if (!currentBook || totalChunks <= 0) return;

    const flushProgress = () => {
      handleProgressUpdate(currentChunkIndex, totalChunks);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };

    window.addEventListener('pagehide', flushProgress);
    window.addEventListener('beforeunload', flushProgress);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', flushProgress);
      window.removeEventListener('beforeunload', flushProgress);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentBook, currentChunkIndex, totalChunks, handleProgressUpdate]);

  const debugActivationOverlay = import.meta.env.DEV && debugActivationEnabled ? (
    <div className="fixed bottom-3 left-3 z-50 max-w-[90vw] rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-100 shadow-lg">
      <div>version: {APP_VERSION}</div>
      <div>activationStage: {activationStage}</div>
      <div>ttsEngine: {ttsEngine}</div>
      <div>hasActivation: {String(hasActivation)}</div>
      <div>hasActivationVoice: {String(hasActivationVoice)}</div>
      <div>activationSkipped: {String(activationSkipped)}</div>
      <div>isAzureConfigHydrated: {String(isAzureConfigHydrated)}</div>
      <div>azureKeyLength: {azureConfig.key?.length || 0}</div>
      <div>azureVoice: {azureConfig.voice || ''}</div>
    </div>
  ) : null;

  const clearActivationInfo = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(AZURE_TTS_CONFIG_KEY);
        window.localStorage.removeItem(ACTIVATION_VOICE_CONFIRMED_KEY);
        window.localStorage.removeItem(AZURE_VOICE_LIST_KEY);
      } catch {
        // no-op
      }
    }
    setAzureConfig((prev) => ({
      ...prev,
      key: '',
      enabled: true,
    }));
    setActivationVoices([]);
    setActivationVoiceConfirmed(false);
    setActivationSkipped(false);
    setActivationStage('required');
  }, []);

  if (isAzureConfigHydrated && activationStage !== 'done') {
    if (activationStage === 'required') {
      return (
        <div
          ref={activationPageRef}
          tabIndex={-1}
          role="main"
          aria-labelledby="activation-title"
          className={`min-h-screen flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12 overflow-hidden ${
          theme === 'dark' ? 'bg-slate-950 text-slate-100' : theme === 'sepia' ? 'bg-[#f4ecd8] text-[#5b4636]' : 'bg-white text-slate-900'
        }`}
        >
          {debugActivationOverlay}
          <div className={`w-full max-w-md sm:max-w-lg p-6 sm:p-8 rounded-3xl border shadow-2xl ${
            theme === 'dark'
              ? 'bg-slate-900 border-slate-800'
              : theme === 'sepia'
                ? 'bg-[#f6efe0] border-[#eaddc5]'
                : 'bg-white border-slate-200'
          }`}>
            <h1 id="activation-title" className="text-xl sm:text-2xl font-black mb-3">{t.activationTitle}</h1>
            <p className="text-sm opacity-80 mb-6">{t.activationBody}</p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (activationStatus === 'loading') return;
                const nextKey = activationKeyInput.trim();
                setActivationSkipped(false);
                setActivationVoiceConfirmed(false);
                setAzureConfig((prev) => ({ ...prev, key: nextKey, enabled: true }));
                setTtsEngine('azure');
                fetchAzureVoices(nextKey);
              }}
            >
              <input
                type="text"
                value={activationKeyInput}
                onChange={(e) => setActivationKeyInput(e.target.value)}
                placeholder={t.activationInputPlaceholder}
                className={`w-full px-4 py-3 rounded-xl border text-sm outline-none ${
                  theme === 'dark'
                    ? 'bg-slate-900 border-white/5 text-slate-200 focus:border-indigo-500'
                    : theme === 'sepia'
                      ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636] focus:border-[#5b4636]'
                      : 'bg-white border-slate-200 text-slate-900 focus:border-indigo-600'
                }`}
              />
              {activationStatus === 'error' && (
                <div className="text-xs text-red-400">{activationError}</div>
              )}
              <button
                type="submit"
                aria-disabled={activationStatus === 'loading' || !activationKeyInput.trim()}
                className={`w-full px-4 py-3 rounded-xl font-bold transition-colors ${
                  theme === 'sepia'
                    ? 'bg-[#5b4636] text-[#f4ecd8]'
                    : 'bg-indigo-600 text-white'
                } ${
                  activationStatus === 'loading' || !activationKeyInput.trim()
                    ? 'opacity-50 cursor-not-allowed'
                    : theme === 'sepia'
                      ? 'hover:bg-[#4a382a]'
                      : 'hover:bg-indigo-700'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {activationStatus === 'loading' && (
                    <span className="h-4 w-4 rounded-full border-2 border-transparent border-t-current animate-spin" />
                  )}
                  {activationStatus === 'loading'
                    ? t.activationLoading
                    : activationStatus === 'error'
                      ? t.activationRetry
                      : t.activationAction}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActivationStage('done');
                  setActivationSkipped(true);
                  setTtsEngine('browser');
                }}
                className="text-xs opacity-60 hover:opacity-90 transition-opacity"
              >
                {t.activationLater}
              </button>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={activationVoicePageRef}
        tabIndex={-1}
        role="main"
        aria-labelledby="activation-voice-title"
        className={`min-h-screen px-6 py-10 ${
        theme === 'dark' ? 'bg-slate-950 text-slate-100' : theme === 'sepia' ? 'bg-[#f4ecd8] text-[#5b4636]' : 'bg-white text-slate-900'
      }`}
      >
        {debugActivationOverlay}
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            {returnViewAfterActivation && (
              <button
                type="button"
                onClick={() => {
                  setActivationStage('done');
                  setReturnViewAfterActivation(null);
                  setView(returnViewAfterActivation);
                }}
                className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 inline-flex items-center justify-center h-11 px-5 rounded-full text-sm font-bold shadow-lg transition-all ${
                  theme === 'sepia'
                    ? 'bg-[#5b4636] text-[#f4ecd8] hover:bg-[#4a382a]'
                    : theme === 'dark'
                      ? 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-white/10'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {t.close || '关闭'}
              </button>
            )}
            <h1 id="activation-voice-title" className="text-2xl font-black mb-2">{t.activationVoiceTitle}</h1>
            <p className="text-sm opacity-80">{t.activationVoiceHint}</p>
            {previewStatus === 'error' && (
              <div className="text-xs text-red-400 mt-2">{previewError}</div>
            )}
          </div>
          {groupedActivationVoices.length === 0 ? (
            <div className="text-sm opacity-70">
              {t.activationFetchError}
            </div>
          ) : (
            groupedActivationVoices.map(([locale, localeVoices]) => (
              <div key={locale} className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-[0.15em] opacity-60">
                  {getLanguageName(locale)}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {localeVoices.map((voice) => (
                    <div key={voice.shortName} className={`p-4 rounded-2xl border flex items-center gap-3 ${
                      theme === 'dark'
                        ? 'bg-slate-900/60 border-white/5'
                        : theme === 'sepia'
                          ? 'bg-[#f6efe0] border-[#eaddc5]'
                          : 'bg-slate-50 border-slate-200'
                    }`}>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{voice.localName || voice.shortName}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          aria-disabled={previewStatus === 'loading'}
                          onClick={() => previewVoice(voice)}
                          aria-label={
                            previewStatus === 'loading' && previewingVoiceId === voice.shortName
                              ? (t.loading || '加载中')
                              : previewStatus === 'playing' && previewingVoiceId === voice.shortName
                                ? (t.activationVoicePlaying || '播放中')
                                : (t.activationVoicePreview || '试听')
                          }
                          className={`h-9 w-10 rounded-lg inline-flex items-center justify-center text-xs font-semibold leading-none text-center transition-colors relative ${
                            theme === 'sepia'
                              ? 'bg-[#5b4636]/10 text-[#5b4636]'
                              : 'bg-slate-900/60 text-slate-100 border border-white/10'
                          } ${previewStatus === 'loading' && previewingVoiceId !== voice.shortName
                            ? 'opacity-60 cursor-not-allowed'
                            : theme === 'sepia'
                              ? 'hover:bg-[#5b4636]/20'
                              : 'hover:bg-slate-900/80'
                          }`}
                        >
                          {previewStatus === 'loading' && previewingVoiceId === voice.shortName ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          ) : previewStatus === 'playing' && previewingVoiceId === voice.shortName ? (
                            <Pause className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <Play className="w-4 h-4" aria-hidden="true" />
                          )}
                          <span className="sr-only">
                            {previewStatus === 'loading' && previewingVoiceId === voice.shortName
                              ? t.loading || '加载中'
                              : previewStatus === 'playing' && previewingVoiceId === voice.shortName
                                ? t.activationVoicePlaying || '播放中'
                                : t.activationVoicePreview}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAzureConfig((prev) => ({ ...prev, key: azureConfig.key, voice: voice.shortName, enabled: true }));
                            setTtsEngine('azure');
                            setActivationSkipped(false);
                            setActivationVoiceConfirmed(true);
                            setActivationStage('done');
                            if (returnViewAfterActivation) {
                              setView(returnViewAfterActivation);
                              setReturnViewAfterActivation(null);
                            }
                          }}
                          aria-label={t.activationVoiceUse}
                          className={`h-9 w-10 rounded-lg inline-flex items-center justify-center text-xs font-semibold leading-none text-center transition-colors ${
                            theme === 'sepia'
                              ? 'bg-[#5b4636]/10 text-[#5b4636]'
                              : 'bg-slate-900/60 text-slate-100 border border-indigo-500/70'
                          } ${theme === 'sepia'
                            ? 'hover:bg-[#5b4636]/20'
                            : 'hover:bg-slate-900/80'
                          }`}
                        >
                          <Check className="w-4 h-4" aria-hidden="true" />
                          <span className="sr-only">{t.activationVoiceUse}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {debugActivationOverlay}
      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 h-16 z-30 flex items-center justify-between px-6 border-b transition-colors duration-300 ${
        theme === 'dark' 
          ? 'bg-slate-950/80 border-white/5 text-slate-100' 
          : theme === 'sepia' 
            ? 'bg-[#f4ecd8]/90 border-[#5b4636]/10 text-[#5b4636]' 
            : 'bg-white/80 border-black/5 text-slate-900'
      } backdrop-blur-md`} aria-hidden={isSettingsOpen} inert={isSettingsOpen ? '' : undefined}>
        <div className="flex items-center gap-3">
          {view === 'reader' && (
            <button 
              onClick={handleBack}
              className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              aria-label={t.back}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 opacity-80" />
            <h1 className="font-semibold text-lg truncate max-w-[150px] sm:max-w-md flex items-baseline gap-2">
              <span>{currentBook?.title || '随身听'}</span>
              {!currentBook && <span className="text-[10px] font-mono opacity-30 font-normal">v{APP_VERSION}</span>}
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {view === 'reader' && !isPlaying && (
            <button
              onClick={handleStartPlayback}
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                theme === 'dark' 
                  ? 'bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30' 
                  : theme === 'sepia'
                    ? 'bg-[#5b4636]/10 text-[#5b4636] hover:bg-[#5b4636]/20'
                    : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{t.playFromCurrent}</span>
            </button>
          )}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-sm font-medium"
            aria-label={t.settings}
          >
            <Settings className="w-5 h-5" />
            <span>{t.settings}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pt-16 pb-32" aria-hidden={isSettingsOpen} inert={isSettingsOpen ? '' : undefined}>
        {view === 'library' ? (
          <Library language={language} theme={theme} onSelectBook={handleSelectBook} onImportBook={handleImportBook} />
        ) : (
          <div className="relative min-h-[calc(100vh-12rem)]">
            <Reader 
              content={currentBook?.content || ''} 
              fontSize={fontSize} 
              theme={theme} 
              currentChunkIndex={currentChunkIndex}
              onChunkClick={jumpTo}
              onActiveChunkReady={handleReaderReady}
              scrollSignal={playScrollSignal}
            />
          </div>
        )}
      </main>

      {isOpeningBook && (
        <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 ${
          theme === 'dark'
            ? 'bg-slate-950/80 text-slate-100'
            : theme === 'sepia'
              ? 'bg-[#f4ecd8]/90 text-[#5b4636]'
              : 'bg-white/90 text-slate-800'
        }`} aria-hidden={isSettingsOpen} inert={isSettingsOpen ? '' : undefined}>
          <div className={`h-10 w-10 animate-spin rounded-full border-2 border-transparent ${
            theme === 'sepia' ? 'border-t-[#5b4636]' : 'border-t-indigo-500'
          }`} />
          <p className="text-sm font-medium opacity-85">加载中...</p>
        </div>
      )}

      {/* Floating Controls (Only when reading) */}
      {view === 'reader' && (
        <motion.div 
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          className={`fixed bottom-0 left-0 right-0 px-4 py-4 z-30 border-t ${
            theme === 'dark' 
              ? 'bg-slate-900 border-slate-800 text-white' 
              : theme === 'sepia' 
                ? 'bg-[#f4ecd8] border-[#eaddc5] text-[#5b4636]' 
                : 'bg-white border-slate-200 text-slate-900'
          }`} aria-hidden={isSettingsOpen} inert={isSettingsOpen ? '' : undefined}
        >
          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            {/* Controls Row */}
            <div className="relative flex items-center justify-center min-h-14 sm:min-h-16">
              <button
                onClick={() => {
                  setReturnViewAfterActivation(view);
                  openActivationVoices();
                }}
                className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-2 px-4 py-2 rounded-full transition-all hover:scale-105 active:scale-95 ${
                  theme === 'dark'
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    : theme === 'sepia'
                      ? 'bg-[#5b4636]/10 text-[#5b4636] hover:bg-[#5b4636]/20'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                aria-label={t.voice}
              >
                <Mic className="w-4 h-4" />
                <span className="text-xs font-medium hidden sm:inline">{t.voice}</span>
              </button>
              <button
                onClick={handleTogglePlayback}
                className={`flex items-center gap-2 px-8 py-3 sm:px-10 sm:py-4 rounded-full shadow-lg transform transition-transform active:scale-95 font-bold text-base sm:text-lg ${
                  theme === 'dark'
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/20'
                    : theme === 'sepia'
                      ? 'bg-[#5b4636] hover:bg-[#4a382a] text-[#f4ecd8] shadow-[#5b4636]/20'
                      : 'bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20'
                }`}
                aria-label={isPlaying ? t.pause : (isPaused ? t.resume : t.play)}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>{t.audioTransmitting}</span>
                  </>
                ) : isPlaying ? (
                  <>
                    <Pause className="w-6 h-6 fill-current" />
                    <span>{t.pause}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-6 h-6 fill-current ml-1" />
                    <span>{isPaused ? t.resume : t.play}</span>
                  </>
                )}
              </button>

              <button
                onClick={() => setIsJumpModalOpen(true)}
                className={`absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2 px-4 py-2 rounded-full transition-all hover:scale-105 active:scale-95 ${
                  theme === 'dark' 
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' 
                    : theme === 'sepia'
                      ? 'bg-[#5b4636]/10 text-[#5b4636] hover:bg-[#5b4636]/20'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span className="text-xs font-medium hidden sm:inline">{t.playbackProgress}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  theme === 'dark' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-600 text-white'
                }`}>
                  {(progress * 100).toFixed(1)}%
                </span>
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Jump Modal */}
      <AnimatePresence>
        {isJumpModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsJumpModalOpen(false)}
              className="fixed inset-0 bg-black z-40"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-sm z-50 p-6 rounded-2xl shadow-2xl border ${
                theme === 'dark' 
                  ? 'bg-slate-900 border-slate-800 text-white' 
                  : theme === 'sepia' 
                    ? 'bg-[#f4ecd8] border-[#eaddc5] text-[#5b4636]' 
                    : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <h3 className="text-lg font-bold mb-4">{t.enterPercentage}</h3>
              <form onSubmit={handleJump} className="flex flex-col gap-6">
                <div className="flex flex-col gap-4">
                  <input
                    autoFocus
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={jumpValue}
                    onChange={(e) => setJumpValue(e.target.value)}
                    placeholder="0 - 100"
                    className={`w-full px-4 py-3 text-2xl font-bold text-center rounded-xl border outline-none focus:ring-2 ${
                      theme === 'dark'
                        ? 'border-slate-700 bg-slate-800 text-white focus:ring-indigo-500'
                        : theme === 'sepia'
                          ? 'border-[#eaddc5] bg-[#f4ecd8] text-[#5b4636] focus:ring-[#5b4636]'
                          : 'border-slate-200 bg-white text-slate-900 focus:ring-indigo-500'
                    }`}
                  />
                  
                  <div className="px-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={jumpValue || 0}
                      onChange={(e) => setJumpValue(e.target.value)}
                      className={`w-full h-2 rounded-full appearance-none cursor-pointer accent-indigo-600 ${
                        theme === 'dark' ? 'bg-slate-700' : theme === 'sepia' ? 'bg-[#eaddc5]' : 'bg-slate-200'
                      }`}
                    />
                    <div className="flex justify-between mt-2 text-[10px] opacity-50 font-mono">
                      <span>0%</span>
                      <span>50%</span>
                      <span>100%</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsJumpModalOpen(false)}
                    className={`flex-1 px-4 py-3 rounded-xl font-bold transition-colors ${
                      theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'
                    }`}
                  >
                    {t.cancel || '取消'}
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 px-4 py-3 rounded-xl font-bold transition-colors ${
                      theme === 'sepia' ? 'bg-[#5b4636] text-[#f4ecd8] hover:bg-[#4a382a]' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {t.go}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        voices={voices}
        selectedVoice={selectedVoice}
        onVoiceChange={setVoice}
        ttsEngine={ttsEngine}
        onTtsEngineChange={(engine) => {
          setTtsEngine(engine);
          setAzureConfig((prev) => ({ ...prev, enabled: engine === 'azure' }));
        }}
        activationVoices={activationVoices}
        azureConfig={azureConfig}
        onAzureConfigChange={setAzureConfig}
        onClearActivation={clearActivationInfo}
        onRequireActivationCode={requireActivationCode}
        rate={rate}
        onRateChange={setRate}
        pitch={pitch}
        onPitchChange={setPitch}
        volume={volume}
        onVolumeChange={setVolume}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        theme={theme}
        onThemeChange={setTheme}
        language={language}
        onLanguageChange={setLanguage}
        status={status}
      />
    </div>
  );
}
