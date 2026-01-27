import React, { Suspense, useEffect, useRef, useState, useMemo, ReactNode, Component } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Grid, TransformControls, Html, useProgress, Bounds, Environment, GizmoHelper, GizmoViewport, ContactShadows, Billboard, useHelper, PerspectiveCamera } from '@react-three/drei';
import { useAppStore } from '../store/useAppStore';
import { Zap, Loader2, Sparkles, AlertTriangle, Box, RefreshCw, Aperture, Ratio, Wand2, ArrowRight, X, Download, Video, Lock, Layers, Triangle, Activity } from 'lucide-react';
import * as THREE from 'three';
import { DirectionalLightHelper, CameraHelper } from 'three';
import { v4 as uuidv4 } from 'uuid';
import { AssetStatus, ModelTransform, SceneObject, TransformMode } from '../types';
import { createTextTo3DTask, pollTripoTask } from '../services/tripoService';
import { generateRefinedImage, optimizePromptFor3D } from '../services/geminiService';
import Toolbar from './Toolbar';

// --- Configuration ---
const DRACO_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';

const RESOLUTION_PRESETS = [
    { label: 'Square (1:1)', w: 1024, h: 1024, ratio: "1:1", icon: 'square' },
    { label: 'Landscape (16:9)', w: 1920, h: 1080, ratio: "16:9", icon: 'rectangle-horizontal' },
    { label: 'Portrait (9:16)', w: 1080, h: 1920, ratio: "9:16", icon: 'rectangle-vertical' },
    { label: 'Standard (4:3)', w: 1024, h: 768, ratio: "4:3", icon: 'monitor' },
];

// --- Scene Stats Component ---
function SceneStatsUpdater({ onUpdate }: { onUpdate: (stats: { verts: number, tris: number, objects: number }) => void }) {
    const { scene } = useThree();
    const lastUpdate = useRef(0);

    useFrame(({ clock }) => {
        // Update every 500ms to avoid performance impact
        if (clock.elapsedTime - lastUpdate.current > 0.5) {
            lastUpdate.current = clock.elapsedTime;
            
            let verts = 0;
            let tris = 0;
            let objects = 0;

            scene.traverse((obj) => {
                // Count meshes that are not editor helpers
                if ((obj as THREE.Mesh).isMesh && !obj.userData.isEditorObject && obj.visible) {
                    objects++;
                    const mesh = obj as THREE.Mesh;
                    const geo = mesh.geometry;
                    if (geo) {
                        verts += geo.attributes.position.count;
                        if (geo.index) {
                            tris += geo.index.count / 3;
                        } else {
                            tris += geo.attributes.position.count / 3;
                        }
                    }
                }
            });

            onUpdate({ verts, tris: Math.round(tris), objects });
        }
    });
    return null;
}

