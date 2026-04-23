import type { RasterizedRow, VLMResult } from '../types';

export type VlmCapability = {
  supported: boolean;
  reason?: string;
};

export type VlmStatus =
  | { stage: 'idle'; message: string }
  | { stage: 'checking'; message: string }
  | { stage: 'loading'; message: string; progress?: number }
  | { stage: 'ready'; message: string }
  | { stage: 'error'; message: string };

export interface VLMAdapter {
  id: string;
  label: string;
  checkSupport(): Promise<VlmCapability>;
  load(): Promise<void>;
  isReady(): boolean;
  transcribe(image: RasterizedRow): Promise<VLMResult>;
  unload(): Promise<void>;
  setStatusListener(listener: ((status: VlmStatus) => void) | null): void;
}
