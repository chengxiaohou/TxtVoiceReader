export interface TextChunk {
  text: string;
  start: number;
  end: number;
  paragraphId?: number;
}

export interface ChunkingOptions {
  maxChunkLength?: number;
  minChunkLength?: number;
  preferredChunkLength?: number;
}

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  maxChunkLength: 140,
  minChunkLength: 20,
  preferredChunkLength: 80,
};

const splitWithRegex = (text: string, regex: RegExp): TextChunk[] => {
  const chunks: TextChunk[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (end <= lastIndex) continue;
    chunks.push({
      text: text.slice(lastIndex, end),
      start: lastIndex,
      end,
    });
    lastIndex = end;
  }
  if (lastIndex < text.length) {
    chunks.push({
      text: text.slice(lastIndex),
      start: lastIndex,
      end: text.length,
    });
  }
  return chunks.filter((chunk) => chunk.text.length > 0);
};

const hardSplit = (chunk: TextChunk, maxLength: number): TextChunk[] => {
  const results: TextChunk[] = [];
  let cursor = chunk.start;
  const text = chunk.text;
  while (cursor - chunk.start < text.length) {
    const remaining = text.length - (cursor - chunk.start);
    if (remaining <= maxLength) {
      results.push({
        text: text.slice(cursor - chunk.start),
        start: cursor,
        end: chunk.end,
        paragraphId: chunk.paragraphId,
      });
      break;
    }
    const sliceStart = cursor - chunk.start;
    const sliceEnd = sliceStart + maxLength;
    const window = text.slice(sliceStart, sliceEnd);
    const lastSpaceIndex = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\t'));
    const splitOffset = lastSpaceIndex > 20 ? lastSpaceIndex + 1 : window.length;
    const end = cursor + splitOffset;
    results.push({
      text: text.slice(sliceStart, sliceStart + splitOffset),
      start: cursor,
      end,
      paragraphId: chunk.paragraphId,
    });
    cursor = end;
  }
  return results.filter((chunk) => chunk.text.length > 0);
};

const mergeChunks = (chunks: TextChunk[], minLength: number, maxLength: number, preferredLength: number): TextChunk[] => {
  const merged: TextChunk[] = [];
  for (const chunk of chunks) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(chunk);
      continue;
    }
    if (last.paragraphId !== chunk.paragraphId) {
      merged.push(chunk);
      continue;
    }
    const combinedLength = last.text.length + chunk.text.length;
    const shouldMergeSmall = chunk.text.length < minLength && combinedLength <= maxLength;
    const shouldMergePreferred = last.text.length < preferredLength && combinedLength <= maxLength;
    if (shouldMergeSmall || shouldMergePreferred) {
      last.text += chunk.text;
      last.end = chunk.end;
      continue;
    }
    merged.push(chunk);
  }
  return merged;
};

export const chunkText = (text: string, options: ChunkingOptions = {}): TextChunk[] => {
  if (!text) return [];
  const { maxChunkLength, minChunkLength, preferredChunkLength } = { ...DEFAULT_OPTIONS, ...options };

  const paragraphRegex = /\n\s*\n+/g;
  const sentenceRegex = /[。！？!?；;…]+/g;
  const clauseRegex = /[，、,]+/g;

  const paragraphChunks = splitWithRegex(text, paragraphRegex).map((chunk, index) => ({
    ...chunk,
    paragraphId: index,
  }));
  const result: TextChunk[] = [];

  for (const paragraph of paragraphChunks) {
    if (paragraph.text.length <= maxChunkLength) {
      result.push(paragraph);
      continue;
    }

    const sentenceChunks = splitWithRegex(paragraph.text, sentenceRegex).map((chunk) => ({
      ...chunk,
      start: paragraph.start + chunk.start,
      end: paragraph.start + chunk.end,
      paragraphId: paragraph.paragraphId,
    }));

    for (const sentence of sentenceChunks) {
      if (sentence.text.length <= maxChunkLength) {
        result.push(sentence);
        continue;
      }

      const clauseChunks = splitWithRegex(sentence.text, clauseRegex).map((chunk) => ({
        ...chunk,
        start: sentence.start + chunk.start,
        end: sentence.start + chunk.end,
        paragraphId: sentence.paragraphId,
      }));

      for (const clause of clauseChunks) {
        if (clause.text.length <= maxChunkLength) {
          result.push(clause);
          continue;
        }
        result.push(...hardSplit(clause, maxChunkLength));
      }
    }
  }

  return mergeChunks(result, minChunkLength, maxChunkLength, preferredChunkLength);
};
