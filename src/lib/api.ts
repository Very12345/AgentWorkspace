import type { Member, Project, ProjectFile, Commit, ProjectData } from '@/types'

const API_BASE = "https://veryonly123-my-team-docs.hf.space";
const USER_PAGE = "aiagent20265122209_user";
const PROJECTS_PAGE = "aiagent20265122209_projects";

function getProjectPage(project: string): string {
  return `aiagent20265122209_project_${project}`;
}

export async function apiRead(page: string): Promise<string> {
  try {
    const resp = await fetch(`${API_BASE}/api/read/${page}`);
    if (!resp.ok) return "";
    const text = await resp.text();
    return text.trim() === '#null' ? '' : text;
  } catch {
    return "";
  }
}

export async function apiWrite(page: string, content: string): Promise<boolean> {
  try {
    const formData = new URLSearchParams();
    formData.append('t', content.trim() === '' ? '#null' : content);
    const resp = await fetch(`${API_BASE}/api/write/${page}`, {
      method: 'POST',
      body: formData
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function loadMembers(): Promise<Member[]> {
  const raw = await apiRead(USER_PAGE);
  const lines = raw.split('\n').filter(line => line.trim() !== '');
  const now = Date.now();
  const onlineThreshold = 60 * 1000;
  
  return lines.map(line => {
    const parts = line.split('|||');
    const name = parts[0]?.trim() || '';
    const status = parts[1]?.trim() || '';
    const lastOnline = parseInt(parts[2]?.trim() || '0');
    
    return {
      name,
      status,
      lastOnline,
      isOnline: now - lastOnline < onlineThreshold
    };
  }).filter(m => m.name);
}

export async function updateMemberStatus(name: string, status: string): Promise<boolean> {
  const raw = await apiRead(USER_PAGE);
  const lines = raw.split('\n').filter(line => line.trim() !== '');
  let found = false;
  const now = Date.now();
  
  const newLines = lines.map(line => {
    const parts = line.split('|||');
    if (parts[0]?.trim() === name) {
      found = true;
      return `${name}|||${status}|||${now}`;
    }
    return line;
  });
  
  if (!found) {
    newLines.push(`${name}|||${status}|||${now}`);
  }
  
  return apiWrite(USER_PAGE, newLines.join('\n'));
}

export async function loadProjects(): Promise<Project[]> {
  const raw = await apiRead(PROJECTS_PAGE);
  const lines = raw.split('\n').filter(line => line.trim() !== '');
  
  return lines.map(line => {
    const parts = line.split('|||');
    return {
      name: parts[0]?.trim() || '',
      description: parts[1]?.trim() || ''
    };
  }).filter(p => p.name);
}

export async function createProject(name: string, description: string): Promise<boolean> {
  const projects = await loadProjects();
  if (projects.some(p => p.name === name)) {
    return false;
  }
  
  const raw = await apiRead(PROJECTS_PAGE);
  const lines = raw.split('\n').filter(line => line.trim() !== '');
  lines.push(`${name}|||${description}`);
  
  const success = await apiWrite(PROJECTS_PAGE, lines.join('\n'));
  if (success) {
    await apiWrite(getProjectPage(name), '#null');
  }
  return success;
}

export async function deleteProject(name: string): Promise<boolean> {
  try {
    const projects = await loadProjects();
    if (!projects.some(p => p.name === name)) {
      return false;
    }
    
    const raw = await apiRead(PROJECTS_PAGE);
    const lines = raw.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed !== '' && !trimmed.startsWith(name + '|||');
    });
    
    return await apiWrite(PROJECTS_PAGE, lines.join('\n'));
  } catch {
    return false;
  }
}

export async function updateProject(oldName: string, newName: string, newDescription: string): Promise<boolean> {
  const raw = await apiRead(PROJECTS_PAGE);
  const lines = raw.split('\n').filter(line => line.trim() !== '');
  
  const index = lines.findIndex(line => line.startsWith(oldName + '|||'));
  if (index === -1) return false;
  
  // 如果要重命名项目
  if (oldName !== newName) {
    const projects = await loadProjects();
    if (projects.some(p => p.name === newName)) return false;
    
    // 复制项目数据
    const oldProjectData = await apiRead(getProjectPage(oldName));
    await apiWrite(getProjectPage(newName), oldProjectData);
    
    // 删除旧的项目数据（可选，保持原样做备份）
  }
  
  // 更新项目列表
  lines[index] = `${newName}|||${newDescription}`;
  
  return apiWrite(PROJECTS_PAGE, lines.join('\n'));
}

export async function loadProjectData(project: string): Promise<ProjectData> {
  const raw = await apiRead(getProjectPage(project));
  if (!raw || raw.trim() === '#null') {
    return { files: [], evaluationTasks: [] };
  }
  
  try {
    const data = JSON.parse(raw);
    if (data.files && Array.isArray(data.files)) {
      return {
        ...data,
        evaluationTasks: data.evaluationTasks || []
      };
    }
    return { files: [{ name: '', content: raw, history: [] }], evaluationTasks: [] };
  } catch {
    return { files: [{ name: '', content: raw, history: [] }], evaluationTasks: [] };
  }
}

export async function saveProjectData(project: string, data: ProjectData): Promise<boolean> {
  return apiWrite(getProjectPage(project), JSON.stringify(data));
}

export async function loadProjectFiles(project: string): Promise<ProjectFile[]> {
  const data = await loadProjectData(project);
  return data.files;
}

export async function loadProjectFile(project: string, filename: string): Promise<string> {
  const data = await loadProjectData(project);
  const file = data.files.find(f => f.name === filename);
  return file?.content || '';
}

export async function saveProjectFile(
  project: string, 
  filename: string, 
  content: string, 
  message: string, 
  user: string
): Promise<boolean> {
  const data = await loadProjectData(project);
  
  let file = data.files.find(f => f.name === filename);
  if (!file) {
    file = { name: filename, content: '', history: [] };
    data.files.push(file);
  }
  
  const commit: Commit = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    timestamp: Date.now(),
    user,
    message,
    content: file.content
  };
  
  file.history = [commit, ...file.history];
  file.content = content;
  
  return saveProjectData(project, data);
}

export async function createProjectFile(project: string, filename: string): Promise<boolean> {
  const data = await loadProjectData(project);
  if (data.files.some(f => f.name === filename)) {
    return false;
  }
  data.files.push({ name: filename, content: '', history: [] });
  return saveProjectData(project, data);
}

export async function renameProjectFile(project: string, oldName: string, newName: string): Promise<boolean> {
  const data = await loadProjectData(project);
  if (oldName === newName) return false;
  if (data.files.some(f => f.name === newName)) return false;
  
  const file = data.files.find(f => f.name === oldName);
  if (file) {
    file.name = newName;
    return saveProjectData(project, data);
  }
  return false;
}

export async function deleteProjectFile(project: string, filename: string): Promise<boolean> {
  const data = await loadProjectData(project);
  data.files = data.files.filter(f => f.name !== filename);
  
  if (data.files.length === 0) {
    data.files = [{ name: '', content: '', history: [] }];
  }
  
  return saveProjectData(project, data);
}

export async function loadProjectFileHistory(project: string, filename: string): Promise<Commit[]> {
  const data = await loadProjectData(project);
  const file = data.files.find(f => f.name === filename);
  return file?.history || [];
}

export async function loadAllData(): Promise<{
  members: Member[];
  projects: Project[];
  projectData: { [key: string]: ProjectData };
}> {
  const members = await loadMembers();
  const projects = await loadProjects();
  const projectData: { [key: string]: ProjectData } = {};
  
  for (const project of projects) {
    projectData[project.name] = await loadProjectData(project.name);
  }
  
  return { members, projects, projectData };
}

export async function exportAllData(): Promise<string> {
  const allData = await loadAllData();
  return JSON.stringify(allData, null, 2);
}

export async function importAllData(jsonStr: string): Promise<boolean> {
  try {
    const allData = JSON.parse(jsonStr);
    
    const userLines = allData.members.map((m: Member) => 
      `${m.name}|||${m.status}|||${m.lastOnline}`
    );
    await apiWrite(USER_PAGE, userLines.join('\n'));
    
    const projectLines = allData.projects.map((p: Project) => 
      `${p.name}|||${p.description}`
    );
    await apiWrite(PROJECTS_PAGE, projectLines.join('\n'));
    
    for (const [name, data] of Object.entries(allData.projectData)) {
      await apiWrite(getProjectPage(name), JSON.stringify(data));
    }
    
    return true;
  } catch {
    return false;
  }
}

function decodeBase64ToUTF8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export async function syncFromGitHub(repo: string, filePath: string, branch: string | undefined, projectName: string, fileName: string, autoSync: boolean, currentUser?: string): Promise<boolean> {
  try {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json'
    };

    let url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    if (branch) {
      url += `?ref=${encodeURIComponent(branch)}`;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) return false;
    
    const content = await resp.json();
    if (content.type !== 'file') return false;
    
    const fileContent = decodeBase64ToUTF8(content.content);
    
    const data = await loadProjectData(projectName);
    let file = data.files.find(f => f.name === fileName);
    
    if (file) {
      if (file.content !== fileContent) {
        if (currentUser) {
          await saveProjectFile(projectName, fileName, fileContent, '从GitHub同步', currentUser);
        } else {
          file.content = fileContent;
        }
      }
      file.githubSync = { repo, path: filePath, branch, autoSync };
      return await saveProjectData(projectName, data);
    } else {
      file = { 
        name: fileName, 
        content: fileContent, 
        history: [], 
        githubSync: { repo, path: filePath, branch, autoSync } 
      };
      data.files.push(file);
      return await saveProjectData(projectName, data);
    }
  } catch {
    return false;
  }
}

