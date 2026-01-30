import React, { Suspense, useEffect, useRef, useState, useMemo, ReactNode, Component } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Grid, TransformControls, Html, useProgress, Environment, GizmoHelper, GizmoViewport, ContactShadows, Billboard, useHelper, PerspectiveCamera } from '@react-three/drei';
import { useAppStore } from '../store/useAppStore';
import { Zap, Loader2, Sparkles, AlertTriangle, Box, RefreshCw, Aperture, Ratio, Wand2, X, Download, Video, Lock, Layers, Triangle, Activity, MapPin, Lightbulb, ArrowRight } from 'lucide-react';
import * as THREE from 'three';
import { DirectionalLightHelper, CameraHelper } from 'three';
import { v4 as uuidv4 } from 'uuid';
import { AssetStatus, ModelTransform, SceneObject, TransformMode } from '../types';
import { createTextTo3DTask, pollTripoTask } from '../services/tripoService';
import { generateRefinedImage, optimizePromptFor3D, analyzeSceneAndSuggestPrompts } from '../services/geminiService';
import Toolbar from './Toolbar';

// Fix for missing React Three Fiber types in strict environments
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      sphereGeometry: any;
      meshStandardMaterial: any;
      meshBasicMaterial: any;
      circleGeometry: any;
      directionalLight: any;
      primitive: any;
      ambientLight: any;
      hemisphereLight: any;
      boxGeometry: any;
      cylinderGeometry: any;
      orthographicCamera: any; // Add this definition
      [elemName: string]: any;
    }
  }
}

// CONSTANTS
const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
const DEFAULT_WORKER_URL = "https://soft-wave-9c83.a718919334.workers.dev";

const RESOLUTION_PRESETS = [
    { label: 'Square (1:1)', w: 1024, h: 1024, ratio: "1:1", icon: 'square' },
    { label: 'Landscape (16:9)', w: 1920, h: 1080, ratio: "16:9", icon: 'rectangle-horizontal' },
    { label: 'Portrait (9:16)', w: 1080, h: 1920, ratio: "9:16", icon: 'rectangle-vertical' },
    { label: 'Standard (4:3)', w: 1024, h: 768, ratio: "4:3", icon: 'monitor' },
];

// IMPORTANT: Configure Draco Loader globally once to avoid re-initialization loops
useGLTF.setDecoderPath(DRACO_URL);

// --- Scene Stats Component ---
function SceneStatsUpdater({ onUpdate }: { onUpdate: (stats: { verts: number, tris: number, objects: number }) => void }) {
    const { scene } = useThree();
    const lastUpdate = useRef(0);
    const lastStatsRef = useRef({ verts: 0, tris: 0, objects: 0 });

    useFrame(({ clock }) => {
        // Throttled update (500ms) to prevent performance impact
        if (clock.elapsedTime - lastUpdate.current > 0.5) {
            lastUpdate.current = clock.elapsedTime;
            
            let verts = 0;
            let tris = 0;
            let objects = 0;

            try {
                if (scene) {
                    scene.traverse((obj) => {
                        // Safety check: ensure obj exists and is a Mesh
                        // Filter out editor helpers to count only "real" scene objects
                        if (obj && obj instanceof THREE.Mesh && !obj.userData.isEditorObject && obj.visible) {
                            objects++;
                            const geo = obj.geometry;
                            if (geo) {
                                verts += geo.attributes.position ? geo.attributes.position.count : 0;
                                if (geo.index) {
                                    tris += geo.index.count / 3;
                                } else if (geo.attributes.position) {
                                    tris += geo.attributes.position.count / 3;
                                }
                            }
                        }
                    });
                }
            } catch(e) {
                // Ignore traversal errors silently to avoid potential error loops
            }

            if (lastStatsRef.current.objects !== objects || 
                Math.abs(lastStatsRef.current.verts - verts) > 100) {
                
                const newStats = { verts, tris: Math.round(tris), objects };
                lastStatsRef.current = newStats;
                onUpdate(newStats);
            }
        }
    });
    return null;
}

