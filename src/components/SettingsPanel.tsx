import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { Settings, X, Volume2, Mic, Globe, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../i18n';
import type { AzureTtsConfig, TtsEngine } from '../hooks/useSpeech';
import { getAudioCacheStats, clearAudioCache } from '../utils/audioCache';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  onVoiceChange: (voice: SpeechSynthesisVoice) => void;
  ttsEngine: TtsEngine;
  onTtsEngineChange: (engine: TtsEngine) => void;
  activationVoices?: { shortName: string; locale: string; localName?: string; gender?: string }[];
  azureConfig: AzureTtsConfig;
  onAzureConfigChange: (config: AzureTtsConfig) => void;
  rate: number;
  onRateChange: (rate: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  theme: 'light' | 'dark' | 'sepia';
  onThemeChange: (theme: 'light' | 'dark' | 'sepia') => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  onRequireActivationCode?: () => boolean;
  onClearActivation?: () => void;
  status?: {
    level: 'idle' | 'info' | 'error';
    message: string;
  };
}

export const SettingsPanel = React.memo(({
  isOpen,
  onClose,
  voices,
  selectedVoice,
  onVoiceChange,
  ttsEngine,
  onTtsEngineChange,
  activationVoices,
  azureConfig,
  onAzureConfigChange,
  rate,
  onRateChange,
  pitch,
  onPitchChange,
  volume,
  onVolumeChange,
  fontSize,
  onFontSizeChange,
  theme,
  onThemeChange,
  language,
  onLanguageChange,
  onRequireActivationCode,
  onClearActivation,
  status,
}: SettingsPanelProps) => {
  const t = translations[language];
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [azureVoices, setAzureVoices] = useState<{ shortName: string; locale: string; localName?: string; gender?: string }[]>([]);
  const [azureVoiceStatus, setAzureVoiceStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [audioCacheCount, setAudioCacheCount] = useState(0);
  const [audioCacheBytes, setAudioCacheBytes] = useState(0);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [rateDraft, setRateDraft] = useState(rate);
  const [volumeDraft, setVolumeDraft] = useState(volume);
  const [pitchDraft, setPitchDraft] = useState(pitch);
  const [fontSizeDraft, setFontSizeDraft] = useState(fontSize);
  const [trimStartDraft, setTrimStartDraft] = useState(Number.isFinite(azureConfig.trimStartSec) ? azureConfig.trimStartSec : 0);
  const [trimEndDraft, setTrimEndDraft] = useState(Number.isFinite(azureConfig.trimEndSec) ? azureConfig.trimEndSec : 0);
  const [cacheEntriesDraft, setCacheEntriesDraft] = useState(Number.isFinite(azureConfig.cacheMaxEntries) ? azureConfig.cacheMaxEntries : 200);
  const [cacheSizeMbDraft, setCacheSizeMbDraft] = useState(Math.round((Number.isFinite(azureConfig.cacheMaxBytes) ? azureConfig.cacheMaxBytes : 0) / (1024 * 1024)));
  const isDraggingPlaybackRef = useRef(false);
  const isDraggingPitchRef = useRef(false);
  const isDraggingFontRef = useRef(false);
  const isDraggingTrimRef = useRef(false);
  const isDraggingCacheRef = useRef(false);

  const refreshAudioCacheStats = useCallback(() => {
    getAudioCacheStats()
      .then((stats) => {
        setAudioCacheCount(stats.count);
        setAudioCacheBytes(stats.totalBytes);
      })
      .catch(() => {
        setAudioCacheCount(0);
        setAudioCacheBytes(0);
      });
  }, []);

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };
  const guardActivation = (event?: React.SyntheticEvent) => {
    if (!onRequireActivationCode) return true;
    const ok = onRequireActivationCode();
    if (!ok && event) {
      event.preventDefault();
      event.stopPropagation();
    }
    return ok;
  };

  useEffect(() => {
    if (!isOpen) return;
    refreshAudioCacheStats();
  }, [isOpen, refreshAudioCacheStats]);

  useEffect(() => {
    if (isDraggingPlaybackRef.current) return;
    setRateDraft(rate);
    setVolumeDraft(volume);
  }, [rate, volume]);

  useEffect(() => {
    if (isDraggingPitchRef.current) return;
    setPitchDraft(pitch);
  }, [pitch]);

  useEffect(() => {
    if (isDraggingFontRef.current) return;
    setFontSizeDraft(fontSize);
  }, [fontSize]);

  useEffect(() => {
    if (isDraggingTrimRef.current) return;
    setTrimStartDraft(Number.isFinite(azureConfig.trimStartSec) ? azureConfig.trimStartSec : 0);
    setTrimEndDraft(Number.isFinite(azureConfig.trimEndSec) ? azureConfig.trimEndSec : 0);
  }, [azureConfig.trimStartSec, azureConfig.trimEndSec]);

  useEffect(() => {
    if (isDraggingCacheRef.current) return;
    setCacheEntriesDraft(Number.isFinite(azureConfig.cacheMaxEntries) ? azureConfig.cacheMaxEntries : 200);
    setCacheSizeMbDraft(Math.round((Number.isFinite(azureConfig.cacheMaxBytes) ? azureConfig.cacheMaxBytes : 0) / (1024 * 1024)));
  }, [azureConfig.cacheMaxEntries, azureConfig.cacheMaxBytes]);

  const commitTrim = useCallback((nextStart: number, nextEnd: number) => {
    const safeStart = clampValue(Number(nextStart.toFixed(1)), 0, 3);
    const safeEnd = clampValue(Number(nextEnd.toFixed(1)), 0, 3);
    onAzureConfigChange({ ...azureConfig, trimStartSec: safeStart, trimEndSec: safeEnd });
  }, [azureConfig, onAzureConfigChange]);

  const roundToStep = (value: number, step: number) => {
    if (!Number.isFinite(value)) return 0;
    if (!Number.isFinite(step) || step <= 0) return value;
    const inv = 1 / step;
    return Math.round(value * inv) / inv;
  };

  const commitRate = useCallback((nextValue: number) => {
    const rounded = clampValue(roundToStep(nextValue, 0.1), 0.5, 2);
    onRateChange(rounded);
  }, [onRateChange]);

  const commitVolume = useCallback((nextValue: number) => {
    const rounded = clampValue(roundToStep(nextValue, 0.1), 0, 1);
    onVolumeChange(rounded);
  }, [onVolumeChange]);

  const commitPitch = useCallback((nextValue: number) => {
    const rounded = clampValue(roundToStep(nextValue, 0.1), 0.5, 2);
    onPitchChange(rounded);
  }, [onPitchChange]);

  const commitFontSize = useCallback((nextValue: number) => {
    const rounded = clampValue(Math.round(nextValue), 12, 32);
    onFontSizeChange(rounded);
  }, [onFontSizeChange]);

  const commitCacheEntries = useCallback((nextEntries: number) => {
    const safeEntries = clampValue(Math.round(nextEntries), 0, 1000);
    onAzureConfigChange({ ...azureConfig, cacheMaxEntries: safeEntries });
  }, [azureConfig, onAzureConfigChange]);

  const commitCacheSizeMb = useCallback((nextMb: number) => {
    const safeMb = clampValue(Math.round(nextMb), 0, 2048);
    onAzureConfigChange({ ...azureConfig, cacheMaxBytes: safeMb * 1024 * 1024 });
  }, [azureConfig, onAzureConfigChange]);

  const getLanguageName = (langCode: string) => {
    try {
      const displayNames = new Intl.DisplayNames([language], { type: 'language' });
      const name = displayNames.of(langCode.split('-')[0]);
      return name ? `${name} (${langCode})` : langCode;
    } catch (e) {
      return langCode;
    }
  };

  const groupedVoices = useMemo(() => {
    const groups: Record<string, SpeechSynthesisVoice[]> = {};
    voices.forEach(voice => {
      const lang = voice.lang;
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push(voice);
    });
    // Sort languages: current app language first, then alphabetical
    return Object.entries(groups).sort(([a], [b]) => {
      const aIsCurrent = a.startsWith(language);
      const bIsCurrent = b.startsWith(language);
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      return a.localeCompare(b);
    });
  }, [voices, language]);

  useEffect(() => {
    if (ttsEngine !== 'azure') return;
    if (!azureConfig.region || !azureConfig.key) {
      setAzureVoices([]);
      return;
    }

    const controller = new AbortController();
    const isChina = azureConfig.useChinaEndpoint;
    const endpoint = isChina
      ? `https://${azureConfig.region}.tts.speech.azure.cn/cognitiveservices/voices/list`
      : `https://${azureConfig.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

    setAzureVoiceStatus('loading');
    fetch(endpoint, {
      headers: {
        'Ocp-Apim-Subscription-Key': azureConfig.key,
      },
      signal: controller.signal,
    })
      .then(async (resp) => {
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
            })).filter((v: any) => v.shortName)
          : [];
        setAzureVoices(mapped);
        setAzureVoiceStatus('idle');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAzureVoiceStatus('error');
        }
      });

    return () => controller.abort();
  }, [ttsEngine, azureConfig.region, azureConfig.key, azureConfig.useChinaEndpoint]);

  useEffect(() => {
    if (ttsEngine !== 'azure') return;
    if (!activationVoices || activationVoices.length === 0) return;
    setAzureVoices(activationVoices);
  }, [activationVoices, ttsEngine]);

  const azureOutputFormats = [
    { value: 'audio-24khz-48kbitrate-mono-mp3', label: t.azureFormatBalanced },
    { value: 'audio-24khz-160kbitrate-mono-mp3', label: t.azureFormatHigh },
    { value: 'audio-16khz-32kbitrate-mono-mp3', label: t.azureFormatLow },
    { value: 'audio-48khz-192kbitrate-mono-mp3', label: t.azureFormatUltra },
    { value: 'riff-24khz-16bit-mono-pcm', label: t.azureFormatPcm24k },
    { value: 'riff-16khz-16bit-mono-pcm', label: t.azureFormatPcm16k },
    { value: 'raw-16khz-16bit-mono-pcm', label: t.azureFormatRaw16k },
  ];


  const groupedAzureVoices = useMemo(() => {
    const groups: Record<string, { shortName: string; locale: string; localName?: string; gender?: string }[]> = {};
    azureVoices.forEach((voice) => {
      if (!groups[voice.locale]) groups[voice.locale] = [];
      groups[voice.locale].push(voice);
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
  }, [azureVoices, language]);

  const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  useEffect(() => {
    if (isOpen) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      panelRef.current?.focus();
    } else if (lastFocusedRef.current) {
      lastFocusedRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const getFocusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusables = getFocusable();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !panel.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    return () => {
      panel.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black z-40 lg:hidden"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed right-0 top-0 bottom-0 w-full sm:w-[360px] shadow-2xl z-50 px-8 pt-0 pb-8 overflow-y-auto border-l transition-colors duration-300 ${
              theme === 'dark' 
                ? 'bg-slate-950 border-white/10 text-slate-100' 
                : theme === 'sepia' 
                  ? 'bg-[#f4ecd8] border-[#5b4636]/10 text-[#5b4636]' 
                  : 'bg-white border-black/5 text-slate-900'
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            tabIndex={-1}
            ref={panelRef}
          >
            <div className={`sticky top-0 z-20 -mx-8 px-8 pt-8 pb-6 flex items-center justify-between shadow-sm ${
              theme === 'dark' 
                ? 'bg-slate-950 border-b border-white/5' 
                : theme === 'sepia' 
                  ? 'bg-[#f4ecd8] border-b border-[#5b4636]/10' 
                  : 'bg-white border-b border-black/5'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${
                  theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400' : theme === 'sepia' ? 'bg-[#5b4636]/10 text-[#5b4636]' : 'bg-indigo-50 text-indigo-600'
                }`}>
                  <Settings className="w-5 h-5" />
                </div>
                <h2 id="settings-title" className="text-xl font-bold tracking-tight">{t.settings}</h2>
              </div>
              <button
                onClick={onClose}
                className={`p-2 rounded-full transition-all hover:scale-110 active:scale-90 ${
                  theme === 'dark' 
                    ? 'hover:bg-white/10 text-slate-400 hover:text-white' 
                    : theme === 'sepia' 
                      ? 'hover:bg-[#5b4636]/10 text-[#5b4636]' 
                      : 'hover:bg-black/5 text-slate-500 hover:text-slate-900'
                }`}
                aria-label={t.close}
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Voice Selection */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] opacity-50">
                  <Mic className="w-3.5 h-3.5" />
                  {t.voice}
                </label>
                <div className="relative group">
                  {ttsEngine === 'azure' ? (
                    <select
                      value={azureConfig.voice}
                      onMouseDown={(event) => guardActivation(event)}
                      onFocus={(event) => guardActivation(event)}
                      onChange={(e) => onAzureConfigChange({ ...azureConfig, voice: e.target.value })}
                      className={`w-full px-4 py-3 pr-10 border-2 rounded-2xl text-sm font-medium outline-none transition-all appearance-none cursor-pointer ${
                        theme === 'dark' 
                          ? 'bg-slate-900/50 border-white/5 text-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10' 
                          : theme === 'sepia' 
                            ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636] focus:border-[#5b4636] focus:ring-4 focus:ring-[#5b4636]/5' 
                            : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5'
                      }`}
                    >
                      {groupedAzureVoices.length === 0 && (
                        <option value="">{azureVoiceStatus === 'loading' ? t.azureVoiceLoading : t.azureVoiceEmpty}</option>
                      )}
                      {groupedAzureVoices.map(([locale, localeVoices]) => (
                        <optgroup key={locale} label={getLanguageName(locale)} className={theme === 'dark' ? 'bg-slate-950 text-slate-400' : ''}>
                          {localeVoices.map((voice) => (
                            <option key={voice.shortName} value={voice.shortName} className={theme === 'dark' ? 'bg-slate-900 text-white' : ''}>
                              {voice.localName || voice.shortName}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={selectedVoice?.voiceURI || ''}
                      onChange={(e) => {
                        const voice = voices.find((v) => v.voiceURI === e.target.value);
                        if (voice) onVoiceChange(voice);
                      }}
                      className={`w-full px-4 py-3 pr-10 border-2 rounded-2xl text-sm font-medium outline-none transition-all appearance-none cursor-pointer ${
                        theme === 'dark' 
                          ? 'bg-slate-900/50 border-white/5 text-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10' 
                          : theme === 'sepia' 
                            ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636] focus:border-[#5b4636] focus:ring-4 focus:ring-[#5b4636]/5' 
                            : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5'
                      }`}
                    >
                      {groupedVoices.map(([lang, langVoices]) => (
                        <optgroup key={lang} label={getLanguageName(lang)} className={theme === 'dark' ? 'bg-slate-950 text-slate-400' : ''}>
                          {langVoices.map((voice) => (
                            <option key={voice.voiceURI} value={voice.voiceURI} className={theme === 'dark' ? 'bg-slate-900 text-white' : ''}>
                              {voice.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                    <ChevronLeft className="w-4 h-4 -rotate-90" />
                  </div>
                </div>
                {ttsEngine === 'azure' && azureVoiceStatus === 'error' && (
                  <div className="text-xs text-red-400">{t.azureVoiceError}</div>
                )}
              </div>

              {ttsEngine === 'azure' && (
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.azureOutputFormat}</label>
                  <div className="relative group">
                    <select
                      value={azureConfig.outputFormat}
                      onMouseDown={(event) => guardActivation(event)}
                      onFocus={(event) => guardActivation(event)}
                      onChange={(e) => onAzureConfigChange({ ...azureConfig, outputFormat: e.target.value })}
                      className={`w-full px-4 py-3 pr-10 border-2 rounded-2xl text-sm font-medium outline-none transition-all appearance-none cursor-pointer ${
                        theme === 'dark'
                          ? 'bg-slate-900/50 border-white/5 text-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10'
                          : theme === 'sepia'
                            ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636] focus:border-[#5b4636] focus:ring-4 focus:ring-[#5b4636]/5'
                            : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5'
                      }`}
                    >
                      {azureOutputFormats.map((format) => (
                        <option key={format.value} value={format.value} className={theme === 'dark' ? 'bg-slate-900 text-white' : ''}>
                          {format.label}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                      <ChevronLeft className="w-4 h-4 -rotate-90" />
                    </div>
                  </div>
                </div>
              )}

              {/* Playback Controls */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] opacity-50">
                  <Volume2 className="w-3.5 h-3.5" />
                  {t.playback}
                </label>
                <div className="grid grid-cols-1 gap-4">
                  {[
                    { label: t.speed, value: `${roundToStep(rateDraft, 0.1)}x`, val: rateDraft, min: 0.5, max: 2, step: 0.1, onChange: setRateDraft, onCommit: commitRate },
                    { label: t.volume, value: `${Math.round(roundToStep(volumeDraft, 0.1) * 100)}%`, val: volumeDraft, min: 0, max: 1, step: 0.1, onChange: setVolumeDraft, onCommit: commitVolume },
                  ].map((control) => (
                    <div key={control.label} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{control.label}</label>
                        <span className="text-sm font-mono font-bold">{control.value}</span>
                      </div>
                      <div className="relative flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const nextValue = clampValue(Number((control.val - control.step).toFixed(2)), control.min, control.max);
                            control.onChange(nextValue);
                            control.onCommit(nextValue);
                          }}
                          className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                            theme === 'dark'
                              ? 'border-white/10 text-slate-200 hover:bg-white/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                          aria-label={`${control.label} 减小，当前 ${control.value}`}
                        >
                          -
                        </button>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step="any"
                          value={control.val}
                          onChange={(e) => control.onChange(parseFloat(e.target.value))}
                          onMouseDown={() => { isDraggingPlaybackRef.current = true; }}
                          onTouchStart={() => { isDraggingPlaybackRef.current = true; }}
                          onPointerDown={() => { isDraggingPlaybackRef.current = true; }}
                          onMouseUp={() => { isDraggingPlaybackRef.current = false; control.onCommit(control.val); }}
                          onTouchEnd={() => { isDraggingPlaybackRef.current = false; control.onCommit(control.val); }}
                          onPointerUp={() => { isDraggingPlaybackRef.current = false; control.onCommit(control.val); }}
                          onBlur={() => { isDraggingPlaybackRef.current = false; control.onCommit(control.val); }}
                          onKeyUp={() => control.onCommit(control.val)}
                          aria-label={control.label}
                          aria-valuetext={`${control.label} ${control.value}`}
                          className={`w-full h-1.5 rounded-full appearance-none cursor-pointer transition-all ${
                            theme === 'dark' 
                              ? 'bg-slate-800 accent-indigo-500' 
                              : theme === 'sepia' 
                                ? 'bg-[#5b4636]/10 accent-[#5b4636]' 
                                : 'bg-slate-200 accent-indigo-600'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const nextValue = clampValue(Number((control.val + control.step).toFixed(2)), control.min, control.max);
                            control.onChange(nextValue);
                            control.onCommit(nextValue);
                          }}
                          className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                            theme === 'dark'
                              ? 'border-white/10 text-slate-200 hover:bg-white/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                          aria-label={`${control.label} 增大，当前 ${control.value}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.pitch}</label>
                    <span className="text-sm font-mono font-bold">{roundToStep(pitchDraft, 0.1)}</span>
                  </div>
                  <div className="relative flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const nextValue = clampValue(Number((pitchDraft - 0.1).toFixed(2)), 0.5, 2);
                        setPitchDraft(nextValue);
                        commitPitch(nextValue);
                      }}
                      className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                        theme === 'dark'
                          ? 'border-white/10 text-slate-200 hover:bg-white/10'
                          : theme === 'sepia'
                            ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                      aria-label={`${t.pitch} 减小，当前 ${pitch}`}
                    >
                      -
                    </button>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step="any"
                      value={pitchDraft}
                      onChange={(e) => setPitchDraft(parseFloat(e.target.value))}
                      onMouseDown={() => { isDraggingPitchRef.current = true; }}
                      onTouchStart={() => { isDraggingPitchRef.current = true; }}
                      onPointerDown={() => { isDraggingPitchRef.current = true; }}
                      onMouseUp={() => { isDraggingPitchRef.current = false; commitPitch(pitchDraft); }}
                      onTouchEnd={() => { isDraggingPitchRef.current = false; commitPitch(pitchDraft); }}
                      onPointerUp={() => { isDraggingPitchRef.current = false; commitPitch(pitchDraft); }}
                      onBlur={() => { isDraggingPitchRef.current = false; commitPitch(pitchDraft); }}
                      onKeyUp={() => commitPitch(pitchDraft)}
                      aria-label={t.pitch}
                      aria-valuetext={`${t.pitch} ${roundToStep(pitchDraft, 0.1)}`}
                      className={`w-full h-1.5 rounded-full appearance-none cursor-pointer transition-all ${
                        theme === 'dark' 
                          ? 'bg-slate-800 accent-indigo-500' 
                          : theme === 'sepia' 
                            ? 'bg-[#5b4636]/10 accent-[#5b4636]' 
                            : 'bg-slate-200 accent-indigo-600'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const nextValue = clampValue(Number((pitchDraft + 0.1).toFixed(2)), 0.5, 2);
                        setPitchDraft(nextValue);
                        commitPitch(nextValue);
                      }}
                      className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                        theme === 'dark'
                          ? 'border-white/10 text-slate-200 hover:bg-white/10'
                          : theme === 'sepia'
                            ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                      aria-label={`${t.pitch} 增大，当前 ${pitch}`}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {[
                    {
                      label: t.trimStart,
                      value: `${Number.isFinite(trimStartDraft) ? trimStartDraft.toFixed(1) : '0.0'}s`,
                      val: Number.isFinite(trimStartDraft) ? trimStartDraft : 0,
                      min: 0,
                      max: 3,
                      step: 0.1,
                      onChange: (next: number) => setTrimStartDraft(clampValue(Number(next.toFixed(1)), 0, 3)),
                      onCommit: (next: number) => commitTrim(next, trimEndDraft),
                    },
                    {
                      label: t.trimEnd,
                      value: `${Number.isFinite(trimEndDraft) ? trimEndDraft.toFixed(1) : '0.0'}s`,
                      val: Number.isFinite(trimEndDraft) ? trimEndDraft : 0,
                      min: 0,
                      max: 3,
                      step: 0.1,
                      onChange: (next: number) => setTrimEndDraft(clampValue(Number(next.toFixed(1)), 0, 3)),
                      onCommit: (next: number) => commitTrim(trimStartDraft, next),
                    },
                  ].map((control) => (
                    <div key={control.label} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{control.label}</label>
                        <span className="text-sm font-mono font-bold">{control.value}</span>
                      </div>
                      <div className="relative flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const nextValue = clampValue(Number((control.val - control.step).toFixed(1)), control.min, control.max);
                            control.onChange(nextValue);
                            control.onCommit(nextValue);
                          }}
                          className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                            theme === 'dark'
                              ? 'border-white/10 text-slate-200 hover:bg-white/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                          aria-label={`${control.label} 减小，当前 ${control.value}`}
                        >
                          -
                        </button>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step="any"
                        value={control.val}
                        onChange={(e) => control.onChange(parseFloat(e.target.value))}
                        onMouseDown={() => { isDraggingTrimRef.current = true; }}
                          onTouchStart={() => { isDraggingTrimRef.current = true; }}
                          onPointerDown={() => { isDraggingTrimRef.current = true; }}
                          onMouseUp={() => { isDraggingTrimRef.current = false; control.onCommit(control.val); }}
                          onTouchEnd={() => { isDraggingTrimRef.current = false; control.onCommit(control.val); }}
                          onPointerUp={() => { isDraggingTrimRef.current = false; control.onCommit(control.val); }}
                          onBlur={() => { isDraggingTrimRef.current = false; control.onCommit(control.val); }}
                          onKeyUp={() => control.onCommit(control.val)}
                          aria-label={control.label}
                          aria-valuetext={`${control.label} ${control.value}`}
                          className={`w-full h-1.5 rounded-full appearance-none cursor-pointer transition-all ${
                            theme === 'dark'
                              ? 'bg-slate-800 accent-indigo-500'
                              : theme === 'sepia'
                                ? 'bg-[#5b4636]/10 accent-[#5b4636]'
                                : 'bg-slate-200 accent-indigo-600'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const nextValue = clampValue(Number((control.val + control.step).toFixed(1)), control.min, control.max);
                            control.onChange(nextValue);
                            control.onCommit(nextValue);
                          }}
                          className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                            theme === 'dark'
                              ? 'border-white/10 text-slate-200 hover:bg-white/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                          aria-label={`${control.label} 增大，当前 ${control.value}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

              </div>

              {/* Reading Display */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.readingDisplay}</label>
                <div className="grid grid-cols-1 gap-4">
                  {[
                    { label: t.fontSize, value: `${Math.round(fontSizeDraft)}px`, val: fontSizeDraft, min: 12, max: 32, step: 1, onChange: setFontSizeDraft, onCommit: commitFontSize }
                  ].map((control) => (
                    <div key={control.label} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{control.label}</label>
                        <span className="text-sm font-mono font-bold">{control.value}</span>
                      </div>
                      <div className="relative flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const nextValue = clampValue(control.val - control.step, control.min, control.max);
                            control.onChange(nextValue);
                            control.onCommit(nextValue);
                          }}
                          className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                            theme === 'dark'
                              ? 'border-white/10 text-slate-200 hover:bg-white/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                          aria-label={`${control.label} 减小，当前 ${control.value}`}
                        >
                          -
                        </button>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step="any"
                          value={control.val}
                          onChange={(e) => control.onChange(parseFloat(e.target.value))}
                          onMouseDown={() => { isDraggingFontRef.current = true; }}
                          onTouchStart={() => { isDraggingFontRef.current = true; }}
                          onPointerDown={() => { isDraggingFontRef.current = true; }}
                          onMouseUp={() => { isDraggingFontRef.current = false; control.onCommit(control.val); }}
                          onTouchEnd={() => { isDraggingFontRef.current = false; control.onCommit(control.val); }}
                          onPointerUp={() => { isDraggingFontRef.current = false; control.onCommit(control.val); }}
                          onBlur={() => { isDraggingFontRef.current = false; control.onCommit(control.val); }}
                          onKeyUp={() => control.onCommit(control.val)}
                          aria-label={control.label}
                          aria-valuetext={`${control.label} ${control.value}`}
                          className={`w-full h-1.5 rounded-full appearance-none cursor-pointer transition-all ${
                            theme === 'dark' 
                              ? 'bg-slate-800 accent-indigo-500' 
                              : theme === 'sepia' 
                                ? 'bg-[#5b4636]/10 accent-[#5b4636]' 
                                : 'bg-slate-200 accent-indigo-600'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const nextValue = clampValue(control.val + control.step, control.min, control.max);
                            control.onChange(nextValue);
                            control.onCommit(nextValue);
                          }}
                          className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                            theme === 'dark'
                              ? 'border-white/10 text-slate-200 hover:bg-white/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                          aria-label={`${control.label} 增大，当前 ${control.value}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 pt-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.theme}</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'light', label: t.light, icon: 'bg-white border-slate-200' },
                      { id: 'dark', label: t.dark, icon: 'bg-slate-900 border-slate-800' },
                      { id: 'sepia', label: t.sepia, icon: 'bg-[#f4ecd8] border-[#eaddc5]' }
                    ].map((tItem) => (
                      <button
                        key={tItem.id}
                        onClick={() => onThemeChange(tItem.id as any)}
                        className={`group relative flex flex-col items-center gap-3 p-3 rounded-2xl transition-all border-2 ${
                          theme === tItem.id
                            ? theme === 'dark'
                              ? 'border-indigo-500 bg-indigo-500/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636] bg-[#5b4636]/10'
                                : 'border-indigo-600 bg-indigo-50'
                            : theme === 'dark'
                              ? 'border-white/5 bg-slate-900/50 hover:border-white/10'
                              : theme === 'sepia'
                                ? 'border-[#5b4636]/10 bg-transparent hover:border-[#5b4636]/30'
                                : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className={`w-full aspect-square rounded-lg border shadow-sm ${tItem.icon}`} />
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          theme === tItem.id ? 'opacity-100' : 'opacity-40'
                        }`}>
                          {tItem.label}
                        </span>
                        {theme === tItem.id && (
                          <motion.div
                            layoutId="activeTheme"
                            className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 ${
                              theme === 'dark' ? 'bg-indigo-500 border-slate-950' : theme === 'sepia' ? 'bg-[#5b4636] border-[#f4ecd8]' : 'bg-indigo-600 border-white'
                            }`}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Language Selection */}
              <div className="space-y-3">
                <label className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] opacity-50`}>
                  <Globe className="w-3.5 h-3.5" />
                  {t.language}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'en', label: t.english },
                    { id: 'zh', label: t.chinese }
                  ].map((lang) => (
                    <button
                      key={lang.id}
                      onClick={() => onLanguageChange(lang.id as Language)}
                      className={`py-3 px-4 rounded-2xl text-sm font-bold transition-all border-2 ${
                        language === lang.id
                          ? theme === 'dark'
                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                            : theme === 'sepia'
                              ? 'bg-[#5b4636] border-[#5b4636] text-[#f4ecd8]'
                              : 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-900/20'
                          : theme === 'dark'
                            ? 'bg-slate-900/50 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200'
                            : theme === 'sepia'
                              ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636]/70 hover:border-[#5b4636]/40'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Developer Options */}
              <details className={`rounded-2xl border p-4 ${
                theme === 'dark'
                  ? 'bg-slate-900/50 border-white/5'
                  : theme === 'sepia'
                    ? 'bg-[#f4ecd8]/60 border-[#5b4636]/20'
                    : 'bg-slate-50 border-slate-200'
              }`}>
                <summary className="cursor-pointer text-sm font-semibold opacity-80">{t.developerOptions}</summary>
                <div className="space-y-4 pt-4">
                  <p className="text-xs opacity-70">
                    {t.azureHint}
                  </p>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.ttsEngine}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { id: 'browser', label: t.engineBrowser },
                        { id: 'azure', label: t.engineAzure }
                      ].map((engine) => (
                        <button
                          key={engine.id}
                          onClick={() => onTtsEngineChange(engine.id as TtsEngine)}
                          className={`py-3 px-4 rounded-2xl text-sm font-bold transition-all border-2 ${
                            ttsEngine === engine.id
                              ? theme === 'dark'
                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                                : theme === 'sepia'
                                  ? 'bg-[#5b4636] border-[#5b4636] text-[#f4ecd8]'
                                  : 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-900/20'
                              : theme === 'dark'
                                ? 'bg-slate-900/50 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200'
                                : theme === 'sepia'
                                  ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636]/70 hover:border-[#5b4636]/40'
                                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                          }`}
                        >
                          {engine.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">
                        {t.audioCacheLimit}
                      </label>
                      <span className="text-sm font-mono font-bold">
                        {(Number.isFinite(cacheEntriesDraft) ? cacheEntriesDraft : 200)}{t.audioCacheLimitUnit}
                      </span>
                    </div>
                    <div className="relative flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const current = Number.isFinite(cacheEntriesDraft) ? cacheEntriesDraft : 200;
                          const nextValue = clampValue(current - 10, 0, 1000);
                          setCacheEntriesDraft(nextValue);
                          commitCacheEntries(nextValue);
                        }}
                        className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                          theme === 'dark'
                            ? 'border-white/10 text-slate-200 hover:bg-white/10'
                            : theme === 'sepia'
                              ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        aria-label={`${t.audioCacheLimit} 减小`}
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1000}
                        step="any"
                        value={Number.isFinite(cacheEntriesDraft) ? cacheEntriesDraft : 200}
                        onChange={(e) => {
                          const nextValue = Math.max(0, Math.min(1000, Number(e.target.value)));
                          setCacheEntriesDraft(Number.isFinite(nextValue) ? nextValue : 0);
                        }}
                        onMouseDown={() => { isDraggingCacheRef.current = true; }}
                        onTouchStart={() => { isDraggingCacheRef.current = true; }}
                        onPointerDown={() => { isDraggingCacheRef.current = true; }}
                        onMouseUp={() => { isDraggingCacheRef.current = false; commitCacheEntries(cacheEntriesDraft); }}
                        onTouchEnd={() => { isDraggingCacheRef.current = false; commitCacheEntries(cacheEntriesDraft); }}
                        onPointerUp={() => { isDraggingCacheRef.current = false; commitCacheEntries(cacheEntriesDraft); }}
                        onBlur={() => { isDraggingCacheRef.current = false; commitCacheEntries(cacheEntriesDraft); }}
                        onKeyUp={() => commitCacheEntries(cacheEntriesDraft)}
                        aria-label={t.audioCacheLimit}
                        className={`w-full h-1.5 rounded-full appearance-none cursor-pointer transition-all ${
                          theme === 'dark' 
                            ? 'bg-slate-800 accent-indigo-500' 
                            : theme === 'sepia' 
                              ? 'bg-[#5b4636]/10 accent-[#5b4636]' 
                              : 'bg-slate-200 accent-indigo-600'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const current = Number.isFinite(cacheEntriesDraft) ? cacheEntriesDraft : 200;
                          const nextValue = clampValue(current + 10, 0, 1000);
                          setCacheEntriesDraft(nextValue);
                          commitCacheEntries(nextValue);
                        }}
                        className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                          theme === 'dark'
                            ? 'border-white/10 text-slate-200 hover:bg-white/10'
                            : theme === 'sepia'
                              ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        aria-label={`${t.audioCacheLimit} 增大`}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">
                        {t.audioCacheSizeLimit}
                      </label>
                      <span className="text-sm font-mono font-bold">
                        {(Number.isFinite(cacheSizeMbDraft) ? cacheSizeMbDraft : 0)}{t.audioCacheSizeLimitUnit}
                      </span>
                    </div>
                    <div className="relative flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const current = Number.isFinite(cacheSizeMbDraft) ? cacheSizeMbDraft : 0;
                          const nextMb = clampValue(current - 10, 0, 2048);
                          setCacheSizeMbDraft(nextMb);
                          commitCacheSizeMb(nextMb);
                        }}
                        className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                          theme === 'dark'
                            ? 'border-white/10 text-slate-200 hover:bg-white/10'
                            : theme === 'sepia'
                              ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        aria-label={`${t.audioCacheSizeLimit} 减小`}
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={2048}
                        step="any"
                        value={Number.isFinite(cacheSizeMbDraft) ? cacheSizeMbDraft : 0}
                        onChange={(e) => {
                          const nextMb = Math.max(0, Math.min(2048, Number(e.target.value)));
                          setCacheSizeMbDraft(Number.isFinite(nextMb) ? nextMb : 0);
                        }}
                        onMouseDown={() => { isDraggingCacheRef.current = true; }}
                        onTouchStart={() => { isDraggingCacheRef.current = true; }}
                        onPointerDown={() => { isDraggingCacheRef.current = true; }}
                        onMouseUp={() => { isDraggingCacheRef.current = false; commitCacheSizeMb(cacheSizeMbDraft); }}
                        onTouchEnd={() => { isDraggingCacheRef.current = false; commitCacheSizeMb(cacheSizeMbDraft); }}
                        onPointerUp={() => { isDraggingCacheRef.current = false; commitCacheSizeMb(cacheSizeMbDraft); }}
                        onBlur={() => { isDraggingCacheRef.current = false; commitCacheSizeMb(cacheSizeMbDraft); }}
                        onKeyUp={() => commitCacheSizeMb(cacheSizeMbDraft)}
                        aria-label={t.audioCacheSizeLimit}
                        className={`w-full h-1.5 rounded-full appearance-none cursor-pointer transition-all ${
                          theme === 'dark' 
                            ? 'bg-slate-800 accent-indigo-500' 
                            : theme === 'sepia' 
                              ? 'bg-[#5b4636]/10 accent-[#5b4636]' 
                              : 'bg-slate-200 accent-indigo-600'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const current = Number.isFinite(cacheSizeMbDraft) ? cacheSizeMbDraft : 0;
                          const nextMb = clampValue(current + 10, 0, 2048);
                          setCacheSizeMbDraft(nextMb);
                          commitCacheSizeMb(nextMb);
                        }}
                        className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                          theme === 'dark'
                            ? 'border-white/10 text-slate-200 hover:bg-white/10'
                            : theme === 'sepia'
                              ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        aria-label={`${t.audioCacheSizeLimit} 增大`}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="text-xs font-semibold opacity-80 space-y-1">
                    <div>{t.audioCacheStats}</div>
                    <div>{t.audioCacheStatsCount}：{audioCacheCount}</div>
                    <div>{t.audioCacheStatsSize}：{formatBytes(audioCacheBytes)}</div>
                    <div>{t.audioCacheStatsAvg}：{audioCacheCount > 0 ? formatBytes(Math.round(audioCacheBytes / audioCacheCount)) : t.audioCacheStatsAvgEmpty}</div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setIsClearingCache(true);
                      try {
                        await clearAudioCache();
                      } finally {
                        setIsClearingCache(false);
                        refreshAudioCacheStats();
                      }
                    }}
                    className={`w-full px-4 py-3 rounded-xl font-bold transition-colors ${
                      theme === 'sepia'
                        ? 'bg-[#5b4636] text-[#f4ecd8] hover:bg-[#4a382a]'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    } ${isClearingCache ? 'opacity-60 cursor-wait' : ''}`}
                    disabled={isClearingCache}
                  >
                    {isClearingCache ? t.audioCacheClearing : t.audioCacheClear}
                  </button>

                  <button
                    type="button"
                    onClick={() => onClearActivation?.()}
                    className={`w-full px-4 py-3 rounded-xl font-bold transition-colors ${
                      theme === 'sepia'
                        ? 'bg-[#5b4636] text-[#f4ecd8] hover:bg-[#4a382a]'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {t.clearActivation}
                  </button>

                  {status?.message && (
                    <div className={`text-xs font-medium ${
                      status.level === 'error'
                        ? 'text-red-400'
                        : status.level === 'info'
                          ? 'text-amber-400'
                          : 'opacity-60'
                    }`}>
                      {status.message}
                    </div>
                  )}
                </div>
              </details>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});