export async function fetchGitHubFileContent(repo: string, filePath: string, branch?: string, token?: string): Promise<string | null> {
  try {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json'
    };

    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    let url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    if (branch) {
      url += `?ref=${encodeURIComponent(branch)}`;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      console.error('GitHub API error:', resp.status, resp.statusText);
      return null;
    }
    
    const content = await resp.json();
    if (content.type !== 'file') return null;
    
    return decodeBase64ToUTF8(content.content);
  } catch (error) {
    console.error('GitHub fetch error:', error);
    return null;
  }
}

export function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export function setCookie(name: string, value: string, days: number = 30): void {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value}; ${expires}; path=/`;
}

export function generateDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff: string[] = [];
  
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    
    if (oldLine === newLine) {
      if (oldLine) diff.push(`<span class="diff-unchanged"> ${oldLine}</span>`);
    } else if (!oldLine) {
      diff.push(`<span class="diff-add">+${newLine}</span>`);
    } else if (!newLine) {
      diff.push(`<span class="diff-remove">-${oldLine}</span>`);
    } else {
      diff.push(`<span class="diff-remove">-${oldLine}</span>`);
      diff.push(`<span class="diff-add">+${newLine}</span>`);
    }
  }
  
  return diff.join('\n');
}

const EVALUATION_BASE = "https://veryonly123-cc-solver.hf.space/api";

function buildUrl(url: string, token?: string): string {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export async function submitProblem(problem: string, name: string, token?: string): Promise<string | null> {
  try {
    const url = buildUrl(`${EVALUATION_BASE}/submit`, token);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problem, name }),
    });
    
    if (!res.ok) {
      console.error('Submit failed:', res.status, res.statusText);
      try {
        const errorText = await res.text();
        console.error('Error response:', errorText);
      } catch {}
      return null;
    }
    
    const data = await res.json();
    console.log('Submit response:', data);
    
    if (!data.task_id) {
      console.error('No task_id in response:', data);
    }
    
    return data.task_id || null;
  } catch (error) {
    console.error('Submit error:', error);
    return null;
  }
}

export interface EvaluationStatus {
  task_id?: string;
  name?: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  phase?: string;
  problem_preview?: string;
  problem_length?: number;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  files_done?: string[];
  error?: string;
}

export async function getEvaluationStatus(taskId: string, token?: string): Promise<EvaluationStatus | null> {
  try {
    const url = buildUrl(`${EVALUATION_BASE}/status/${taskId}`, token);
    const res = await fetch(url);
    const task = await res.json();
    return task;
  } catch {
    return null;
  }
}

export async function downloadEvaluationResult(taskId: string, token?: string, backupKey?: string): Promise<void> {
  try {
    const url = buildUrl(`${EVALUATION_BASE}/download/${taskId}`, token);
    const res = await fetch(url);
    
    if (res.ok) {
      const blob = await res.blob();
      downloadBlob(blob, `evaluation-${taskId}.zip`);
      return;
    }
    
    console.warn('Primary download failed, trying backup:', res.status);
    
    if (backupKey) {
      const backupSuccess = await downloadFromBackup(backupKey, taskId);
      if (backupSuccess) return;
    }
    
    const fallbackBackupKey = `evaluation_backup_${taskId}`;
    const fallbackSuccess = await downloadFromBackup(fallbackBackupKey, taskId);
    if (fallbackSuccess) return;
    
    console.error('Download failed: both primary and backup are unavailable');
  } catch (error) {
    console.error('Download error:', error);
  }
}

async function downloadFromBackup(backupKey: string, taskId: string): Promise<boolean> {
  try {
    const backupRaw = await apiRead(backupKey);
    if (!backupRaw || backupRaw.trim() === '#null') {
      return false;
    }
    
    const backupData = JSON.parse(backupRaw);
    if (!backupData || !backupData.data) {
      return false;
    }
    
    const binaryString = atob(backupData.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const blob = new Blob([bytes], { type: 'application/zip' });
    const filename = `evaluation-${taskId}-backup.zip`;
    downloadBlob(blob, filename);
    console.log('Downloaded from backup successfully');
    return true;
  } catch (error) {
    console.warn('Backup download failed:', error);
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const urlObject = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = urlObject;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(urlObject);
}

export async function fetchAndSaveEvaluationBackup(taskId: string, token?: string): Promise<string | null> {
  try {
    const url = buildUrl(`${EVALUATION_BASE}/download/${taskId}`, token);
    const res = await fetch(url);
    
    if (!res.ok) {
      console.warn('Backup download failed:', res.status);
      return null;
    }
    
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);
    
    const backupKey = `evaluation_backup_${taskId}`;
    const backupData = {
      taskId,
      timestamp: Date.now(),
      data: base64Data,
      size: blob.size
    };
    
    await apiWrite(backupKey, JSON.stringify(backupData));
    console.log('Evaluation backup saved:', backupKey);
    return backupKey;
  } catch (error) {
    console.warn('Backup failed:', error);
    return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function getEvaluationResult(taskId: string, token?: string): Promise<string | null> {
  try {
    const url = buildUrl(`${EVALUATION_BASE}/result/${taskId}`, token);
    const resultRes = await fetch(url);
    const result = await resultRes.json();
    return result.content || null;
  } catch {
    return null;
  }
}

export async function waitForEvaluation(taskId: string, onProgress?: (status: EvaluationStatus) => void, token?: string): Promise<string | null> {
  while (true) {
    const status = await getEvaluationStatus(taskId, token);
    if (!status) return null;

    if (onProgress) onProgress(status);

    if (status.status === "complete") {
      return getEvaluationResult(taskId, token);
    }

    if (status.status === "error") {
      throw new Error(status.error || 'Unknown error');
    }

    await new Promise((r) => setTimeout(r, 5000));
  }
}

export interface GitHubApiError {
  success: boolean;
  error?: string;
  isRateLimit?: boolean;
  retryAfter?: number;
}

export async function fetchGitHubRepoFiles(repo: string, branch?: string, path: string = '', token?: string): Promise<{ name: string; path: string; type: 'file' | 'dir'; content?: string }[] | null> {
  try {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json'
    };

    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    let url = `https://api.github.com/repos/${repo}/contents/${path}`;
    if (branch) {
      url += `?ref=${encodeURIComponent(branch)}`;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const retryAfter = resp.headers.get('Retry-After');
      if (resp.status === 403 && retryAfter) {
        console.error(`GitHub Rate Limit exceeded. Retry after ${retryAfter} seconds.`);
      } else {
        console.error('GitHub API error:', resp.status, resp.statusText);
      }
      return null;
    }
    
    const contents = await resp.json();
    if (!Array.isArray(contents)) return null;

    const files: { name: string; path: string; type: 'file' | 'dir'; content?: string }[] = [];
    
    for (const item of contents) {
      if (item.type === 'file') {
        let content: string | undefined;
        if (item.content) {
          content = decodeBase64ToUTF8(item.content);
        } else if (item.download_url) {
          const downloadResp = await fetch(item.download_url);
          if (downloadResp.ok) {
            content = await downloadResp.text();
          }
        }
        files.push({
          name: item.name,
          path: item.path,
          type: 'file',
          content
        });
      } else if (item.type === 'dir') {
        files.push({
          name: item.name,
          path: item.path,
          type: 'dir'
        });
      }
    }
    
    return files;
  } catch {
    return null;
  }
}

