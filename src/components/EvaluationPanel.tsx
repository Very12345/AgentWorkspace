import { useState } from 'react';
import type { EvaluationTask, ProjectData } from '@/types';
import { submitProblem, waitForEvaluation, downloadEvaluationResult, submitBundle } from '@/lib/api';

interface PendingFile {
  id: string;
  file: File;
  content: string;
  name: string;
}

interface EvaluationPanelProps {
  projectName: string;
  tasks: EvaluationTask[];
  onTasksUpdated: (tasks: EvaluationTask[]) => void;
  projectData?: ProjectData;
}

const SOLVER_TOKEN_KEY = 'solver_token';

export default function EvaluationPanel({ projectName, tasks, onTasksUpdated, projectData }: EvaluationPanelProps) {
  const [problemText, setProblemText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedTask, setSelectedTask] = useState<EvaluationTask | null>(null);
  const [solverToken, setSolverToken] = useState(() => {
    const saved = localStorage.getItem(SOLVER_TOKEN_KEY);
    return saved || '';
  });
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [useCurrentProject, setUseCurrentProject] = useState(false);
  
  const handleTokenChange = (value: string) => {
    setSolverToken(value);
    if (value) {
      localStorage.setItem(SOLVER_TOKEN_KEY, value);
    } else {
      localStorage.removeItem(SOLVER_TOKEN_KEY);
    }
  };
  
  const displayTasks = tasks;

  const createProjectZip = (): Blob | null => {
    if (!projectData?.files || projectData.files.length === 0) {
      return null;
    }
    
    try {
      const files = projectData.files.map(file => ({
        name: file.name || 'index.md',
        content: file.content || ''
      }));
      
      return createZipBlob(files);
    } catch (error) {
      console.error('Failed to create zip:', error);
      return null;
    }
  };

  const createZipBlob = (files: { name: string; content: string }[]): Blob => {
    const zipParts: Uint8Array[] = [];
    let offset = 0;
    const fileEntries: { crc32: number; compressedSize: number; uncompressedSize: number; name: string; localHeaderOffset: number }[] = [];
    
    for (const file of files) {
      const content = file.content;
      const contentBytes = new TextEncoder().encode(content);
      
      const crc32 = crc32Bytes(contentBytes);
      const compressedSize = contentBytes.length;
      const uncompressedSize = contentBytes.length;
      
      const localHeader = createLocalFileHeader(file.name, compressedSize, uncompressedSize, crc32);
      zipParts.push(localHeader);
      
      fileEntries.push({
        crc32,
        compressedSize,
        uncompressedSize,
        name: file.name,
        localHeaderOffset: offset
      });
      
      zipParts.push(contentBytes);
      offset += localHeader.length + contentBytes.length;
    }
    
    const centralDirectoryOffset = offset;
    let centralDirectorySize = 0;
    
    for (const entry of fileEntries) {
      const centralEntry = createCentralDirectoryEntry(entry);
      zipParts.push(centralEntry);
      offset += centralEntry.length;
      centralDirectorySize += centralEntry.length;
    }
    
    const eocd = createEndOfCentralDirectory(fileEntries.length, centralDirectorySize, centralDirectoryOffset);
    zipParts.push(eocd);
    
    const totalSize = zipParts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalSize);
    let writeOffset = 0;
    for (const part of zipParts) {
      result.set(part, writeOffset);
      writeOffset += part.length;
    }
    
    return new Blob([result], { type: 'application/zip' });
  };

  const crc32Bytes = (data: Uint8Array): number => {
    let crc = 0xFFFFFFFF;
    const table: number[] = [];
    
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  const createLocalFileHeader = (fileName: string, compressedSize: number, uncompressedSize: number, crc32: number): Uint8Array => {
    const header = new Uint8Array(30 + fileName.length);
    const view = new DataView(header.buffer);
    
    view.setUint32(0, 0x04034B50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc32, true);
    view.setUint32(18, compressedSize, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, fileName.length, true);
    view.setUint16(28, 0, true);
    
    const nameBytes = new TextEncoder().encode(fileName);
    header.set(nameBytes, 30);
    
    return header;
  };

  const createCentralDirectoryEntry = (entry: { name: string; crc32: number; compressedSize: number; uncompressedSize: number; localHeaderOffset: number }): Uint8Array => {
    const entrySize = 46 + entry.name.length;
    const header = new Uint8Array(entrySize);
    const view = new DataView(header.buffer);
    
    view.setUint32(0, 0x02014B50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, entry.crc32, true);
    view.setUint32(20, entry.compressedSize, true);
    view.setUint32(24, entry.uncompressedSize, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.localHeaderOffset, true);
    
    const nameBytes = new TextEncoder().encode(entry.name);
    header.set(nameBytes, 46);
    
    return header;
  };

  const createEndOfCentralDirectory = (entryCount: number, centralDirSize: number, centralDirOffset: number): Uint8Array => {
    const eocd = new Uint8Array(22);
    const view = new DataView(eocd.buffer);
    
    view.setUint32(0, 0x06054B50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, entryCount, true);
    view.setUint16(10, entryCount, true);
    view.setUint32(12, centralDirSize, true);
    view.setUint32(16, centralDirOffset, true);
    view.setUint16(20, 0, true);
    
    return eocd;
  };

  const handleSubmit = async () => {
    if (!problemText.trim() && pendingFiles.length === 0) {
      alert('请输入题目内容或选择文件');
      return;
    }
    
    setSubmitting(true);
    
    try {
      if (useCurrentProject && projectData) {
        const projectZip = await createProjectZip();
        if (!projectZip) {
          alert('无法创建项目压缩包');
          setSubmitting(false);
          return;
        }
        
        const problems: string[] = [];
        
        if (problemText.trim()) {
          problems.push(problemText);
        }
        
        for (const pendingFile of pendingFiles) {
          problems.push(pendingFile.content);
        }
        
        const response = await submitBundle(projectZip, problems, undefined, solverToken || undefined);
        
        if (response && response.task_ids) {
          const newTasks: EvaluationTask[] = response.task_ids.map((taskId: string) => ({
            taskId,
            problem: problemText.trim() || '多题目测评',
            status: 'pending',
            submittedAt: Date.now()
          }));
          
          const updatedTasks = [...newTasks, ...displayTasks];
          onTasksUpdated(updatedTasks);
          
          for (const task of newTasks) {
            setTimeout(() => {
              pollTaskStatus(task.taskId, updatedTasks);
            }, 500);
          }
          
          setProblemText('');
          setPendingFiles([]);
          alert(`成功提交 ${response.count} 个测评任务`);
        } else {
          alert('提交失败');
        }
      } else {
        if (pendingFiles.length > 0) {
          for (const pendingFile of pendingFiles) {
            const taskId = await submitProblem(pendingFile.content, projectName, solverToken || undefined);
            
            const newTask: EvaluationTask = {
              taskId: taskId || ('temp-' + Date.now()),
              problem: pendingFile.name + ': ' + pendingFile.content.substring(0, 50) + (pendingFile.content.length > 50 ? '...' : ''),
              status: taskId ? 'pending' : 'error',
              submittedAt: Date.now(),
              error: taskId ? undefined : '提交失败'
            };
            
            const newTasks = [newTask, ...displayTasks];
            onTasksUpdated(newTasks);
            
            if (taskId) {
              setTimeout(() => {
                pollTaskStatus(taskId, newTasks);
              }, 500);
            }
          }
          setPendingFiles([]);
          setProblemText('');
        } else {
          const taskId = await submitProblem(problemText, projectName, solverToken || undefined);
        
          const newTask: EvaluationTask = {
            taskId: taskId || ('temp-' + Date.now()),
            problem: problemText,
            status: taskId ? 'pending' : 'error',
            submittedAt: Date.now(),
            error: taskId ? undefined : '提交失败'
          };
        
          const newTasks = [newTask, ...displayTasks];
          onTasksUpdated(newTasks);
          setProblemText('');
        
          if (taskId) {
            pollTaskStatus(taskId, newTasks);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      const newTask: EvaluationTask = {
        taskId: 'temp-' + Date.now(),
        problem: problemText,
        status: 'error',
        submittedAt: Date.now(),
        error: errorMessage
      };
      
      const newTasks = [newTask, ...displayTasks];
      onTasksUpdated(newTasks);
      setProblemText('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    try {
      const newPendingFiles: PendingFile[] = [];
      
      for (const file of files) {
        const content = await file.text();
        newPendingFiles.push({
          id: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          file,
          content,
          name: file.name
        });
      }
      
      setPendingFiles(prev => [...prev, ...newPendingFiles]);
    } catch (error) {
      console.error('Failed to load files:', error);
      alert('加载文件失败');
    } finally {
      event.target.value = '';
    }
  };

  const removePendingFile = (id: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id));
  };

  const pollTaskStatus = async (taskId: string, initialTasks: EvaluationTask[]) => {
    let currentTasks = [...initialTasks];
    
    try {
      const result = await waitForEvaluation(taskId, (status) => {
        const updated = currentTasks.map(t => 
          t.taskId === taskId 
            ? { 
                ...t, 
                status: status.status as 'pending' | 'running' | 'complete' | 'error', 
                phase: status.phase, 
                filesDone: status.files_done,
                createdAt: status.created_at,
                startedAt: status.started_at || undefined,
                finishedAt: status.finished_at || undefined
              }
            : t
        );
        currentTasks = updated;
        onTasksUpdated(updated);
      }, solverToken || undefined);
      
      if (result) {
        const { getEvaluationStatus, fetchAndSaveEvaluationBackup } = await import('@/lib/api');
        const statusInfo = await getEvaluationStatus(taskId, solverToken || undefined);
        
        const backupData = await fetchAndSaveEvaluationBackup(taskId, solverToken || undefined);
        
        const updated = currentTasks.map(t => 
          t.taskId === taskId ? { 
            ...t, 
            status: 'complete' as const, 
            result,
            createdAt: statusInfo?.created_at,
            startedAt: statusInfo?.started_at || undefined,
            finishedAt: statusInfo?.finished_at || undefined,
            backupData: backupData || undefined
          } : t
        );
        onTasksUpdated(updated);
      } else if (!result) {
        const updated = currentTasks.map(t => 
          t.taskId === taskId ? { 
            ...t, 
            status: 'error' as const, 
            error: '获取测评结果失败'
          } : t
        );
        onTasksUpdated(updated);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      const updated = currentTasks.map(t => 
        t.taskId === taskId ? { ...t, status: 'error' as const, error: errorMessage } : t
      );
      onTasksUpdated(updated);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'text-gray-500';
      case 'running': return 'text-yellow-600';
      case 'complete': return 'text-green-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '等待中';
      case 'running': return '运行中';
      case 'complete': return '已完成';
      case 'error': return '错误';
      default: return status;
    }
  };

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <h3 className="font-semibold mb-4">测评管理</h3>
      
      <div className="mb-4">
        <div className="mb-3">
          <label className="block text-sm text-gray-600 mb-1">Solver Token（可选）</label>
          <input 
            type="password" 
            value={solverToken} 
            onChange={(e) => handleTokenChange(e.target.value)} 
            placeholder="输入认证密码（会自动保存）" 
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        
        <div className="flex items-center mb-3">
          <input
            type="checkbox"
            id="useCurrentProject"
            checked={useCurrentProject}
            onChange={(e) => setUseCurrentProject(e.target.checked)}
            className="mr-2"
          />
          <label htmlFor="useCurrentProject" className="text-sm text-gray-600">
            使用当前项目进行测评
          </label>
          {useCurrentProject && (
            <span className="ml-2 text-xs text-gray-400">
              (会上传项目文件到服务器)
            </span>
          )}
        </div>
        
        <label className="block text-sm text-gray-600 mb-2">提交题目</label>
        <textarea 
          value={problemText} 
          onChange={(e) => setProblemText(e.target.value)} 
          placeholder="输入要测评的题目内容..." 
          className="w-full min-h-[100px] px-3 py-2 border border-gray-200 rounded-lg text-sm resize-vertical"
        />
        <button 
          onClick={handleSubmit} 
          disabled={submitting} 
          className={`mt-2 px-4 py-2 rounded-lg font-medium ${submitting
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {submitting ? '提交中...' : '提交测评'}
        </button>
        
        <div className="mt-4">
          <label className="block text-sm text-gray-600 mb-2">从本地文件加载测评</label>
          <input
            type="file"
            accept=".md,.txt"
            multiple
            onChange={handleFileSelect}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">支持 .md 和 .txt 文件，可选择多个文件</p>
          
          {pendingFiles.length > 0 && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-700">
                  待提交文件 ({pendingFiles.length})
                </span>
              </div>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {pendingFiles.map((pendingFile) => (
                  <div key={pendingFile.id} className="flex items-center justify-between bg-white p-2 rounded border">
                    <span className="text-sm truncate flex-1">{pendingFile.file.name}</span>
                    <button
                      onClick={() => removePendingFile(pendingFile.id)}
                      className="ml-2 p-1 text-gray-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">测评历史</h4>
        {displayTasks.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无测评记录</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {displayTasks.map((task) => (
              <div 
                key={task.taskId} 
                className={`p-3 bg-white border rounded-lg ${selectedTask?.taskId === task.taskId ? 'border-blue-300' : 'border-gray-200'} relative`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`text-sm font-medium ${getStatusColor(task.status)}`}>
                          {getStatusText(task.status)}
                        </span>
                        {task.phase && (
                          <span className="text-xs text-gray-500 ml-2">
                            {task.phase}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {formatTime(task.submittedAt)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('确定要删除这条测评记录吗？')) {
                        const newTasks = displayTasks.filter(t => t.taskId !== task.taskId);
                        onTasksUpdated(newTasks);
                        if (selectedTask?.taskId === task.taskId) {
                          setSelectedTask(null);
                        }
                      }
                    }}
                    className="ml-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="删除"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                
                {task.filesDone && task.filesDone.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    已完成: {task.filesDone.join(', ')}
                  </div>
                )}
                
                {task.status === 'complete' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadEvaluationResult(task.taskId, solverToken || undefined, task.backupData);
                    }}
                    className="mt-2 px-3 py-1.5 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600"
                  >
                    下载结果 (ZIP)
                  </button>
                )}
                
                {selectedTask?.taskId === task.taskId && (
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    <div className="text-sm text-gray-500">
                      <strong className="text-gray-700">题目:</strong> {task.problem}
                    </div>
                    
                    {task.createdAt && (
                      <div className="text-xs text-gray-400">
                        创建时间: {new Date(task.createdAt).toLocaleString('zh-CN')}
                      </div>
                    )}
                    
                    {task.startedAt && (
                      <div className="text-xs text-gray-400">
                        开始时间: {new Date(task.startedAt).toLocaleString('zh-CN')}
                      </div>
                    )}
                    
                    {task.finishedAt && (
                      <div className="text-xs text-gray-400">
                        完成时间: {new Date(task.finishedAt).toLocaleString('zh-CN')}
                      </div>
                    )}
                    
                    {task.status === 'error' && (
                      <div className="text-sm text-red-600 mt-2">
                        <strong>错误:</strong> {task.error}
                      </div>
                    )}
                    
                    {task.status === 'complete' && task.result && (
                      <div className="mt-2">
                        <div className="text-sm font-medium text-gray-700 mb-1">测评结果预览:</div>
                        <div 
                          className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg preview-panel"
                          dangerouslySetInnerHTML={{ __html: (window as any).marked?.parse(task.result) || task.result }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
