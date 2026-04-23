export type InkPoint = {
  x: number;
  y: number;
  pressure: number;
};

export type Stroke = {
  id: string;
  points: InkPoint[];
};

export type RasterizedRow = {
  imageData: ImageData;
  dataUrl: string;
  width: number;
  height: number;
};
