import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AssetStatus } from '../types';
import { testApiConnection, uploadImageToTripo, createImageTo3DTask, pollTripoTask } from '../services/tripoService';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, Search, Image as ImageIcon, FolderOpen, AlertCircle, Wifi, WifiOff, GripVertical, Download, Sparkles, Box, RefreshCw, Upload, Plus, Trash2 } from 'lucide-react';

export default function AssetManager() {
  const { assets, addModelToScene, addAsset, updateAsset, removeAsset, sceneObjects, addNotification } = useAppStore();
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
        imageUrl: "https://placehold.co/100x100/252526/white?text=GLB", 
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
      setApiMsg('正在连接网关...');
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
    <div className="flex flex-col h-full bg-[#1e1e1e] border-r border-slate-900 w-80 text-slate-300 select-none">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-900 bg-[#252526] text-xs font-medium text-slate-100">
        <div className="flex items-center gap-2"><FolderOpen size={14} /> 项目资产</div>
        <button 
            onClick={() => checkConnection()} 
            title={apiMsg || "测试连接"}
            className={`p-1 rounded hover:bg-slate-700 transition-colors ${apiStatus === 'error' ? 'text-red-500 bg-red-900/10' : apiStatus === 'ok' ? 'text-emerald-500' : 'text-slate-400'}`}
        >
            {apiStatus === 'checking' ? <Loader2 size={12} className="animate-spin"/> : <Wifi size={12} />}
        </button>
      </div>

      {apiMsg && (
        <div className={`px-4 py-2 text-[10px] font-mono border-b border-slate-800 break-words ${
            apiStatus === 'error' ? 'bg-red-900/20 text-red-300' : 
            apiStatus === 'checking' ? 'bg-blue-900/20 text-blue-300' :
            'bg-emerald-900/20 text-emerald-300'
        }`}>
            {apiMsg}
        </div>
      )}

      <div className="flex-1 flex flex-col">
        <div className="p-3 border-b border-slate-800 bg-[#252526] flex flex-col gap-2">
          <label className="flex items-center justify-center w-full h-9 gap-2 border border-slate-700/50 border-dashed rounded cursor-pointer hover:border-slate-500 hover:bg-slate-800 transition bg-[#1e1e1e]">
            <ImageIcon size={14} className="text-slate-400"/><span className="text-xs text-slate-400">导入图片</span>
            <input type="file" className="hidden" multiple onChange={handleFileUpload} accept="image/*" />
          </label>
          <label className="flex items-center justify-center w-full h-9 gap-2 border border-slate-700/50 border-dashed rounded cursor-pointer hover:border-slate-500 hover:bg-slate-800 transition bg-[#1e1e1e]">
            <Box size={14} className="text-slate-400"/><span className="text-xs text-slate-400">导入模型 (.glb)</span>
            <input type="file" className="hidden" multiple onChange={handleModelUpload} accept=".glb,.gltf" />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-1 space-y-1">
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
                  className={`group p-2 rounded flex items-center gap-2 transition border border-transparent hover:bg-[#2a2d2e] ${canAdd ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                  <div className={`text-slate-500 ${canAdd ? 'group-hover:text-slate-200' : 'opacity-20'}`}><GripVertical size={12} /></div>
                  <div className="relative w-8 h-8 rounded bg-black/50 overflow-hidden shrink-0 border border-slate-700/50">
                     <img src={item.imageUrl} className="w-full h-full object-cover" alt="" />
                     {item.modelUrl && (
                        <div className="absolute bottom-0 right-0 bg-blue-600/90 p-[2px] rounded-tl-sm shadow-sm" title="包含 3D 模型">
                            <Box size={8} className="text-white" strokeWidth={3} />
                        </div>
                     )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate text-slate-200">{item.originalName}</div>
                    <div className="text-[10px] opacity-60">{item.status}</div>
                    {item.errorMsg && <div className="text-[9px] text-red-400 truncate" title={item.errorMsg}>{item.errorMsg}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                      {(item.status === AssetStatus.PENDING || item.status === AssetStatus.ERROR) && (
                          <button onClick={(e) => handleGenerate(e, item.id, item.imageUrl, item.originalName)} className="p-1.5 bg-blue-600 rounded text-white hover:scale-105 transition"><Sparkles size={12} /></button>
                      )}
                      {item.status === AssetStatus.PROCESSING && <Loader2 size={14} className="animate-spin text-blue-400" />}
                      {canAdd && (
                          <button onClick={() => addModelToScene(item.modelUrl!, item.originalName)} className="p-1.5 hover:bg-slate-600 rounded text-slate-300 transition" title="添加到场景">
                            <Plus size={14} />
                          </button>
                      )}
                      <button 
                        onClick={(e) => {
                             e.stopPropagation();
                             if(confirm(`确定要删除 "${item.originalName}" 吗？`)) {
                                 removeAsset(item.id);
                             }
                        }}
                        className="p-1.5 hover:bg-red-900/30 text-slate-500 hover:text-red-400 rounded transition opacity-0 group-hover:opacity-100" 
                        title="删除"
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