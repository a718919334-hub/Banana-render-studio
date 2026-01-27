import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Box, Layers, Eye, Sun, Video, Grid as GridIcon, Zap, Sliders, Globe, Trash2, RefreshCw, Plus, Lock, Unlock, EyeOff } from 'lucide-react';

// Extracted Component: Vector3Input
const Vector3Input = ({ label, value, onChange, disabled }: { label: string, value: [number, number, number], onChange: (val: [number, number, number]) => void, disabled?: boolean }) => {
     const updateVal = (index: number, val: string) => {
         const newArr = [...value] as [number, number, number];
         newArr[index] = parseFloat(val) || 0;
         onChange(newArr);
     };

     return (
        <div className={`flex flex-col gap-1 mb-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{label}</span>
            <div className="flex gap-1">
                <div className="relative flex-1">
                    <span className="absolute left-1.5 top-1 text-[10px] text-red-500 font-bold">X</span>
                    <input 
                        type="number" step="0.1" 
                        value={value[0].toFixed(2)} 
                        onChange={(e) => updateVal(0, e.target.value)}
                        className="w-full bg-[#111] border border-slate-700 text-xs text-slate-200 pl-4 py-1 rounded focus:border-blue-500 outline-none transition-colors" 
                    />
                </div>
                <div className="relative flex-1">
                    <span className="absolute left-1.5 top-1 text-[10px] text-green-500 font-bold">Y</span>
                    <input 
                        type="number" step="0.1" 
                        value={value[1].toFixed(2)} 
                        onChange={(e) => updateVal(1, e.target.value)}
                        className="w-full bg-[#111] border border-slate-700 text-xs text-slate-200 pl-4 py-1 rounded focus:border-blue-500 outline-none transition-colors" 
                    />
                </div>
                <div className="relative flex-1">
                    <span className="absolute left-1.5 top-1 text-[10px] text-blue-500 font-bold">Z</span>
                    <input 
                        type="number" step="0.1" 
                        value={value[2].toFixed(2)} 
                        onChange={(e) => updateVal(2, e.target.value)}
                        className="w-full bg-[#111] border border-slate-700 text-xs text-slate-200 pl-4 py-1 rounded focus:border-blue-500 outline-none transition-colors" 
                    />
                </div>
            </div>
        </div>
     );
  };

// Extracted Component: SceneItem
const SceneItem = ({ id, label, icon: Icon, active, onClick, onDelete }: any) => (
    <div 
        onClick={onClick}
        className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs rounded-sm mx-1 mb-0.5 transition-colors ${
            active 
            ? 'bg-[#094771] text-white' 
            : 'text-slate-400 hover:bg-[#2a2d2e] hover:text-slate-200'
        }`}
    >
        <Icon size={12} className={active ? 'text-white' : 'opacity-70'} /> 
        <span className="flex-1 truncate">{label}</span>
        {onDelete && (
            <button 
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 hover:text-red-400 rounded transition-all"
                title="移除"
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
    <div className="w-72 bg-[#1e1e1e] border-l border-slate-900 flex flex-col h-full text-slate-300 select-none">
      
      {/* --- TOP SECTION: SCENE GRAPH --- */}
      <div className="flex-1 flex flex-col min-h-0 border-b border-slate-900">
          <div className="flex items-center justify-between px-3 py-2 bg-[#252526] border-b border-slate-900">
             <div className="flex items-center">
                <Layers size={12} className="text-slate-400 mr-2" />
                <span className="text-xs font-bold text-slate-300">场景列表</span>
             </div>
             <button onClick={addLightToScene} className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-white" title="添加光源">
                 <Plus size={14} />
             </button>
          </div>
          
          <div className="flex-1 overflow-y-auto py-2">
             <div className="px-2 pb-1 text-[10px] font-bold text-slate-500 uppercase">全局对象</div>
             
             {/* Global Environment & Tools */}
             <SceneItem 
                id="light-env" 
                label="环境光 (Ambient Light)" 
                icon={Sun} 
                active={selectedObjectId === 'light-env'}
                onClick={() => setSelectedObjectId('light-env')}
             />
              <SceneItem 
                id="grid" 
                label="辅助网格 (Grid)" 
                icon={GridIcon} 
                active={selectedObjectId === 'grid'}
                onClick={() => setSelectedObjectId('grid')}
             />
             <SceneItem 
                id="camera" 
                label="主视图 (Editor View)" 
                icon={Video} 
                active={selectedObjectId === 'camera'}
                onClick={() => setSelectedObjectId('camera')}
             />

             <div className="px-2 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase flex justify-between items-center">
                 <span>层级 ({sceneObjects.length})</span>
             </div>
             
             {sceneObjects.length > 0 ? (
                 sceneObjects.map(obj => (
                     <SceneItem 
                        key={obj.id}
                        id={obj.id} 
                        label={obj.name || "Untitled"} 
                        icon={obj.type === 'light' ? Zap : obj.type === 'camera' ? Video : Box} 
                        active={selectedObjectId === obj.id}
                        onClick={() => setSelectedObjectId(obj.id)}
                        onDelete={() => removeSceneObject(obj.id)}
                     />
                 ))
             ) : (
                <div className="px-3 py-2 text-xs text-slate-600 italic">
                    场景为空
                </div>
             )}
          </div>
      </div>

      {/* --- BOTTOM SECTION: PROPERTIES --- */}
      <div className="h-1/2 flex flex-col bg-[#1e1e1e]">
        <div className="flex items-center px-3 py-2 bg-[#252526] border-b border-slate-900 border-t">
             <Sliders size={12} className="text-slate-400 mr-2" />
             <span className="text-xs font-bold text-slate-300">属性 (Properties)</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
            {!selectedObjectId && (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 space-y-2">
                    <Globe size={24} className="opacity-20" />
                    <span className="text-xs">在上方选择对象以编辑属性</span>
                </div>
            )}

            {/* 1. SCENE OBJECT PROPERTIES (Model / Light / Camera) */}
            {selectedObject && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                        <div className="flex items-center gap-2">
                            {selectedObject.type === 'light' ? <Zap size={14} className="text-yellow-400" /> : 
                             selectedObject.type === 'camera' ? <Video size={14} className="text-purple-400" /> :
                             <Box size={14} className="text-blue-400" />}
                            <span className="text-xs font-bold text-white truncate max-w-[120px]">{selectedObject.name}</span>
                        </div>
                        {/* Lock Toggle */}
                        <button 
                            onClick={() => updateSceneObject(selectedObject.id, { locked: !selectedObject.locked })}
                            className={`p-1 rounded transition ${selectedObject.locked ? 'text-red-400 bg-red-900/20' : 'text-slate-500 hover:text-white'}`}
                            title={selectedObject.locked ? "解锁位置" : "锁定位置"}
                        >
                            {selectedObject.locked ? <Lock size={14} /> : <Unlock size={14} />}
                        </button>
                    </div>

                    {/* Camera View Switcher */}
                    {selectedObject.type === 'camera' && (
                        <div className="mb-4">
                            {activeCameraId === selectedObject.id ? (
                                <button 
                                    onClick={() => setActiveCameraId(null)}
                                    className="w-full flex items-center justify-center gap-2 py-2 bg-slate-700 text-slate-300 rounded text-xs hover:bg-slate-600 transition"
                                >
                                    <EyeOff size={14} /> 退出相机视角
                                </button>
                            ) : (
                                <button 
                                    onClick={() => setActiveCameraId(selectedObject.id)}
                                    className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 text-white rounded text-xs hover:bg-blue-500 transition shadow-lg shadow-blue-900/20"
                                >
                                    <Eye size={14} /> 进入相机视角
                                </button>
                            )}
                        </div>
                    )}
                    
                    <Vector3Input 
                        label="位置 (Position)" 
                        value={selectedObject.transform.position} 
                        onChange={(v) => updateSelectedObjectTransform({ position: v })}
                        disabled={selectedObject.locked}
                    />
                    
                    <Vector3Input 
                        label="旋转 (Rotation)" 
                        value={selectedObject.transform.rotation} 
                        onChange={(v) => updateSelectedObjectTransform({ rotation: v })} 
                        disabled={selectedObject.locked}
                    />

                    {selectedObject.type === 'model' && (
                        <Vector3Input 
                            label="缩放 (Scale)" 
                            value={selectedObject.transform.scale} 
                            onChange={(v) => updateSelectedObjectTransform({ scale: v })} 
                            disabled={selectedObject.locked}
                        />
                    )}

                    {/* Light Specific Properties */}
                    {selectedObject.type === 'light' && selectedObject.lightProps && (
                        <div className="p-3 bg-slate-800/30 rounded border border-slate-700/50">
                             <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>光照强度</span>
                                <span>{selectedObject.lightProps.intensity.toFixed(1)}</span>
                            </div>
                            <input 
                                type="range" 
                                min="0" max="10" step="0.1"
                                value={selectedObject.lightProps.intensity}
                                onChange={(e) => updateSceneObject(selectedObject.id, { 
                                    lightProps: { ...selectedObject.lightProps!, intensity: parseFloat(e.target.value) } 
                                })}
                                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer mb-3"
                            />

                             <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>光照颜色</span>
                            </div>
                            <div className="flex gap-2">
                                <input 
                                    type="color" 
                                    value={selectedObject.lightProps.color}
                                    onChange={(e) => updateSceneObject(selectedObject.id, { 
                                        lightProps: { ...selectedObject.lightProps!, color: e.target.value } 
                                    })}
                                    className="w-8 h-6 bg-transparent border-0 p-0 cursor-pointer"
                                />
                                <span className="text-xs text-slate-500 self-center">{selectedObject.lightProps.color}</span>
                            </div>
                        </div>
                    )}

                    {/* Camera Specific Properties */}
                    {selectedObject.type === 'camera' && selectedObject.cameraProps && (
                         <div className="p-3 bg-slate-800/30 rounded border border-slate-700/50">
                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>视野 (FOV)</span>
                                <span>{selectedObject.cameraProps.fov.toFixed(0)}°</span>
                            </div>
                            <input 
                                type="range" 
                                min="10" max="120" step="1"
                                value={selectedObject.cameraProps.fov}
                                onChange={(e) => updateSceneObject(selectedObject.id, { 
                                    cameraProps: { ...selectedObject.cameraProps!, fov: parseFloat(e.target.value) } 
                                })}
                                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* 3. AMBIENT LIGHT PROPERTIES */}
            {selectedObjectId === 'light-env' && (
                <div className="space-y-4">
                     <div className="flex items-center gap-2 pb-2 border-b border-slate-800 mb-2">
                        <Sun size={14} className="text-orange-400" />
                        <span className="text-xs font-bold text-white">环境设置</span>
                    </div>
                    
                    <div className="p-3 bg-slate-800/50 rounded border border-slate-700">
                        <span className="text-xs text-slate-400 block mb-2">环境预设</span>
                        <select className="w-full bg-[#111] border border-slate-700 text-xs text-white p-1 rounded outline-none">
                            <option>Studio (默认)</option>
                            <option>City</option>
                            <option>Park</option>
                            <option>Lobby</option>
                        </select>
                    </div>
                </div>
            )}

             {/* 4. GRID PROPERTIES */}
             {selectedObjectId === 'grid' && (
                <div className="space-y-4">
                     <div className="flex items-center gap-2 pb-2 border-b border-slate-800 mb-2">
                        <GridIcon size={14} className="text-slate-400" />
                        <span className="text-xs font-bold text-white">辅助网格</span>
                    </div>
                    
                    <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded">
                        <span className="text-xs text-slate-300">显示网格</span>
                        <input 
                            type="checkbox" 
                            checked={renderSettings.gridVisible}
                            onChange={(e) => updateRenderSettings({ gridVisible: e.target.checked })}
                            className="toggle"
                        />
                    </div>
                </div>
            )}

            {/* 5. DEFAULT EDITOR CAMERA PROPERTIES */}
            {selectedObjectId === 'camera' && (
                <div className="space-y-4">
                     <div className="flex items-center gap-2 pb-2 border-b border-slate-800 mb-2">
                        <Video size={14} className="text-purple-400" />
                        <span className="text-xs font-bold text-white">主视图 (Editor Camera)</span>
                    </div>
                    
                    <div className="p-2 bg-blue-900/20 border border-blue-900/50 rounded text-xs text-blue-200 mb-2">
                        这是默认的编辑器视角。要创建可渲染的电影视角，请添加一个新的“相机”对象。
                    </div>

                    <Vector3Input 
                        label="摄像机位置 (World)" 
                        value={cameraState.position} 
                        onChange={(v) => setCameraState({ position: v })} 
                    />
                    
                    <Vector3Input 
                        label="目标点 (Target)" 
                        value={cameraState.target} 
                        onChange={(v) => setCameraState({ target: v })} 
                    />

                    <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                            <span>视野 (FOV)</span>
                            <span>{cameraState.fov.toFixed(0)}°</span>
                        </div>
                        <input 
                            type="range" 
                            min="10" max="120" step="1"
                            value={cameraState.fov}
                            onChange={(e) => setCameraState({ fov: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex gap-2">
                        <button 
                            onClick={resetCamera}
                            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded text-xs font-medium flex items-center justify-center gap-2 transition"
                        >
                            <RefreshCw size={12} /> 重置视角
                        </button>
                    </div>
                </div>
            )}

        </div>
      </div>
    </div>
  );
}