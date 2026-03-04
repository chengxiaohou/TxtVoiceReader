import React, { useEffect, useRef, useMemo, memo } from 'react';

interface ChunkProps {
  chunk: string;
  index: number;
  isActive: boolean;
  onClick: (index: number) => void;
}

const Chunk = memo(({ chunk, index, isActive, onClick }: ChunkProps) => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [isActive]);

  return (
    <span
      ref={ref}
      onClick={() => onClick(index)}
      className={`
        cursor-pointer rounded px-0.5
        ${isActive 
          ? 'bg-indigo-500/20 ring-1 ring-indigo-500/30' 
          : 'hover:bg-black/5 dark:hover:bg-white/5'
        }
      `}
      role="button"
      aria-label={`Read from: ${chunk.substring(0, 20)}...`}
    >
      {chunk}
    </span>
  );
});

Chunk.displayName = 'Chunk';

interface ReaderProps {
  content: string;
  fontSize: number;
  theme: 'light' | 'dark' | 'sepia';
  currentChunkIndex: number;
  onChunkClick?: (index: number) => void;
}

export const Reader: React.FC<ReaderProps> = ({ 
  content, 
  fontSize, 
  theme, 
  currentChunkIndex,
  onChunkClick 
}) => {
  const chunks = useMemo(() => {
    if (!content) return [];
    return content.match(/[^.!?\n]+[.!?\n]*/g) || [content];
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
            chunk={chunk}
            isActive={index === currentChunkIndex}
            onClick={onChunkClick || (() => {})}
          />
        ))}
      </div>
    </div>
  );
};
