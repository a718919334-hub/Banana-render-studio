import React, { Suspense, useEffect, useRef, useState, useMemo, ReactNode, Component } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Grid, TransformControls, Html, useProgress, Bounds, Environment, GizmoHelper, GizmoViewport, ContactShadows, Billboard, useHelper, PerspectiveCamera } from '@react-three/drei';
import { useAppStore } from '../store/useAppStore';
import { Zap, Loader2, Sparkles, AlertTriangle, Box, RefreshCw, Aperture, Ratio, Wand2, ArrowRight, X, Download, Video, Lock, Layers, Triangle, Activity, Maximize2 } from 'lucide-react';
import * as THREE from 'three';
import { DirectionalLightHelper, CameraHelper } from 'three';
import { v4 as uuidv4 } from 'uuid';
import { AssetStatus, ModelTransform, SceneObject, TransformMode } from '../types';
import { createTextTo3DTask, pollTripoTask } from '../services/tripoService';
import { generateRefinedImage, optimizePromptFor3D } from '../services/geminiService';
import Toolbar from './Toolbar';

// Fix for missing React Three Fiber types in strict environments
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      boxGeometry: any;
      circleGeometry: any;
      cylinderGeometry: any;
      directionalLight: any;
      group: any;
      hemisphereLight: any;
      mesh: any;
      meshBasicMaterial: any;
      meshStandardMaterial: any;
      primitive: any;
      sphereGeometry: any;
    }
  }
}

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

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

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
           <div className="bg-[#1f0f0f] border border-red-900 p-6 rounded-lg text-white flex flex-col items-center gap-4 shadow-2xl select-none w-64 z-50 pointer-events-none">
              <AlertTriangle size={32} className="text-red-500" />
              <div className="text-center">
                  <div className="font-bold mb-1">Error Loading Object</div>
                  <div className="text-[10px] font-mono opacity-80 break-words text-center mb-2 line-clamp-3 text-red-200">
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
                className="pointer-events-auto px-4 py-2 bg-red-800 hover:bg-red-700 rounded text-xs font-bold w-full flex items-center justify-center gap-2"
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
      <div className="flex flex-col items-center gap-2 text-white bg-[#09090b] p-6 rounded-2xl border border-white/10 shadow-2xl z-50">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
        <div className="text-xs font-bold tracking-wider">{progress.toFixed(0)}%</div>
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

