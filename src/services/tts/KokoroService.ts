import { KokoroTTS } from 'kokoro-js';

export class KokoroService {
  private tts: KokoroTTS | null = null;
  public isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private onProgressCallback: ((percent: number) => void) | null = null;

  onProgress(callback: (percent: number) => void) {
    this.onProgressCallback = callback;
  }

  prepareAudioContext() {
    console.log("[KokoroService] prepareAudioContext called");
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      console.log("[KokoroService] AudioContext created in prepare");
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
      console.log("[KokoroService] AudioContext resumed in prepare");
    }
  }

  async init() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
        
        // We use a progress callback to track downloading
        this.tts = await KokoroTTS.from_pretrained(model_id, {
          dtype: "q8",
          device: "wasm", // or "webgpu" if available, but wasm is safer for compatibility
          progress_callback: (progressInfo: any) => {
            if (this.onProgressCallback && progressInfo.status === 'progress') {
              // progressInfo.progress is 0-100
              this.onProgressCallback(progressInfo.progress);
            }
          }
        });

        // Bypass voice validation to allow Chinese voices like zf_xiaobei
        (this.tts as any)._validate_voice = (voice: string) => {
          return voice.startsWith('z') ? 'z' : 'a';
        };

        this.isInitialized = true;
      } catch (error) {
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  async speak(text: string, voice: string = 'zf_xiaobei', speed: number = 1.0): Promise<void> {
    console.log(`[KokoroService] speak called with text: "${text.substring(0, 20)}...", voice: ${voice}, speed: ${speed}`);
    
    // Initialize AudioContext immediately to capture user gesture
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      console.log("[KokoroService] AudioContext created");
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      console.log("[KokoroService] AudioContext resumed");
    }

    await this.init();
    
    if (!this.tts) throw new Error("TTS not initialized");

    try {
      console.log("[KokoroService] Generating audio...");
      const rawAudio = await this.tts.generate(text, {
        voice: voice as any,
        speed: speed,
      });
      console.log("[KokoroService] Audio generated, playing...");

      await this.playAudio(rawAudio.audio, rawAudio.sampling_rate);
      console.log("[KokoroService] Audio playback finished");
    } catch (error) {
      console.error("Kokoro generation error:", error);
      throw error;
    }
  }

  private async playAudio(samples: Float32Array, sampleRate: number): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const buffer = this.audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);

    if (this.currentSource) {
      try { this.currentSource.stop(); } catch (e) {}
    }

    const source = this.audioContext.createBufferSource();
    this.currentSource = source;
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    
    return new Promise((resolve) => {
      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        resolve();
      };
      source.start();
    });
  }

  stop() {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch (e) {}
      this.currentSource = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.suspend();
    }
  }
}

export const kokoroService = new KokoroService();
