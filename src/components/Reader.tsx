import React, { useEffect, useRef, useMemo, memo } from 'react';
import { chunkText, TextChunk } from '../utils/chunking';

interface ChunkProps {
  chunk: string;
  index: number;
  isActive: boolean;
  isPreloading: boolean;
  isPreloaded: boolean;
  onClick: (index: number) => void;
  onActiveReady?: () => void;
  scrollSignal?: number;
}

const Chunk = memo(({ chunk, index, isActive, isPreloading, isPreloaded, onClick, onActiveReady, scrollSignal }: ChunkProps) => {
  const ref = useRef<HTMLSpanElement>(null);
  const leadingMatch = chunk.match(/^(\s+)/);
  const trailingMatch = chunk.match(/(\s+)$/);
  const leadingWhitespace = leadingMatch ? leadingMatch[1] : '';
  const trailingWhitespace = trailingMatch ? trailingMatch[1] : '';
  const startOffset = leadingWhitespace.length;
  const endOffset = trailingWhitespace.length;
  const visibleText = chunk.slice(startOffset, endOffset ? -endOffset : undefined);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      onActiveReady?.();
    }
  }, [isActive, onActiveReady, scrollSignal]);

  if (!visibleText) {
    return <span>{chunk}</span>;
  }

  return (
    <>
      {leadingWhitespace}
      <span
        ref={ref}
        onClick={() => onClick(index)}
        className={`
          cursor-pointer rounded px-0.5
          ${isActive 
            ? 'bg-indigo-500/20 ring-1 ring-indigo-500/30' 
            : isPreloading
              ? 'border border-dashed border-indigo-500/30 bg-transparent'
              : isPreloaded
                ? 'border border-solid border-indigo-500/30 bg-transparent'
                : 'hover:bg-black/5 dark:hover:bg-white/5'
          }
        `}
        role="button"
        aria-label={`Read from: ${visibleText.substring(0, 20)}...`}
      >
        {visibleText}
      </span>
      {trailingWhitespace}
    </>
  );
});

Chunk.displayName = 'Chunk';

interface ReaderProps {
  content: string;
  fontSize: number;
  theme: 'light' | 'dark' | 'sepia';
  currentChunkIndex: number;
  preloadingChunkIndex?: number[];
  preloadedChunkIndex?: number[];
  onChunkClick?: (index: number) => void;
  onActiveChunkReady?: () => void;
  scrollSignal?: number;
}

export const Reader: React.FC<ReaderProps> = ({ 
  content, 
  fontSize, 
  theme, 
  currentChunkIndex,
  preloadingChunkIndex,
  preloadedChunkIndex,
  onChunkClick,
  onActiveChunkReady,
  scrollSignal,
}) => {
  const chunks = useMemo<TextChunk[]>(() => {
    if (!content) return [];
    const result = chunkText(content);
    return result.length > 0 ? result : [{ text: content, start: 0, end: content.length }];
  }, [content]);

  const getThemeClasses = () => {
    switch (theme) {
      case 'dark':
        return 'bg-slate-900 text-slate-300';
      case 'sepia':
        return 'bg-[#f4ecd8] text-[#5b4636]';
      default:
        return 'bg-white text-slate-800';
    }
  };

  return (
    <div 
      className={`w-full min-h-full p-6 md:p-12 transition-colors duration-200 ${getThemeClasses()}`}
      style={{ fontSize: `${fontSize}px`, lineHeight: '1.8' }}
    >
      <div className="max-w-3xl mx-auto whitespace-pre-wrap font-serif">
        {chunks.map((chunk, index) => (
          <Chunk
            key={index}
            index={index}
            chunk={chunk.text}
            isActive={index === currentChunkIndex}
            isPreloading={Boolean(preloadingChunkIndex?.includes(index))}
            isPreloaded={Boolean(preloadedChunkIndex?.includes(index))}
            onClick={onChunkClick || (() => {})}
            onActiveReady={onActiveChunkReady}
            scrollSignal={scrollSignal}
          />
        ))}
      </div>
    </div>
  );
};