// 渲染窗口组件 (Render Window Component)
// 这是一个模态对话框，用于处理 AI 渲染请求
const RenderWindow = ({ onClose, onCaptureRequest }: any) => {
    const { addNotification } = useAppStore();
    // 渲染结果图片的 URL (Rendered result image URL)
    const [renderResult, setRenderResult] = useState<string | null>(null);
    // 基础截图 (Base screenshot from the 3D viewport)
    const [baseImage, setBaseImage] = useState<string | null>(null);
    // 渲染状态 (Rendering loading state)
    const [isRendering, setIsRendering] = useState(false);
    // 提示词输入 (Prompt input)
    const [prompt, setPrompt] = useState("");
    // 选中的分辨率预设索引 (Selected resolution/aspect ratio preset index)
    const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);

    // 初始化时获取视口截图 (Capture viewport on mount)
    useEffect(() => {
        if (onCaptureRequest && !baseImage) {
            setBaseImage(onCaptureRequest());
        }
    }, [onCaptureRequest, baseImage]);

    // 处理渲染点击事件 (Handle render button click)
    const handleRender = async () => {
        if (!prompt.trim()) addNotification('info', '建议输入提示词以获得更好的风格化效果');
        setIsRendering(true);
        const preset = RESOLUTION_PRESETS[selectedPresetIdx];
        try {
            if (!baseImage) throw new Error("无法获取场景截图");
            // 调用 Gemini 服务生成精炼图像
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
        // 遮罩层 (Overlay/Backdrop)
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 animate-in fade-in duration-300">
            {/* 对话框主体 (Dialog Body) - Brightened background and border */}
            <div className="w-[900px] h-[600px] bg-[#27272a] border border-white/20 rounded-xl shadow-2xl flex flex-col overflow-hidden relative ring-1 ring-white/10">
                {/* 标题栏 (Header) - Brightened background */}
                <div className="h-14 bg-[#27272a] flex items-center justify-between px-6 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-2 text-white font-bold tracking-wide">
                        <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400"><Aperture size={16}/></div>
                        <span>AI Render Studio</span>
                        <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-bold ml-2">Gemini 2.5 Flash</span>
                    </div>
                    {/* 关闭按钮 (Close Button) */}
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-zinc-400 hover:text-white transition"><X size={18}/></button>
                </div>
                
                {/* 内容区域 (Content Area) */}
                <div className="flex-1 flex min-h-0">
                    {/* 左侧：图片预览区 (Left: Image Preview) */}
                    <div className="flex-1 bg-black relative p-6 flex items-center justify-center">
                         <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at center, #1e1b4b 0%, transparent 70%)' }} />
                         <div className="relative max-w-full max-h-full shadow-lg z-10 rounded-lg overflow-hidden border border-white/10 bg-black">
                             {/* 显示结果或基础截图 (Show Result or Base Image) */}
                             {renderResult ? (
                                <img src={renderResult} className="max-w-full max-h-full object-contain" alt="Result" />
                             ) : baseImage ? (
                                <img src={baseImage} className="max-w-full max-h-full object-contain opacity-80" alt="Preview" />
                             ) : (
                                <Loader2 className="animate-spin text-zinc-600"/>
                             )}
                             
                             {/* 加载中遮罩 (Loading Overlay) */}
                             {isRendering && (
                                 <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-20">
                                     <div className="relative">
                                         <Loader2 size={48} className="relative animate-spin text-indigo-500 mb-4" />
                                     </div>
                                     <div className="font-bold tracking-widest text-sm text-indigo-300">PROCESSING...</div>
                                 </div>
                             )}
                         </div>
                    </div>

                    {/* 右侧：设置面板 (Right: Settings Panel) - Brightened background */}
                    <div className="w-80 bg-[#27272a] border-l border-white/10 flex flex-col p-6 gap-6 overflow-y-auto">
                        {/* 比例选择 (Aspect Ratio Selection) */}
                        <div>
                            <label className="text-xs font-bold text-zinc-300 mb-3 flex items-center gap-2 uppercase tracking-wider"><Ratio size={12} /> Aspect Ratio</label>
                            <div className="grid grid-cols-2 gap-2">
                                {RESOLUTION_PRESETS.map((preset, idx) => (
                                    <button key={idx} onClick={() => setSelectedPresetIdx(idx)} className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${selectedPresetIdx === idx ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300 shadow-sm' : 'bg-[#3f3f46] border-white/5 text-zinc-300 hover:bg-[#52525b] hover:text-white'}`}>
                                        <div className="text-xs font-bold mb-1">{preset.ratio}</div>
                                        <div className="text-[10px] opacity-60">{preset.label}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 提示词输入 (Prompt Input) */}
                        <div className="flex-1">
                            <label className="text-xs font-bold text-zinc-300 mb-3 flex items-center gap-2 uppercase tracking-wider"><Wand2 size={12} /> Prompt</label>
                            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the style (e.g. Cyberpunk, Claymation, Realistic)..." className="w-full h-32 bg-[#18181b] border border-white/10 rounded-lg p-4 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 focus:bg-[#000] resize-none transition-all placeholder:text-zinc-500" />
                        </div>

                        {/* 底部操作按钮 (Action Buttons) */}
                        <div className="mt-auto flex flex-col gap-3">
                            <button onClick={handleRender} disabled={isRendering} className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-900/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-all hover:translate-y-[-1px]">
                                <Sparkles size={16} fill="currentColor" /> {isRendering ? 'Rendering...' : 'Generate Render'}
                            </button>
                            {renderResult && (
                                <a href={renderResult} download={`render-${Date.now()}.png`} className="w-full py-2.5 bg-[#3f3f46] hover:bg-[#52525b] text-zinc-200 font-bold rounded-xl border border-white/10 flex items-center justify-center gap-2 transition-all"><Download size={14} /> Save Image</a>
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
    addAsset({ id: newId, originalName: prompt, imageUrl: "https://placehold.co/100x100/18181b/666?text=Tripo+AI", status: AssetStatus.PENDING, modelUrl: null, createdAt: Date.now() });
    
    // Clear input but keep the logic running
    const originalPrompt = prompt;
    setPrompt('');

    try {
        addNotification('info', 'Optimizing prompt with Gemini...');
        const optimizedPrompt = await optimizePromptFor3D(originalPrompt);
        
        if (optimizedPrompt !== originalPrompt) {
            console.log("Optimized Prompt:", optimizedPrompt);
            addNotification('success', `Optimized: ${optimizedPrompt.slice(0, 30)}...`);
        }

        const taskId = await createTextTo3DTask(optimizedPrompt);
        updateAsset(newId, { status: AssetStatus.PROCESSING });
        
        pollTripoTask(taskId, (status, modelUrl) => {
            updateAsset(newId, { status, modelUrl });
            if (status === AssetStatus.COMPLETED && modelUrl) {
                addNotification('success', 'Model Generated');
                addModelToScene(modelUrl, originalPrompt);
            } else if (status === AssetStatus.ERROR) {
                addNotification('error', 'Generation Failed');
            }
        });
    } catch (e) {
        updateAsset(newId, { status: AssetStatus.ERROR });
        addNotification('error', 'Request Failed');
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
        className="flex-1 relative w-full h-full"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
    >
      <Toolbar />
      
      {/* --- Left Top: Render Button (Dark Grey Layer) --- */}
      <div className="absolute top-20 left-4 z-10 pointer-events-auto">
         <button onClick={() => setShowRenderWindow(!showRenderWindow)} className="group bg-[#18181b] p-3 rounded-2xl border border-white/5 shadow-lg shadow-black/20 text-zinc-300 hover:text-white hover:border-indigo-500/30 transition-all flex items-center gap-3">
            <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                <Aperture size={20} />
            </div>
            <div className="flex flex-col items-start">
                <span className="text-xs font-bold tracking-wide">AI RENDER</span>
                <span className="text-[9px] opacity-60 font-medium">VISUALIZE</span>
            </div>
         </button>
      </div>

      {/* --- Right Top: Stats & Info (Dark Grey Layer) --- */}
      <div className="absolute top-20 right-4 z-10 pointer-events-auto flex flex-col items-end gap-3">
          {/* Stats Panel */}
          <div className="bg-[#18181b] border border-white/5 p-4 rounded-2xl shadow-lg shadow-black/20 text-[10px] font-mono text-zinc-400 min-w-[160px] flex flex-col gap-2 select-none group hover:border-white/10 transition-colors">
             <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-1 opacity-80">
                 <div className="flex items-center gap-1.5 font-sans font-bold tracking-wider text-zinc-300"><Activity size={12} className="text-emerald-500" /> STATISTICS</div>
             </div>
             <div className="flex justify-between items-center">
                 <span className="text-zinc-500 flex items-center gap-1.5"><Layers size={12} /> Objects</span>
                 <span className="text-zinc-300 font-bold">{stats.objects}</span>
             </div>
             <div className="flex justify-between items-center">
                 <span className="text-zinc-500 flex items-center gap-1.5"><Box size={12} /> Vertices</span>
                 <span className="text-blue-500">{stats.verts.toLocaleString()}</span>
             </div>
             <div className="flex justify-between items-center">
                 <span className="text-zinc-500 flex items-center gap-1.5"><Triangle size={12} /> Triangles</span>
                 <span className="text-orange-500">{stats.tris.toLocaleString()}</span>
             </div>
          </div>

          {/* Camera Active Indicator */}
          {activeCameraId && (
              <div className="flex items-center gap-3 bg-red-900/80 text-white px-4 py-2.5 rounded-xl shadow-lg border border-red-500/50 animate-pulse">
                  <Video size={16} fill="currentColor" />
                  <span className="text-xs font-bold tracking-wide">REC • CAMERA VIEW</span>
              </div>
          )}
      </div>
      
      {showRenderWindow && <RenderWindow onClose={() => setShowRenderWindow(false)} onCaptureRequest={() => captureRef.current ? captureRef.current() : null} />}

      {sceneObjects.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 z-0 pointer-events-none">
              <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 border border-white/5 animate-pulse">
                  <Box size={40} className="opacity-20 text-white" />
              </div>
              <div className="text-2xl font-bold mb-2 text-white/10 tracking-tight">Scene Empty</div>
              <div className="text-sm opacity-50 mb-6 text-white/30">Drag and drop assets or create new ones</div>
              <button onClick={handleLoadDemo} className="pointer-events-auto px-6 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-full text-indigo-300 text-sm font-bold flex items-center gap-2 transition-all hover:scale-105">
                  <Sparkles size={16} /> Load Demo Asset
              </button>
          </div>
      )}

      <div className="flex-1 cursor-crosshair relative w-full h-full">
          <Canvas 
            shadows 
            // Camera position is now handled by CameraManager
            camera={{ position: [5, 5, 5], fov: 50, near: 0.1, far: 1000 }} 
            gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
            onPointerMissed={(e) => {
               if (e.type === 'click') setSelectedObjectId(null);
            }}
          >
            <ViewportCapturer captureRef={captureRef} />
            <SceneStatsUpdater onUpdate={setStats} />
            <CameraManager /> {/* Handles OrbitControls and Camera Sync */}
            
            <ambientLight intensity={0.4} />
            <hemisphereLight intensity={0.5} groundColor="#000000" color="#333333" />
            
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
                <Environment preset="city" blur={0.8} background={false} /> 
                <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={20} blur={2.5} far={4} color="#000000" />
            </Suspense>

            {renderSettings.gridVisible && <Grid name="GlobalGrid" infiniteGrid fadeDistance={30} sectionColor="#4f4f4f" cellColor="#1a1a1a" position={[0, -0.01, 0]} />}
            <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                <GizmoViewport axisColors={['#f43f5e', '#10b981', '#3b82f6']} labelColor="white" />
            </GizmoHelper>
          </Canvas>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[600px] max-w-[90%] z-20 pointer-events-auto">
         <div className="bg-[#18181b] border border-white/5 p-2 rounded-2xl shadow-lg shadow-black/50 flex gap-3 ring-1 ring-white/5 transition-all focus-within:ring-indigo-500/50 focus-within:border-indigo-500/50">
            <input 
                type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleTextTo3D()}
                placeholder="Describe a 3D object to generate..."
                className="flex-1 bg-transparent border-none py-3 px-4 text-sm text-zinc-200 focus:outline-none placeholder:text-zinc-500 font-medium"
            />
            <button onClick={handleTextTo3D} disabled={isGenerating || !prompt.trim()} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50 transition-all shadow-lg shadow-indigo-900/30">
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} fill="currentColor" />}
                Generate
            </button>
         </div>
      </div>
    </div>
  );
}