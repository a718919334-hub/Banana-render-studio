import React, { useState, Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stage, OrbitControls, useGLTF } from '@react-three/drei';
import { useAppStore } from '../store/useAppStore';
import { AssetStatus } from '../types';
import { testApiConnection, uploadImageToTripo, createImageTo3DTask, pollTripoTask, downloadTripoModel, getProxyUrl } from '../services/tripoService';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, Image as ImageIcon, FolderOpen, Wifi, GripVertical, Sparkles, Box, Plus, Trash2, CloudUpload, Download } from 'lucide-react';

// Preview Component for the Hover Card
function AssetPreview3D({ url }: { url: string }) {
    // Reuse proxy logic to ensure remote models load correctly via worker
    const processedUrl = useMemo(() => {
        if (!url) return "";
        if (url.startsWith('blob:') || url.startsWith('data:')) return url;
        // Check if already proxied
        if (url.includes('/proxy?url=')) return url;
        return getProxyUrl(url);
    }, [url]);

    const { scene } = useGLTF(processedUrl || "", true);
    return <primitive object={scene} />;
}

export default function AssetManager() {
  const { assets, addModelToScene, addAsset, updateAsset, removeAsset, addNotification } = useAppStore();
  const [apiStatus, setApiStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [apiMsg, setApiMsg] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // State for Hover Preview
  const [hoveredAsset, setHoveredAsset] = useState<{ id: string, url: string, name: string, top: number } | null>(null);

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

  // 2. Generation Logic with Auto-Download
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
        
        // Generate a safe filename to avoid issues with special characters (Chinese, Emojis, spaces)
        // Format: upload_{timestamp}_{uuid}.{ext}
        const fileExtension = originalName.split('.').pop() || 'png';
        const safeExtension = fileExtension.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(); // Sanitize extension
        const safeFileName = `upload_${Date.now()}_${uuidv4()}.${safeExtension}`;
        
        // Create a new File object with the safe name
        const file = new File([blob], safeFileName, { type: blob.type });

        const imageToken = await uploadImageToTripo(file);
        
        // Use the sanitized extension for the task creation
        const taskId = await createImageTo3DTask(imageToken, safeExtension);

        pollTripoTask(taskId, async (status, remoteModelUrl) => {
            if (status === AssetStatus.COMPLETED && remoteModelUrl) {
                // AUTO-DOWNLOAD Logic: Fetch the model to local memory
                try {
                    addNotification('info', '正在下载模型到本地...');
                    const modelBlob = await downloadTripoModel(remoteModelUrl);
                    const localBlobUrl = URL.createObjectURL(modelBlob);
                    
                    updateAsset(assetId, { status, modelUrl: localBlobUrl });
                    addNotification('success', `模型 "${originalName}" 已下载并就绪！`);
                    
                    // Auto-add to scene using the local URL
                    addModelToScene(localBlobUrl, originalName);

                } catch (downloadErr: any) {
                    // FALLBACK STRATEGY:
                    // If local download fails (proxy missing), fallback to the DIRECT REMOTE URL.
                    // This allows Three.js to try loading it directly (CORS might work depending on CDN).
                    
                    if (downloadErr.message.includes('404')) {
                        addNotification('error', '注意：远程 Worker 不支持代理下载。已切换到直连模式。');
                    } else {
                        addNotification('info', `本地下载失败，尝试使用在线链接...`);
                    }
                    
                    // Use Direct URL, DO NOT use getProxyUrl here as it would likely fail again
                    updateAsset(assetId, { status, modelUrl: remoteModelUrl });
                    addModelToScene(remoteModelUrl, originalName);
                }
            } else {
                updateAsset(assetId, { status, modelUrl: remoteModelUrl });
                if (status === AssetStatus.ERROR) {
                     updateAsset(assetId, { errorMsg: "API Error" });
                     addNotification('error', `生成失败: ${originalName}`);
                }
            }
        });
    } catch (err: any) {
        updateAsset(assetId, { status: AssetStatus.ERROR, errorMsg: err.message });
        addNotification('error', `错误: ${err.message}`);
    }
  };

  const handleDownloadFile = (e: React.MouseEvent, url: string, name: string) => {
      e.stopPropagation();
      const link = document.createElement('a');
      link.href = url;
      link.download = name.endsWith('.glb') ? name : `${name}.glb`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
    <div className="flex flex-col h-full text-zinc-300 select-none relative bg-[#18181b] animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#18181b]/50 backdrop-blur-md z-10 sticky top-0">
        <div className="flex items-center gap-2 text-xs font-bold text-zinc-100 tracking-wider">
            <FolderOpen size={14} className="text-indigo-400" /> 
            ASSETS
        </div>
        <button 
            onClick={() => checkConnection()} 
            title={apiMsg || "Check API"}
            className={`w-6 h-6 rounded flex items-center justify-center transition-all duration-300 ease-silky hover:scale-110 active:scale-95 ${
                apiStatus === 'error' ? 'bg-red-500/10 text-red-400 animate-pulse' : 
                apiStatus === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 
                'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
            }`}
        >
            {apiStatus === 'checking' ? <Loader2 size={12} className="animate-spin"/> : <Wifi size={12} />}
        </button>
      </div>

      {apiMsg && (
        <div className={`px-4 py-2 text-[10px] font-mono border-b border-white/5 break-words animate-slide-in-right ${
            apiStatus === 'error' ? 'bg-red-900/20 text-red-300' : 
            apiStatus === 'checking' ? 'bg-blue-900/20 text-blue-300' :
            'bg-emerald-900/20 text-emerald-300'
        }`}>
            {apiMsg}
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        {/* Drop Zones */}
        <div className="p-4 grid grid-cols-2 gap-3 border-b border-white/5 bg-[#131315]">
          <label className="relative flex flex-col items-center justify-center h-20 gap-2 border border-white/5 border-dashed rounded-lg cursor-pointer transition-all duration-300 ease-silky hover:border-indigo-500/50 hover:bg-indigo-500/5 hover:scale-[1.02] active:scale-[0.98] group bg-[#18181b] overflow-hidden">
            <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="p-1.5 rounded-full bg-zinc-800 group-hover:bg-indigo-500/20 transition-colors relative z-10">
                <ImageIcon size={14} className="text-zinc-400 group-hover:text-indigo-300 transition-colors"/>
            </div>
            <span className="text-[10px] font-bold text-zinc-400 group-hover:text-indigo-300 relative z-10">Image</span>
            <input type="file" className="hidden" multiple onChange={handleFileUpload} accept="image/*" />
          </label>
          <label className="relative flex flex-col items-center justify-center h-20 gap-2 border border-white/5 border-dashed rounded-lg cursor-pointer transition-all duration-300 ease-silky hover:border-blue-500/50 hover:bg-blue-500/5 hover:scale-[1.02] active:scale-[0.98] group bg-[#18181b] overflow-hidden">
             <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="p-1.5 rounded-full bg-zinc-800 group-hover:bg-blue-500/20 transition-colors relative z-10">
                 <Box size={14} className="text-zinc-400 group-hover:text-blue-300 transition-colors"/>
            </div>
            <span className="text-[10px] font-bold text-zinc-400 group-hover:text-blue-300 relative z-10">GLB Model</span>
            <input type="file" className="hidden" multiple onChange={handleModelUpload} accept=".glb,.gltf" />
          </label>
        </div>

        {/* Asset List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar bg-[#18181b]">
          {assets.map((item, index) => {
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
                  onMouseEnter={(e) => {
                      if (canAdd && item.modelUrl) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredAsset({ 
                              id: item.id, 
                              url: item.modelUrl, 
                              name: item.originalName, 
                              top: rect.top 
                          });
                      }
                  }}
                  onMouseLeave={() => setHoveredAsset(null)}
                  className={`group relative p-2 rounded-lg flex items-center gap-3 transition-all duration-300 ease-silky border border-transparent 
                  hover:bg-[#27272a] hover:border-white/5 hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20
                  ${canAdd ? 'cursor-grab active:cursor-grabbing' : ''} animate-fade-in-up`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className={`text-zinc-500 transition-all duration-300 ${canAdd ? 'group-hover:text-zinc-300' : 'opacity-20'}`}><GripVertical size={12} /></div>
                  
                  <div className="relative w-10 h-10 rounded bg-zinc-800 overflow-hidden shrink-0 border border-white/5 transition-transform duration-300 group-hover:scale-105">
                     <img src={item.imageUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                     {item.modelUrl && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <Box size={14} className="text-white drop-shadow-md" />
                        </div>
                     )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate text-zinc-200 group-hover:text-white transition-colors">{item.originalName}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                            item.status === AssetStatus.COMPLETED ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                            item.status === AssetStatus.PROCESSING ? 'bg-indigo-500 animate-pulse' :
                            item.status === AssetStatus.ERROR ? 'bg-red-500' : 'bg-zinc-600'
                        }`} />
                        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">{item.status}</span>
                    </div>
                  </div>

                  {/* Actions Overlay / Row */}
                  <div className="flex items-center gap-1 opacity-0 translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 ease-silky bg-[#27272a]/90 backdrop-blur pl-2 rounded-l">
                      {(item.status === AssetStatus.PENDING || item.status === AssetStatus.ERROR) && (
                          <button 
                            onClick={(e) => handleGenerate(e, item.id, item.imageUrl, item.originalName)} 
                            className="p-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 transition-all duration-200 hover:scale-110 active:scale-95"
                            title="Generate 3D"
                          >
                            <Sparkles size={14} fill="currentColor" />
                          </button>
                      )}
                      
                      {item.status === AssetStatus.PROCESSING && (
                          <div className="p-2"><Loader2 size={14} className="animate-spin text-indigo-400" /></div>
                      )}

                      {canAdd && (
                         <>
                          <button 
                            onClick={() => addModelToScene(item.modelUrl!, item.originalName)} 
                            className="p-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-all duration-200 hover:scale-110 active:scale-95"
                            title="Add to Scene"
                          >
                            <Plus size={14} />
                          </button>
                          
                          <button 
                             onClick={(e) => handleDownloadFile(e, item.modelUrl!, item.originalName)}
                             className="p-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-all duration-200 hover:scale-110 active:scale-95"
                             title="Download GLB"
                           >
                             <Download size={14} />
                           </button>
                         </>
                      )}
                      
                      <button 
                        onClick={(e) => {
                             e.stopPropagation();
                             if (deletingId === item.id) {
                                 removeAsset(item.id);
                                 setDeletingId(null);
                             } else {
                                 setDeletingId(item.id);
                                 setTimeout(() => setDeletingId(null), 3000);
                             }
                        }}
                        className={`p-1.5 rounded transition-all duration-200 hover:scale-110 active:scale-95 ${
                            deletingId === item.id 
                            ? 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-900/50' 
                            : 'hover:bg-red-900/50 text-zinc-500 hover:text-red-400'
                        }`}
                        title={deletingId === item.id ? "Click again to confirm" : "Delete"}
                      >
                        <Trash2 size={14} fill={deletingId === item.id ? "currentColor" : "none"} />
                      </button>
                  </div>
                </div>
             );
          })}
        </div>
      </div>

      {/* --- HOVER PREVIEW POPUP --- */}
      {hoveredAsset && (
          <div 
             className="fixed z-[100] w-64 h-64 bg-[#18181b]/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl flex flex-col overflow-hidden animate-pop-in pointer-events-none transition-all duration-300 ease-silky"
             style={{ 
                 left: '330px', 
                 top: Math.min(window.innerHeight - 270, Math.max(20, hoveredAsset.top - 100))
             }}
          >
              <div className="px-3 py-2 border-b border-white/5 bg-zinc-900/80 flex justify-between items-center shrink-0">
                <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider truncate max-w-[180px]">{hoveredAsset.name}</span>
                <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-bold">PREVIEW</span>
             </div>
             <div className="flex-1 relative bg-gradient-to-b from-[#131315] to-black">
                <Canvas shadows dpr={[1, 2]} camera={{ fov: 45 }}>
                   <Suspense fallback={null}>
                      <Stage intensity={0.5} environment="city" adjustCamera={1.2}>
                         <AssetPreview3D url={hoveredAsset.url} />
                      </Stage>
                   </Suspense>
                   <OrbitControls autoRotate autoRotateSpeed={5} enableZoom={false} enablePan={false} />
                </Canvas>
             </div>
          </div>
      )}
    </div>
  );
}