// --- Camera Manager Component ---
function CameraManager() {
    const { camera, gl } = useThree();
    const controlsRef = useRef<any>(null);
    const { 
        cameraState, 
        cameraVersion, 
        syncCameraState, 
        activeCameraId,
        sceneObjects,
        updateSceneObject
    } = useAppStore();
    const isSyncingStoreToCamera = useRef(false);

    // 1. Handle Active Camera Initialization (When switching TO a camera)
    useEffect(() => {
        if (activeCameraId) {
            const activeObj = sceneObjects.find(o => o.id === activeCameraId);
            if (activeObj) {
                // IMPORTANT: Directly set camera transform to match object state.
                // This prevents the camera from spawning at 0,0,0 or looking into void.
                camera.position.set(...activeObj.transform.position);
                camera.updateMatrixWorld();

                if (controlsRef.current) {
                    const startPos = new THREE.Vector3(...activeObj.transform.position);
                    const direction = new THREE.Vector3(0, 0, -1);
                    direction.applyEuler(new THREE.Euler(...activeObj.transform.rotation));
                    const target = startPos.clone().add(direction.multiplyScalar(10));
                    
                    controlsRef.current.target.copy(target);
                    controlsRef.current.update();
                }
            }
        }
    }, [activeCameraId, camera]); 

    // 2. Sync Store (UI) -> Scene Camera (Editor Camera only)
    useEffect(() => {
        // If we are looking through a scene camera, we don't sync from cameraState (which is for editor camera)
        if (activeCameraId) return;

        if (isSyncingStoreToCamera.current) return;
        
        // LOOP PREVENTION: Check if update is actually needed
        const targetPos = new THREE.Vector3(...cameraState.position);
        const targetTarget = new THREE.Vector3(...cameraState.target);
        const distPos = camera.position.distanceTo(targetPos);
        const distTarget = controlsRef.current ? controlsRef.current.target.distanceTo(targetTarget) : 0;
        
        // Only update if difference is significant
        if (distPos > 0.01 || distTarget > 0.01) {
            isSyncingStoreToCamera.current = true;
            camera.position.copy(targetPos);
            
            if (camera instanceof THREE.PerspectiveCamera) {
                if (Math.abs(camera.fov - cameraState.fov) > 0.1) {
                    camera.fov = cameraState.fov;
                    camera.updateProjectionMatrix();
                }
            }
            
            if (controlsRef.current) {
                controlsRef.current.target.copy(targetTarget);
                controlsRef.current.update();
            }
            isSyncingStoreToCamera.current = false;
        }
    }, [cameraVersion, activeCameraId, cameraState, camera]); 

    // 3. Sync Scene Controls -> Store
    const handleControlsChange = () => {
        // Prevent update loops
        if (isSyncingStoreToCamera.current) return;

        if (activeCameraId) {
             // Sync OrbitControls changes back to the active Scene Object
             const activeObj = sceneObjects.find(o => o.id === activeCameraId);
             if(!activeObj) return;

             // Extract new transform from the controlled camera
             const pos = camera.position.toArray();
             const rot = [camera.rotation.x, camera.rotation.y, camera.rotation.z];
             
             updateSceneObject(activeCameraId, {
                 transform: {
                     ...activeObj.transform,
                     position: pos as [number, number, number],
                     rotation: rot as [number, number, number]
                 }
             });
        } else {
             // Sync OrbitControls changes back to the Editor Camera State
             if (controlsRef.current) {
                 const pos = camera.position;
                 const target = controlsRef.current.target;
                 
                 syncCameraState({
                     position: [pos.x, pos.y, pos.z],
                     target: [target.x, target.y, target.z],
                     fov: (camera as THREE.PerspectiveCamera).fov
                 });
             }
        }
    };

    return (
        <OrbitControls 
            ref={controlsRef}
            makeDefault 
            minPolarAngle={0} 
            maxPolarAngle={Math.PI} 
            onEnd={handleControlsChange}
        />
    );
}

interface ErrorBoundaryProps {
    children?: ReactNode;
    onReset: () => void;
    modelUrl?: string | null;
}
interface ErrorBoundaryState {
    hasError: boolean;
    error: any;
}

class ModelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("3D Model Parsing Error:", error, errorInfo);
    if (this.props.modelUrl) {
        useGLTF.clear(this.props.modelUrl);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
      if (prevProps.modelUrl !== this.props.modelUrl && this.state.hasError) {
          this.setState({ hasError: false, error: null });
      }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Html center>
           <div className="bg-red-900/90 border border-red-500 p-6 rounded-lg text-white flex flex-col items-center gap-4 backdrop-blur-md shadow-2xl select-none w-64 z-50 pointer-events-none">
              <AlertTriangle size={32} className="text-red-400" />
              <div className="text-center">
                  <div className="font-bold mb-1">Error Loading Object</div>
                  <div className="text-[10px] font-mono opacity-80 break-words text-center mb-2 line-clamp-3">
                      {this.state.error?.message}
                  </div>
              </div>
              <button 
                onClick={(e) => {
                    // Prevent propagation to scene canvas which might deselect
                    e.stopPropagation(); 
                    this.setState({ hasError: false });
                    if (this.props.modelUrl) useGLTF.clear(this.props.modelUrl);
                    this.props.onReset();
                }}
                className="pointer-events-auto px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-xs font-bold w-full flex items-center justify-center gap-2"
              >
                <RefreshCw size={12} /> Remove Object
              </button>
           </div>
        </Html>
      );
    }
    return this.props.children;
  }
}

