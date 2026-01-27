import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Move, RotateCw, Scaling, Grid, Play, Save, Download, Undo2, Redo2, Zap, Video, MonitorPlay } from 'lucide-react';

export default function Toolbar() {
  const { 
    transformMode, 
    setTransformMode, 
    renderSettings, 
    updateRenderSettings,
    undo,
    redo,
    past,
    future,
    addLightToScene,
    addCameraToScene
  } = useAppStore();

  const ToolBtn = ({ active, onClick, children, title, disabled, colorClass }: any) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`relative w-9 h-9 rounded-lg transition-all flex items-center justify-center group ${
        active 
          ? 'bg-[#27272a] text-white border border-white/10 shadow-inner' 
          : 'text-zinc-500 hover:text-zinc-200 hover:bg-[#27272a] border border-transparent hover:border-white/5'
      } ${disabled ? 'opacity-30 cursor-not-allowed hover:bg-transparent hover:border-transparent' : ''}`}
    >
      {children}
      {active && <div className={`absolute -bottom-1 w-1 h-1 rounded-full ${colorClass || 'bg-indigo-500'}`} />}
    </button>
  );

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-[#18181b] border border-white/10 rounded-xl shadow-lg shadow-black/50">
      
      {/* Transform Tools */}
      <div className="flex items-center gap-1 pr-4 border-r border-white/10">
        <ToolBtn 
          active={transformMode === 'translate'} 
          onClick={() => setTransformMode('translate')}
          title="Move (T)"
          colorClass="bg-rose-500"
        >
          <Move size={18} className={transformMode === 'translate' ? 'text-rose-500' : ''} />
        </ToolBtn>
        <ToolBtn 
          active={transformMode === 'rotate'} 
          onClick={() => setTransformMode('rotate')}
          title="Rotate (R)"
          colorClass="bg-emerald-500"
        >
          <RotateCw size={18} className={transformMode === 'rotate' ? 'text-emerald-500' : ''} />
        </ToolBtn>
        <ToolBtn 
          active={transformMode === 'scale'} 
          onClick={() => setTransformMode('scale')}
          title="Scale (S)"
          colorClass="bg-blue-500"
        >
          <Scaling size={18} className={transformMode === 'scale' ? 'text-blue-500' : ''} />
        </ToolBtn>
      </div>

      {/* Creation Tools */}
      <div className="flex items-center gap-1 pr-4 border-r border-white/10">
         <ToolBtn onClick={addLightToScene} title="Add Light">
            <Zap size={18} className="group-hover:text-yellow-500 transition-colors" />
         </ToolBtn>
         <ToolBtn onClick={addCameraToScene} title="Add Camera">
            <Video size={18} className="group-hover:text-purple-500 transition-colors" />
         </ToolBtn>
      </div>

      {/* History */}
      <div className="flex items-center gap-1 pr-4 border-r border-white/10">
        <ToolBtn onClick={undo} disabled={past.length === 0} title="Undo">
            <Undo2 size={18} />
        </ToolBtn>
        <ToolBtn onClick={redo} disabled={future.length === 0} title="Redo">
            <Redo2 size={18} />
        </ToolBtn>
      </div>

      {/* View & Export */}
      <div className="flex items-center gap-1">
        <ToolBtn 
          active={renderSettings.gridVisible} 
          onClick={() => updateRenderSettings({ gridVisible: !renderSettings.gridVisible })}
          title="Toggle Grid"
        >
          <Grid size={18} />
        </ToolBtn>
        <ToolBtn title="Export GLB">
          <Download size={18} />
        </ToolBtn>
      </div>
    </div>
  );
}