import { useState, useEffect } from 'react'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import katex from 'katex'
import 'highlight.js/styles/atom-one-light.css'
import 'katex/dist/katex.min.css'
import type { ProjectData, EvaluationTask } from '@/types'
import { submitProblem, submitBundle, waitForEvaluation, getEvaluationStatus, fetchAndSaveEvaluationBackup, loadProjectData } from '@/lib/api'

hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)

declare const marked: {
  parse: (text: string) => string
}

interface EvaluationPageProps {
  projectName: string
  tasks: EvaluationTask[]
  onTasksUpdated: (tasks: EvaluationTask[]) => void
}

const SOLVER_TOKEN_KEY = 'solver_token'

interface PendingFile {
  id: string
  file: File
  content: string
  name: string
}

export default function EvaluationPage({ projectName, tasks, onTasksUpdated }: EvaluationPageProps) {
  const [problemText, setProblemText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedTask, setSelectedTask] = useState<EvaluationTask | null>(null)
  const [solverToken, setSolverToken] = useState(() => {
    const saved = localStorage.getItem(SOLVER_TOKEN_KEY)
    return saved || ''
  })
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [useCurrentProject, setUseCurrentProject] = useState(false)
  const [projectData, setProjectData] = useState<ProjectData | null>(null)

  useEffect(() => {
    const loadData = async () => {
      if (useCurrentProject && projectName) {
        const data = await loadProjectData(projectName)
        setProjectData(data)
      }
    }
    loadData()
  }, [useCurrentProject, projectName])

  const displayTasks = tasks

  const handleTokenChange = (value: string) => {
    setSolverToken(value)
    if (value) {
      localStorage.setItem(SOLVER_TOKEN_KEY, value)
    } else {
      localStorage.removeItem(SOLVER_TOKEN_KEY)
    }
  }

  const createProjectZip = (): Blob | null => {
    if (!projectData?.files || projectData.files.length === 0) {
      return null
    }

    try {
      const files = projectData.files.map(file => ({
        name: file.name || 'index.md',
        content: file.content || ''
      }))

      const zipData: number[] = []
      let offset = 0

      for (const file of files) {
        const contentBytes = new TextEncoder().encode(file.content)
        const fileNameBytes = new TextEncoder().encode(file.name)
        const crc32 = crc32Checksum(contentBytes)
        const fileHeader = createZipFileHeader(fileNameBytes.length, contentBytes.length, crc32)
        offset += fileHeader.length + contentBytes.length + 12

        zipData.push(...fileHeader)
        zipData.push(...contentBytes)
        zipData.push(...createZipDataDescriptor(contentBytes.length, crc32))
      }

      const centralDirOffset = offset
      const centralDir: number[] = []

      for (const file of files) {
        const fileNameBytes = new TextEncoder().encode(file.name)
        const contentBytes = new TextEncoder().encode(file.content)
        const crc32 = crc32Checksum(contentBytes)
        centralDir.push(...createZipCentralDirEntry(fileNameBytes, contentBytes.length, crc32, centralDirOffset))
      }

      const eocd = createZipEOCD(centralDir.length, centralDirOffset)

      zipData.push(...centralDir)
      zipData.push(...eocd)

      return new Blob([new Uint8Array(zipData)], { type: 'application/zip' })
    } catch {
      return null
    }
  }

  const crc32Checksum = (data: Uint8Array): number => {
    let crc = 0xFFFFFFFF
    const table: number[] = []
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      }
      table[i] = c
    }
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }

  const createZipFileHeader = (fileNameLen: number, dataLen: number, crc: number): number[] => {
    const header: number[] = []
    header.push(0x50, 0x4B, 0x03, 0x04)
    header.push(0x14, 0x00)
    header.push(0x00, 0x00)
    header.push(0x00, 0x00)
    header.push(0x00, 0x00)
    header.push(0x00, 0x00)
    header.push((fileNameLen >> 0) & 0xFF, (fileNameLen >> 8) & 0xFF)
    header.push(0x00, 0x00)
    header.push((dataLen >> 0) & 0xFF, (dataLen >> 8) & 0xFF, (dataLen >> 16) & 0xFF, (dataLen >> 24) & 0xFF)
    header.push((crc >> 0) & 0xFF, (crc >> 8) & 0xFF, (crc >> 16) & 0xFF, (crc >> 24) & 0xFF)
    return header
  }

  const createZipDataDescriptor = (dataLen: number, crc: number): number[] => {
    const desc: number[] = []
    desc.push(0x50, 0x4B, 0x07, 0x08)
    desc.push((crc >> 0) & 0xFF, (crc >> 8) & 0xFF, (crc >> 16) & 0xFF, (crc >> 24) & 0xFF)
    desc.push((dataLen >> 0) & 0xFF, (dataLen >> 8) & 0xFF, (dataLen >> 16) & 0xFF, (dataLen >> 24) & 0xFF)
    desc.push((dataLen >> 0) & 0xFF, (dataLen >> 8) & 0xFF, (dataLen >> 16) & 0xFF, (dataLen >> 24) & 0xFF)
    return desc
  }

  const createZipCentralDirEntry = (fileNameBytes: Uint8Array, dataLen: number, crc: number, offset: number): number[] => {
    const entry: number[] = []
    entry.push(0x50, 0x4B, 0x01, 0x02)
    entry.push(0x14, 0x00)
    entry.push(0x14, 0x00)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push((dataLen >> 0) & 0xFF, (dataLen >> 8) & 0xFF, (dataLen >> 16) & 0xFF, (dataLen >> 24) & 0xFF)
    entry.push((crc >> 0) & 0xFF, (crc >> 8) & 0xFF, (crc >> 16) & 0xFF, (crc >> 24) & 0xFF)
    entry.push((dataLen >> 0) & 0xFF, (dataLen >> 8) & 0xFF, (dataLen >> 16) & 0xFF, (dataLen >> 24) & 0xFF)
    entry.push((fileNameBytes.length >> 0) & 0xFF, (fileNameBytes.length >> 8) & 0xFF)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push(0x00, 0x00)
    entry.push((offset >> 0) & 0xFF, (offset >> 8) & 0xFF, (offset >> 16) & 0xFF, (offset >> 24) & 0xFF)
    entry.push(...fileNameBytes)
    return entry
  }

  const createZipEOCD = (centralDirLen: number, offset: number): number[] => {
    const eocd: number[] = []
    eocd.push(0x50, 0x4B, 0x05, 0x06)
    eocd.push(0x00, 0x00)
    eocd.push(0x00, 0x00)
    eocd.push(0x01, 0x00)
    eocd.push(0x01, 0x00)
    eocd.push((centralDirLen >> 0) & 0xFF, (centralDirLen >> 8) & 0xFF, (centralDirLen >> 16) & 0xFF, (centralDirLen >> 24) & 0xFF)
    eocd.push((offset >> 0) & 0xFF, (offset >> 8) & 0xFF, (offset >> 16) & 0xFF, (offset >> 24) & 0xFF)
    eocd.push((centralDirLen >> 0) & 0xFF, (centralDirLen >> 8) & 0xFF)
    return eocd
  }

  const handleSubmit = async () => {
    if (!problemText.trim() && pendingFiles.length === 0) {
      alert('请输入题目内容或选择文件')
      return
    }

    setSubmitting(true)

    try {
      if (useCurrentProject && projectData) {
        const projectZip = await createProjectZip()
        if (!projectZip) {
          alert('无法创建项目压缩包')
          setSubmitting(false)
          return
        }

        const problems: string[] = []

        if (problemText.trim()) {
          problems.push(problemText)
        }

        for (const pendingFile of pendingFiles) {
          problems.push(pendingFile.content)
        }

        const response = await submitBundle(projectZip, problems, undefined, solverToken || undefined)

        if (response && response.task_ids) {
          const newTasks: EvaluationTask[] = response.task_ids.map((taskId: string) => ({
            taskId,
            problem: problemText.trim() || '多题目测评',
            status: 'pending',
            submittedAt: Date.now()
          }))

          const updatedTasks = [...newTasks, ...displayTasks]
          onTasksUpdated(updatedTasks)

          for (const task of newTasks) {
            setTimeout(() => {
              pollTaskStatus(task.taskId)
            }, 500)
          }

          setProblemText('')
          setPendingFiles([])
          alert(`成功提交 ${response.count} 个测评任务`)
        } else {
          alert('提交失败')
        }
      } else {
        if (pendingFiles.length > 0) {
          for (const pendingFile of pendingFiles) {
            const taskId = await submitProblem(pendingFile.content, projectName, solverToken || undefined)

            const newTask: EvaluationTask = {
              taskId: taskId || ('temp-' + Date.now()),
              problem: pendingFile.name + ': ' + pendingFile.content.substring(0, 50) + (pendingFile.content.length > 50 ? '...' : ''),
              status: taskId ? 'pending' : 'error',
              submittedAt: Date.now(),
              error: taskId ? undefined : '提交失败'
            }

            const newTasks = [newTask, ...displayTasks]
            onTasksUpdated(newTasks)

            if (taskId) {
              setTimeout(() => {
                pollTaskStatus(taskId)
              }, 500)
            }
          }
          setPendingFiles([])
          setProblemText('')
        } else {
          const taskId = await submitProblem(problemText, projectName, solverToken || undefined)

          const newTask: EvaluationTask = {
            taskId: taskId || ('temp-' + Date.now()),
            problem: problemText,
            status: taskId ? 'pending' : 'error',
            submittedAt: Date.now(),
            error: taskId ? undefined : '提交失败'
          }

          const newTasks = [newTask, ...displayTasks]
          onTasksUpdated(newTasks)
          setProblemText('')

          if (taskId) {
            pollTaskStatus(taskId)
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      const newTask: EvaluationTask = {
        taskId: 'temp-' + Date.now(),
        problem: problemText || '测评任务',
        status: 'error',
        submittedAt: Date.now(),
        error: errorMessage
      }

      const newTasks = [newTask, ...displayTasks]
      onTasksUpdated(newTasks)
      setProblemText('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const newPendingFiles: PendingFile[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const content = await file.text()
      newPendingFiles.push({
        id: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        file,
        content,
        name: file.name
      })
    }

    setPendingFiles(prev => [...prev, ...newPendingFiles])
    event.target.value = ''
  }

  const removePendingFile = (id: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id))
  }

  const pollTaskStatus = async (taskId: string) => {
    try {
      const result = await waitForEvaluation(taskId, (status) => {
        onTasksUpdated(tasks.map(t =>
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
        ))
      }, solverToken || undefined)

      if (result) {
        const statusInfo = await getEvaluationStatus(taskId, solverToken || undefined)
        const backupData = await fetchAndSaveEvaluationBackup(taskId, solverToken || undefined)

        onTasksUpdated(tasks.map(t =>
          t.taskId === taskId ? {
            ...t,
            status: 'complete' as const,
            result,
            createdAt: statusInfo?.created_at,
            startedAt: statusInfo?.started_at || undefined,
            finishedAt: statusInfo?.finished_at || undefined,
            backupData: backupData || undefined
          } : t
        ))
      } else if (!result) {
        onTasksUpdated(tasks.map(t =>
          t.taskId === taskId ? {
            ...t,
            status: 'error' as const,
            error: '获取测评结果失败'
          } : t
        ))
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      onTasksUpdated(tasks.map(t =>
        t.taskId === taskId ? { ...t, status: 'error' as const, error: errorMessage } : t
      ))
    }
  }

  const handleTaskClick = async (task: EvaluationTask) => {
    setSelectedTask(task)

    if (task.status !== 'complete' && task.status !== 'error') {
      pollTaskStatus(task.taskId)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'text-yellow-600'
      case 'running': return 'text-blue-600'
      case 'complete': return 'text-green-600'
      case 'error': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '等待中'
      case 'running': return '运行中'
      case 'complete': return '已完成'
      case 'error': return '错误'
      default: return status
    }
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const renderMarkdownWithMath = (text: string): string => {
    let html = marked.parse(text) as string

    html = html.replace(/\$\$(.*?)\$\$/gs, (_match: string, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), {
          throwOnError: false,
          displayMode: true
        })
      } catch {
        return `<div class="text-red-500">${formula}</div>`
      }
    })

    html = html.replace(/\$(.*?)\$/g, (_match: string, formula: string) => {
      try {
        return katex.renderToString(formula.trim(), {
          throwOnError: false,
          displayMode: false
        })
      } catch {
        return `<span class="text-red-500">${formula}</span>`
      }
    })

    return html
  }

  const downloadEvaluationResult = async (taskId: string, token?: string, backupKey?: string) => {
    const { downloadEvaluationResult: apiDownload } = await import('@/lib/api')
    await apiDownload(taskId, token, backupKey)
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">测评管理</h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">提交测评</h2>

            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">Solver Token（可选）</label>
              <input
                type="password"
                value={solverToken}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="输入认证密码（会自动保存）"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div className="flex items-center mb-4">
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

            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-2">提交题目</label>
              <textarea
                value={problemText}
                onChange={(e) => setProblemText(e.target.value)}
                placeholder="输入要测评的题目内容..."
                className="w-full min-h-[200px] px-3 py-2 border border-gray-200 rounded-lg text-sm resize-vertical"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-2">或选择文件</label>
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center hover:border-blue-300 transition-colors">
                <input
                  type="file"
                  accept=".md,.txt,.py,.js,.json"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  id="fileInput"
                />
                <label htmlFor="fileInput" className="cursor-pointer">
                  <div className="text-gray-500">
                    <div className="text-lg mb-1">📁</div>
                    <div className="text-sm">点击选择文件或拖拽到此处</div>
                  </div>
                </label>
              </div>

              {pendingFiles.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-blue-700">
                      待提交文件 ({pendingFiles.length})
                    </span>
                  </div>
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                    {pendingFiles.map((pendingFile) => (
                      <div key={pendingFile.id} className="flex items-center justify-between bg-gray-50 p-2 rounded border">
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

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium"
            >
              {submitting ? '提交中...' : '提交测评'}
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">测评历史</h2>

            {displayTasks.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">暂无测评记录</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {displayTasks.map((task) => (
                  <div
                    key={task.taskId}
                    className={`p-4 border rounded-lg cursor-pointer transition-all ${
                      selectedTask?.taskId === task.taskId
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-200 hover:bg-gray-50'
                    }`}
                    onClick={() => handleTaskClick(task)}
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
                        <div className="text-xs text-gray-400 mt-1 font-mono">
                          Task ID: {task.taskId}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm('确定要删除这条测评记录吗？')) {
                            const newTasks = displayTasks.filter(t => t.taskId !== task.taskId)
                            onTasksUpdated(newTasks)
                            if (selectedTask?.taskId === task.taskId) {
                              setSelectedTask(null)
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
                      <div className="text-xs text-gray-500 mt-2">
                        已完成: {task.filesDone.map(item => typeof item === 'object' ? item.name || item.file || JSON.stringify(item) : item).join(', ')}
                      </div>
                    )}

                    {task.status === 'complete' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          downloadEvaluationResult(task.taskId, solverToken || undefined, task.backupData)
                        }}
                        className="mt-2 px-3 py-1.5 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600"
                      >
                        下载结果 (ZIP)
                      </button>
                    )}

                    {selectedTask?.taskId === task.taskId && (
                      <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
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

                        {task.result && (
                          <div className="mt-3">
                            <div className="text-sm font-medium text-gray-700 mb-2">测评结果</div>
                            <div
                              className="bg-gray-50 rounded-lg p-4 max-h-[300px] overflow-y-auto prose max-w-none"
                              dangerouslySetInnerHTML={{ __html: renderMarkdownWithMath(task.result) }}
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
      </div>
    </div>
  )
}