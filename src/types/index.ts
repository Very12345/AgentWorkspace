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

export interface ProjectFile {
  name: string
  content: string
  history: Commit[]
  githubSync?: {
    repo: string
    path: string
    autoSync: boolean
  }
}

export interface ProjectData {
  files: ProjectFile[]
}
