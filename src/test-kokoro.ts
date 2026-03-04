import { KokoroTTS } from "kokoro-js";

async function main() {
  const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const tts = await KokoroTTS.from_pretrained(model_id, {
    dtype: "q8",
    device: "cpu",
  });
  
  // Bypass voice validation
  (tts as any)._validate_voice = (voice: string) => {
    return voice.startsWith('z') ? 'z' : 'a';
  };

  console.log("Generating audio...");
  const audio = await tts.generate("你好，世界", {
    voice: "zf_xiaobei" as any,
  });
  console.log("Audio generated", audio);
}

main().catch(console.error);
