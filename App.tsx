import React, { useEffect } from 'react';
import AssetManager from './components/AssetManager';
import SceneViewer from './components/SceneViewer';
import RendererPanel from './components/RendererPanel';
import { useAppStore } from './store/useAppStore';
import { CheckCircle, AlertCircle, Info, X, Command } from 'lucide-react';

const ToastContainer = () => {
    const { notifications, removeNotification } = useAppStore();
    return (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
            {notifications.map(n => (
                <div key={n.id} className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl shadow-black/50 text-sm font-medium transition-all animate-in slide-in-from-right duration-300 border ${
                    n.type === 'success' ? 'bg-[#0f1f15] border-emerald-800 text-emerald-400' :
                    n.type === 'error' ? 'bg-[#1f0f0f] border-red-900 text-red-400' :
                    'bg-[#18181b] border-white/10 text-zinc-300'
                }`}>
                    {n.type === 'success' && <CheckCircle size={18} className="text-emerald-500" />}
                    {n.type === 'error' && <AlertCircle size={18} className="text-red-500" />}
                    {n.type === 'info' && <Info size={18} className="text-blue-500" />}
                    <span>{n.message}</span>
                    <button onClick={() => removeNotification(n.id)} className="ml-2 opacity-40 hover:opacity-100 transition-opacity text-white">
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
    <div className="flex flex-col h-screen w-screen overflow-hidden text-zinc-300 font-sans selection:bg-indigo-500/30 bg-[#09090b]">
      {/* 1. Header / Status Bar - Dark Layer 1 */}
      <div className="h-12 flex items-center px-4 justify-between shrink-0 z-50 bg-[#18181b] border-b border-white/5">
         <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/10">
                <Command size={16} className="text-white" />
             </div>
             <div>
                <div className="text-sm font-bold text-white tracking-wide">Banana Render</div>
                <div className="text-[10px] text-zinc-500 font-bold tracking-wider uppercase">Studio Pro</div>
             </div>
         </div>
         
         <div className="flex gap-1">
            {['File', 'Edit', 'View', 'Help'].map(item => (
                <button key={item} className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-md transition-all">
                    {item}
                </button>
            ))}
         </div>

         <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#09090b] border border-emerald-900/30 text-emerald-500 text-[10px] font-bold tracking-wide">
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                 GCP CONNECTED
             </div>
             <div className="w-8 h-8 rounded-full bg-[#27272a] border border-white/5 shadow-sm flex items-center justify-center text-[10px] font-bold text-zinc-400">
                 Dev
             </div>
         </div>
      </div>

      {/* 2. Main Workspace - Dark Background */}
      <div className="flex-1 flex gap-0 p-0 overflow-hidden min-h-0 bg-[#09090b]">
        
        {/* Left Panel: Project Assets (Dark Layer 1) */}
        <div className="w-80 flex flex-col border-r border-white/5 bg-[#18181b] z-10">
            <AssetManager />
        </div>
        
        {/* Middle Panel: 3D Viewport (WORKBENCH - Radial Gradient Background) */}
        <div className="flex-1 flex flex-col bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-700 via-[#09090b] to-black overflow-hidden relative shadow-inner shadow-black">
            <SceneViewer />
        </div>
        
        {/* Right Panel: Properties (Dark Layer 1) */}
        <div className="w-72 flex flex-col border-l border-white/5 bg-[#18181b] z-10">
            <RendererPanel />
        </div>
      </div>

      {/* Global Notifications */}
      <ToastContainer />
    </div>
  );
}