// --- Camera Manager Component ---
function CameraManager() {
    const { camera, gl } = useThree();
    const controlsRef = useRef<any>(null);
    
    // Select specific slices to prevent unnecessary re-renders of CameraManager
    const cameraState = useAppStore(state => state.cameraState);
    const cameraVersion = useAppStore(state => state.cameraVersion);
    const activeCameraId = useAppStore(state => state.activeCameraId);
    
    // Optimized: Only re-render if the ACTIVE camera object changes
    const activeCameraObj = useAppStore(state => 
        state.activeCameraId 
        ? state.sceneObjects.find(o => o.id === state.activeCameraId) 
        : undefined
    );
    
    const syncCameraState = useAppStore(state => state.syncCameraState);
    const updateSceneObject = useAppStore(state => state.updateSceneObject);

    const isSyncingStoreToCamera = useRef(false);
    const isTransitioning = useRef(false);
    const prevActiveCameraId = useRef(activeCameraId);

    // Detect transition from Camera Mode -> Editor Mode
    useEffect(() => {
        if (prevActiveCameraId.current && !activeCameraId) {
            isTransitioning.current = true;
        }
        prevActiveCameraId.current = activeCameraId;
    }, [activeCameraId]);

    // 1. Handle Active Camera Initialization (When switching TO a camera)
    useEffect(() => {
        if (activeCameraObj) {
            camera.position.set(...activeCameraObj.transform.position);
            camera.updateMatrixWorld();

            if (controlsRef.current) {
                const startPos = new THREE.Vector3(...activeCameraObj.transform.position);
                const direction = new THREE.Vector3(0, 0, -1);
                direction.applyEuler(new THREE.Euler(...activeCameraObj.transform.rotation));
                const target = startPos.clone().add(direction.multiplyScalar(10));
                
                controlsRef.current.target.copy(target);
                controlsRef.current.update();
            }
        }
    }, [activeCameraId, camera]); 

    // 2. Sync Store (UI) -> Scene Camera (Editor Camera only)
    useEffect(() => {
        if (activeCameraId) return; 
        if (isSyncingStoreToCamera.current) return;
        
        const targetPos = new THREE.Vector3(...cameraState.position);
        const targetTarget = new THREE.Vector3(...cameraState.target);
        
        const distPos = camera.position.distanceTo(targetPos);
        const distTarget = controlsRef.current ? controlsRef.current.target.distanceTo(targetTarget) : 0;
        
        // Restore state if transitioning or drifted
        if (isTransitioning.current || distPos > 0.05 || distTarget > 0.05) {
            isSyncingStoreToCamera.current = true;
            
            camera.position.copy(targetPos);
            camera.updateMatrixWorld();
            
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

            setTimeout(() => {
                isSyncingStoreToCamera.current = false;
                isTransitioning.current = false;
            }, 50);
        }
    }, [cameraVersion, activeCameraId, cameraState, camera]); 

    // 3. Sync Scene Controls -> Store
    const handleControlsChange = () => {
        if (isSyncingStoreToCamera.current) return;
        if (isTransitioning.current) return;

        if (activeCameraId) {
             if(!activeCameraObj) return;

             const pos = camera.position.toArray();
             const rot = [camera.rotation.x, camera.rotation.y, camera.rotation.z];
             
             const oldPos = new THREE.Vector3(...activeCameraObj.transform.position);
             // More aggressive delta check to avoid loop
             if (oldPos.distanceTo(camera.position) < 0.05) return;

             updateSceneObject(activeCameraId, {
                 transform: {
                     ...activeCameraObj.transform,
                     position: pos as [number, number, number],
                     rotation: rot as [number, number, number]
                 }
             });
        } else {
             if (controlsRef.current) {
                 const pos = camera.position;
                 const target = controlsRef.current.target;
                 
                 const oldPos = new THREE.Vector3(...cameraState.position);
                 const oldTarget = new THREE.Vector3(...cameraState.target);
                 
                 if (oldPos.distanceTo(pos) < 0.05 && oldTarget.distanceTo(target) < 0.05) return;
                 
                 if (pos.lengthSq() === 0 && target.lengthSq() === 0) return;

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
            enableDamping={false}
        />
    );
}

interface ErrorBoundaryProps {
    children?: ReactNode;
    onReset: () => void;
    modelUrl?: string | null;
    key?: any;
}
interface ErrorBoundaryState {
    hasError: boolean;
    error: any;
}

class ModelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  props: ErrorBoundaryProps;
  setState: any;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    // Avoid console logging error objects that might be huge
    console.error("3D Model Parsing Error Message:", error.message);
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
           <div className="bg-[#1f0f0f] border border-red-900 p-6 rounded-lg text-white flex flex-col items-center gap-4 shadow-2xl select-none w-64 z-50 pointer-events-none animate-pop-in">
              <AlertTriangle size={32} className="text-red-500" />
              <div className="text-center">
                  <div className="font-bold mb-1">Error Loading Object</div>
                  <div className="text-[10px] font-mono opacity-80 break-words text-center mb-2 line-clamp-3 text-red-200">
                      {this.state.error?.message}
                  </div>
              </div>
              <button 
                onClick={(e) => {
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
      <div className="flex flex-col items-center gap-2 text-white bg-[#09090b]/80 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl z-50 animate-pop-in">
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
    
    // Only show helper if selected AND visible
    useHelper((isSelected && obj.visible) ? lightRef : null, DirectionalLightHelper, 1, '#fbbf24');

    useEffect(() => {
        if (groupRef.current) {
            groupRef.current.position.set(...obj.transform.position);
        }
    }, [obj.transform.position]);

    return (
        <>
            <group ref={groupRef} visible={obj.visible}>
                <mesh onClick={onSelect} castShadow receiveShadow userData={{ isEditorObject: true }}>
                    <sphereGeometry args={[0.2, 16, 16]} />
                    <meshStandardMaterial 
                        color={obj.lightProps?.color || "#ffffff"} 
                        emissive={obj.lightProps?.color || "#ffffff"}
                        emissiveIntensity={2}
                    />
                </mesh>

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
                
                <directionalLight 
                    ref={lightRef}
                    intensity={obj.lightProps?.intensity ?? 1.0}
                    castShadow={obj.lightProps?.castShadow ?? true}
                    color={obj.lightProps?.color || '#ffffff'}
                    shadow-mapSize={[2048, 2048]}
                    target-position={[0, 0, 0]} 
                    shadow-bias={-0.0005} // Optimization: Reduce shadow acne
                >
                    {/* Optimization: Ensure shadow camera covers typical scene bounds */}
                    <orthographicCamera attach="shadow-camera" args={[-15, 15, 15, -15, 0.1, 100]} />
                </directionalLight>
            </group>
            
            {isSelected && !obj.locked && obj.visible && groupRef.current && (
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
    
    useHelper((isSelected && !isActive && obj.visible) ? cameraRef : null, CameraHelper);

    useEffect(() => {
        if (!isActive && groupRef.current) {
            groupRef.current.position.set(...obj.transform.position);
            groupRef.current.rotation.set(...obj.transform.rotation);
        }
    }, [obj.transform.position, obj.transform.rotation, isActive]);

    if (isActive) {
        return (
            <PerspectiveCamera 
               makeDefault
               ref={cameraRef}
               fov={obj.cameraProps?.fov || 50}
               near={0.1}
               far={1000}
            />
        );
    }

    return (
        <group ref={groupRef} visible={obj.visible}>
            <PerspectiveCamera 
                ref={cameraRef}
                fov={obj.cameraProps?.fov || 50}
                near={0.1}
                far={1000}
            />

            <group onClick={onSelect} rotation={[0, Math.PI, 0]} userData={{ isEditorObject: true }}>
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[0.4, 0.3, 0.2]} />
                    <meshStandardMaterial color="#333" />
                </mesh>
                <mesh position={[0, 0, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.12, 0.12, 0.2, 16]} />
                    <meshStandardMaterial color="#111" />
                </mesh>
                
                <Billboard follow={true} position={[0, 0.5, 0]}>
                     <Html position={[0, 0, 0]} center pointerEvents="none" transform={false} zIndexRange={[100, 0]}>
                         <div className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${isSelected ? "text-purple-400" : "text-white/70"}`}>
                            {obj.locked ? <Lock size={14} fill="currentColor"/> : <Video size={16} fill="currentColor" />}
                         </div>
                    </Html>
                </Billboard>
            </group>

             {isSelected && !obj.locked && obj.visible && groupRef.current && (
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
    visible?: boolean;
    transform: ModelTransform;
    onSelect: (e: any) => void;
    onTransformChange: (t: Partial<ModelTransform>) => void;
    transformMode: TransformMode;
}

function ModelInstance({ id, url, isSelected, locked, visible = true, transform, onSelect, onTransformChange, transformMode }: ModelInstanceProps) {
  // Use the backend store to get the worker URL, but fallback to constant if empty
  const storeBackendUrl = useAppStore(state => state.backendUrl);
  const WORKER_URL = storeBackendUrl || DEFAULT_WORKER_URL;
  
  // CORE FIX: Robust Proxy Logic to handle CORS
  // 1. Local Blobs/Data URIs -> Use directly
  // 2. Already proxied URLs -> Use directly (prevent double wrapping)
  // 3. Remote URLs -> Wrap in Worker Proxy
  const processedUrl = useMemo(() => {
    if (!url) return null;
    
    // Check for local file
    if (url.startsWith('blob:') || url.startsWith('data:')) {
        return url;
    }
    
    // Check if already proxied to avoid loops or double encoding
    if (url.includes('/proxy?url=')) {
        return url;
    }

    // Construct Proxy URL
    const cleanBase = WORKER_URL.replace(/\/+$/, '');
    return `${cleanBase}/proxy?url=${encodeURIComponent(url)}`;
  }, [url, WORKER_URL]);

  // IMPORTANT: Pass 'true' as the second argument to useGLTF to enable Draco compression support
  // This is critical for Tripo3D models which are often compressed.
  const { scene } = useGLTF(processedUrl || "", true);
  
  const clonedScene = useMemo(() => (scene ? scene.clone() : null), [scene]);
  const [mesh, setMesh] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    if (mesh) {
        mesh.position.set(...transform.position);
        mesh.rotation.set(...transform.rotation);
        mesh.scale.set(...transform.scale);
    }
  }, [transform, mesh]);

  useEffect(() => {
    if (clonedScene) {
        clonedScene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
        }
        });
    }
  }, [clonedScene]);

  // Safety check: if URL processing failed, don't render primitive
  if (!processedUrl) return null;

  return (
    <>
      {isSelected && !locked && visible && mesh && (
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
        visible={visible}
      />
    </>
  );
}

const ViewportCapturer = ({ captureRef }: { captureRef: React.MutableRefObject<any> }) => {
    const { gl, scene, camera } = useThree();
    useEffect(() => {
        captureRef.current = () => {
            const hiddenObjects: THREE.Object3D[] = [];
            
            scene.traverse((obj) => {
                if (
                    obj.userData.isEditorObject || 
                    obj.name === 'GlobalGrid' || 
                    obj.type.includes('Helper') || 
                    obj.name === 'TransformControls' || 
                    (obj as any).isTransformControls 
                ) {
                    if (obj.visible) {
                        obj.visible = false;
                        hiddenObjects.push(obj);
                    }
                }
            });

            gl.render(scene, camera);
            const dataUrl = gl.domElement.toDataURL('image/png', 1.0);

            hiddenObjects.forEach(obj => obj.visible = true);

            return dataUrl;
        };
    }, [gl, scene, camera, captureRef]);
    return null;
}

const RenderWindow = ({ onClose, onCaptureRequest }: any) => {
    const addNotification = useAppStore(state => state.addNotification);
    const activeCameraId = useAppStore(state => state.activeCameraId);
    const sceneObjects = useAppStore(state => state.sceneObjects);
    const cameraState = useAppStore(state => state.cameraState);
    
    const [renderResult, setRenderResult] = useState<string | null>(null);
    const [baseImage, setBaseImage] = useState<string | null>(null);
    const [isRendering, setIsRendering] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);

    // AI Suggestions State
    const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Dynamic Camera Data for display
    const [camDisplayInfo, setCamDisplayInfo] = useState({
        fov: 50,
        pos: "",
        rot: ""
    });

    useEffect(() => {
        if (onCaptureRequest && !baseImage) {
            setBaseImage(onCaptureRequest());
        }
    }, [onCaptureRequest, baseImage]);

    // TRIGGER ANALYSIS ON OPEN
    useEffect(() => {
        if (baseImage && !renderResult) {
            setIsAnalyzing(true);
            analyzeSceneAndSuggestPrompts(baseImage)
                .then(prompts => setSuggestedPrompts(prompts))
                .catch(err => console.error(err))
                .finally(() => setIsAnalyzing(false));
        }
    }, [baseImage]);

    // Update camera display info on mount and when states change
    useEffect(() => {
        let f = cameraState.fov;
        let p = `[${cameraState.position.map(n=>n.toFixed(1)).join(', ')}]`;
        let r = `LookAt [${cameraState.target.map(n=>n.toFixed(1)).join(', ')}]`;

        if (activeCameraId) {
            const cam = sceneObjects.find(o => o.id === activeCameraId);
            if (cam) {
                if (cam.cameraProps) f = cam.cameraProps.fov;
                p = `[${cam.transform.position.map(n=>n.toFixed(1)).join(', ')}]`;
                r = `Rot [${cam.transform.rotation.map(n=>n.toFixed(1)).join(', ')}]`;
            }
        }
        setCamDisplayInfo({ fov: f, pos: p, rot: r });
    }, [cameraState, activeCameraId, sceneObjects]);


    const handleRender = async () => {
        if (!prompt.trim()) addNotification('info', '建议输入提示词以获得更好的风格化效果');
        setIsRendering(true);
        const preset = RESOLUTION_PRESETS[selectedPresetIdx];
        
        // Final calculation for prompt & lighting
        const camInfoStr = `Position: ${camDisplayInfo.pos}, Orientation: ${camDisplayInfo.rot}`;
        
        // Extract Light Information
        const activeLights = sceneObjects.filter(obj => obj.type === 'light' && obj.visible);
        let lightingInfoStr = "";
        
        if (activeLights.length > 0) {
            lightingInfoStr = activeLights.map((l, i) => {
                 const pos = l.transform.position.map(n => n.toFixed(1)).join(', ');
                 const color = l.lightProps?.color || '#ffffff';
                 const intensity = l.lightProps?.intensity || 1.0;
                 return `Source ${i+1}: Directional Light positioned at coordinates (${pos}). Color: ${color}. Intensity: ${intensity}.`;
            }).join('\n');
        } else {
            lightingInfoStr = "Standard environment lighting.";
        }

        try {
            if (!baseImage) throw new Error("无法获取场景截图");
            const resultUrl = await generateRefinedImage({
                prompt: prompt,
                referenceImage: baseImage,
                aspectRatio: preset.ratio as any,
                fov: camDisplayInfo.fov,
                cameraInfo: camInfoStr,
                lightingInfo: lightingInfoStr // Pass lighting info to Gemini
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in-up duration-300">
            <div className="w-[1024px] h-[700px] bg-[#27272a] border border-white/20 rounded-xl shadow-2xl flex flex-col overflow-hidden relative ring-1 ring-white/10 animate-pop-in">
                <div className="h-14 bg-[#27272a] flex items-center justify-between px-6 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-2 text-white font-bold tracking-wide">
                        <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400"><Aperture size={16}/></div>
                        <span>AI Render Studio</span>
                        <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-bold ml-2">Gemini 2.5 Flash</span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-zinc-400 hover:text-white transition-all duration-200 hover:rotate-90"><X size={18}/></button>
                </div>
                
                <div className="flex-1 flex min-h-0">
                    <div className="flex-1 bg-black relative p-6 flex items-center justify-center">
                         <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at center, #1e1b4b 0%, transparent 70%)' }} />
                         <div className="relative max-w-full max-h-full shadow-lg z-10 rounded-lg overflow-hidden border border-white/10 bg-black transition-all duration-500">
                             {renderResult ? (
                                <img src={renderResult} className="max-w-full max-h-full object-contain animate-fade-in-up" alt="Result" />
                             ) : baseImage ? (
                                <img src={baseImage} className="max-w-full max-h-full object-contain opacity-80" alt="Preview" />
                             ) : (
                                <Loader2 className="animate-spin text-zinc-600"/>
                             )}
                             
                             {isRendering && (
                                 <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white z-20 animate-fade-in-up">
                                     <div className="relative">
                                         <Loader2 size={48} className="relative animate-spin text-indigo-500 mb-4" />
                                     </div>
                                     <div className="font-bold tracking-widest text-sm text-indigo-300 animate-pulse">PROCESSING...</div>
                                 </div>
                             )}
                         </div>
                    </div>

                    <div className="w-[440px] bg-[#27272a] border-l border-white/10 flex flex-col p-6 gap-6 overflow-y-auto">
                        
                        {/* Camera Context Display */}
                        <div className="p-3 bg-black/20 rounded-lg border border-white/5 animate-slide-in-right stagger-1">
                            <label className="text-[10px] font-bold text-zinc-500 mb-2 flex items-center gap-2 uppercase tracking-wider">
                                <MapPin size={10} /> Camera Context
                            </label>
                            <div className="grid grid-cols-2 gap-y-1 text-[10px] font-mono text-zinc-300">
                                <span className="text-zinc-500">Mode:</span>
                                <span className="text-indigo-400 font-bold">{activeCameraId ? "Scene Camera" : "Editor View"}</span>
                                
                                <span className="text-zinc-500">FOV:</span>
                                <span>{camDisplayInfo.fov.toFixed(0)}°</span>
                                
                                <span className="text-zinc-500">Pos:</span>
                                <span className="truncate" title={camDisplayInfo.pos}>{camDisplayInfo.pos}</span>
                                
                                <span className="text-zinc-500">Dir:</span>
                                <span className="truncate" title={camDisplayInfo.rot}>{camDisplayInfo.rot}</span>
                            </div>
                        </div>

                         {/* Scene Lighting Display */}
                         <div className="p-3 bg-black/20 rounded-lg border border-white/5 animate-slide-in-right stagger-1 mt-2">
                            <label className="text-[10px] font-bold text-zinc-500 mb-2 flex items-center gap-2 uppercase tracking-wider">
                                <Zap size={10} /> Scene Lighting
                            </label>
                            <div className="text-[10px] font-mono text-zinc-300">
                                {sceneObjects.filter(o => o.type === 'light' && o.visible).length > 0 ? (
                                    <div className="flex flex-col gap-1">
                                        {sceneObjects.filter(o => o.type === 'light' && o.visible).map((l, i) => (
                                            <div key={l.id} className="flex justify-between items-center bg-white/5 px-2 py-1 rounded">
                                                <span>Light {i+1}</span>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full" style={{backgroundColor: l.lightProps?.color || '#fff'}}></div>
                                                    <span className="text-zinc-500">{l.lightProps?.intensity.toFixed(1)}x</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-zinc-600 italic">Default Environment</span>
                                )}
                            </div>
                        </div>

                        {/* Aspect Ratio */}
                        <div className="animate-slide-in-right stagger-2">
                            <label className="text-xs font-bold text-zinc-300 mb-3 flex items-center gap-2 uppercase tracking-wider"><Ratio size={12} /> Aspect Ratio</label>
                            <div className="grid grid-cols-2 gap-2">
                                {RESOLUTION_PRESETS.map((preset, idx) => (
                                    <button key={idx} onClick={() => setSelectedPresetIdx(idx)} className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all duration-300 ease-silky hover:scale-[1.02] active:scale-[0.98] ${selectedPresetIdx === idx ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300 shadow-sm' : 'bg-[#3f3f46] border-white/5 text-zinc-300 hover:bg-[#52525b] hover:text-white'}`}>
                                        <div className="text-xs font-bold mb-1">{preset.ratio}</div>
                                        <div className="text-[10px] opacity-60">{preset.label}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Prompt & AI Suggestions Area (Side by Side) */}
                        <div className="flex-1 flex flex-col min-h-0 animate-slide-in-right stagger-3">
                             <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-zinc-300 flex items-center gap-2 uppercase tracking-wider"><Wand2 size={12} /> Prompt</label>
                                {isAnalyzing && <span className="text-[10px] text-zinc-500 animate-pulse flex items-center gap-1"><Loader2 size={10} className="animate-spin"/> Analyzing Scene...</span>}
                             </div>

                             <div className="flex gap-3 h-48">
                                 {/* Prompt Input */}
                                 <textarea 
                                    value={prompt} 
                                    onChange={(e) => setPrompt(e.target.value)} 
                                    placeholder="Describe the style (e.g. Cyberpunk, Claymation, Realistic)..." 
                                    className="flex-1 bg-[#18181b] border border-white/10 rounded-lg p-3 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 focus:bg-[#000] resize-none transition-all duration-300 placeholder:text-zinc-600 h-full focus:shadow-[0_0_15px_rgba(99,102,241,0.1)]" 
                                />

                                 {/* Suggestions List (Right Side) */}
                                 <div className="w-40 flex flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar">
                                     <div className="sticky top-0 bg-[#27272a] pb-1 z-10">
                                         <label className="text-[10px] font-bold text-zinc-500 flex items-center gap-1 uppercase tracking-wider">
                                             <Lightbulb size={10} className="text-yellow-500" /> Ideas
                                         </label>
                                     </div>
                                     
                                     {isAnalyzing && suggestedPrompts.length === 0 ? (
                                         [1, 2, 3].map(i => <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse shrink-0" />)
                                     ) : (
                                        suggestedPrompts.length > 0 ? suggestedPrompts.map((s, i) => (
                                             <button 
                                                 key={i}
                                                 onClick={() => setPrompt(s)}
                                                 className="text-left text-[10px] p-2 bg-[#18181b] border border-white/5 hover:border-indigo-500/50 hover:bg-indigo-500/10 rounded-lg text-zinc-400 hover:text-indigo-200 transition-all duration-200 leading-tight shrink-0 group relative hover:scale-[1.02]"
                                                 title={s}
                                             >
                                                 <span className="line-clamp-3 group-hover:line-clamp-none transition-all">{s}</span>
                                                 <div className="absolute right-1 bottom-1 opacity-0 group-hover:opacity-100 text-indigo-400 transition-opacity">
                                                     <ArrowRight size={8} />
                                                 </div>
                                             </button>
                                         )) : (
                                            <div className="text-[10px] text-zinc-600 italic text-center py-4 border border-dashed border-white/5 rounded-lg">
                                                No suggestions
                                            </div>
                                         )
                                     )}
                                 </div>
                             </div>
                        </div>

                        <div className="mt-auto flex flex-col gap-3 pt-4 border-t border-white/5 animate-slide-in-right stagger-4">
                            <button onClick={handleRender} disabled={isRendering} className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-900/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]">
                                <Sparkles size={16} fill="currentColor" /> {isRendering ? 'Rendering...' : 'Generate Render'}
                            </button>
                            {renderResult && (
                                <a href={renderResult} download={`render-${Date.now()}.png`} className="w-full py-2.5 bg-[#3f3f46] hover:bg-[#52525b] text-zinc-200 font-bold rounded-xl border border-white/10 flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"><Download size={14} /> Save Image</a>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function SceneViewer() {
  // Use Selectors for granular subscription to store
  // Prevents re-render on unrelated changes (e.g. Asset status updates)
  const sceneObjects = useAppStore(state => state.sceneObjects);
  const renderSettings = useAppStore(state => state.renderSettings);
  const selectedObjectId = useAppStore(state => state.selectedObjectId);
  const transformMode = useAppStore(state => state.transformMode);
  const activeCameraId = useAppStore(state => state.activeCameraId);
  
  // Actions are stable, but good practice to select them or use `useAppStore.getState()` if pure
  const setSelectedObjectId = useAppStore(state => state.setSelectedObjectId);
  const updateSelectedObjectTransform = useAppStore(state => state.updateSelectedObjectTransform);
  const removeSceneObject = useAppStore(state => state.removeSceneObject);
  const addAsset = useAppStore(state => state.addAsset);
  const updateAsset = useAppStore(state => state.updateAsset);
  const addModelToScene = useAppStore(state => state.addModelToScene);
  const addNotification = useAppStore(state => state.addNotification);

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [showRenderWindow, setShowRenderWindow] = useState(false);
  const [stats, setStats] = useState({ verts: 0, tris: 0, objects: 0 });
  const captureRef = useRef<(() => string) | null>(null);

  const handleTextTo3D = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setProgress(0);
    setStatusText('Initializing...');

    const newId = uuidv4();
    
    addAsset({ id: newId, originalName: prompt, imageUrl: "https://placehold.co/100x100/18181b/666?text=Tripo+AI", status: AssetStatus.PENDING, modelUrl: null, createdAt: Date.now() });
    
    const originalPrompt = prompt;
    setPrompt('');

    try {
        addNotification('info', 'Optimizing prompt with Gemini...');
        setStatusText('Optimizing Prompt (Gemini)...');
        
        const optimizedPrompt = await optimizePromptFor3D(originalPrompt);
        
        if (optimizedPrompt !== originalPrompt) {
            console.log("Optimized Prompt:", optimizedPrompt);
            addNotification('success', `Optimized: ${optimizedPrompt.slice(0, 30)}...`);
        }

        setStatusText('Submitting Task...');
        const taskId = await createTextTo3DTask(optimizedPrompt);
        
        updateAsset(newId, { status: AssetStatus.PROCESSING });
        setStatusText('Queued');
        
        pollTripoTask(taskId, (status, modelUrl, prog) => {
            // Update local progress UI
            setProgress(prog || 0);
            
            if (status === AssetStatus.PENDING) setStatusText('In Queue...');
            if (status === AssetStatus.PROCESSING) {
                if ((prog || 0) < 30) setStatusText('Generating Geometry...');
                else if ((prog || 0) < 70) setStatusText('Refining Mesh...');
                else setStatusText('Applying Texture...');
            }

            // Update Global Asset Store
            updateAsset(newId, { status, modelUrl });

            if (status === AssetStatus.COMPLETED && modelUrl) {
                addNotification('success', 'Model Generated');
                addModelToScene(modelUrl, originalPrompt);
                setIsGenerating(false);
                setProgress(100);
            } else if (status === AssetStatus.ERROR) {
                addNotification('error', 'Generation Failed');
                setIsGenerating(false);
                setStatusText('Failed');
            }
        });
    } catch (e) {
        updateAsset(newId, { status: AssetStatus.ERROR });
        addNotification('error', 'Request Failed');
        setIsGenerating(false);
    }
  };

  const handleLoadDemo = () => addModelToScene('https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb', 'Damaged Helmet');

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
      <Toolbar onToggleRender={() => setShowRenderWindow(!showRenderWindow)} />
      
      {/* Absolute "AI RENDER" button removed from here. */}

      <div className="absolute top-20 right-4 z-10 pointer-events-auto flex flex-col items-end gap-3 animate-slide-in-right">
          <div className="bg-[#18181b]/80 backdrop-blur-md border border-white/5 p-4 rounded-2xl shadow-lg shadow-black/20 text-[10px] font-mono text-zinc-400 min-w-[160px] flex flex-col gap-2 select-none group hover:border-white/10 transition-colors duration-300">
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

          {activeCameraId && (
              <div className="flex items-center gap-3 bg-red-900/80 text-white px-4 py-2.5 rounded-xl shadow-lg border border-red-500/50 animate-pulse">
                  <Video size={16} fill="currentColor" />
                  <span className="text-xs font-bold tracking-wide">REC • CAMERA VIEW</span>
              </div>
          )}
      </div>
      
      {showRenderWindow && <RenderWindow onClose={() => setShowRenderWindow(false)} onCaptureRequest={() => captureRef.current ? captureRef.current() : null} />}

      {sceneObjects.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 z-0 pointer-events-none animate-fade-in-up">
              <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 border border-white/5 animate-pulse">
                  <Box size={40} className="opacity-20 text-white" />
              </div>
              <div className="text-2xl font-bold mb-2 text-white/10 tracking-tight">Scene Empty</div>
              <div className="text-sm opacity-50 mb-6 text-white/30">Drag and drop assets or create new ones</div>
              <button onClick={handleLoadDemo} className="pointer-events-auto px-6 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-full text-indigo-300 text-sm font-bold flex items-center gap-2 transition-all duration-300 hover:scale-105 active:scale-95">
                  <Sparkles size={16} /> Load Demo Asset
              </button>
          </div>
      )}

      <div className="flex-1 cursor-crosshair relative w-full h-full">
          <Canvas 
            shadows 
            camera={{ position: [5, 5, 5], fov: 50, near: 0.1, far: 1000 }} 
            gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
            onPointerMissed={(e) => {
               if (e.type === 'click') setSelectedObjectId(null);
            }}
          >
            <ViewportCapturer captureRef={captureRef} />
            <SceneStatsUpdater onUpdate={setStats} />
            <CameraManager /> 
            
            <ambientLight intensity={0.4} />
            <hemisphereLight intensity={0.5} groundColor="#000000" color="#333333" />
            
            <Suspense fallback={<ModelLoader />}>
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

                    const safeUrl = obj.url || null;
                    if (!safeUrl) return null;

                    return (
                            <ModelErrorBoundary key={obj.id} onReset={() => removeSceneObject(obj.id)} modelUrl={safeUrl}>
                            <ModelInstance 
                                id={obj.id}
                                url={safeUrl}
                                isSelected={selectedObjectId === obj.id}
                                locked={obj.locked}
                                visible={obj.visible}
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
                <Environment preset="city" blur={0.8} background={false} /> 
                <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={20} blur={2.5} far={4} color="#000000" />
            </Suspense>

            {renderSettings.gridVisible && <Grid name="GlobalGrid" infiniteGrid fadeDistance={30} sectionColor="#4f4f4f" cellColor="#1a1a1a" position={[0, -0.01, 0]} />}
            <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                <GizmoViewport axisColors={['#f43f5e', '#10b981', '#3b82f6']} labelColor="white" />
            </GizmoHelper>
          </Canvas>
      </div>

      {/* Progress & Input Area */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[600px] max-w-[90%] z-20 pointer-events-auto flex flex-col gap-2">
         
         {/* Generation Progress Indicator */}
         {isGenerating && (
             <div className="bg-[#18181b]/90 backdrop-blur border border-white/10 rounded-xl p-3 shadow-xl animate-fade-in-up">
                 <div className="flex justify-between items-center text-xs font-bold text-zinc-300 mb-2">
                     <div className="flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"/>
                         <span className="uppercase tracking-wider text-[10px] text-indigo-400">{statusText}</span>
                     </div>
                     <span className="font-mono">{progress}%</span>
                 </div>
                 <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                     <div 
                        className="h-full bg-indigo-500 transition-all duration-700 ease-silky shadow-[0_0_10px_rgba(99,102,241,0.5)]" 
                        style={{ width: `${progress}%` }} 
                     />
                 </div>
             </div>
         )}

         <div className="bg-[#18181b]/80 backdrop-blur-md border border-white/5 p-2 rounded-2xl shadow-lg shadow-black/50 flex gap-3 ring-1 ring-white/5 transition-all duration-300 ease-silky focus-within:ring-indigo-500/50 focus-within:border-indigo-500/50 focus-within:shadow-[0_0_20px_rgba(99,102,241,0.15)] focus-within:scale-[1.01]">
            <input 
                type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleTextTo3D()}
                placeholder={isGenerating ? "Generating 3D model..." : "Describe a 3D object to generate..."}
                disabled={isGenerating}
                className="flex-1 bg-transparent border-none py-3 px-4 text-sm text-zinc-200 focus:outline-none placeholder:text-zinc-500 font-medium disabled:opacity-50"
            />
            <button onClick={handleTextTo3D} disabled={isGenerating || !prompt.trim()} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50 transition-all duration-300 ease-silky shadow-lg shadow-indigo-900/30 hover:scale-105 active:scale-95">
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} fill="currentColor" />}
                Generate
            </button>
         </div>
      </div>
    </div>
  );
}