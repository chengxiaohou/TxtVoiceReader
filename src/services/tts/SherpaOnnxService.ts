import { getCachedFile } from '../../utils/cache';

export class SherpaOnnxService {
  private worker: Worker | null = null;
  public isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private onProgressCallback: ((percent: number) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  }

  onProgress(callback: (percent: number) => void) {
    this.onProgressCallback = callback;
  }

  async init() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Piper Model URLs (Chinese Female - Huayan)
        const modelUrl = 'https://huggingface.co/csukuangfj/sherpa-onnx-vits-piper-zh_CN-huayan-medium/resolve/main/zh_CN-huayan-medium.onnx';
        const tokensUrl = 'https://huggingface.co/csukuangfj/sherpa-onnx-vits-piper-zh_CN-huayan-medium/resolve/main/tokens.txt';

        let modelProgress = 0;
        let tokensProgress = 0;

        const updateProgress = () => {
          if (this.onProgressCallback) {
            // Model is much larger, so we weight it more (95% model, 5% tokens)
            const totalProgress = Math.round(modelProgress * 0.95 + tokensProgress * 0.05);
            this.onProgressCallback(totalProgress);
          }
        };

        const [model, tokens] = await Promise.all([
          getCachedFile(modelUrl, (p) => {
            modelProgress = p;
            updateProgress();
          }),
          getCachedFile(tokensUrl, (p) => {
            tokensProgress = p;
            updateProgress();
          })
        ]);

        return new Promise<void>((resolve, reject) => {
          if (!this.worker) return reject('Worker not created');

          const timeout = setTimeout(() => {
            reject('初始化超时，请检查网络连接或刷新页面重试');
          }, 60000); // 1 minute timeout for worker initialization

          const onMessage = (e: MessageEvent) => {
            if (e.data.type === 'initialized') {
              clearTimeout(timeout);
              this.isInitialized = true;
              this.worker?.removeEventListener('message', onMessage);
              resolve();
            } else if (e.data.type === 'error') {
              clearTimeout(timeout);
              this.worker?.removeEventListener('message', onMessage);
              reject(e.data.error);
            }
          };

          this.worker.addEventListener('message', onMessage);

          this.worker.postMessage({
            type: 'init',
            data: { model, tokens }
          });
        });
      } catch (error) {
        this.initPromise = null; // Allow retry
        throw error;
      }
    })();

    return this.initPromise;
  }

  async speak(text: string, speed: number = 1.0): Promise<void> {
    await this.init();
    
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    return new Promise((resolve, reject) => {
      if (!this.worker) return reject('Worker not created');

      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'audio') {
          this.playAudio(e.data.data.samples, e.data.data.sampleRate).then(resolve);
          this.worker?.removeEventListener('message', onMessage);
        } else if (e.data.type === 'error') {
          reject(e.data.error);
          this.worker?.removeEventListener('message', onMessage);
        }
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.postMessage({
        type: 'generate',
        data: { text, speed }
      });
    });
  }

  private async playAudio(samples: Float32Array, sampleRate: number): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
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

export const sherpaOnnxService = new SherpaOnnxService();