function ModelLoader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2 text-white bg-black/60 p-6 rounded-xl backdrop-blur-md border border-slate-700 shadow-2xl z-50">
        <Loader2 className="animate-spin text-blue-500" size={30} />
        <div className="text-xs font-bold">{progress.toFixed(0)}%</div>
      </div>
    </Html>
  );
}

// --- Light Component ---

interface LightInstanceProps {
    obj: SceneObject;
    isSelected: boolean;
    transformMode: TransformMode;
    onSelect: (e: any) => void;
    onTransformChange: (t: Partial<ModelTransform>) => void;
}

const LightInstance: React.FC<LightInstanceProps> = ({ obj, isSelected, transformMode, onSelect, onTransformChange }) => {
    const lightRef = useRef<THREE.DirectionalLight>(null!);
    const groupRef = useRef<THREE.Group>(null);
    
    // Visualize the light direction when selected
    useHelper(isSelected ? lightRef : null, DirectionalLightHelper, 1, '#fbbf24');

    useEffect(() => {
        if (groupRef.current) {
            groupRef.current.position.set(...obj.transform.position);
        }
    }, [obj.transform.position]);

    return (
        <>
            {/* Control Group */}
            <group ref={groupRef}>
                {/* 3D Representation of the source - MARKED AS EDITOR OBJECT */}
                <mesh onClick={onSelect} castShadow receiveShadow userData={{ isEditorObject: true }}>
                    <sphereGeometry args={[0.2, 16, 16]} />
                    <meshStandardMaterial 
                        color={obj.lightProps?.color || "#ffffff"} 
                        emissive={obj.lightProps?.color || "#ffffff"}
                        emissiveIntensity={2}
                    />
                </mesh>

                {/* Icon Label (Clickable) - MARKED AS EDITOR OBJECT */}
                <Billboard follow={true} userData={{ isEditorObject: true }}>
                    <mesh onClick={onSelect}>
                        <circleGeometry args={[0.35, 32]} />
                        <meshBasicMaterial color="black" transparent opacity={0.5} />
                    </mesh>
                    <Html position={[0, 0, 0]} center pointerEvents="none" transform={false} zIndexRange={[100, 0]}>
                         <div className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${isSelected ? "text-yellow-400" : "text-white/70"}`}>
                            <Zap size={16} fill="currentColor" />
                         </div>
                    </Html>
                </Billboard>
                
                {/* The actual light */}
                <directionalLight 
                    ref={lightRef}
                    intensity={obj.lightProps?.intensity ?? 1.0}
                    castShadow={obj.lightProps?.castShadow ?? true}
                    color={obj.lightProps?.color || '#ffffff'}
                    shadow-mapSize={[2048, 2048]}
                    target-position={[0, 0, 0]} 
                />
            </group>
            
            {/* Transform Controls */}
            {isSelected && !obj.locked && groupRef.current && (
                <TransformControls
                    object={groupRef.current}
                    mode="translate" 
                    onMouseUp={() => {
                         if (groupRef.current) {
                             onTransformChange({
                                 position: groupRef.current.position.toArray(),
                                 rotation: [0,0,0], 
                                 scale: [1,1,1]
                             });
                         }
                    }}
                />
            )}
        </>
    )
}

// --- Camera Component ---
interface CameraInstanceProps {
    obj: SceneObject;
    isSelected: boolean;
    isActive: boolean;
    transformMode: TransformMode;
    onSelect: (e: any) => void;
    onTransformChange: (t: Partial<ModelTransform>) => void;
}

const CameraInstance: React.FC<CameraInstanceProps> = ({ obj, isSelected, isActive, transformMode, onSelect, onTransformChange }) => {
    const groupRef = useRef<THREE.Group>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera>(null!);
    
    // Helper to visualize frustum, only when selected and NOT active
    useHelper((isSelected && !isActive) ? cameraRef : null, CameraHelper);

    // Sync group transform ONLY if NOT active
    useEffect(() => {
        if (!isActive && groupRef.current) {
            groupRef.current.position.set(...obj.transform.position);
            groupRef.current.rotation.set(...obj.transform.rotation);
        }
    }, [obj.transform.position, obj.transform.rotation, isActive]);

    // If active, we render the camera directly at the root position (controlled by OrbitControls + Props)
    if (isActive) {
        return (
            <PerspectiveCamera 
               makeDefault
               ref={cameraRef}
               fov={obj.cameraProps?.fov || 50}
               near={0.1}
               far={1000}
               // IMPORTANT: We do NOT pass position/rotation here. 
               // CameraManager handles the initial setup, and OrbitControls handles updates.
               // Passing them here causes conflict/reset during re-renders.
            />
        );
    }

    // When inactive, render visualization group
    return (
        <group ref={groupRef}>
            <PerspectiveCamera 
                ref={cameraRef}
                fov={obj.cameraProps?.fov || 50}
                near={0.1}
                far={1000}
                // No rotation here so it aligns with group -Z
            />

            {/* Visual Representation - MARKED AS EDITOR OBJECT */}
            <group onClick={onSelect} rotation={[0, Math.PI, 0]} userData={{ isEditorObject: true }}>
                {/* Camera Body */}
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[0.4, 0.3, 0.2]} />
                    <meshStandardMaterial color="#333" />
                </mesh>
                {/* Lens */}
                <mesh position={[0, 0, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.12, 0.12, 0.2, 16]} />
                    <meshStandardMaterial color="#111" />
                </mesh>
                
                {/* Icon */}
                <Billboard follow={true} position={[0, 0.5, 0]}>
                     <Html position={[0, 0, 0]} center pointerEvents="none" transform={false} zIndexRange={[100, 0]}>
                         <div className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${isSelected ? "text-purple-400" : "text-white/70"}`}>
                            {obj.locked ? <Lock size={14} fill="currentColor"/> : <Video size={16} fill="currentColor" />}
                         </div>
                    </Html>
                </Billboard>
            </group>

             {/* Transform Controls */}
             {isSelected && !obj.locked && groupRef.current && (
                <TransformControls
                    object={groupRef.current}
                    mode={transformMode === 'scale' ? 'translate' : transformMode} 
                    onMouseUp={() => {
                         if (groupRef.current) {
                             onTransformChange({
                                 position: groupRef.current.position.toArray(),
                                 rotation: [groupRef.current.rotation.x, groupRef.current.rotation.y, groupRef.current.rotation.z], 
                                 scale: [1,1,1]
                             });
                         }
                    }}
                />
            )}
        </group>
    )
}


