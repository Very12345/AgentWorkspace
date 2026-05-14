import { useState } from 'react';
import type { EvaluationTask } from '@/types';
import { submitProblem, waitForEvaluation, downloadEvaluationResult } from '@/lib/api';

interface EvaluationPanelProps {
  projectName: string;
  tasks: EvaluationTask[];
  onTasksUpdated: (tasks: EvaluationTask[]) => void;
}

export default function EvaluationPanel({ projectName, tasks, onTasksUpdated }: EvaluationPanelProps) {
  const [problemText, setProblemText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedTask, setSelectedTask] = useState<EvaluationTask | null>(null);
  const [solverToken, setSolverToken] = useState('');
  
  const displayTasks = tasks;

  const handleSubmit = async () => {
    if (!problemText.trim()) {
      alert('请输入题目内容');
      return;
    }
    
    setSubmitting(true);
    
    try {
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

  const handleFileLoad = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setSubmitting(true);
    
    try {
      const newTasks: EvaluationTask[] = [];
      
      for (const file of files) {
        const content = await file.text();
        const newTask: EvaluationTask = {
          taskId: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          problem: content,
          status: 'pending',
          submittedAt: Date.now(),
          fileName: file.name
        };
        newTasks.push(newTask);
      }
      
      const updatedTasks = [...newTasks, ...displayTasks];
      onTasksUpdated(updatedTasks);
      
      for (const task of newTasks) {
        if (task.taskId && task.status === 'pending') {
          setTimeout(() => {
            pollTaskStatus(task.taskId!, updatedTasks);
          }, 100);
        }
      }
      
      alert(`成功加载 ${files.length} 个文件`);
    } catch (error) {
      console.error('Failed to load files:', error);
      alert('加载文件失败');
    } finally {
      setSubmitting(false);
      event.target.value = '';
    }
  };

  const pollTaskStatus = async (taskId: string, currentTasks: EvaluationTask[]) => {
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
            onChange={(e) => setSolverToken(e.target.value)} 
            placeholder="输入认证密码" 
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
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
        
        <div className="mt-3">
          <label className="block text-sm text-gray-600 mb-1">从本地文件加载测评</label>
          <input
            type="file"
            accept=".md,.txt"
            multiple
            onChange={handleFileLoad}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">支持 .md 和 .txt 文件，可选择多个文件</p>
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
                  className="absolute top-2 right-2 px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200"
                >
                  删除
                </button>
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
                
                {task.filesDone && task.filesDone.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    已完成: {task.filesDone.join(', ')}
                  </div>
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
                        <div className="text-sm font-medium text-gray-700 mb-1">测评结果:</div>
                        <div 
                          className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg preview-panel"
                          dangerouslySetInnerHTML={{ __html: (window as any).marked?.parse(task.result) || task.result }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadEvaluationResult(task.taskId, solverToken || undefined, task.backupData);
                          }}
                          className="mt-2 px-3 py-1 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600"
                        >
                          下载完整结果 (ZIP)
                        </button>
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
