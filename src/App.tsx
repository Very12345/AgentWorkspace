import { useState, useEffect } from 'react'
import Login from '@/components/Login'
import MemberTable from '@/components/MemberTable'
import ProjectList from '@/components/ProjectList'
import ProjectEditor from '@/components/ProjectEditor'
import { getCookie, setCookie, importAllData, exportAllData, loadProjects } from '@/lib/api'
import type { Project } from '@/types'

type View = 'login' | 'main' | 'project'

export default function App() {
  const [view, setView] = useState<View>('login')
  const [currentUser, setCurrentUser] = useState('')
  const [currentProject, setCurrentProject] = useState('')
  const [showRestore, setShowRestore] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [githubToken, setGithubToken] = useState('')

  const fetchProjects = async () => {
    const data = await loadProjects()
    setProjects(data)
  }

  useEffect(() => {
    const savedUser = getCookie('teamwork_user')
    if (savedUser) {
      setCurrentUser(savedUser)
      setView('main')
    }
    const savedToken = localStorage.getItem('github_token')
    if (savedToken) {
      setGithubToken(savedToken)
    }
  }, [])

  useEffect(() => {
    if (view === 'main') {
      fetchProjects()
    }
  }, [view])

  const handleLogin = (name: string) => {
    setCurrentUser(name)
    setCookie('teamwork_user', name)
    setView('main')
  }

  const handleSelectProject = (projectName: string) => {
    setCurrentProject(projectName)
    setView('project')
  }

  const handleBackToMain = () => {
    setView('main')
    setCurrentProject('')
  }



  const handleBackup = async () => {
    const data = await exportAllData()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backup_${new Date().toISOString().slice(0,10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    setRestoreLoading(true)
    const text = await file.text()
    const success = await importAllData(text)
    setRestoreLoading(false)
    
    if (success) {
      alert('回档成功，请刷新页面')
      setShowRestore(false)
    } else {
      alert('回档失败，数据格式错误')
    }
    event.target.value = ''
  }

  const handleSaveGithubToken = () => {
    if (githubToken) {
      localStorage.setItem('github_token', githubToken)
      alert('GitHub Token 已保存')
      setShowSettings(false)
    } else {
      localStorage.removeItem('github_token')
      alert('GitHub Token 已清除')
      setShowSettings(false)
    }
  }

  return (
    <div className="container">
      {view === 'login' && (
        <Login onLogin={handleLogin} savedName={getCookie('teamwork_user')} />
      )}
      
      {view === 'main' && currentUser && (
        <div id="mainView">
          <MemberTable currentUser={currentUser} />
          <ProjectList onSelectProject={handleSelectProject} />
          
          <div className="card">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleBackup}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                下载存档
              </button>
              <button
                onClick={() => setShowRestore(true)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                上传回档
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
              >
                设置
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">存档和回档包含网站所有数据：成员、项目、所有文件</p>
          </div>
        </div>
      )}
      
      {view === 'project' && currentUser && currentProject && (
        <ProjectEditor
          projectName={currentProject}
          projectDescription={projects.find(p => p.name === currentProject)?.description || ''}
          currentUser={currentUser}
          onBack={handleBackToMain}
          onProjectUpdated={(newProjectName?: string) => {
            fetchProjects()
            if (newProjectName) {
              setCurrentProject(newProjectName)
            }
          }}
          githubToken={githubToken}
        />
      )}



      {showRestore && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">上传回档</h3>
            <p className="text-sm text-gray-600 mb-4">
              选择之前下载的存档文件进行回档
            </p>
            <input
              type="file"
              accept=".json"
              onChange={handleRestore}
              disabled={restoreLoading}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg mb-4"
            />
            <p className="text-xs text-gray-400">
              回档将覆盖现有所有数据，请谨慎操作
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowRestore(false)}
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
            <h3 className="text-lg font-semibold mb-4">设置</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">GitHub Token</label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_xxx..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
                {githubToken && (
                  <p className="text-xs text-green-500 mt-1">Token 已设置</p>
                )}
              </div>
              <p className="text-xs text-gray-400">
                GitHub Token 用于提高 API 调用速率限制（从 60 次/小时提升到 5000 次/小时）
                <br />
                保存后将存储在浏览器 localStorage 中
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveGithubToken}
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