export async function syncGitHubRepoToProject(repo: string, projectName: string, branch?: string, token?: string): Promise<{ success: boolean; syncedFiles: string[]; error?: string; isRateLimit?: boolean; retryAfter?: number }> {
  try {
    const files = await fetchGitHubRepoFiles(repo, branch, '', token);
    if (!files) return { success: false, syncedFiles: [] };

    const data = await loadProjectData(projectName);
    const syncedFiles: string[] = [];
    
    for (const file of files) {
      if (file.type === 'file') {
        const isMdFile = file.name.toLowerCase().endsWith('.md');
        const existingFile = data.files.find(f => f.name === file.path);
        const fileContent = file.content || '';
        
        if (existingFile) {
          if (isMdFile && existingFile.content !== fileContent) {
            existingFile.content = fileContent;
          }
          existingFile.githubSync = { repo, path: file.path, branch, autoSync: true };
          existingFile.isReadOnly = !isMdFile;
        } else {
          data.files.push({
            name: file.path,
            content: fileContent,
            history: [],
            githubSync: { repo, path: file.path, branch, autoSync: true },
            isReadOnly: !isMdFile
          });
        }
        syncedFiles.push(file.path);
      }
    }

    data.githubRepoSync = { repo, branch, autoSync: true, lastSyncTime: Date.now() };
    const success = await saveProjectData(projectName, data);
    
    return { success, syncedFiles };
  } catch (error) {
    console.error('Sync error:', error);
    return { success: false, syncedFiles: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function shouldAutoSync(lastSyncTime?: number): boolean {
  if (!lastSyncTime) return true;
  const oneHour = 60 * 60 * 1000;
  return Date.now() - lastSyncTime > oneHour;
}

export async function pushToGitHub(repo: string, filePath: string, content: string, message: string, token: string, branch?: string): Promise<boolean> {
  try {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${token}`
    };

    const getUrl = branch 
      ? `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`
      : `https://api.github.com/repos/${repo}/contents/${filePath}`;

    const getResp = await fetch(getUrl, { headers });
    let sha: string | undefined;
    
    if (getResp.ok) {
      const existing = await getResp.json();
      sha = existing.sha;
    } else if (getResp.status !== 404) {
      return false;
    }

    const base64Content = btoa(unescape(encodeURIComponent(content)));
    
    const body = JSON.stringify({
      message,
      content: base64Content,
      sha,
      branch
    });

    const putResp = await fetch(getUrl, {
      method: 'PUT',
      headers,
      body
    });

    return putResp.ok;
  } catch {
    return false;
  }
}
