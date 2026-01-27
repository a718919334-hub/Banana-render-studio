import React, { useEffect } from 'react';
import AssetManager from './components/AssetManager';
import SceneViewer from './components/SceneViewer';
import RendererPanel from './components/RendererPanel';
import { useAppStore } from './store/useAppStore';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContainer = () => {
    const { notifications, removeNotification } = useAppStore();
    return (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
            {notifications.map(n => (
                <div key={n.id} className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl text-sm font-medium transition-all animate-in slide-in-from-right duration-300 border border-white/10 ${
                    n.type === 'success' ? 'bg-emerald-600 text-white' :
                    n.type === 'error' ? 'bg-red-600 text-white' :
                    'bg-slate-700 text-white'
                }`}>
                    {n.type === 'success' && <CheckCircle size={18} />}
                    {n.type === 'error' && <AlertCircle size={18} />}
                    {n.type === 'info' && <Info size={18} />}
                    <span>{n.message}</span>
                    <button onClick={() => removeNotification(n.id)} className="ml-2 opacity-60 hover:opacity-100 transition-opacity">
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>
    )
};

export default function App() {
  // Global Undo/Redo Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Check for Ctrl (or Command on Mac)
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    useAppStore.getState().redo();
                } else {
                    useAppStore.getState().undo();
                }
            }
            // Support Ctrl+Y for Redo
            if (e.key === 'y') {
                e.preventDefault();
                useAppStore.getState().redo();
            }
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden text-slate-100 font-sans bg-[#1e1e1e]">
      {/* 1. Menubar (Visual Simulation) */}
      <div className="h-8 bg-[#111] flex items-center px-2 text-xs select-none border-b border-slate-900">
         <img src="https://raw.githubusercontent.com/pmndrs/branding/master/react-three-fiber/react-three-fiber.png" className="w-5 h-5 mr-3 opacity-80" alt="Icon" />
         <div className="flex gap-4 text-slate-300">
            <span className="hover:text-white cursor-pointer">文件</span>
            <span className="hover:text-white cursor-pointer">编辑</span>
            <span className="hover:text-white cursor-pointer">添加</span>
            <span className="hover:text-white cursor-pointer">视图</span>
            <span className="hover:text-white cursor-pointer">帮助</span>
         </div>
      </div>

      {/* 2. Main Editor Workspace (Toolbar is now inside SceneViewer) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Project Assets */}
        <AssetManager />
        
        {/* Middle Panel: 3D Viewport with Integrated Toolbar */}
        <SceneViewer />
        
        {/* Right Panel: Scene Graph & Properties */}
        <RendererPanel />
      </div>

      {/* Global Notifications */}
      <ToastContainer />
    </div>
  );
}