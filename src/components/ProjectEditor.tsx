import { useState, useEffect, useCallback, useRef } from 'react'
import type { ProjectData, ProjectFile, Commit } from '@/types'
import {
  loadProjectData,
  saveProjectFile,
  createProjectFile,
  deleteProjectFile,
  renameProjectFile,
  saveProjectData,
  updateProject,
  syncFromGitHub,
  generateDiff
} from '@/lib/api'

interface ProjectEditorProps {
  projectName: string
  projectDescription: string
  currentUser: string
  onBack: () => void
  onProjectUpdated: (newProjectName?: string) => void
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

export default function ProjectEditor({ projectName, projectDescription, currentUser, onBack, onProjectUpdated }: ProjectEditorProps) {
  const [projectData, setProjectData] = useState<ProjectData>({ files: [] })
  const [currentFile, setCurrentFile] = useState('')
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
  const [syncLoading, setSyncLoading] = useState(false)
  const [renameFile, setRenameFile] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsName, setSettingsName] = useState(projectName)
  const [settingsDescription, setSettingsDescription] = useState(projectDescription)

  const loadDoc = useCallback(async () => {
    const data = await loadProjectData(projectName)
    if (data.files.length === 0) {
      data.files = [{ name: '', content: '', history: [] }]
      setCurrentFile('')
      setEditorContent('')
    } else {
      const defaultFile = data.files.find(f => f.name === '') || data.files[0]
      setCurrentFile(defaultFile.name)
      setEditorContent(defaultFile.content)
    }
    setProjectData(data)
  }, [projectName])

  useEffect(() => {
    loadDoc()
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

  const handleSelectFile = (filename: string) => {
    const file = projectData.files.find(f => f.name === filename)
    if (file) {
      setCurrentFile(filename)
      setEditorContent(file.content)
      setShowPreview(false)
      setSelectedCommit(null)
    }
  }

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return
    const success = await createProjectFile(projectName, newFileName.trim())
    if (success) {
      await loadDoc()
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
      await loadDoc()
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
      await loadDoc()
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
    const success = await syncFromGitHub(githubRepo, githubFilePath, projectName, currentFile, false, currentUser)
    setSyncLoading(false)
    
    if (success) {
      hasAutoSynced.current.delete(currentFile)
      alert('同步成功')
      setShowGitHubSync(false)
      await loadDoc()
      const newFileData = (await loadProjectData(projectName)).files.find(f => f.name === currentFile)
      if (newFileData) {
        setEditorContent(newFileData.content)
      }
    } else {
      alert('同步失败，请检查配置')
    }
  }

  const handlePullFromGitHub = async () => {
    const syncConfig = currentFileData?.githubSync
    if (!syncConfig) return
    
    setSyncLoading(true)
    const success = await syncFromGitHub(
      syncConfig.repo, 
      syncConfig.path, 
      projectName, 
      currentFile, 
      syncConfig.autoSync, 
      currentUser
    )
    setSyncLoading(false)
    if (success) {
      await loadDoc()
      const newFileData = (await loadProjectData(projectName)).files.find(f => f.name === currentFile)
      if (newFileData) {
        setEditorContent(newFileData.content)
      }
    } else {
      alert('获取文件失败')
    }
  }

  const handleRemoveGitHubSync = async () => {
    const data = await loadProjectData(projectName)
    const file = data.files.find(f => f.name === currentFile)
    if (file) {
      file.githubSync = undefined
      hasAutoSynced.current.delete(currentFile)
      await saveProjectData(projectName, data)
      await loadDoc()
    }
  }

  const handleRenameFile = async () => {
    if (renameFile === null || !renameName.trim()) return
    
    const success = await renameProjectFile(projectName, renameFile, renameName.trim())
    if (success) {
      if (currentFile === renameFile) {
        setCurrentFile(renameName.trim())
      }
      await loadDoc()
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
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowSettings(true)}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            更多设置
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            历史记录
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            下载文件
          </button>
          {currentFileData?.githubSync ? (
            <>
              <button
                onClick={handlePullFromGitHub}
                disabled={syncLoading}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                从GitHub拉取
              </button>
              <button
                onClick={async () => {
                  const sync = currentFileData.githubSync!
                  const newAutoSync = !sync.autoSync
                  if (newAutoSync) {
                    hasAutoSynced.current.add(currentFile)
                  } else {
                    hasAutoSynced.current.delete(currentFile)
                  }
                  sync.autoSync = newAutoSync
                  await saveProjectData(projectName, projectData)
                  await loadDoc()
                }}
                className={`px-4 py-2 rounded-lg ${
                  currentFileData.githubSync!.autoSync
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {currentFileData.githubSync!.autoSync ? '停止自动同步' : '启用自动同步'}
              </button>
              <button
                onClick={handleRemoveGitHubSync}
                className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
              >
                取消同步
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setShowGitHubSync(true)
                setGithubRepo('')
                setGithubFilePath('')
              }}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
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
            className={`px-4 py-2 rounded-lg font-medium ${
              isEditing 
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' 
                : 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {isEditing ? '取消编辑' : '编辑文档'}
          </button>
        </div>
        
        {currentFileData?.githubSync && (
          <div className={`text-sm ${currentFileData.githubSync.autoSync ? 'text-yellow-700' : 'text-gray-500'}`}>
            已同步: {currentFileData.githubSync.repo}/{currentFileData.githubSync.path}
            {currentFileData.githubSync.autoSync && ' (自动同步，仅读)'}
          </div>
        )}
      </div>

      <div className="mb-4">
        <h3 className="text-sm text-gray-600 mb-2">文件列表</h3>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {projectData.files.map((file) => (
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
                    {file.name || '(默认)'}
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
          <div
            id="previewContent"
            className="bg-gray-50 rounded-xl p-4 min-h-[400px] overflow-y-auto prose max-w-none"
            dangerouslySetInnerHTML={{ __html: marked.parse(editorContent || '') }}
          />
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
    </div>
  )
}
