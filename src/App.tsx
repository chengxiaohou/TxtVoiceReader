import { useState, useEffect, useCallback } from 'react';
import { Reader } from './components/Reader';
import { SettingsPanel } from './components/SettingsPanel';
import { Library } from './components/Library';
import { useSpeech } from './hooks/useSpeech';
import { Settings, Play, Pause, ChevronLeft, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { addBook, updateProgress, Book } from './utils/db';
import { translations, Language } from './i18n';

type Theme = 'light' | 'dark' | 'sepia';
type View = 'library' | 'reader';

export default function App() {
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [view, setView] = useState<View>('library');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<Theme>('dark');
  const [language, setLanguage] = useState<Language>('zh');

  const [isJumpModalOpen, setIsJumpModalOpen] = useState(false);

  const t = translations[language];

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
  } = useSpeech(
    currentBook?.content || '', 
    currentBook?.progress || 0,
    handleProgressUpdate
  );

  const handleImportBook = async (text: string, name: string) => {
    try {
      const newBook = await addBook(name, text);
      setCurrentBook(newBook);
      setView('reader');
    } catch (error) {
      console.error("Failed to import book:", error);
      alert(t.saveError);
    }
  };

  const handleSelectBook = (book: Book) => {
    setCurrentBook(book);
    setView('reader');
  };

  const handleBack = () => {
    stop();
    setCurrentBook(null);
    setView('library');
  };

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

  // Apply theme to body for overscroll colors
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

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 h-16 z-30 flex items-center justify-between px-6 border-b transition-colors duration-300 ${
        theme === 'dark' 
          ? 'bg-slate-950/80 border-white/5 text-slate-100' 
          : theme === 'sepia' 
            ? 'bg-[#f4ecd8]/90 border-[#5b4636]/10 text-[#5b4636]' 
            : 'bg-white/80 border-black/5 text-slate-900'
      } backdrop-blur-md`}>
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
            <h1 className="font-semibold text-lg truncate max-w-[150px] sm:max-w-md">
              {currentBook?.title || 'TxtVoiceReader'}
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {view === 'reader' && !isPlaying && (
            <button
              onClick={speak}
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
      <main className="flex-1 pt-16 pb-32">
        {view === 'library' ? (
          <Library language={language} theme={theme} onSelectBook={handleSelectBook} onImportBook={handleImportBook} />
        ) : (
          <Reader 
            content={currentBook?.content || ''} 
            fontSize={fontSize} 
            theme={theme} 
            currentChunkIndex={currentChunkIndex}
            onChunkClick={jumpTo}
          />
        )}
      </main>

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
          }`}
        >
          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            {/* Controls Row */}
            <div className="flex items-center justify-center gap-4 sm:gap-6">
              <button
                onClick={isPlaying ? pause : speak}
                className={`flex items-center gap-2 px-8 py-3 sm:px-10 sm:py-4 rounded-full shadow-lg transform transition-transform active:scale-95 font-bold text-base sm:text-lg ${
                  theme === 'dark'
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/20'
                    : theme === 'sepia'
                      ? 'bg-[#5b4636] hover:bg-[#4a382a] text-[#f4ecd8] shadow-[#5b4636]/20'
                      : 'bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20'
                }`}
                aria-label={isPlaying ? t.pause : (isPaused ? t.resume : t.play)}
              >
                {isPlaying ? (
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
                className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all hover:scale-105 active:scale-95 ${
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
                  {Math.round(progress * 100)}%
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
