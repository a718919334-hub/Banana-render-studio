import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Box, Layers, Eye, Sun, Video, Grid as GridIcon, Zap, Sliders, Globe, Trash2, RefreshCw, Plus, Lock, Unlock, EyeOff, Hash } from 'lucide-react';

// Extracted Component: Vector3Input
const Vector3Input = ({ label, value, onChange, disabled }: { label: string, value: [number, number, number], onChange: (val: [number, number, number]) => void, disabled?: boolean }) => {
     const updateVal = (index: number, val: string) => {
         const newArr = [...value] as [number, number, number];
         newArr[index] = parseFloat(val) || 0;
         onChange(newArr);
     };

     return (
        <div className={`flex flex-col gap-2 mb-4 transition-opacity duration-300 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider pl-1">{label}</span>
            <div className="flex gap-2">
                {['X', 'Y', 'Z'].map((axis, i) => (
                    <div key={axis} className="relative flex-1 group">
                        <div className={`absolute left-2 top-1.5 text-[9px] font-bold pointer-events-none transition-colors duration-300 ${
                            i === 0 ? 'text-rose-500' : i === 1 ? 'text-emerald-500' : 'text-blue-500'
                        }`}>
                            {axis}
                        </div>
                        <input 
                            type="number" step="0.1" 
                            value={value[i].toFixed(2)} 
                            onChange={(e) => updateVal(i, e.target.value)}
                            className="w-full bg-[#09090b] border border-white/10 rounded-md text-xs text-zinc-100 pl-6 py-1.5 
                            focus:border-indigo-500 focus:bg-[#09090b] focus:ring-1 focus:ring-indigo-500/50 focus:outline-none 
                            transition-all duration-200 font-mono ease-silky hover:border-white/20" 
                        />
                    </div>
                ))}
            </div>
        </div>
     );
  };

// Extracted Component: SceneItem
const SceneItem = ({ id, label, icon: Icon, active, visible = true, onClick, onToggleVisibility, onDelete }: any) => (
    <div 
        onClick={onClick}
        className={`group flex items-center gap-2.5 px-3 py-2 cursor-pointer text-xs rounded-lg mx-2 mb-1 transition-all duration-300 ease-silky border border-transparent ${
            active 
            ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300 shadow-sm' 
            : 'text-zinc-400 hover:bg-[#27272a] hover:text-zinc-100 hover:border-white/5 hover:translate-x-1'
        }`}
    >
        <Icon size={14} className={`transition-colors duration-300 ${active ? 'text-indigo-400' : 'opacity-50 group-hover:opacity-80'}`} /> 
        <span className={`flex-1 truncate font-bold transition-opacity duration-300 ${!visible ? 'opacity-50 line-through' : ''}`}>{label}</span>
        
        {/* Visibility Toggle */}
        {onToggleVisibility && (
             <button 
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisibility();
                }}
                className={`p-1 hover:bg-white/10 rounded transition-all duration-200 hover:scale-110 ${!visible ? 'text-zinc-600' : 'text-zinc-500 hover:text-zinc-200'}`}
                title={visible ? "Hide" : "Show"}
            >
                {visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
        )}

        {onDelete && (
            <button 
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 hover:text-red-400 rounded transition-all duration-200 hover:scale-110"
                title="Remove"
            >
                <Trash2 size={12} /> 
            </button>
        )}
    </div>
);

export default function RendererPanel() {
  const { 
    sceneObjects,
    selectedObjectId, 
    setSelectedObjectId,
    updateSelectedObjectTransform,
    removeSceneObject,
    addLightToScene,
    updateSceneObject,
    renderSettings, 
    updateRenderSettings,
    cameraState,
    setCameraState,
    resetCamera,
    activeCameraId,
    setActiveCameraId
  } = useAppStore();
  
  // Find current selected object data
  const selectedObject = sceneObjects.find(obj => obj.id === selectedObjectId);

  return (
    <div className="flex flex-col h-full text-zinc-300 select-none bg-[#18181b] animate-slide-in-right">
      
      {/* --- TOP SECTION: SCENE GRAPH --- */}
      <div className="flex-1 flex flex-col min-h-0 border-b border-white/5">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#18181b]">
             <div className="flex items-center gap-2 text-xs font-bold text-zinc-100 tracking-wide">
                <Layers size={14} className="text-indigo-500" />
                SCENE GRAPH
             </div>
             <button 
                onClick={addLightToScene} 
                className="w-5 h-5 rounded bg-[#27272a] hover:bg-zinc-700 border border-white/5 text-zinc-400 hover:text-white flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95" 
                title="Add Light"
            >
                 <Plus size={12} />
             </button>
          </div>
          
          <div className="flex-1 overflow-y-auto py-2 custom-scrollbar bg-[#131315]">
             <div className="px-4 pb-2 pt-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Environment</div>
             
             {/* Global Environment & Tools */}
             <SceneItem 
                id="light-env" 
                label="Environment Light" 
                icon={Sun} 
                active={selectedObjectId === 'light-env'}
                onClick={() => setSelectedObjectId('light-env')}
             />
              <SceneItem 
                id="grid" 
                label="Viewport Grid" 
                icon={GridIcon} 
                active={selectedObjectId === 'grid'}
                visible={renderSettings.gridVisible}
                onToggleVisibility={() => updateRenderSettings({ gridVisible: !renderSettings.gridVisible })}
                onClick={() => setSelectedObjectId('grid')}
             />
             <SceneItem 
                id="camera" 
                label="Editor Camera" 
                icon={Video} 
                active={selectedObjectId === 'camera'}
                onClick={() => setSelectedObjectId('camera')}
             />

             <div className="px-4 pt-4 pb-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex justify-between items-center">
                 <span>Objects ({sceneObjects.length})</span>
             </div>
             
             {sceneObjects.length > 0 ? (
                 sceneObjects.map((obj, i) => (
                     <div key={obj.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                        <SceneItem 
                            id={obj.id} 
                            label={obj.name || "Untitled"} 
                            icon={obj.type === 'light' ? Zap : obj.type === 'camera' ? Video : Box} 
                            active={selectedObjectId === obj.id}
                            visible={obj.visible}
                            onToggleVisibility={() => updateSceneObject(obj.id, { visible: !obj.visible })}
                            onClick={() => setSelectedObjectId(obj.id)}
                            onDelete={() => removeSceneObject(obj.id)}
                        />
                     </div>
                 ))
             ) : (
                <div className="px-5 py-2 text-xs text-zinc-500 italic animate-pulse">
                    Scene is empty
                </div>
             )}
          </div>
      </div>

      {/* --- BOTTOM SECTION: PROPERTIES --- */}
      <div className="h-[55%] flex flex-col bg-[#18181b]">
        <div className="flex items-center px-4 py-3 border-b border-white/5 bg-[#18181b]">
             <Sliders size={14} className="text-indigo-500 mr-2" />
             <span className="text-xs font-bold text-zinc-100 tracking-wide">PROPERTIES</span>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            {!selectedObjectId && (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-3 opacity-80 animate-pop-in">
                    <Globe size={32} strokeWidth={1.5} />
                    <span className="text-xs">Select an object to edit</span>
                </div>
            )}

            {/* 1. SCENE OBJECT PROPERTIES (Model / Light / Camera) */}
            {selectedObject && (
                <div className="space-y-5 animate-pop-in">
                    <div className="flex items-center justify-between pb-3 border-b border-white/5">
                        <div className="flex items-center gap-3">
                            <div className={`p-1.5 rounded-lg transition-colors duration-300 ${
                                selectedObject.type === 'light' ? 'bg-yellow-900/30 text-yellow-500' : 
                                selectedObject.type === 'camera' ? 'bg-purple-900/30 text-purple-500' :
                                'bg-blue-900/30 text-blue-500'
                            }`}>
                                {selectedObject.type === 'light' ? <Zap size={14} /> : 
                                 selectedObject.type === 'camera' ? <Video size={14} /> :
                                 <Box size={14} />}
                            </div>
                            <span className="text-sm font-bold text-zinc-100 truncate max-w-[120px]">{selectedObject.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            {/* Visibility Toggle in Properties */}
                            <button 
                                onClick={() => updateSceneObject(selectedObject.id, { visible: !selectedObject.visible })}
                                className={`p-1.5 rounded transition-all duration-200 hover:scale-110 active:scale-95 ${!selectedObject.visible ? 'text-zinc-600' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                                title={selectedObject.visible ? "Hide" : "Show"}
                            >
                                {selectedObject.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                            {/* Lock Toggle */}
                            <button 
                                onClick={() => updateSceneObject(selectedObject.id, { locked: !selectedObject.locked })}
                                className={`p-1.5 rounded transition-all duration-200 hover:scale-110 active:scale-95 ${selectedObject.locked ? 'text-red-400 bg-red-900/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                                title={selectedObject.locked ? "Unlock" : "Lock"}
                            >
                                {selectedObject.locked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>
                        </div>
                    </div>

                    {/* Camera View Switcher */}
                    {selectedObject.type === 'camera' && (
                        <div className="animate-fade-in-up">
                            {activeCameraId === selectedObject.id ? (
                                <button 
                                    onClick={() => setActiveCameraId(null)}
                                    className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-bold hover:bg-zinc-700 transition-all duration-300 ease-silky border border-white/5 hover:scale-[1.02] active:scale-[0.98]"
                                >
                                    <EyeOff size={14} /> Exit Camera View
                                </button>
                            ) : (
                                <button 
                                    onClick={() => setActiveCameraId(selectedObject.id)}
                                    className="w-full flex items-center justify-center gap-2 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-500 transition-all duration-300 ease-silky shadow-lg shadow-indigo-900/20 hover:scale-[1.02] active:scale-[0.98]"
                                >
                                    <Eye size={14} /> Enter Camera View
                                </button>
                            )}
                        </div>
                    )}
                    
                    <Vector3Input 
                        label="Position" 
                        value={selectedObject.transform.position} 
                        onChange={(v) => updateSelectedObjectTransform({ position: v })}
                        disabled={selectedObject.locked}
                    />
                    
                    <Vector3Input 
                        label="Rotation" 
                        value={selectedObject.transform.rotation} 
                        onChange={(v) => updateSelectedObjectTransform({ rotation: v })} 
                        disabled={selectedObject.locked}
                    />

                    {selectedObject.type === 'model' && (
                        <Vector3Input 
                            label="Scale" 
                            value={selectedObject.transform.scale} 
                            onChange={(v) => updateSelectedObjectTransform({ scale: v })} 
                            disabled={selectedObject.locked}
                        />
                    )}

                    {/* Light Specific Properties */}
                    {selectedObject.type === 'light' && selectedObject.lightProps && (
                        <div className="p-4 bg-[#09090b] rounded-lg border border-white/5 space-y-4 animate-fade-in-up">
                             <div className="flex justify-between text-xs font-medium text-zinc-400">
                                <span>Intensity</span>
                                <span className="font-mono text-indigo-400 font-bold">{selectedObject.lightProps.intensity.toFixed(1)}</span>
                            </div>
                            <input 
                                type="range" 
                                min="0" max="10" step="0.1"
                                value={selectedObject.lightProps.intensity}
                                onChange={(e) => updateSceneObject(selectedObject.id, { 
                                    lightProps: { ...selectedObject.lightProps!, intensity: parseFloat(e.target.value) } 
                                })}
                                className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-indigo-500 transition-all hover:h-2"
                            />

                             <div className="flex justify-between text-xs font-medium text-zinc-400 pt-2">
                                <span>Color</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/10 shadow-sm hover:scale-110 transition-transform duration-200">
                                    <input 
                                        type="color" 
                                        value={selectedObject.lightProps.color}
                                        onChange={(e) => updateSceneObject(selectedObject.id, { 
                                            lightProps: { ...selectedObject.lightProps!, color: e.target.value } 
                                        })}
                                        className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] cursor-pointer p-0 border-0"
                                    />
                                </div>
                                <span className="text-xs font-mono text-zinc-300 uppercase font-bold">{selectedObject.lightProps.color}</span>
                            </div>
                        </div>
                    )}

                    {/* Camera Specific Properties */}
                    {selectedObject.type === 'camera' && selectedObject.cameraProps && (
                         <div className="p-4 bg-[#09090b] rounded-lg border border-white/5 space-y-4 animate-fade-in-up">
                            <div className="flex justify-between text-xs font-medium text-zinc-400">
                                <span>Field of View</span>
                                <span className="font-mono text-indigo-400 font-bold">{selectedObject.cameraProps.fov.toFixed(0)}°</span>
                            </div>
                            <input 
                                type="range" 
                                min="10" max="120" step="1"
                                value={selectedObject.cameraProps.fov}
                                onChange={(e) => updateSceneObject(selectedObject.id, { 
                                    cameraProps: { ...selectedObject.cameraProps!, fov: parseFloat(e.target.value) } 
                                })}
                                className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-indigo-500 transition-all hover:h-2"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* 3. AMBIENT LIGHT PROPERTIES */}
            {selectedObjectId === 'light-env' && (
                <div className="space-y-4 animate-pop-in">
                     <div className="flex items-center gap-3 pb-3 border-b border-white/5">
                        <div className="p-1.5 rounded-lg bg-orange-900/30 text-orange-500">
                            <Sun size={14} />
                        </div>
                        <span className="text-sm font-bold text-zinc-100">Environment</span>
                    </div>
                    
                    <div className="p-4 bg-[#09090b] rounded-lg border border-white/5">
                        <span className="text-xs font-bold text-zinc-400 block mb-3 uppercase tracking-wider">Preset</span>
                        <select className="w-full bg-[#18181b] border border-white/10 text-xs text-zinc-200 p-2 rounded outline-none focus:border-indigo-500 transition-all duration-300 hover:border-white/20">
                            <option>Studio (Default)</option>
                            <option>City</option>
                            <option>Park</option>
                            <option>Lobby</option>
                        </select>
                    </div>
                </div>
            )}

             {/* 4. GRID PROPERTIES */}
             {selectedObjectId === 'grid' && (
                <div className="space-y-4 animate-pop-in">
                     <div className="flex items-center gap-3 pb-3 border-b border-white/5">
                        <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400">
                            <GridIcon size={14} />
                        </div>
                        <span className="text-sm font-bold text-zinc-100">Grid System</span>
                    </div>
                    
                    <div className="flex items-center justify-between p-4 bg-[#09090b] rounded-lg border border-white/5">
                        <span className="text-xs font-bold text-zinc-400">Show Grid</span>
                        <input 
                            type="checkbox" 
                            checked={renderSettings.gridVisible}
                            onChange={(e) => updateRenderSettings({ gridVisible: e.target.checked })}
                            className="w-5 h-5 rounded bg-zinc-800 border-zinc-700 accent-indigo-500 cursor-pointer transition-transform hover:scale-110"
                        />
                    </div>
                </div>
            )}

            {/* 5. DEFAULT EDITOR CAMERA PROPERTIES */}
            {selectedObjectId === 'camera' && (
                <div className="space-y-5 animate-pop-in">
                     <div className="flex items-center gap-3 pb-3 border-b border-white/5">
                        <div className="p-1.5 rounded-lg bg-purple-900/30 text-purple-500">
                            <Video size={14} />
                        </div>
                        <span className="text-sm font-bold text-zinc-100">Editor View</span>
                    </div>
                    
                    <div className="p-3 bg-indigo-900/10 border border-indigo-500/20 rounded-lg text-[10px] leading-relaxed text-indigo-300 font-medium animate-fade-in-up">
                        This is the default editor perspective. To render cinematic shots, please add a dedicated "Camera" object from the toolbar.
                    </div>

                    <Vector3Input 
                        label="World Position" 
                        value={cameraState.position} 
                        onChange={(v) => setCameraState({ position: v })} 
                    />
                    
                    <Vector3Input 
                        label="Look At Target" 
                        value={cameraState.target} 
                        onChange={(v) => setCameraState({ target: v })} 
                    />

                    <div>
                        <div className="flex justify-between text-xs font-medium text-zinc-400 mb-2">
                            <span>Field of View</span>
                            <span className="font-mono text-indigo-400 font-bold">{cameraState.fov.toFixed(0)}°</span>
                        </div>
                        <input 
                            type="range" 
                            min="10" max="120" step="1"
                            value={cameraState.fov}
                            onChange={(e) => setCameraState({ fov: parseFloat(e.target.value) })}
                            className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-indigo-500 transition-all hover:h-2"
                        />
                    </div>

                    <div className="pt-4 border-t border-white/5">
                        <button 
                            onClick={resetCamera}
                            className="w-full bg-[#09090b] border border-white/10 hover:bg-[#27272a] text-zinc-400 hover:text-zinc-200 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <RefreshCw size={12} /> Reset to Default
                        </button>
                    </div>
                </div>
            )}

        </div>
      </div>
    </div>
  );
}