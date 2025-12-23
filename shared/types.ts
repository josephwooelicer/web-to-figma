export interface FigmaLayer {
  name: string;
  type: 'FRAME' | 'TEXT' | 'RECTANGLE' | 'VECTOR' | 'IMAGE' | 'SVG';
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: ColorFill[];
  strokes?: ColorFill[];
  strokeWeight?: number;
  cornerRadius?: number;
  opacity?: number;
  effects?: Effect[];
  children?: FigmaLayer[];
  // SVG specific
  svgContent?: string;
  // IMAGE specific
  imageUrl?: string;
  // Text specific
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  letterSpacing?: number;
  lineHeight?: number;
}

export interface ColorFill {
  type: 'SOLID' | 'GRADIENT_LINEAR';
  color: { r: number; g: number; b: number };
  opacity?: number;
}

export interface Effect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
  radius: number;
  visible: boolean;
  blendMode: 'NORMAL';
}
