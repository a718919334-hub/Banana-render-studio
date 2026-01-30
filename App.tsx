import React, { useEffect, useState } from 'react';
import AssetManager from './components/AssetManager';
import SceneViewer from './components/SceneViewer';
import RendererPanel from './components/RendererPanel';
import { useAppStore } from './store/useAppStore';
import { CheckCircle, AlertCircle, Info, X, Aperture, Link, ExternalLink } from 'lucide-react';

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
  const { backendUrl, setBackendUrl } = useAppStore();
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [tempUrl, setTempUrl] = useState(backendUrl);
  
  // This constant matches the one in tripoService and SceneViewer
  const DEFAULT_BACKEND_URL = 'https://soft-wave-9c83.a718919334.workers.dev';

  // Global Undo/Redo Listener
  useEffect(() => {
    // Keyboard shortcuts
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

  const handleUrlSubmit = () => {
      let finalUrl = tempUrl.trim();
      
      // Default reset
      if (!finalUrl) {
          finalUrl = DEFAULT_BACKEND_URL;
      } 
      // Auto-protocol for external domains (if not starting with / or http)
      else if (!finalUrl.startsWith('/') && !finalUrl.startsWith('http')) {
          // If localhost or IP address, default to http to avoid SSL issues
          if (finalUrl.includes('localhost') || finalUrl.includes('127.0.0.1')) {
              finalUrl = `http://${finalUrl}`;
          } else {
              finalUrl = `https://${finalUrl}`;
          }
      }
      
      // Remove trailing slash for consistency
      if (finalUrl.endsWith('/')) {
          finalUrl = finalUrl.slice(0, -1);
      }

      setBackendUrl(finalUrl);
      setTempUrl(finalUrl); 
      setIsEditingUrl(false);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden text-zinc-300 font-sans selection:bg-indigo-500/30 bg-[#09090b]">
      {/* 1. Header / Status Bar - Dark Layer 1 */}
      <div className="h-16 flex items-center px-6 justify-between shrink-0 z-50 bg-[#18181b] border-b border-white/5">
         <div className="flex items-center gap-4">
             <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Aperture size={24} className="text-white" />
             </div>
             <div>
                <div className="text-xl font-bold text-white tracking-wide">Banana Render</div>
                <div className="text-xs text-zinc-500 font-bold tracking-wider uppercase">Studio Pro</div>
             </div>
         </div>
         
         <div className="flex items-center gap-3">
             {/* Backend Configuration UI */}
             {isEditingUrl ? (
                <div className="flex items-center gap-2 bg-[#09090b] border border-indigo-500/50 rounded-md px-2 py-0.5 animate-in fade-in duration-200 shadow-lg shadow-indigo-500/10">
                    <Link size={12} className="text-indigo-500" />
                    <input 
                        className="bg-transparent border-none text-xs text-white outline-none w-56 font-mono placeholder:text-zinc-600"
                        value={tempUrl}
                        onChange={(e) => setTempUrl(e.target.value)}
                        onBlur={handleUrlSubmit}
                        onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                        autoFocus
                        placeholder="e.g. /api/tripo or https://worker.dev"
                    />
                </div>
             ) : (
                <button 
                    onClick={() => {
                        setTempUrl(backendUrl);
                        setIsEditingUrl(true);
                    }}
                    className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all text-[10px] font-bold tracking-wide group ${
                        backendUrl === DEFAULT_BACKEND_URL 
                        ? 'bg-[#09090b] border-white/10 text-zinc-400 hover:text-white hover:border-indigo-500/30' 
                        : 'bg-indigo-900/20 border-indigo-500/30 text-indigo-300 hover:bg-indigo-900/30'
                    }`}
                    title="Configure Backend Service URL"
                >
                    {backendUrl === DEFAULT_BACKEND_URL ? <Link size={12} /> : <ExternalLink size={12} />}
                    {backendUrl === DEFAULT_BACKEND_URL ? 'CLOUD PROXY' : 'CUSTOM BACKEND'}
                    
                    {backendUrl !== DEFAULT_BACKEND_URL && (
                        <span className="opacity-50 text-[9px] truncate max-w-[100px] hidden sm:block border-l border-white/10 pl-2 ml-1">
                            {backendUrl.replace(/^https?:\/\//, '')}
                        </span>
                    )}
                </button>
             )}

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
        
        {/* Middle Panel: 3D Viewport (WORKBENCH) */}
        <div className="flex-1 flex flex-col bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-600/50 -zinc-800 to-zinc-1000">
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