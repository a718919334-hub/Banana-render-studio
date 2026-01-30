import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Move, RotateCw, Scaling, Grid, Play, Save, Download, Undo2, Redo2, Zap, Video, MonitorPlay, Aperture } from 'lucide-react';

interface ToolbarProps {
    onToggleRender?: () => void;
}

export default function Toolbar({ onToggleRender }: ToolbarProps) {
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
      className={`relative w-9 h-9 rounded-lg transition-all duration-300 ease-silky flex items-center justify-center group ${
        active 
          ? 'bg-[#27272a] text-white border border-white/10 shadow-inner scale-105' 
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#27272a] border border-transparent hover:border-white/5 hover:scale-110 active:scale-95'
      } ${disabled ? 'opacity-30 cursor-not-allowed hover:bg-transparent hover:border-transparent hover:scale-100' : ''}`}
    >
      {children}
      {active && <div className={`absolute -bottom-1 w-1 h-1 rounded-full ${colorClass || 'bg-indigo-500'} animate-pop-in`} />}
    </button>
  );

  return (
    // 工具栏容器定位：
    // absolute: 绝对定位，脱离文档流，相对于最近的定位父级（Canvas容器）
    // top-4: 距离顶部 1rem (16px)
    // left-1/2: 左侧距离父容器 50%
    // -translate-x-1/2: 向左平移自身宽度的 50%，实现水平居中对齐
    <div className="absolute top-4 left-1/3 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-[#18181b]/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 animate-fade-in-up">
      
      {/* Transform Tools */}
      <div className="flex items-center gap-1 pr-4 border-r border-white/10">
        <ToolBtn 
          active={transformMode === 'translate'} 
          onClick={() => setTransformMode('translate')}
          title="Move (T)"
          colorClass="bg-rose-500"
        >
          <Move size={18} className={`transition-colors duration-300 ${transformMode === 'translate' ? 'text-rose-500' : ''}`} />
        </ToolBtn>
        <ToolBtn 
          active={transformMode === 'rotate'} 
          onClick={() => setTransformMode('rotate')}
          title="Rotate (R)"
          colorClass="bg-emerald-500"
        >
          <RotateCw size={18} className={`transition-colors duration-300 ${transformMode === 'rotate' ? 'text-emerald-500' : ''}`} />
        </ToolBtn>
        <ToolBtn 
          active={transformMode === 'scale'} 
          onClick={() => setTransformMode('scale')}
          title="Scale (S)"
          colorClass="bg-blue-500"
        >
          <Scaling size={18} className={`transition-colors duration-300 ${transformMode === 'scale' ? 'text-blue-500' : ''}`} />
        </ToolBtn>
      </div>

      {/* Creation Tools */}
      <div className="flex items-center gap-1 pr-4 border-r border-white/10">
         <ToolBtn onClick={addLightToScene} title="Add Light">
            <Zap size={18} className="group-hover:text-yellow-500 transition-colors duration-300" />
         </ToolBtn>
         <ToolBtn onClick={addCameraToScene} title="Add Camera">
            <Video size={18} className="group-hover:text-purple-500 transition-colors duration-300" />
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
      <div className="flex items-center gap-1 pr-4 border-r border-white/10">
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

      {/* AI Render Button */}
      <button 
          onClick={onToggleRender}
          className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all duration-300 ease-silky shadow-lg shadow-indigo-500/20 hover:scale-105 active:scale-95 group"
      >
          <Aperture size={16} className="group-hover:rotate-180 transition-transform duration-700 ease-in-out" />
          <span className="tracking-wide">AI RENDER</span>
      </button>
    </div>
  );
}