import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AssetStatus } from '../types';
import { testApiConnection, uploadImageToTripo, createImageTo3DTask, pollTripoTask } from '../services/tripoService';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, Image as ImageIcon, FolderOpen, Wifi, GripVertical, Sparkles, Box, Plus, Trash2, CloudUpload } from 'lucide-react';

export default function AssetManager() {
  const { assets, addModelToScene, addAsset, updateAsset, removeAsset, addNotification } = useAppStore();
  const [apiStatus, setApiStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [apiMsg, setApiMsg] = useState('');

  // 1. Handle Image Selection
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files) as File[];
    files.forEach(file => {
      const fileId = uuidv4();
      addAsset({
        id: fileId,
        originalName: file.name,
        imageUrl: URL.createObjectURL(file),
        status: AssetStatus.PENDING,
        modelUrl: null,
        createdAt: Date.now()
      });
    });
    e.target.value = '';
  };

  // 1.b Handle Model Upload (.glb)
  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files) as File[];

    files.forEach(file => {
      const fileId = uuidv4();
      const localModelUrl = URL.createObjectURL(file);

      addAsset({
        id: fileId,
        originalName: file.name,
        imageUrl: "https://placehold.co/100x100/27272a/52525b?text=GLB", 
        status: AssetStatus.COMPLETED,
        modelUrl: localModelUrl,
        createdAt: Date.now()
      });
      
      addNotification('success', `模型 "${file.name}" 导入成功`);
      addModelToScene(localModelUrl, file.name);
    });

    e.target.value = '';
  };

  // 2. Generation Logic
  const handleGenerate = async (e: React.MouseEvent, assetId: string, imageUrl: string, originalName: string) => {
    e.stopPropagation();
    
    // Auto-check connection if not checked or previous check failed
    if (apiStatus === 'idle' || apiStatus === 'error') {
        const result = await checkConnection();
        if (!result) return; // Stop if connection failed
    }

    updateAsset(assetId, { status: AssetStatus.PROCESSING });

    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const file = new File([blob], originalName, { type: blob.type });

        const imageToken = await uploadImageToTripo(file);
        const fileExt = originalName.split('.').pop() || 'png';
        const taskId = await createImageTo3DTask(imageToken, fileExt);

        pollTripoTask(taskId, (status, modelUrl) => {
            updateAsset(assetId, { status, modelUrl });
            if (status === AssetStatus.COMPLETED && modelUrl) {
                addNotification('success', `模型 "${originalName}" 生成成功！`);
                // Auto-add to scene
                addModelToScene(modelUrl, originalName);
            } else if (status === AssetStatus.ERROR) {
                 updateAsset(assetId, { errorMsg: "API Error" });
                 addNotification('error', `生成失败: ${originalName}`);
            }
        });
    } catch (err: any) {
        updateAsset(assetId, { status: AssetStatus.ERROR, errorMsg: err.message });
        addNotification('error', `错误: ${err.message}`);
    }
  };

  const checkConnection = async (): Promise<boolean> => {
      setApiStatus('checking');
      setApiMsg('Connecting...');
      const result = await testApiConnection();
      if (result.success) {
          setApiStatus('ok');
          setApiMsg(result.message);
          setTimeout(() => { if(apiStatus === 'ok') setApiMsg(''); }, 3000);
          return true;
      } else {
          setApiStatus('error');
          setApiMsg(result.message);
          return false;
      }
  };

  return (
    <div className="flex flex-col h-full text-zinc-400 select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#18181b]">
        <div className="flex items-center gap-2 text-xs font-bold text-zinc-200 tracking-wider">
            <FolderOpen size={14} className="text-indigo-500" /> 
            ASSETS
        </div>
        <button 
            onClick={() => checkConnection()} 
            title={apiMsg || "Check API"}
            className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                apiStatus === 'error' ? 'bg-red-500/10 text-red-500 animate-pulse' : 
                apiStatus === 'ok' ? 'bg-emerald-500/10 text-emerald-500' : 
                'bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300'
            }`}
        >
            {apiStatus === 'checking' ? <Loader2 size={12} className="animate-spin"/> : <Wifi size={12} />}
        </button>
      </div>

      {apiMsg && (
        <div className={`px-4 py-2 text-[10px] font-mono border-b border-white/5 break-words ${
            apiStatus === 'error' ? 'bg-red-900/20 text-red-400' : 
            apiStatus === 'checking' ? 'bg-blue-900/20 text-blue-400' :
            'bg-emerald-900/20 text-emerald-400'
        }`}>
            {apiMsg}
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        {/* Drop Zones */}
        <div className="p-4 grid grid-cols-2 gap-3 border-b border-white/5 bg-[#131315]">
          <label className="flex flex-col items-center justify-center h-20 gap-2 border border-white/5 border-dashed rounded-lg cursor-pointer hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all group bg-[#18181b]">
            <div className="p-1.5 rounded-full bg-zinc-800 group-hover:bg-indigo-500/20 transition-colors">
                <ImageIcon size={14} className="text-zinc-500 group-hover:text-indigo-400 transition-colors"/>
            </div>
            <span className="text-[10px] font-bold text-zinc-500 group-hover:text-indigo-400">Image</span>
            <input type="file" className="hidden" multiple onChange={handleFileUpload} accept="image/*" />
          </label>
          <label className="flex flex-col items-center justify-center h-20 gap-2 border border-white/5 border-dashed rounded-lg cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-all group bg-[#18181b]">
            <div className="p-1.5 rounded-full bg-zinc-800 group-hover:bg-blue-500/20 transition-colors">
                 <Box size={14} className="text-zinc-500 group-hover:text-blue-400 transition-colors"/>
            </div>
            <span className="text-[10px] font-bold text-zinc-500 group-hover:text-blue-400">GLB Model</span>
            <input type="file" className="hidden" multiple onChange={handleModelUpload} accept=".glb,.gltf" />
          </label>
        </div>

        {/* Asset List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar bg-[#18181b]">
          {assets.map((item) => {
             const isCompleted = item.status === AssetStatus.COMPLETED;
             const canAdd = isCompleted && !!item.modelUrl;
             return (
                <div 
                  key={item.id} 
                  draggable={canAdd}
                  onDragStart={(e) => {
                    if (canAdd && item.modelUrl) {
                        e.dataTransfer.setData('application/json', JSON.stringify({ url: item.modelUrl, name: item.originalName }));
                        e.currentTarget.style.opacity = '0.5';
                    }
                  }}
                  onDragEnd={(e) => e.currentTarget.style.opacity = '1'}
                  className={`group relative p-2 rounded-lg flex items-center gap-3 transition-all border border-transparent hover:bg-[#27272a] hover:border-white/5 ${canAdd ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                  <div className={`text-zinc-600 ${canAdd ? 'group-hover:text-zinc-400' : 'opacity-20'}`}><GripVertical size={12} /></div>
                  
                  <div className="relative w-10 h-10 rounded bg-zinc-800 overflow-hidden shrink-0 border border-white/5">
                     <img src={item.imageUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                     {item.modelUrl && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity">
                            <Box size={14} className="text-white drop-shadow-md" />
                        </div>
                     )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate text-zinc-300 group-hover:text-white transition-colors">{item.originalName}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            item.status === AssetStatus.COMPLETED ? 'bg-emerald-500' :
                            item.status === AssetStatus.PROCESSING ? 'bg-indigo-500 animate-pulse' :
                            item.status === AssetStatus.ERROR ? 'bg-red-500' : 'bg-zinc-600'
                        }`} />
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{item.status}</span>
                    </div>
                  </div>

                  {/* Actions Overlay / Row */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                      {(item.status === AssetStatus.PENDING || item.status === AssetStatus.ERROR) && (
                          <button 
                            onClick={(e) => handleGenerate(e, item.id, item.imageUrl, item.originalName)} 
                            className="p-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 transition-all"
                            title="Generate 3D"
                          >
                            <Sparkles size={14} fill="currentColor" />
                          </button>
                      )}
                      
                      {item.status === AssetStatus.PROCESSING && (
                          <div className="p-2"><Loader2 size={14} className="animate-spin text-indigo-500" /></div>
                      )}

                      {canAdd && (
                          <button 
                            onClick={() => addModelToScene(item.modelUrl!, item.originalName)} 
                            className="p-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-all"
                            title="Add to Scene"
                          >
                            <Plus size={14} />
                          </button>
                      )}
                      
                      <button 
                        onClick={(e) => {
                             e.stopPropagation();
                             if(confirm(`Delete "${item.originalName}"?`)) removeAsset(item.id);
                        }}
                        className="p-1.5 rounded hover:bg-red-900/50 text-zinc-600 hover:text-red-400 transition-all"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                  </div>
                </div>
             );
          })}
        </div>
      </div>
    </div>
  );
}