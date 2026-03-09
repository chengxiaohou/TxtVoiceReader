import React, { useEffect, useState, useRef } from 'react';
import { Book, getBooks, deleteBook } from '../utils/db';
import { Trash2, BookOpen, Clock, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../i18n';

interface LibraryProps {
  language: Language;
  theme: 'light' | 'dark' | 'sepia';
  onSelectBook: (book: Book) => void;
  onImportBook: (content: string, title: string) => void;
}

export const Library = React.memo(({ language, theme, onSelectBook, onImportBook }: LibraryProps) => {
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const t = translations[language];

  const loadBooks = async () => {
    setIsLoading(true);
    try {
      const loadedBooks = await getBooks();
      // Sort by last read (descending)
      setBooks(loadedBooks.sort((a, b) => b.lastReadAt - a.lastReadAt));
    } catch (error) {
      console.error("Failed to load books:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBooks();
  }, []);

  const handleDelete = async (e: React.MouseEvent | React.KeyboardEvent, id: string, title: string) => {
    e.stopPropagation();
    if (window.confirm(t.deleteConfirm.replace('{title}', title))) {
      await deleteBook(id);
      loadBooks();
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return t.today;
    } else if (diffDays === 1) {
      return t.yesterday;
    } else if (diffDays < 7) {
      return `${diffDays} ${t.daysAgo}`;
    } else {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        setIsImporting(true);
        
        try {
          const arrayBuffer = await file.arrayBuffer();
          
          // Try UTF-8 first
          let content = '';
          try {
            const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
            content = utf8Decoder.decode(arrayBuffer);
          } catch (e) {
            // Fallback to GBK for Chinese compatibility
            console.log("UTF-8 decoding failed, trying GBK...");
            const gbkDecoder = new TextDecoder('gbk');
            content = gbkDecoder.decode(arrayBuffer);
          }
          
          await onImportBook(content, file.name);
        } catch (error) {
          console.error("File import failed:", error);
          alert('Failed to read file');
        } finally {
          setIsImporting(false);
        }
      } else {
        alert('Please upload a valid .txt file');
      }
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className={`text-3xl font-bold tracking-tight ${
            theme === 'dark' ? 'text-white' : theme === 'sepia' ? 'text-[#5b4636]' : 'text-slate-900'
          }`}>
            {t.library}
          </h1>
          <p className={`mt-1 ${
            theme === 'dark' ? 'text-slate-400' : theme === 'sepia' ? 'text-[#5b4636]/70' : 'text-slate-500'
          }`}>
            {books.length} {books.length === 1 ? t.bookAvailable : t.booksAvailable}
          </p>
        </div>
        
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className={`
            flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium transition-all
            shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2
            ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}
            ${theme === 'sepia' 
              ? 'bg-[#5b4636] text-[#f4ecd8] hover:bg-[#4a382a] focus:ring-[#5b4636]' 
              : 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500'
            }
            dark:focus:ring-offset-slate-900
          `}
          aria-label={t.addBook}
        >
          {isImporting ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
          ) : (
            <Plus className="w-5 h-5" />
          )}
          <span>{isImporting ? t.importing : t.addBook}</span>
        </button>
        <input 
          ref={fileInputRef}
          type="file" 
          className="hidden" 
          accept=".txt" 
          onChange={handleFileChange}
          aria-hidden="true"
        />
      </header>

      <section aria-label={t.library}>
        {(isLoading || isImporting) ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4" aria-label={t.loadingLibrary}>
            <div className={`animate-spin rounded-full h-10 w-10 border-b-2 ${
              theme === 'sepia' ? 'border-[#5b4636]' : 'border-indigo-600'
            }`}></div>
            {isImporting && <p className="text-sm font-medium opacity-60 animate-pulse">{t.processingFile}</p>}
          </div>
        ) : books.length === 0 ? (
          <div className={`text-center py-20 px-4 rounded-3xl border border-dashed ${
            theme === 'dark' 
              ? 'bg-slate-900 border-slate-800' 
              : theme === 'sepia' 
                ? 'bg-[#f4ecd8] border-[#eaddc5]' 
                : 'bg-slate-50 border-slate-200'
          }`}>
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
              theme === 'dark' 
                ? 'bg-indigo-900/30 text-indigo-500' 
                : theme === 'sepia' 
                  ? 'bg-[#5b4636]/10 text-[#5b4636]' 
                  : 'bg-indigo-50 text-indigo-500'
            }`}>
              <BookOpen className="w-8 h-8" />
            </div>
            <h2 className={`text-xl font-semibold mb-2 ${
              theme === 'dark' ? 'text-white' : theme === 'sepia' ? 'text-[#5b4636]' : 'text-slate-900'
            }`}>{t.emptyLibrary}</h2>
            <p className={`max-w-md mx-auto mb-6 ${
              theme === 'dark' ? 'text-slate-400' : theme === 'sepia' ? 'text-[#5b4636]/70' : 'text-slate-500'
            }`}>
              {t.emptyLibraryDesc}
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`inline-flex items-center gap-2 font-medium hover:underline focus:outline-none focus:ring-2 rounded-lg px-2 py-1 ${
                theme === 'sepia' ? 'text-[#5b4636] focus:ring-[#5b4636]' : 'text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500'
              }`}
            >
              {t.importFirst}
            </button>
          </div>
        ) : (
          <ul 
            className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            <AnimatePresence mode='popLayout'>
              {books.map((book) => {
                const progressPercent = book.totalChunks > 0 ? (book.progress / book.totalChunks) * 100 : 0;
                const progressText = progressPercent.toFixed(1);
                
                return (
                  <motion.li
                    key={book.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group relative"
                  >
                    <div 
                      className={`
                        h-full flex flex-col rounded-xl p-4 
                        shadow-sm border transition-all duration-200 relative z-10
                        ${theme === 'dark' 
                          ? 'bg-slate-800 border-slate-700 hover:border-indigo-700' 
                          : theme === 'sepia' 
                            ? 'bg-[#f4ecd8] border-[#eaddc5] hover:border-[#5b4636]' 
                            : 'bg-white border-slate-200 hover:border-indigo-300'
                        }
                        hover:shadow-md
                      `}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className={`p-2 rounded-lg ${
                          theme === 'dark' 
                            ? 'bg-indigo-900/30 text-indigo-400' 
                            : theme === 'sepia' 
                              ? 'bg-[#5b4636]/10 text-[#5b4636]' 
                              : 'bg-indigo-50 text-indigo-600'
                        }`}>
                          <BookOpen className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <button
                          onClick={(e) => handleDelete(e, book.id, book.title)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              handleDelete(e, book.id, book.title);
                            }
                          }}
                          className={`
                            p-1.5 rounded-md transition-colors focus:outline-none focus:ring-2 
                            opacity-0 group-hover:opacity-100 focus:opacity-100 relative z-20
                            ${theme === 'sepia' 
                              ? 'text-[#5b4636]/50 hover:text-red-700 hover:bg-red-700/10 focus:ring-red-700' 
                              : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 focus:ring-red-500'
                            }
                          `}
                          aria-label={`${t.deleteBook} ${book.title}`}
                          title={t.deleteBook}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <h3 className={`text-base font-bold mb-2 line-clamp-2 leading-tight ${
                        theme === 'dark' ? 'text-white' : theme === 'sepia' ? 'text-[#5b4636]' : 'text-slate-900'
                      }`} title={book.title}>
                        <button 
                          onClick={() => onSelectBook(book)}
                          className={`text-left hover:underline focus:outline-none focus:underline decoration-2 underline-offset-2 ${
                            theme === 'sepia' ? 'decoration-[#5b4636]' : 'decoration-indigo-500'
                          }`}
                        >
                          {book.title}
                        </button>
                      </h3>
                      
                      <div className="mt-auto pt-3">
                        <div className={`flex items-center justify-between text-xs mb-2 ${
                          theme === 'dark' ? 'text-slate-400' : theme === 'sepia' ? 'text-[#5b4636]/70' : 'text-slate-500'
                        }`}>
                          <div className="flex items-center" title={`${new Date(book.lastReadAt).toLocaleString()}`}>
                            <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                            <span>{formatDate(book.lastReadAt)}</span>
                          </div>
                          <span aria-label={`${progressText}% ${t.completed}`}>{progressText}%</span>
                        </div>

                        <div 
                          className={`w-full h-2 rounded-full overflow-hidden ${
                            theme === 'dark' ? 'bg-slate-700' : theme === 'sepia' ? 'bg-[#5b4636]/10' : 'bg-slate-100'
                          }`}
                          role="progressbar"
                          aria-valuenow={Number(progressText)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ease-out ${
                              theme === 'sepia' ? 'bg-[#5b4636]' : 'bg-indigo-500'
                            }`} 
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                      
                      <div 
                        className="absolute inset-0 z-0 cursor-pointer" 
                        onClick={() => onSelectBook(book)}
                        aria-hidden="true"
                      />
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </section>
    </div>
  );
});
