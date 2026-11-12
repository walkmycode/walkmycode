// The part of sherpa-onnx-node (Apache-2.0) used by engine.ts; the package ships no TypeScript types.
declare module "sherpa-onnx-node" {
  export interface OfflineRecognizerConfig {
    featConfig?: { sampleRate?: number; featureDim?: number };
    modelConfig: {
      transducer?: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads?: number;
      provider?: string;
      debug?: number;
      modelType?: string;
    };
  }
  export class OfflineStream {
    acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void;
  }
  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    static createAsync(config: OfflineRecognizerConfig): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    decodeAsync(stream: OfflineStream): Promise<{ text: string }>;
    getResult(stream: OfflineStream): { text: string };
  }
  export function readWave(path: string): { samples: Float32Array; sampleRate: number };
}

declare module "unbzip2-stream" {
  const bz2: () => NodeJS.ReadWriteStream;
  export default bz2;
}
