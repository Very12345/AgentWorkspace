export interface Member {
  name: string
  status: string
  lastOnline: number
  isOnline: boolean
}

export interface Project {
  name: string
  description: string
}

export interface Commit {
  id: string
  timestamp: number
  user: string
  message: string
  content: string
}

export interface GithubSyncConfig {
  repo: string
  path?: string
  branch?: string
  autoSync: boolean
}

export interface ProjectFile {
  name: string
  content: string
  history: Commit[]
  githubSync?: GithubSyncConfig
  isReadOnly?: boolean
}

export interface EvaluationTask {
  taskId: string
  problem: string
  status: 'pending' | 'running' | 'complete' | 'error'
  phase?: string
  filesDone?: string[]
  error?: string
  result?: string
  submittedAt: number
  createdAt?: string
  startedAt?: string
  finishedAt?: string
  backupData?: string
}

export interface ProjectData {
  files: ProjectFile[]
  githubRepoSync?: {
    repo: string
    branch?: string
    autoSync: boolean
  }
  evaluationTasks?: EvaluationTask[]
  githubCredentials?: {
    token: string
  }
}