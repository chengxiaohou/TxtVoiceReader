import React, { useMemo, useEffect, useState, useRef } from 'react';
import { Settings, X, Volume2, Mic, Globe, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../i18n';
import type { AzureTtsConfig, TtsEngine } from '../hooks/useSpeech';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  onVoiceChange: (voice: SpeechSynthesisVoice) => void;
  ttsEngine: TtsEngine;
  onTtsEngineChange: (engine: TtsEngine) => void;
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
  status,
}: SettingsPanelProps) => {
  const t = translations[language];
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [azureVoices, setAzureVoices] = useState<{ shortName: string; locale: string; localName?: string; gender?: string }[]>([]);
  const [azureVoiceStatus, setAzureVoiceStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const guardActivation = (event?: React.SyntheticEvent) => {
    if (!onRequireActivationCode) return true;
    const ok = onRequireActivationCode();
    if (!ok && event) {
      event.preventDefault();
      event.stopPropagation();
    }
    return ok;
  };

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

  const azureOutputFormats = [
    { value: 'audio-24khz-48kbitrate-mono-mp3', label: t.azureFormatBalanced },
    { value: 'audio-24khz-160kbitrate-mono-mp3', label: t.azureFormatHigh },
    { value: 'audio-16khz-32kbitrate-mono-mp3', label: t.azureFormatLow },
    { value: 'audio-48khz-192kbitrate-mono-mp3', label: t.azureFormatUltra },
    { value: 'riff-24khz-16bit-mono-pcm', label: t.azureFormatPcm24k },
    { value: 'riff-16khz-16bit-mono-pcm', label: t.azureFormatPcm16k },
    { value: 'raw-16khz-16bit-mono-pcm', label: t.azureFormatRaw16k },
  ];

  const formatGapLabel = (value: number) => {
    if (value === 0) return t.paragraphGapStandard;
    if (value > 0) return t.paragraphGapEarlyOption.replace('{ms}', String(value));
    return t.paragraphGapLateOption.replace('{ms}', String(Math.abs(value)));
  };

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
            className={`fixed right-0 top-0 bottom-0 w-full sm:w-[360px] shadow-2xl z-50 px-8 pt-0 pb-8 overflow-y-auto border-l backdrop-blur-xl transition-colors duration-300 ${
              theme === 'dark' 
                ? 'bg-slate-950/95 border-white/10 text-slate-100' 
                : theme === 'sepia' 
                  ? 'bg-[#f4ecd8]/95 border-[#5b4636]/10 text-[#5b4636]' 
                  : 'bg-white/95 border-black/5 text-slate-900'
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            tabIndex={-1}
            ref={panelRef}
          >
            <div className={`sticky top-0 z-20 -mx-8 px-8 pt-8 pb-6 flex items-center justify-between backdrop-blur-xl shadow-sm ${
              theme === 'dark' 
                ? 'bg-slate-950/98 border-b border-white/5' 
                : theme === 'sepia' 
                  ? 'bg-[#f4ecd8]/98 border-b border-[#5b4636]/10' 
                  : 'bg-white/98 border-b border-black/5'
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
                    { label: t.speed, value: `${rate}x`, val: rate, min: 0.5, max: 2, step: 0.1, onChange: onRateChange },
                    { label: t.volume, value: `${Math.round(volume * 100)}%`, val: volume, min: 0, max: 1, step: 0.1, onChange: onVolumeChange },
                  ].map((control) => (
                    <div key={control.label} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{control.label}</label>
                        <span className="text-sm font-mono font-bold">{control.value}</span>
                      </div>
                      <div className="relative flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => control.onChange(clampValue(Number((control.val - control.step).toFixed(2)), control.min, control.max))}
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
                          step={control.step}
                          value={control.val}
                          onChange={(e) => control.onChange(parseFloat(e.target.value))}
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
                          onClick={() => control.onChange(clampValue(Number((control.val + control.step).toFixed(2)), control.min, control.max))}
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
                    <span className="text-sm font-mono font-bold">{pitch}</span>
                  </div>
                  <div className="relative flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onPitchChange(clampValue(Number((pitch - 0.1).toFixed(2)), 0.5, 2))}
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
                      step={0.1}
                      value={pitch}
                      onChange={(e) => onPitchChange(parseFloat(e.target.value))}
                      aria-label={t.pitch}
                      aria-valuetext={`${t.pitch} ${pitch}`}
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
                      onClick={() => onPitchChange(clampValue(Number((pitch + 0.1).toFixed(2)), 0.5, 2))}
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

                {ttsEngine === 'azure' && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.paragraphGap}</label>
                      <span className="text-sm font-mono font-bold">{formatGapLabel(azureConfig.overlapEnabled ? azureConfig.overlapMs : 0)}</span>
                    </div>
                    <div className="relative flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const current = azureConfig.overlapEnabled ? azureConfig.overlapMs : 0;
                          const nextValue = clampValue(current - 20, -320, 320);
                          onAzureConfigChange({ ...azureConfig, overlapMs: nextValue, overlapEnabled: nextValue !== 0 });
                        }}
                        className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                          theme === 'dark'
                            ? 'border-white/10 text-slate-200 hover:bg-white/10'
                            : theme === 'sepia'
                              ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        aria-label={`${t.paragraphGap} 减小，当前 ${formatGapLabel(azureConfig.overlapEnabled ? azureConfig.overlapMs : 0)}`}
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={-320}
                        max={320}
                        step={20}
                        value={azureConfig.overlapEnabled ? azureConfig.overlapMs : 0}
                        onChange={(e) => {
                          const nextValue = parseInt(e.target.value, 10) || 0;
                          onAzureConfigChange({ ...azureConfig, overlapMs: nextValue, overlapEnabled: nextValue !== 0 });
                        }}
                        aria-label={t.paragraphGap}
                        aria-valuetext={`${t.paragraphGap} ${formatGapLabel(azureConfig.overlapEnabled ? azureConfig.overlapMs : 0)}`}
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
                          const current = azureConfig.overlapEnabled ? azureConfig.overlapMs : 0;
                          const nextValue = clampValue(current + 20, -320, 320);
                          onAzureConfigChange({ ...azureConfig, overlapMs: nextValue, overlapEnabled: nextValue !== 0 });
                        }}
                        className={`h-8 w-8 rounded-full border text-sm font-bold transition-colors ${
                          theme === 'dark'
                            ? 'border-white/10 text-slate-200 hover:bg-white/10'
                            : theme === 'sepia'
                              ? 'border-[#5b4636]/20 text-[#5b4636] hover:bg-[#5b4636]/10'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        aria-label={`${t.paragraphGap} 增大，当前 ${formatGapLabel(azureConfig.overlapEnabled ? azureConfig.overlapMs : 0)}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Reading Display */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.readingDisplay}</label>
                <div className="grid grid-cols-1 gap-4">
                  {[
                    { label: t.fontSize, value: `${fontSize}px`, val: fontSize, min: 12, max: 32, step: 1, onChange: onFontSizeChange }
                  ].map((control) => (
                    <div key={control.label} className="space-y-2">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{control.label}</label>
                        <span className="text-sm font-mono font-bold">{control.value}</span>
                      </div>
                      <div className="relative flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => control.onChange(clampValue(control.val - control.step, control.min, control.max))}
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
                          step={control.step}
                          value={control.val}
                          onChange={(e) => control.onChange(parseFloat(e.target.value))}
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
                          onClick={() => control.onChange(clampValue(control.val + control.step, control.min, control.max))}
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

                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.azureRegion}</label>
                    <input
                      type="text"
                      value={azureConfig.region}
                      onChange={(e) => onAzureConfigChange({ ...azureConfig, region: e.target.value })}
                      placeholder="eastasia"
                      className={`w-full px-4 py-3 rounded-xl border text-sm outline-none ${
                        theme === 'dark'
                          ? 'bg-slate-900 border-white/5 text-slate-200 focus:border-indigo-500'
                          : theme === 'sepia'
                            ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636] focus:border-[#5b4636]'
                            : 'bg-white border-slate-200 text-slate-900 focus:border-indigo-600'
                      }`}
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">{t.azureKey}</label>
                    <input
                      type="password"
                      value={azureConfig.key}
                      onChange={(e) => onAzureConfigChange({ ...azureConfig, key: e.target.value })}
                      placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className={`w-full px-4 py-3 rounded-xl border text-sm outline-none ${
                        theme === 'dark'
                          ? 'bg-slate-900 border-white/5 text-slate-200 focus:border-indigo-500'
                          : theme === 'sepia'
                            ? 'bg-transparent border-[#5b4636]/20 text-[#5b4636] focus:border-[#5b4636]'
                            : 'bg-white border-slate-200 text-slate-900 focus:border-indigo-600'
                      }`}
                    />
                  </div>

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
