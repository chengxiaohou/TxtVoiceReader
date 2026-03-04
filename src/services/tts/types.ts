export interface TTSVoice {
  id: string;
  name: string;
  lang: string;
  provider: 'system';
}

export interface TTSOptions {
  voice?: TTSVoice;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface AudioChunk {
  samples: Float32Array;
  sampleRate: number;
}
