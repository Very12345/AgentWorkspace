import { useState, useEffect } from 'react'
import type { Project } from '@/types'
import { loadProjects, createProject, deleteProject } from '@/lib/api'

interface ProjectListProps {
  onSelectProject: (projectName: string) => void
}

export default function ProjectList({ onSelectProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  const fetchProjects = async () => {
    const data = await loadProjects()
    setProjects(data)
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) {
      alert('请输入项目名称')
      return
    }
    const success = await createProject(newName.trim(), newDescription.trim())
    if (success) {
      setNewName('')
      setNewDescription('')
      setIsCreating(false)
      await fetchProjects()
    } else {
      alert('项目已存在或创建失败')
    }
  }

  const handleDelete = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`确定要删除项目 "${name}" 吗？此操作不可恢复。`)) {
      const success = await deleteProject(name)
      if (success) {
        await fetchProjects()
      } else {
        alert('删除失败')
      }
    }
  }

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4">项目列表</h2>
      
      {isCreating ? (
        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3">创建新项目</h3>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="项目名称"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg mb-2 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="项目概述（可选）"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              创建
            </button>
            <button
              onClick={() => {
                setIsCreating(false)
                setNewName('')
                setNewDescription('')
              }}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsCreating(true)}
          className="w-full mb-4 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + 添加新项目
        </button>
      )}

      <div className="project-grid flex flex-col gap-2">
        {projects.length === 0 ? (
          <p className="text-gray-400 text-center py-8">暂无项目</p>
        ) : (
          projects.map((project) => (
            <div
              key={project.name}
              onClick={() => onSelectProject(project.name)}
              className="project-card bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all relative group"
            >
              <div className="font-semibold text-gray-800 text-base mb-1">{project.name}</div>
              <div className="text-sm text-gray-500">{project.description || '暂无概述'}</div>
              <button
                onClick={(e) => handleDelete(project.name, e)}
                className="absolute top-2 right-2 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="删除项目"
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>

      <button
        onClick={fetchProjects}
        className="mt-4 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center gap-2"
      >
        刷新项目
      </button>
    </div>
  )
}
