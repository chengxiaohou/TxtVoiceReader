
// Sherpa-ONNX TTS Worker

let tts: any = null;
let Module: any = null;

const SHERPA_ONNX_JS_URL = 'https://cdn.jsdelivr.net/npm/sherpa-onnx@1.12.28/sherpa-onnx-wasm-main.js';
const SHERPA_ONNX_WASM_URL = 'https://cdn.jsdelivr.net/npm/sherpa-onnx@1.12.28/sherpa-onnx-wasm-main.wasm';

async function init(modelFiles: { model: Uint8Array, tokens: Uint8Array, dataDir?: Uint8Array }) {
  if (tts) return;

  // @ts-ignore
  importScripts(SHERPA_ONNX_JS_URL);

  // @ts-ignore
  Module = await createSherpaOnnx({
    locateFile: (path: string) => {
      if (path.endsWith('.wasm')) return SHERPA_ONNX_WASM_URL;
      return path;
    }
  });

  // Write files to virtual filesystem
  Module.FS.writeFile('model.onnx', modelFiles.model);
  Module.FS.writeFile('tokens.txt', modelFiles.tokens);
  
  const config = {
    vits: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
    },
    numThreads: 1,
    sampleRate: 22050,
  };

  // @ts-ignore
  tts = new Module.OfflineTts(config);
}

self.onmessage = async (e) => {
  const { type, data } = e.data;

  try {
    if (type === 'init') {
      await init(data);
      self.postMessage({ type: 'initialized' });
    } else if (type === 'generate') {
      if (!tts) throw new Error('TTS not initialized');
      
      const audio = tts.generate({ text: data.text, sid: 0, speed: data.speed || 1.0 });
      const samples = audio.samples; // Float32Array
      const sampleRate = audio.sampleRate;
      
      self.postMessage({ 
        type: 'audio', 
        data: { samples, sampleRate },
        id: data.id 
      }, [samples.buffer] as any);
    }
  } catch (error: any) {
    self.postMessage({ type: 'error', error: error.message });
  }
};
