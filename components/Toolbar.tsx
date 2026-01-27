
import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Move, RotateCw, Scaling, Grid, Play, Save, Download, Undo2, Redo2, Zap, Video } from 'lucide-react';

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

  const ToolBtn = ({ active, onClick, children, title, disabled }: any) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded-md transition-colors flex items-center justify-center ${
        active 
          ? 'bg-blue-600 text-white shadow-sm' 
          : 'text-slate-400 hover:text-white hover:bg-slate-700'
      } ${disabled ? 'opacity-30 cursor-not-allowed hover:bg-transparent' : ''}`}
    >
      {children}
    </button>
  );

  return (
    <div className="h-10 bg-slate-800 border-b border-slate-900 flex items-center px-4 justify-between select-none shadow-md z-20 relative">
      <div className="flex items-center gap-4">
        {/* Transform Tools */}
        <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700/50">
            <ToolBtn 
            active={transformMode === 'translate'} 
            onClick={() => setTransformMode('translate')}
            title="移动 (T)"
            >
            <Move size={16} />
            </ToolBtn>
            <ToolBtn 
            active={transformMode === 'rotate'} 
            onClick={() => setTransformMode('rotate')}
            title="旋转 (R)"
            >
            <RotateCw size={16} />
            </ToolBtn>
            <ToolBtn 
            active={transformMode === 'scale'} 
            onClick={() => setTransformMode('scale')}
            title="缩放 (S)"
            >
            <Scaling size={16} />
            </ToolBtn>
        </div>

        {/* Add Objects */}
        <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700/50">
             <ToolBtn onClick={addLightToScene} title="添加光源">
                <Zap size={16} />
             </ToolBtn>
             <ToolBtn onClick={addCameraToScene} title="添加相机">
                <Video size={16} />
             </ToolBtn>
        </div>

        {/* History Tools */}
        <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700/50">
            <ToolBtn 
                onClick={undo} 
                disabled={past.length === 0}
                title="撤销 (Ctrl+Z)"
            >
                <Undo2 size={16} />
            </ToolBtn>
            <ToolBtn 
                onClick={redo} 
                disabled={future.length === 0}
                title="重做 (Ctrl+Shift+Z)"
            >
                <Redo2 size={16} />
            </ToolBtn>
        </div>
      </div>

      {/* View Settings */}
      <div className="flex items-center gap-4">
         <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-700/50">
            <ToolBtn 
              active={renderSettings.gridVisible} 
              onClick={() => updateRenderSettings({ gridVisible: !renderSettings.gridVisible })}
              title="切换网格显示"
            >
              <Grid size={16} />
            </ToolBtn>
            <div className="w-[1px] h-4 bg-slate-700 mx-1"></div>
            <ToolBtn title="播放动画 (仅演示)">
              <Play size={16} />
            </ToolBtn>
         </div>
      </div>

      {/* File Actions */}
      <div className="flex items-center gap-2">
         <button className="text-xs font-medium text-slate-400 hover:text-white px-3 py-1.5 rounded hover:bg-slate-700 flex items-center gap-2 transition-colors">
            <Save size={14} /> 保存工程
         </button>
         <button className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-500 flex items-center gap-2 shadow-sm transition-colors">
            <Download size={14} /> 导出 GLB
         </button>
      </div>
    </div>
  );
}
