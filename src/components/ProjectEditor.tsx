import { useState, useEffect, useCallback, useRef } from 'react'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/atom-one-light.css'

hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
import type { ProjectData, ProjectFile, Commit, EvaluationTask } from '@/types'
import {
  loadProjectData,
  saveProjectFile,
  createProjectFile,
  deleteProjectFile,
  renameProjectFile,
  saveProjectData,
  updateProject,
  syncFromGitHub,
  generateDiff,
  syncGitHubRepoToProject,
  pushToGitHub,
  shouldAutoSync
} from '@/lib/api'
import EvaluationPanel from './EvaluationPanel'

interface ProjectEditorProps {
  projectName: string
  projectDescription: string
  currentUser: string
  onBack: () => void
  onProjectUpdated: (newProjectName?: string) => void
  githubToken?: string
}

declare const marked: {
  parse: (text: string) => string
}

interface RenderMathOptions {
  delimiters: { left: string; right: string; display: boolean }[]
}

declare global {
  interface Window {
    renderMathInElement?: (element: HTMLElement, options: RenderMathOptions) => void
  }
}

export default function ProjectEditor({ projectName, projectDescription, currentUser, onBack, onProjectUpdated, githubToken }: ProjectEditorProps) {
  const [projectData, setProjectData] = useState<ProjectData>({ files: [] })
  const [currentFile, setCurrentFile] = useState('')
  const currentFileRef = useRef('')
  const [editorContent, setEditorContent] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [showGitHubSync, setShowGitHubSync] = useState(false)
  const [githubRepo, setGithubRepo] = useState('')
  const [githubFilePath, setGithubFilePath] = useState('')
  const [githubBranch, setGithubBranch] = useState('')
  const [syncLoading, setSyncLoading] = useState(false)
  const [renameFile, setRenameFile] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsName, setSettingsName] = useState(projectName)
  const [settingsDescription, setSettingsDescription] = useState(projectDescription)
  const [showRepoSync, setShowRepoSync] = useState(false)
  const [showPushToGitHub, setShowPushToGitHub] = useState(false)
  const [localGithubToken, setLocalGithubToken] = useState('')
  const [pushMessage, setPushMessage] = useState('')
  const [showEvaluation, setShowEvaluation] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [showSyncedFiles, setShowSyncedFiles] = useState(false)
  const [syncedFilesList, setSyncedFilesList] = useState<string[]>([])
  const [syncError, setSyncError] = useState('')

  const loadDoc = useCallback(async (keepCurrentFile: boolean = false) => {
    const data = await loadProjectData(projectName)
    if (data.files.length === 0) {
      data.files = [{ name: '', content: '', history: [] }]
      setCurrentFile('')
      currentFileRef.current = ''
      setEditorContent('')
    } else {
      let targetFile
      if (keepCurrentFile && currentFileRef.current) {
        targetFile = data.files.find(f => f.name === currentFileRef.current)
      }
      if (!targetFile) {
        targetFile = data.files.find(f => f.name === '') || data.files[0]
      }
      setCurrentFile(targetFile.name)
      currentFileRef.current = targetFile.name
      setEditorContent(targetFile.content)
    }
    setProjectData(data)
  }, [projectName])

  const isInitialized = useRef(false)
  
  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true
      loadDoc()
    }
  }, [loadDoc])

  const hasAutoSynced = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (currentFile && projectData.files.length > 0) {
      const file = projectData.files.find(f => f.name === currentFile)
      if (file?.githubSync?.autoSync && !hasAutoSynced.current.has(currentFile)) {
        hasAutoSynced.current.add(currentFile)
        handlePullFromGitHub()
      }
    }
  }, [currentFile, projectData])

  useEffect(() => {
    const syncInterval = setInterval(async () => {
      if (currentFile && projectData.files.length > 0) {
        const file = projectData.files.find(f => f.name === currentFile)
        if (file?.githubSync?.autoSync) {
          await handlePullFromGitHub()
        }
      }
    }, 60000)

    return () => clearInterval(syncInterval)
  }, [currentFile, projectData])

  const renderPreview = useCallback(() => {
    setTimeout(() => {
      const preview = document.getElementById('previewContent')
      if (preview && window.renderMathInElement) {
        try {
          window.renderMathInElement(preview, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false }
            ]
          })
        } catch {}
      }
    }, 0)
  }, [])

  useEffect(() => {
    if (!isEditing) {
      renderPreview()
    }
  }, [isEditing, editorContent, renderPreview])

  const highlightCode = (code: string, filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase()
    let language = 'plaintext'
    
    if (ext === 'py') {
      language = 'python'
    } else if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') {
      language = 'javascript'
    } else if (ext === 'json') {
      language = 'json'
    }
    
    try {
      if (language === 'plaintext') {
        return escapeHtml(code)
      }
      return hljs.highlight(code, { language }).value
    } catch {
      return escapeHtml(code)
    }
  }

  const isCodeFile = (filename: string): boolean => {
    const ext = filename.split('.').pop()?.toLowerCase()
    return ext === 'py' || ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx' || ext === 'json'
  }

  const escapeHtml = (text: string): string => {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  const handleSelectFile = (filename: string) => {
    const file = projectData.files.find(f => f.name === filename)
    if (file) {
      setCurrentFile(filename)
      currentFileRef.current = filename
      setEditorContent(file.content)
      setShowPreview(false)
      setSelectedCommit(null)
    }
  }

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return
    const success = await createProjectFile(projectName, newFileName.trim())
    if (success) {
      await loadDoc(true)
      setCurrentFile(newFileName.trim())
      setEditorContent('')
      setShowNewFile(false)
      setNewFileName('')
    }
  }

  const handleDeleteFile = async (filename: string) => {
    if (!confirm(`确定删除文件 "${filename || '(默认文件)'}" 吗？`)) return
    const success = await deleteProjectFile(projectName, filename)
    if (success) {
      await loadDoc(true)
    }
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      alert('请填写修改说明')
      return
    }
    
    const success = await saveProjectFile(projectName, currentFile, editorContent, commitMessage.trim(), currentUser)
    if (success) {
      alert('提交成功')
      setCommitMessage('')
      await loadDoc(true)
    } else {
      alert('提交失败')
    }
  }

  const handleDownload = () => {
    const filename = currentFile || projectName
    const blob = new Blob([editorContent], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName}/${filename}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleGitHubSync = async () => {
    if (!githubRepo || !githubFilePath) {
      alert('请填写仓库和文件路径')
      return
    }
    
    setSyncLoading(true)
    const success = await syncFromGitHub(
      githubRepo, 
      githubFilePath, 
      githubBranch || undefined,
      projectName, 
      currentFile, 
      false, 
      currentUser
    )
    setSyncLoading(false)
    
    if (success) {
      hasAutoSynced.current.delete(currentFile)
      alert('同步成功')
      setShowGitHubSync(false)
      await loadDoc(true)
      const newFileData = (await loadProjectData(projectName)).files.find(f => f.name === currentFile)
      if (newFileData) {
        setEditorContent(newFileData.content)
      }
    } else {
      alert('同步失败，请检查配置')
    }
  }

  const handlePullFromGitHub = async (force: boolean = false) => {
    const syncConfig = currentFileData?.githubSync
    if (!syncConfig) return
    
    if (!force && syncConfig.lastSyncTime && !shouldAutoSync(syncConfig.lastSyncTime)) {
      return
    }
    
    setSyncLoading(true)
    const success = await syncFromGitHub(
      syncConfig.repo, 
      syncConfig.path || currentFile, 
      syncConfig.branch,
      projectName, 
      currentFile, 
      syncConfig.autoSync, 
      currentUser
    )
    setSyncLoading(false)
    if (success) {
      const data = await loadProjectData(projectName)
      const file = data.files.find(f => f.name === currentFile)
      if (file?.githubSync) {
        file.githubSync.lastSyncTime = Date.now()
        await saveProjectData(projectName, data)
      }
      await loadDoc(true)
      const newFileData = (await loadProjectData(projectName)).files.find(f => f.name === currentFile)
      if (newFileData) {
        setEditorContent(newFileData.content)
      }
    } else if (force) {
      alert('获取文件失败，请检查网络或配置')
    } else {
      setSyncError('自动同步失败，如有更新请手动同步')
      setTimeout(() => setSyncError(''), 5000)
    }
  }

  const handleRemoveGitHubSync = async (fileName?: string) => {
    const targetFile = fileName || currentFile
    const data = await loadProjectData(projectName)
    const file = data.files.find(f => f.name === targetFile)
    if (file) {
      file.githubSync = undefined
      hasAutoSynced.current.delete(targetFile)
      await saveProjectData(projectName, data)
      await loadDoc(true)
    }
  }

  const handleToggleAutoSync = async (fileName?: string) => {
    const targetFile = fileName || currentFile
    const data = await loadProjectData(projectName)
    const file = data.files.find(f => f.name === targetFile)
    if (file?.githubSync) {
      const newAutoSync = !file.githubSync.autoSync
      if (newAutoSync) {
        hasAutoSynced.current.add(targetFile)
      } else {
        hasAutoSynced.current.delete(targetFile)
      }
      file.githubSync.autoSync = newAutoSync
      await saveProjectData(projectName, data)
      await loadDoc(true)
    }
  }

  const handleRepoSync = async (manual: boolean = false) => {
    if (!githubRepo) {
      alert('请填写仓库地址')
      return
    }
    
    const lastSyncTime = projectData.githubRepoSync?.lastSyncTime
    if (!manual && lastSyncTime && !shouldAutoSync(lastSyncTime)) {
      const hours = Math.floor((Date.now() - lastSyncTime) / (60 * 60 * 1000))
      const minutes = Math.floor(((Date.now() - lastSyncTime) % (60 * 60 * 1000)) / (60 * 1000))
      alert(`距离上次同步不到1小时（${hours}小时${minutes}分钟前），请稍后再试或手动同步`)
      return
    }
    
    setSyncLoading(true)
    const result = await syncGitHubRepoToProject(githubRepo, projectName, githubBranch || undefined, githubToken || undefined)
    setSyncLoading(false)
    
    if (result.success) {
      setSyncedFilesList(result.syncedFiles)
      setShowSyncedFiles(true)
      setShowRepoSync(false)
      await loadDoc(true)
    } else {
      if (result.isRateLimit && result.retryAfter) {
        const minutes = Math.ceil(result.retryAfter / 60)
        alert(`GitHub 速率限制已达上限，请等待约 ${minutes} 分钟后再试，或使用 GitHub Token 认证`)
      } else {
        alert(`同步失败${result.error ? `: ${result.error}` : '，请检查配置'}`)
      }
    }
  }

  const handleRemoveRepoSync = async () => {
    const data = await loadProjectData(projectName)
    data.githubRepoSync = undefined
    data.files = data.files.map(file => {
      file.githubSync = undefined
      file.isReadOnly = undefined
      return file
    })
    await saveProjectData(projectName, data)
    setGithubRepo('')
    setGithubBranch('')
    setShowRepoSync(false)
    await loadDoc(true)
  }

  const handlePushToGitHub = async () => {
    const token = localGithubToken || githubToken
    if (!token || !pushMessage.trim()) {
      alert('请填写GitHub Token和提交信息')
      return
    }
    
    const file = projectData.files.find(f => f.name === currentFile)
    if (!file?.githubSync) {
      alert('当前文件未配置GitHub同步')
      return
    }
    
    setPushLoading(true)
    const success = await pushToGitHub(
      file.githubSync.repo,
      file.githubSync.path || file.name,
      file.content,
      pushMessage.trim(),
      token,
      file.githubSync.branch
    )
    setPushLoading(false)
    
    if (success) {
      alert('推送成功')
      setShowPushToGitHub(false)
      setPushMessage('')
    } else {
      alert('推送失败，请检查Token和权限')
    }
  }

  const handleTasksUpdated = async (tasks: EvaluationTask[]) => {
    const data = await loadProjectData(projectName)
    data.evaluationTasks = tasks
    await saveProjectData(projectName, data)
    setProjectData({ ...data })
  }

  const handleRenameFile = async () => {
    if (renameFile === null || !renameName.trim()) return
    
    const success = await renameProjectFile(projectName, renameFile, renameName.trim())
    if (success) {
      if (currentFile === renameFile) {
        setCurrentFile(renameName.trim())
      }
      await loadDoc(true)
    } else {
      alert('重命名失败，文件名可能已存在')
    }
    setRenameFile(null)
    setRenameName('')
  }

  const handleSaveSettings = async () => {
    if (!settingsName.trim()) {
      alert('项目名称不能为空')
      return
    }
    
    const success = await updateProject(projectName, settingsName.trim(), settingsDescription.trim())
    if (success) {
      alert('保存成功')
      setShowSettings(false)
      if (settingsName.trim() !== projectName) {
        onProjectUpdated(settingsName.trim())
      } else {
        onProjectUpdated()
      }
    } else {
      alert('保存失败，项目名称可能已存在')
    }
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const getCurrentFileData = (): ProjectFile | undefined => {
    return projectData.files.find(f => f.name === currentFile)
  }

  const currentFileData = getCurrentFileData()

  return (
    <div id="projectView" className="card">
      <button onClick={onBack} className="back-btn text-blue-500 hover:text-blue-600 flex items-center gap-1 mb-4">
        返回项目列表
      </button>
      
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold">{projectName}</h2>
          {projectDescription && (
            <p className="text-sm text-gray-500 mt-1">{projectDescription}</p>
          )}
          {projectData.githubRepoSync && (
            <p className="text-sm text-gray-500 mt-1">
              关联仓库: {projectData.githubRepoSync.repo}
              {projectData.githubRepoSync.branch && ` (分支: ${projectData.githubRepoSync.branch})`}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* 项目级操作 */}
          <button
            onClick={() => setShowSettings(true)}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            更多设置
          </button>
          <button
            onClick={() => {
              setShowRepoSync(true)
              const repoSync = projectData.githubRepoSync
              setGithubRepo(repoSync?.repo || '')
              setGithubBranch(repoSync?.branch || '')
            }}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            同步仓库
          </button>
          <button
            onClick={() => setShowEvaluation(!showEvaluation)}
            className={`px-4 py-2 rounded-lg ${
              showEvaluation
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            测评管理
          </button>
        </div>
      </div>

      {/* 当前文件操作区 */}
      <div className="mb-4 p-4 bg-gray-50 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600 mr-2">当前文件:</span>
            <span className="font-medium">{currentFile || '(默认)'}</span>
            {currentFileData?.isReadOnly && <span className="text-xs text-gray-400">(只读)</span>}
          </div>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              历史记录
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              下载文件
            </button>
            {currentFileData?.githubSync && (
              <button
                onClick={() => {
                  setShowPushToGitHub(true)
                  setLocalGithubToken(githubToken || '')
                  setPushMessage('')
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                推送到GitHub
              </button>
            )}
            {currentFileData?.githubSync ? (
              <>
                <button
                  onClick={() => handlePullFromGitHub(true)}
                  disabled={syncLoading}
                  className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  从GitHub拉取
                </button>
                <button
                  onClick={() => handleToggleAutoSync(currentFile)}
                  className={`px-3 py-1.5 text-sm rounded-lg ${
                    currentFileData?.githubSync?.autoSync
                      ? 'bg-green-100 text-green-700 border border-green-300'
                      : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {currentFileData?.githubSync?.autoSync ? '停止自动同步' : '启用自动同步'}
                </button>
                <button
                  onClick={() => handleRemoveGitHubSync(currentFile)}
                  className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                >
                  取消同步
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setShowGitHubSync(true)
                  const syncConfig = currentFileData?.githubSync
                  setGithubRepo(syncConfig?.repo || '')
                  setGithubFilePath(syncConfig?.path || '')
                  setGithubBranch(syncConfig?.branch || '')
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                GitHub同步
              </button>
            )}
            <button
              onClick={() => {
                if (currentFileData?.githubSync?.autoSync && !isEditing) {
                  alert('此文件已启用自动同步，无法编辑。请先取消同步后再编辑。')
                  return
                }
                setIsEditing(!isEditing)
              }}
              disabled={currentFileData?.githubSync?.autoSync && !isEditing}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
                isEditing 
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' 
                  : 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {isEditing ? '取消编辑' : '编辑文档'}
            </button>
          </div>
        </div>
        
        {currentFileData?.githubSync && (
          <div className={`text-sm mt-2 ${currentFileData.githubSync.autoSync ? 'text-yellow-700' : 'text-gray-500'}`}>
            已同步: {currentFileData.githubSync.repo}/{currentFileData.githubSync.path}
            {currentFileData.githubSync.branch && ` (分支: ${currentFileData.githubSync.branch})`}
            {currentFileData.githubSync.autoSync && ' (自动同步，仅读)'}
          </div>
        )}
      </div>

      <div className="mb-4">
        {syncError && (
          <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            ⚠️ {syncError}
          </div>
        )}
        <h3 className="text-sm text-gray-600 mb-2">文件列表</h3>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {[...projectData.files]
            .sort((a, b) => {
              if (a.isReadOnly !== b.isReadOnly) {
                return a.isReadOnly ? 1 : -1
              }
              return 0
            })
            .map((file) => (
            <div key={file.name} className="flex items-center justify-between px-4 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
              <div className="flex items-center gap-2">
                {renameFile === file.name ? (
                  <>
                    <input
                      type="text"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      className="px-2 py-1 border border-blue-300 rounded text-sm w-32"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameFile()
                        else if (e.key === 'Escape') { setRenameFile(null); setRenameName('') }
                      }}
                    />
                    <button onClick={handleRenameFile} className="text-blue-500 text-sm">确认</button>
                    <button onClick={() => { setRenameFile(null); setRenameName('') }} className="text-gray-400 text-sm">取消</button>
                  </>
                ) : (
                  <button
                    onClick={() => handleSelectFile(file.name)}
                    className={`text-sm ${
                      currentFile === file.name 
                        ? 'text-blue-600 font-medium' 
                        : 'text-gray-700 hover:text-blue-600'
                    }`}
                  >
                    {file.name || '(默认)'}{file.isReadOnly && <span className="text-xs text-gray-400 ml-2">(只读)</span>}
                  </button>
                )}
              </div>
              {renameFile !== file.name && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setRenameFile(file.name); setRenameName(file.name) }}
                    className="text-gray-400 hover:text-blue-500 text-xs px-2 py-1"
                    title="重命名"
                  >
                    重命名
                  </button>
                    <button
                      onClick={() => handleDeleteFile(file.name)}
                      className="text-gray-400 hover:text-red-500 text-xs px-2 py-1"
                    >
                      删除
                    </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {showNewFile ? (
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="文件名"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
            />
            <button onClick={handleCreateFile} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">确认</button>
            <button onClick={() => { setShowNewFile(false); setNewFileName('') }} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">取消</button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewFile(true)}
            className="mt-3 w-full px-4 py-2 border border-dashed border-gray-300 text-gray-500 rounded-lg text-sm hover:border-blue-400 hover:text-blue-500"
          >
            + 新建文件
          </button>
        )}
      </div>

      {showHistory && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl">
          <h3 className="font-semibold mb-3">提交历史</h3>
          {currentFileData?.history.length === 0 ? (
            <p className="text-gray-400">暂无提交记录</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {currentFileData?.history.map((commit) => (
                <div
                  key={commit.id}
                  className="p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 cursor-pointer"
                  onClick={() => {
                    setSelectedCommit(commit)
                  }}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-gray-800">{commit.message}</span>
                    <span className="text-xs text-gray-400">
                      {formatTime(commit.timestamp)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    by {commit.user}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedCommit && (
        <div className="mb-6 p-4 bg-gray-50 rounded-xl">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">修改内容</h3>
            <button onClick={() => { setSelectedCommit(null); setShowPreview(false) }} className="text-gray-500 hover:text-gray-700">关闭</button>
          </div>
          <div className="bg-gray-900 p-4 rounded-lg font-mono text-sm overflow-x-auto">
            <pre className="whitespace-pre-wrap diff-view" dangerouslySetInnerHTML={{ __html: generateDiff(selectedCommit.content, editorContent) }} />
          </div>
        </div>
      )}

      {isEditing ? (
        <>
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => { setShowPreview(!showPreview); if (!showPreview) renderPreview() }}
              className={`px-4 py-2 border rounded-lg ${
                showPreview ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {showPreview ? '更新预览' : '预览'}
            </button>
          </div>

          {showPreview && (
            <div className="preview-panel mb-4">
              <label className="font-semibold block mb-2">预览</label>
              <div
                id="previewContent"
                className="bg-gray-50 rounded-xl p-4 min-h-[300px] overflow-y-auto prose max-w-none"
                dangerouslySetInnerHTML={{ __html: marked.parse(editorContent || '') }}
              />
            </div>
          )}

          <div className="editor-panel mb-4">
            <div className="flex justify-between items-center mb-2">
              <label className="font-semibold">Markdown 内容</label>
              {currentFileData?.githubSync?.autoSync && (
                <span className="text-yellow-600 text-sm">⚠️ 此文件启用了自动同步，请先取消同步后再编辑</span>
              )}
            </div>
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              disabled={currentFileData?.githubSync?.autoSync}
              className={`w-full min-h-[400px] font-mono text-sm p-4 border rounded-xl resize-vertical focus:outline-none ${
                currentFileData?.githubSync?.autoSync 
                  ? 'bg-gray-50 border-gray-200 cursor-not-allowed' 
                  : 'border-gray-200 focus:border-blue-500'
              }`}
            />
          </div>

          <div className="commit-box p-4 bg-gray-50 rounded-xl flex flex-wrap gap-3 items-center">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              disabled={currentFileData?.githubSync?.autoSync}
              placeholder="修改说明"
              className={`flex-1 min-w-[200px] px-4 py-2 border rounded-lg focus:outline-none ${
                currentFileData?.githubSync?.autoSync 
                  ? 'bg-gray-50 border-gray-200 cursor-not-allowed' 
                  : 'border-gray-200 focus:border-blue-500'
              }`}
            />
            <button
              onClick={handleCommit}
              disabled={currentFileData?.githubSync?.autoSync}
              className={`px-6 py-2 rounded-lg font-medium ${
                currentFileData?.githubSync?.autoSync 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              提交修改
            </button>
          </div>
        </>
      ) : (
        <div className="preview-panel mb-4">
          <label className="font-semibold block mb-2">文档内容</label>
          {isCodeFile(currentFile) ? (
            <div className="bg-gray-100 rounded-xl p-4 min-h-[400px] overflow-y-auto">
              <pre className="font-mono text-sm"><code dangerouslySetInnerHTML={{ __html: highlightCode(editorContent || '', currentFile) }} /></pre>
            </div>
          ) : (
            <div
              id="previewContent"
              className="bg-gray-50 rounded-xl p-4 min-h-[400px] overflow-y-auto prose max-w-none"
              dangerouslySetInnerHTML={{ __html: marked.parse(editorContent || '') }}
            />
          )}
        </div>
      )}

      {showGitHubSync && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">GitHub同步</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">仓库 (username/repo)</label>
                <input
                  type="text"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="user/project-name"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">文件路径</label>
                <input
                  type="text"
                  value={githubFilePath}
                  onChange={(e) => setGithubFilePath(e.target.value)}
                  placeholder="docs/file.md"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">分支 (可选)</label>
                <input
                  type="text"
                  value={githubBranch}
                  onChange={(e) => setGithubBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <p className="text-xs text-gray-400">
                从指定仓库的文件同步内容（仅公开仓库）
                <br />
                同步成功后可在上方按钮中启用自动同步
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleGitHubSync}
                disabled={syncLoading}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {syncLoading ? '同步中...' : '同步'}
              </button>
              <button
                onClick={() => setShowGitHubSync(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">项目设置</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">项目名称</label>
                <input
                  type="text"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  placeholder="项目名称"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">项目概述</label>
                <input
                  type="text"
                  value={settingsDescription}
                  onChange={(e) => setSettingsDescription(e.target.value)}
                  placeholder="项目概述（可选）"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                保存
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showRepoSync && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">同步整个仓库</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">仓库 (username/repo)</label>
                <input
                  type="text"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="user/project-name"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">分支 (可选)</label>
                <input
                  type="text"
                  value={githubBranch}
                  onChange={(e) => setGithubBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              {projectData.githubRepoSync?.lastSyncTime && (
                <div className="text-xs text-gray-500">
                  上次同步: {new Date(projectData.githubRepoSync.lastSyncTime).toLocaleString('zh-CN')}
                </div>
              )}
              <p className="text-xs text-gray-400">
                同步整个仓库的所有文件（仅公开仓库）
                <br />
                Markdown文件可编辑，其他文件为只读
                <br />
                自动同步间隔：1小时
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => handleRepoSync(false)}
                disabled={syncLoading}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {syncLoading ? '同步中...' : '同步仓库'}
              </button>
              <button
                onClick={() => handleRepoSync(true)}
                disabled={syncLoading}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
              >
                {syncLoading ? '同步中...' : '强制同步'}
              </button>
              {projectData.githubRepoSync && (
                <button
                  onClick={handleRemoveRepoSync}
                  disabled={syncLoading}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                >
                  取消同步
                </button>
              )}
              <button
                onClick={() => setShowRepoSync(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showPushToGitHub && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">推送到GitHub</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">GitHub Token</label>
                <input
                  type="password"
                  value={localGithubToken}
                  onChange={(e) => setLocalGithubToken(e.target.value)}
                  placeholder="ghp_xxx"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">提交信息</label>
                <input
                  type="text"
                  value={pushMessage}
                  onChange={(e) => setPushMessage(e.target.value)}
                  placeholder="更新文档"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              <p className="text-xs text-gray-400">
                需要具有仓库写入权限的GitHub Personal Access Token
                <br />
                仅推送当前编辑的文件
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handlePushToGitHub}
                disabled={pushLoading}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
              >
                {pushLoading ? '推送中...' : '推送'}
              </button>
              <button
                onClick={() => setShowPushToGitHub(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showEvaluation && (
        <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-2xl border-l border-gray-200 z-40 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-gray-800">测评管理</h3>
            <button
              onClick={() => setShowEvaluation(false)}
              className="text-gray-500 hover:text-gray-700 hover:bg-gray-200 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <EvaluationPanel
              projectName={projectName}
              tasks={projectData.evaluationTasks || []}
              onTasksUpdated={handleTasksUpdated}
              projectData={projectData}
            />
          </div>
        </div>
      )}

      {showSyncedFiles && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4">
            <h3 className="text-lg font-semibold mb-4">仓库同步成功!</h3>
            <p className="text-sm text-gray-600 mb-3">
              共同步 {syncedFilesList.length} 个文件:
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              <ul className="divide-y divide-gray-100">
                {syncedFilesList.map((file, index) => (
                  <li key={index} className="px-3 py-2 text-sm flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>{file}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowSyncedFiles(false)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
