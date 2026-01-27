
export enum AssetStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export interface Asset {
  id: string;
  originalName: string;
  imageUrl: string;
  status: AssetStatus;
  modelUrl: string | null;
  createdAt: number;
  errorMsg?: string;
}

export type SceneObjectType = 'model' | 'light' | 'camera';

export interface SceneObject {
  id: string;
  type: SceneObjectType;
  name: string;
  url?: string;
  transform: ModelTransform;
  visible: boolean;
  locked?: boolean; // New: Lock transformation
  lightProps?: {
    intensity: number;
    color: string;
    castShadow: boolean;
  };
  cameraProps?: { // New: Camera specific properties
    fov: number;
  };
}

export interface RenderSettings {
  autoRotate: boolean;
  gridVisible: boolean;
}

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface ModelTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface NanoBananaConfig {
  lighting: {
    position: [number, number, number];
    intensity: number;
  };
  camera: {
    position: [number, number, number];
  };
  prompt?: string;
  image?: string; // Base64 image string for reference
  width?: number;
  height?: number;
}

export interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

declare global {
  interface Window {
    NanoBananaPro?: {
      loadModel: (url: string) => void;
      render: (config: NanoBananaConfig) => Promise<string>;
    };
  }
}
