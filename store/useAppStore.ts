import { create } from 'zustand';
import { Asset, RenderSettings, TransformMode, ModelTransform, AppNotification, SceneObject, CameraState } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface UndoableState {
    sceneObjects: SceneObject[];
    renderSettings: RenderSettings;
    selectedObjectId: string | null;
}

interface AppState {
  // Config
  backendUrl: string;

  // Asset Management
  assets: Asset[];
  
  // Scene State (Multiple Models & Lights)
  sceneObjects: SceneObject[];
  
  // Editor State
  transformMode: TransformMode;
  selectedObjectId: string | null; // UUID of SceneObject or 'light-env', 'camera', etc.
  activeCameraId: string | null; // New: Which scene camera is currently being looked through

  // Scene Settings
  renderSettings: RenderSettings;
  
  // Camera State (The default editor camera)
  cameraState: CameraState;
  cameraVersion: number; // Used to trigger scene updates from UI

  // Notifications
  notifications: AppNotification[];

  // History
  past: UndoableState[];
  future: UndoableState[];

  // Actions
  setBackendUrl: (url: string) => void;
  setAssets: (assets: Asset[]) => void;
  addAsset: (asset: Asset) => void;
  updateAsset: (id: string, updates: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  
  addModelToScene: (url: string, name?: string) => void;
  addLightToScene: () => void;
  addCameraToScene: () => void; // New
  updateSceneObject: (id: string, updates: Partial<SceneObject>) => void;
  removeSceneObject: (id: string) => void;
  clearScene: () => void;
  
  setTransformMode: (mode: TransformMode) => void;
  setSelectedObjectId: (id: string | null) => void;
  setActiveCameraId: (id: string | null) => void; // New
  
  // Updates the currently selected object's transform
  updateSelectedObjectTransform: (transform: Partial<ModelTransform>) => void;
  
  updateRenderSettings: (settings: Partial<RenderSettings>) => void;
  
  // Camera Actions
  setCameraState: (state: Partial<CameraState>) => void; // Updates Store AND Version (triggers Scene update)
  syncCameraState: (state: Partial<CameraState>) => void; // Updates Store ONLY (called by Scene)
  resetCamera: () => void;

  addNotification: (type: AppNotification['type'], message: string) => void;
  removeNotification: (id: string) => void;

  undo: () => void;
  redo: () => void;
}

// Generate a static ID for the default camera so we can reference it in initial state
const DEFAULT_CAMERA_ID = uuidv4();

export const useAppStore = create<AppState>((set, get) => ({
  // CONFIGURATION:
  // Default to the provided Cloudflare Worker URL
  backendUrl: localStorage.getItem('tripo_backend_url') || 'https://soft-wave-9c83.a718919334.workers.dev', 

  assets: [],
  sceneObjects: [
    // Default Directional Light
    {
      id: uuidv4(),
      type: 'light',
      name: 'Main Light',
      transform: { position: [5, 5, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      lightProps: { intensity: 1.5, color: '#ffffff', castShadow: true }
    },
    // Default Main Camera (As Viewpoint)
    {
      id: DEFAULT_CAMERA_ID,
      type: 'camera',
      name: 'Main Camera',
      transform: { position: [0, 1.0, 3.5], rotation: [-0.1, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      cameraProps: { fov: 45 }
    }
  ],
  
  transformMode: 'translate',
  selectedObjectId: DEFAULT_CAMERA_ID, // Select the camera by default
  activeCameraId: DEFAULT_CAMERA_ID,   // Set the camera as the active viewpoint

  renderSettings: {
    autoRotate: false, 
    gridVisible: false, // Changed default to false
  },
  
  cameraState: {
    // Editor Camera Default
    position: [2, 1.5, 4],
    target: [0, 0.5, 0],
    fov: 50
  },
  cameraVersion: 0,

  notifications: [],
  past: [],
  future: [],

  setBackendUrl: (url) => {
      localStorage.setItem('tripo_backend_url', url);
      set({ backendUrl: url });
  },

  setAssets: (assets) => set({ assets }),
  
  addAsset: (asset) => set((state) => ({ 
    assets: [asset, ...state.assets] 
  })),
  
  updateAsset: (id, updates) => set((state) => ({
    assets: state.assets.map((asset) => 
      asset.id === id ? { ...asset, ...updates } : asset
    )
  })),

  removeAsset: (id) => set((state) => ({
      assets: state.assets.filter(a => a.id !== id)
  })),

  addModelToScene: (url, name) => set((state) => {
      const snapshot: UndoableState = {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      };
      
      const newId = uuidv4();
      const newObject: SceneObject = {
          id: newId,
          type: 'model',
          name: name || 'New Model',
          url: url,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          visible: true,
          locked: false
      };

      return { 
        sceneObjects: [...state.sceneObjects, newObject],
        selectedObjectId: newId,
        past: [...state.past, snapshot],
        future: []
      };
  }),

  addLightToScene: () => set((state) => {
    const snapshot: UndoableState = {
        sceneObjects: state.sceneObjects,
        renderSettings: state.renderSettings,
        selectedObjectId: state.selectedObjectId
    };

    const newId = uuidv4();
    const newLight: SceneObject = {
        id: newId,
        type: 'light',
        name: `Light ${state.sceneObjects.filter(o => o.type === 'light').length + 1}`,
        transform: { position: [2, 5, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        locked: false,
        lightProps: { intensity: 1.0, color: '#ffffff', castShadow: true }
    };

    return {
        sceneObjects: [...state.sceneObjects, newLight],
        selectedObjectId: newId,
        past: [...state.past, snapshot],
        future: []
    };
  }),

  addCameraToScene: () => set((state) => {
    const snapshot: UndoableState = {
        sceneObjects: state.sceneObjects,
        renderSettings: state.renderSettings,
        selectedObjectId: state.selectedObjectId
    };

    const newId = uuidv4();
    const newCamera: SceneObject = {
        id: newId,
        type: 'camera',
        name: `Camera ${state.sceneObjects.filter(o => o.type === 'camera').length + 1}`,
        transform: { position: [0, 2, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        locked: false,
        cameraProps: { fov: 50 }
    };

    return {
        sceneObjects: [...state.sceneObjects, newCamera],
        selectedObjectId: newId,
        past: [...state.past, snapshot],
        future: []
    };
  }),

  updateSceneObject: (id, updates) => set((state) => {
     const snapshot: UndoableState = {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      };
     return {
         sceneObjects: state.sceneObjects.map(obj => obj.id === id ? { ...obj, ...updates } : obj),
         past: [...state.past, snapshot],
         future: []
     };
  }),

  removeSceneObject: (id) => set((state) => {
      const snapshot: UndoableState = {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      };
      
      // If we remove the camera we are currently looking through, reset active camera
      const isActiveCamera = state.activeCameraId === id;

      return {
          sceneObjects: state.sceneObjects.filter(obj => obj.id !== id),
          selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
          activeCameraId: isActiveCamera ? null : state.activeCameraId,
          past: [...state.past, snapshot],
          future: []
      };
  }),

  clearScene: () => set((state) => ({
      sceneObjects: [],
      selectedObjectId: null,
      activeCameraId: null,
      past: [...state.past, {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      }]
  })),

  setTransformMode: (mode) => set({ transformMode: mode }),
  setSelectedObjectId: (id) => set({ selectedObjectId: id }),
  setActiveCameraId: (id) => set({ activeCameraId: id }),
  
  updateSelectedObjectTransform: (updates) => set((state) => {
      if (!state.selectedObjectId) return {};
      
      const currentObj = state.sceneObjects.find(o => o.id === state.selectedObjectId);
      if (currentObj && currentObj.locked) return {}; // Prevent transform if locked

      const snapshot: UndoableState = {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      };

      const updatedObjects = state.sceneObjects.map(obj => {
          if (obj.id === state.selectedObjectId) {
              return {
                  ...obj,
                  transform: { ...obj.transform, ...updates }
              };
          }
          return obj;
      });

      return {
        sceneObjects: updatedObjects,
        past: [...state.past, snapshot],
        future: []
      };
  }),

  updateRenderSettings: (updates) => set((state) => {
      const snapshot: UndoableState = {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      };
      return {
        renderSettings: { ...state.renderSettings, ...updates },
        past: [...state.past, snapshot],
        future: []
      };
  }),

  setCameraState: (newState) => set((state) => ({
      cameraState: { ...state.cameraState, ...newState },
      cameraVersion: state.cameraVersion + 1
  })),

  syncCameraState: (newState) => set((state) => ({
      cameraState: { ...state.cameraState, ...newState }
  })),

  resetCamera: () => set((state) => ({
      cameraState: { position: [2, 1.5, 4], target: [0, 0.5, 0], fov: 50 },
      cameraVersion: state.cameraVersion + 1
  })),

  addNotification: (type, message) => set((state) => {
    const id = uuidv4();
    setTimeout(() => {
        set((s) => ({ notifications: s.notifications.filter(n => n.id !== id) }));
    }, 4000);
    return { notifications: [...state.notifications, { id, type, message }] };
  }),

  removeNotification: (id) => set((state) => ({
    notifications: state.notifications.filter(n => n.id !== id)
  })),

  undo: () => set((state) => {
      if (state.past.length === 0) return {};

      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, -1);

      const currentSnapshot: UndoableState = {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      };

      return {
          past: newPast,
          future: [currentSnapshot, ...state.future],
          sceneObjects: previous.sceneObjects,
          renderSettings: previous.renderSettings,
          selectedObjectId: previous.selectedObjectId
      };
  }),

  redo: () => set((state) => {
      if (state.future.length === 0) return {};

      const next = state.future[0];
      const newFuture = state.future.slice(1);

      const currentSnapshot: UndoableState = {
          sceneObjects: state.sceneObjects,
          renderSettings: state.renderSettings,
          selectedObjectId: state.selectedObjectId
      };

      return {
          past: [...state.past, currentSnapshot],
          future: newFuture,
          sceneObjects: next.sceneObjects,
          renderSettings: next.renderSettings,
          selectedObjectId: next.selectedObjectId
      };
  })
}));