// --- Individual Model Component ---
interface ModelInstanceProps {
    id: string;
    url: string;
    isSelected: boolean;
    locked?: boolean;
    transform: ModelTransform;
    onSelect: (e: any) => void;
    onTransformChange: (t: Partial<ModelTransform>) => void;
    transformMode: TransformMode;
}

function ModelInstance({ id, url, isSelected, locked, transform, onSelect, onTransformChange, transformMode }: ModelInstanceProps) {
  useGLTF.setDecoderPath(DRACO_URL);
  const { scene } = useGLTF(url);
  const clonedScene = useMemo(() => scene.clone(), [scene]);
  const [mesh, setMesh] = useState<THREE.Object3D | null>(null);

  // Apply transform from props to mesh
  useEffect(() => {
    if (mesh) {
        mesh.position.set(...transform.position);
        mesh.rotation.set(...transform.rotation);
        mesh.scale.set(...transform.scale);
    }
  }, [transform, mesh]);

  // Enable shadows
  useEffect(() => {
    clonedScene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [clonedScene]);

  return (
    <>
      {isSelected && !locked && mesh && (
        <TransformControls 
            object={mesh} 
            mode={transformMode}
            onMouseUp={() => {
                if(mesh) {
                    onTransformChange({
                        position: mesh.position.toArray(),
                        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
                        scale: mesh.scale.toArray()
                    });
                }
            }}
        />
      )}
      <primitive 
        object={clonedScene} 
        onClick={onSelect}
        ref={setMesh}
      />
    </>
  );
}

// --- Viewport Capturer with Clean Mode ---
const ViewportCapturer = ({ captureRef }: { captureRef: React.MutableRefObject<any> }) => {
    const { gl, scene, camera } = useThree();
    useEffect(() => {
        captureRef.current = () => {
            // 1. Identification Phase: Find objects to hide (Grid, Helpers, Editor Visuals)
            const hiddenObjects: THREE.Object3D[] = [];
            
            scene.traverse((obj) => {
                if (
                    obj.userData.isEditorObject || // Explicitly marked editor objects
                    obj.name === 'GlobalGrid' || // The named Grid
                    obj.type.includes('Helper') || // Helpers (CameraHelper, etc)
                    obj.name === 'TransformControls' || // Controls
                    (obj as any).isTransformControls // Some implementations of TransformControls
                ) {
                    if (obj.visible) {
                        obj.visible = false;
                        hiddenObjects.push(obj);
                    }
                }
            });

            // 2. Render Phase: Capture the clean scene
            gl.render(scene, camera);
            const dataUrl = gl.domElement.toDataURL('image/png', 1.0);

            // 3. Restoration Phase: Show them again
            hiddenObjects.forEach(obj => obj.visible = true);

            return dataUrl;
        };
    }, [gl, scene, camera, captureRef]);
    return null;
}

const RenderWindow = ({ onClose, onCaptureRequest }: any) => {
    const { addNotification } = useAppStore();
    const [renderResult, setRenderResult] = useState<string | null>(null);
    const [baseImage, setBaseImage] = useState<string | null>(null);
    const [isRendering, setIsRendering] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);

    useEffect(() => {
        if (onCaptureRequest && !baseImage) {
            setBaseImage(onCaptureRequest());
        }
    }, [onCaptureRequest, baseImage]);

    const handleRender = async () => {
        if (!prompt.trim()) addNotification('info', '建议输入提示词以获得更好的风格化效果');
        setIsRendering(true);
        const preset = RESOLUTION_PRESETS[selectedPresetIdx];
        try {
            if (!baseImage) throw new Error("无法获取场景截图");
            const resultUrl = await generateRefinedImage({
                prompt: prompt,
                referenceImage: baseImage,
                aspectRatio: preset.ratio as any
            });
            setRenderResult(resultUrl);
            addNotification('success', 'AI 渲染完成');
        } catch (e: any) {
            console.error(e);
            addNotification('error', `渲染失败: ${e.message}`);
        } finally {
            setIsRendering(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-[900px] h-[600px] bg-[#1e1e1e] border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
                <div className="h-12 bg-[#252526] flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
                    <div className="flex items-center gap-2 text-slate-200 font-bold">
                        <Aperture size={18} className="text-blue-400"/>
                        <span>高级渲染工作台</span>
                        <span className="text-[10px] bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded border border-blue-800">Gemini 2.5 Flash</span>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition"><X size={18}/></button>
                </div>
                <div className="flex-1 flex min-h-0">
                    <div className="flex-1 bg-[#111] relative p-4 flex items-center justify-center border-r border-slate-800">
                         <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(45deg, #222 25%, transparent 25%), linear-gradient(-45deg, #222 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #222 75%), linear-gradient(-45deg, transparent 75%, #222 75%)', backgroundSize: '20px 20px' }} />
                         <div className="relative max-w-full max-h-full shadow-2xl z-10">
                             {renderResult ? (
                                <img src={renderResult} className="max-w-full max-h-full object-contain rounded border border-slate-700" alt="Result" />
                             ) : baseImage ? (
                                <img src={baseImage} className="max-w-full max-h-full object-contain rounded border border-slate-700 opacity-80" alt="Preview" />
                             ) : (
                                <Loader2 className="animate-spin text-slate-500"/>
                             )}
                             {isRendering && (
                                 <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center text-white z-20">
                                     <Loader2 size={40} className="animate-spin text-blue-500 mb-4" />
                                     <div className="font-bold">Gemini 正在计算...</div>
                                 </div>
                             )}
                         </div>
                    </div>
                    <div className="w-80 bg-[#1e1e1e] flex flex-col p-5 gap-6 overflow-y-auto">
                        <div>
                            <label className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-2"><Ratio size={14} /> 输出宽高比</label>
                            <div className="grid grid-cols-2 gap-2">
                                {RESOLUTION_PRESETS.map((preset, idx) => (
                                    <button key={idx} onClick={() => setSelectedPresetIdx(idx)} className={`flex flex-col items-center justify-center p-2 rounded border transition-all ${selectedPresetIdx === idx ? 'bg-blue-600/20 border-blue-500 text-white' : 'bg-[#252526] border-slate-700 text-slate-400'}`}>
                                        <div className="text-xs font-bold mb-0.5">{preset.ratio}</div>
                                        <div className="text-[10px] opacity-70">{preset.label}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-2"><Wand2 size={14} /> 渲染提示词</label>
                            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述期望的风格..." className="w-full h-32 bg-[#111] border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 resize-none" />
                        </div>
                        <div className="mt-auto flex flex-col gap-3">
                            <button onClick={handleRender} disabled={isRendering} className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-lg shadow-lg disabled:opacity-50 flex items-center justify-center gap-2">
                                <Sparkles size={16} /> {isRendering ? '渲染生成中...' : '开始渲染'}
                            </button>
                            {renderResult && (
                                <a href={renderResult} download={`render-${Date.now()}.png`} className="w-full py-2 bg-[#2d2d2d] text-slate-200 font-medium rounded-lg border border-slate-700 flex items-center justify-center gap-2"><Download size={14} /> 保存图片</a>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function SceneViewer() {
  const { 
      sceneObjects, 
      renderSettings, 
      selectedObjectId, 
      setSelectedObjectId, 
      addAsset, 
      updateAsset, 
      addModelToScene, 
      addNotification, 
      updateSelectedObjectTransform, 
      transformMode, 
      removeSceneObject,
      activeCameraId
  } = useAppStore();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRenderWindow, setShowRenderWindow] = useState(false);
  const [stats, setStats] = useState({ verts: 0, tris: 0, objects: 0 });
  const captureRef = useRef<(() => string) | null>(null);

  const handleTextTo3D = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    const newId = uuidv4();
    
    // Placeholder asset
    addAsset({ id: newId, originalName: prompt, imageUrl: "https://placehold.co/100x100/252526/white?text=Tripo+AI", status: AssetStatus.PENDING, modelUrl: null, createdAt: Date.now() });
    
    // Clear input but keep the logic running
    const originalPrompt = prompt;
    setPrompt('');

    try {
        addNotification('info', 'Gemini 3 Flash 正在优化提示词...');
        const optimizedPrompt = await optimizePromptFor3D(originalPrompt);
        
        if (optimizedPrompt !== originalPrompt) {
            console.log("Optimized Prompt:", optimizedPrompt);
            addNotification('success', `提示词已优化: ${optimizedPrompt.slice(0, 30)}...`);
        }

        const taskId = await createTextTo3DTask(optimizedPrompt);
        updateAsset(newId, { status: AssetStatus.PROCESSING });
        
        pollTripoTask(taskId, (status, modelUrl) => {
            updateAsset(newId, { status, modelUrl });
            if (status === AssetStatus.COMPLETED && modelUrl) {
                addNotification('success', '生成成功');
                addModelToScene(modelUrl, originalPrompt);
            } else if (status === AssetStatus.ERROR) {
                addNotification('error', '生成失败');
            }
        });
    } catch (e) {
        updateAsset(newId, { status: AssetStatus.ERROR });
        addNotification('error', '处理请求时发生错误');
    } finally {
        setIsGenerating(false);
    }
  };

  const handleLoadDemo = () => addModelToScene('https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb', 'Damaged Helmet');

  // Handle Drag & Drop from Asset Manager
  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'));
          if (data && data.url) {
              addModelToScene(data.url, data.name || 'Model');
          }
      } catch (err) {
          console.error("Invalid drag data");
      }
  };

  return (
    <div 
        className="flex-1 relative bg-[#1a1a1c] overflow-hidden flex flex-col"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
    >
      <Toolbar />
      
      {/* --- Left Top: Render Button --- */}
      <div className="absolute top-14 left-4 z-10 pointer-events-auto">
         <button onClick={() => setShowRenderWindow(!showRenderWindow)} className="group bg-[#1e1e1e] p-2.5 rounded-lg border border-slate-800 shadow-lg text-slate-400 hover:text-white hover:border-blue-500 hover:shadow-blue-500/20 transition-all flex items-center gap-2">
            <Aperture size={20} className="group-hover:text-blue-400 transition-colors"/>
            <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 text-xs font-bold whitespace-nowrap">渲染出图</span>
         </button>
      </div>

      {/* --- Right Top: Stats & Info --- */}
      <div className="absolute top-14 right-4 z-10 pointer-events-auto flex flex-col items-end gap-2">
          {/* Stats Panel */}
          <div className="bg-[#1e1e1e]/90 backdrop-blur-md border border-slate-700 p-2.5 rounded-lg shadow-xl text-[10px] font-mono text-slate-300 min-w-[140px] flex flex-col gap-1 select-none">
             <div className="flex justify-between items-center border-b border-slate-700/50 pb-1 mb-1 opacity-70">
                 <div className="flex items-center gap-1 font-sans font-bold"><Activity size={10} /> <span>场景统计</span></div>
             </div>
             <div className="flex justify-between items-center">
                 <span className="text-slate-500 flex items-center gap-1"><Layers size={10} /> Obj</span>
                 <span className="text-white font-bold">{stats.objects}</span>
             </div>
             <div className="flex justify-between items-center">
                 <span className="text-slate-500 flex items-center gap-1"><Box size={10} /> Verts</span>
                 <span className="text-blue-400">{stats.verts.toLocaleString()}</span>
             </div>
             <div className="flex justify-between items-center">
                 <span className="text-slate-500 flex items-center gap-1"><Triangle size={10} /> Tris</span>
                 <span className="text-yellow-400">{stats.tris.toLocaleString()}</span>
             </div>
          </div>

          {/* Camera Active Indicator */}
          {activeCameraId && (
              <div className="flex items-center gap-2 bg-red-600/90 text-white px-3 py-1.5 rounded-lg shadow-lg border border-red-500 animate-pulse">
                  <Video size={16} />
                  <span className="text-xs font-bold">正在预览相机视角</span>
              </div>
          )}
      </div>
      
      {showRenderWindow && <RenderWindow onClose={() => setShowRenderWindow(false)} onCaptureRequest={() => captureRef.current ? captureRef.current() : null} />}

      {sceneObjects.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 z-0 pointer-events-none">
              <Box size={80} className="mb-6 opacity-10" />
              <div className="text-xl font-bold mb-2 opacity-60">空场景</div>
              <button onClick={handleLoadDemo} className="pointer-events-auto mt-4 px-6 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-full text-blue-300 text-sm font-medium flex items-center gap-2 transition-all">
                  <Sparkles size={16} /> 添加测试模型
              </button>
          </div>
      )}

      <div className="flex-1 cursor-crosshair relative">
          <Canvas 
            shadows 
            // Camera position is now handled by CameraManager
            camera={{ position: [5, 5, 5], fov: 50, near: 0.1, far: 1000 }} 
            gl={{ preserveDrawingBuffer: true }}
            onPointerMissed={(e) => {
               if (e.type === 'click') setSelectedObjectId(null);
            }}
          >
            <color attach="background" args={['#1a1a1c']} />
            <ViewportCapturer captureRef={captureRef} />
            <SceneStatsUpdater onUpdate={setStats} />
            <CameraManager /> {/* Handles OrbitControls and Camera Sync */}
            
            <ambientLight intensity={0.6} />
            <hemisphereLight intensity={0.6} groundColor="#000000" color="#ffffff" />
            
            <Suspense fallback={<ModelLoader />}>
                <Bounds fit clip={false} observe={false} margin={1.2}>
                    {sceneObjects.map((obj) => {
                        if (obj.type === 'light') {
                             return (
                                <LightInstance 
                                    key={obj.id}
                                    obj={obj}
                                    isSelected={selectedObjectId === obj.id}
                                    transformMode={transformMode}
                                    onSelect={(e) => {
                                        e.stopPropagation();
                                        setSelectedObjectId(obj.id);
                                    }}
                                    onTransformChange={updateSelectedObjectTransform}
                                />
                             )
                        }

                        if (obj.type === 'camera') {
                            return (
                                <CameraInstance
                                    key={obj.id}
                                    obj={obj}
                                    isSelected={selectedObjectId === obj.id}
                                    isActive={activeCameraId === obj.id}
                                    transformMode={transformMode}
                                    onSelect={(e) => {
                                        e.stopPropagation();
                                        setSelectedObjectId(obj.id);
                                    }}
                                    onTransformChange={updateSelectedObjectTransform}
                                />
                            )
                        }

                        // Use URL directly; assuming backend relay is handling CORS headers
                        const safeUrl = obj.url || null;
                        if (!safeUrl) return null;

                        return (
                             <ModelErrorBoundary key={obj.id} onReset={() => removeSceneObject(obj.id)} modelUrl={safeUrl}>
                                <ModelInstance 
                                    id={obj.id}
                                    url={safeUrl}
                                    isSelected={selectedObjectId === obj.id}
                                    locked={obj.locked}
                                    transform={obj.transform}
                                    transformMode={transformMode}
                                    onSelect={(e) => {
                                        e.stopPropagation();
                                        setSelectedObjectId(obj.id);
                                    }}
                                    onTransformChange={updateSelectedObjectTransform}
                                />
                             </ModelErrorBoundary>
                        );
                    })}
                </Bounds>
                <Environment preset="city" /> 
                <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={20} blur={2} far={4} />
            </Suspense>

            {renderSettings.gridVisible && <Grid name="GlobalGrid" infiniteGrid fadeDistance={30} sectionColor="#4f4f4f" cellColor="#2f2f2f" position={[0, -0.01, 0]} />}
            <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
            </GizmoHelper>
          </Canvas>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[600px] max-w-[90%] z-20 pointer-events-auto">
         <div className="bg-[#1e1e1e]/90 backdrop-blur-md border border-slate-700 p-2 rounded-xl shadow-2xl flex gap-2 ring-1 ring-white/5">
            <input 
                type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleTextTo3D()}
                placeholder="输入提示词生成 3D 模型..."
                className="flex-1 bg-black/40 border border-slate-600/50 rounded-lg py-3 px-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-all"
            />
            <button onClick={handleTextTo3D} disabled={isGenerating || !prompt.trim()} className="bg-blue-600 hover:bg-blue-500 text-white px-5 rounded-lg font-medium text-sm flex items-center gap-2 disabled:opacity-50 transition-all">
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} 生成
            </button>
         </div>
      </div>
    </div>
  );
}