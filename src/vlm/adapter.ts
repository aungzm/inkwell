import type { RasterizedRow, VLMResult } from '../types';

export interface VLMAdapter {
  id: string;
  label: string;
  load(): Promise<void>;
  isReady(): boolean;
  transcribe(image: RasterizedRow): Promise<VLMResult>;
  unload(): Promise<void>;
}
