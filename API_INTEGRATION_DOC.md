# CC Solver API 对接文档

> 部署地址: **https://veryonly123-cc-solver.hf.space**
> 所有 API 路径均在 `/api` 下。
> 所有请求必须携带密码（通过 `?token=` 参数或 `X-Solver-Token` 请求头）。

---

## 目录

1. [快速上手（最常见的场景）](#1-快速上手)
2. [提交题目](#2-提交题目)
3. [轮询状态 & 获取结果](#3-轮询状态--获取结果)
4. [批量提交](#4-批量提交)
5. [上传自定义 Solver 项目包](#5-上传自定义-solver-项目包)
6. [下载结果](#6-下载结果)
7. [管理任务（更新配置 / 删除 / 清理）](#7-管理任务更新配置--删除--清理)
8. [完整端点列表](#8-完整端点列表)
9. [状态 & 进度字段说明](#9-状态--进度字段说明)
10. [错误码](#10-错误码)
11. [常见问题](#11-常见问题)

---

## 认证

所有请求必须携带密码，二选一：

**方式 1：URL 参数（最简单，推荐）**
```
?token=YOUR_PASSWORD
```

**方式 2：HTTP 请求头**
```
X-Solver-Token: YOUR_PASSWORD
```

服务端通过 Hugging Face Space 的 `SOLVER_PASSWORD` 环境变量（Secret）配置。如果该变量未设置，则跳过认证。

---

## 1. 快速上手

> 以下示例中的 `YOUR_PASSWORD` 请替换为实际的密码。

**最简流程：提交一道题 → 轮询 → 拿结果**

### 第 1 步：提交题目

```bash
curl -X POST 'https://veryonly123-cc-solver.hf.space/api/submit?token=YOUR_PASSWORD' \
  -H "Content-Type: application/json" \
  -d '{"problem": "一个质量为2kg的物体从静止开始沿光滑斜面下滑，斜面倾角30度，重力加速度g=9.8m/s²。求物体滑下5米后的速度。"}'
```

返回：
```json
{
  "task_id": "task-1715702400000"
}
```

### 第 2 步：轮询状态（每 5 秒一次）

```bash
curl 'https://veryonly123-cc-solver.hf.space/api/status/task-1715702400000?token=YOUR_PASSWORD'
```

返回（解题中）：
```json
{
  "task_id": "task-1715702400000",
  "name": "Problem 1",
  "status": "running",
  "phase": "planning",
  "problem_preview": "一个质量为2kg的物体从静止开始沿光滑斜面下滑...",
  "problem_length": 56,
  "created_at": "2026-05-14T12:00:00+00:00",
  "started_at": "2026-05-14T12:00:05+00:00",
  "finished_at": null,
  "files_done": ["plan"],
  "error": null
}
```

### 第 3 步：获取结果

当 `status` 变为 `"complete"` 时：

```bash
curl https://veryonly123-cc-solver.hf.space/api/result/task-1715702400000
```

返回：
```json
{
  "content": "# 最终答案\n\n物体滑下5米后的速度为 7.0 m/s\n\n## 解题过程\n..."
}
```

---

## 2. 提交题目

### 方式 A：JSON 文本提交（单题）

```
POST https://veryonly123-cc-solver.hf.space/api/submit
Content-Type: application/json
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| problem | string | ✅ | 题目完整内容（Markdown 格式） |
| name | string | ❌ | 任务名称，用于前端显示，默认 `"Problem N"` |

**请求体示例：**
```json
{
  "problem": "题目正文...",
  "name": "期中考试-力学第3题"
}
```

**返回：**
```json
{ "task_id": "task-1715702400000" }
```

---

### 方式 B：文件上传（单题或多题）

```
POST https://veryonly123-cc-solver.hf.space/api/submit-file
Content-Type: multipart/form-data
```

| 字段 | 类型 | 说明 |
|------|------|------|
| files | file[] | 一个或多个 `.md` 文件，每个文件内容即为一道题 |

**curl 示例：**
```bash
curl -X POST https://veryonly123-cc-solver.hf.space/api/submit-file \
  -F "files=@problem1.md" \
  -F "files=@problem2.md"
```

**返回：**
```json
{
  "task_ids": ["task-111", "task-222"],
  "count": 2
}
```

任务名称默认取自文件名（不含 `.md` 后缀）。

---

## 3. 轮询状态 & 获取结果

### 查询单个任务状态

```
GET https://veryonly123-cc-solver.hf.space/api/status/{task_id}
```

**返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| task_id | string | 任务唯一 ID |
| name | string | 任务名称 |
| status | string | `pending` / `running` / `complete` / `error` |
| phase | string | 当前解题阶段，见下方 [进度字段说明](#8-状态--进度字段说明) |
| problem_preview | string | 题目前 120 字符 |
| problem_length | number | 题目总字符数 |
| created_at | string | 创建时间 (ISO 8601) |
| started_at | string \| null | 开始解题时间 |
| finished_at | string \| null | 完成时间 |
| files_done | string[] | 已生成的文件列表，动态检测 |
| error | string \| null | 错误信息 |

---

### 获取结果内容

```
GET https://veryonly123-cc-solver.hf.space/api/result/{task_id}
```

**返回：**
```json
{
  "content": "# 最终答案\n\n..."
}
```

- 返回 `final_summary.md` 的完整内容（Markdown 格式）
- 若结果尚未生成，返回 `404` + `{"error": "Result not available yet"}`

---

### 查看运行日志

```
GET https://veryonly123-cc-solver.hf.space/api/logs/{task_id}?lines=100
```

| 参数 | 类型 | 说明 |
|------|------|------|
| lines | number | 返回最后 N 行日志，默认 100 |

**返回：**
```json
{
  "logs": [
    "[2026-05-14T...] Task task-xxx created",
    "[2026-05-14T...] Starting solver in /app/workspaces/task-xxx",
    "[2026-05-14T...] [stdout] Phase: planning",
    "..."
  ]
}
```

---

## 4. 批量提交

### 获取所有任务列表

```
GET https://veryonly123-cc-solver.hf.space/api/tasks
```

**返回：**
```json
{
  "tasks": [
    {
      "task_id": "task-222",
      "name": "problem2",
      "status": "complete",
      "phase": "complete",
      "problem_preview": "...",
      "problem_length": 1200,
      "created_at": "2026-05-14T...",
      "started_at": "2026-05-14T...",
      "finished_at": "2026-05-14T...",
      "files_done": ["plan", "solution", "review", "final_summary"],
      "error": null
    },
    {
      "task_id": "task-111",
      "name": "problem1",
      "status": "running",
      "phase": "building",
      "files_done": ["plan", "solution"],
      "error": null
    }
  ]
}
```

任务按创建时间倒序排列（最新的在前）。

---

## 5. 上传自定义 Solver 项目包

适用于需要使用自定义 Solver 代码的场景。

```
POST https://veryonly123-cc-solver.hf.space/api/submit-bundle
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project | file | ❌* | Solver 项目 ZIP 包 |
| problems | file[] | ❌* | 题目文件（.md） |
| problem | string[] | ❌* | 题目文本（直接在表单字段中传） |

\* 至少提供其中之一。

**project ZIP 包必须包含以下文件：**

| 文件名 | 说明 |
|--------|------|
| run.py | Solver 入口文件（必需） |
| spawn.py | 子代理启动脚本（必需） |
| outline.md | 项目大纲（必需） |
| config.json | 运行时配置（必需） |

**ZIP 结构示例：**
```
solver-project.zip
├── run.py
├── spawn.py
├── outline.md
└── config.json
```

**curl 示例：**
```bash
curl -X POST https://veryonly123-cc-solver.hf.space/api/submit-bundle \
  -F "project=@my-solver.zip" \
  -F "problems=@physics_q1.md" \
  -F "problems=@physics_q2.md" \
  -F 'problem="这是一道直接提交的物理题目文本..."'
```

上传的 Solver 代码会替换当前运行中的 Solver（对所有后续任务生效）。

**返回：**
```json
{
  "task_ids": ["task-333", "task-444", "task-555"],
  "count": 3
}
```

---

## 6. 下载结果

### 下载单个任务

```
GET https://veryonly123-cc-solver.hf.space/api/download/{task_id}
```

返回一个 ZIP 文件，包含该任务工作目录中的用户文件（problem.md、plan.md、solution.md、review.md、final_summary.md、solver.log 等）。

> **注意**：自动排除仓库自带的 solver 源文件（run.py、spawn.py、outline.md）。config.json 不在排除列表中，因为用户可能做过自定义修改。

---

### 下载所有已完成任务

```
GET https://veryonly123-cc-solver.hf.space/api/download-all
```

返回一个 ZIP 文件，按任务名分目录包含所有已完成任务的用户文件。

> 同样排除 solver 源文件（run.py、spawn.py、outline.md）。

```
all_results.zip
├── problem1/
│   ├── problem.md
│   ├── config.json
│   ├── plan.md
│   ├── solution.md
│   ├── review.md
│   ├── final_summary.md
│   └── solver.log
├── problem2/
│   ├── problem.md
│   ├── config.json
│   ├── plan.md
│   ├── ...
```

---

## 7. 管理任务（更新配置 / 删除 / 清理）

### 更新任务配置（仅 pending 状态）

```
PUT https://veryonly123-cc-solver.hf.space/api/task/{task_id}/config
Content-Type: application/json
```

**请求体示例（部分更新）：**
```json
{
  "wallClock": 3600,
  "maxTurns": 50
}
```

只传入需要修改的字段，会与现有 config.json 合并。

**返回：**
```json
{
  "config": {
    "model": "qwen3.6-plus",
    "wallClock": 3600,
    "maxTurns": 50,
    ...
  }
}
```

> **注意**：仅当任务状态为 `pending`（尚未开始执行）时可修改。如果任务已经在运行，会返回 400 错误。

---

### 删除单个任务

```
DELETE https://veryonly123-cc-solver.hf.space/api/task/{task_id}
```

从内存和磁盘中完全删除该任务（包括 workspace 目录）。

**返回：**
```json
{
  "status": "deleted",
  "task_id": "task-1715702400000"
}
```

如果任务不存在，返回 404。

---

### 批量清理已完成/出错的任务

```
POST https://veryonly123-cc-solver.hf.space/api/tasks/cleanup
```

删除所有 `complete` 和 `error` 状态的任务，释放磁盘和内存空间。

**返回：**
```json
{
  "status": "ok",
  "deleted": 5
}
```

> 正在运行中（`running` / `pending`）的任务不会被清理。

---

## 8. 完整端点列表

| 方法 | 路径 | 说明 | Content-Type |
|------|------|------|-------------|
| `GET` | `/` | Web UI 页面 | - |
| `GET` | `/api/config` | 查看当前配置 | - |
| `POST` | `/api/config` | 更新 Solver 下载源 URL | `application/json` |
| `POST` | `/api/submit` | 提交单题（文本） | `application/json` |
| `POST` | `/api/submit-file` | 提交题目文件 | `multipart/form-data` |
| `POST` | `/api/submit-bundle` | 提交项目包 + 题目 | `multipart/form-data` |
| `GET` | `/api/status/{task_id}` | 查询任务状态 | - |
| `GET` | `/api/result/{task_id}` | 获取解题结果 | - |
| `GET` | `/api/logs/{task_id}` | 查看运行日志 | - |
| `GET` | `/api/tasks` | 获取所有任务列表 | - |
| `GET` | `/api/download/{task_id}` | 下载单个任务 ZIP | - |
| `GET` | `/api/download-all` | 下载全部已完成任务 ZIP | - |
| `PUT` | `/api/task/{task_id}/config` | 更新任务配置 | `application/json` |
| `DELETE` | `/api/task/{task_id}` | 删除单个任务 | - |
| `POST` | `/api/tasks/cleanup` | 清理已完成任务 | - |
| `DELETE` | `/api/tasks` | 清理所有已完成任务 | - |
| `GET` | `/api/integration-guide` | 获取本文档（JSON） | - |
| `GET` | `/api/integration-guide.md` | 获取本文档（Markdown） | `text/markdown` |

---

## 9. 状态 & 进度字段说明

| 方法 | 路径 | 说明 | Content-Type |
|------|------|------|-------------|
| `GET` | `/` | Web UI 页面 | - |
| `GET` | `/api/config` | 查看当前配置 | - |
| `POST` | `/api/config` | 更新 Solver 下载源 URL | `application/json` |
| `POST` | `/api/submit` | 提交单题（文本） | `application/json` |
| `POST` | `/api/submit-file` | 提交题目文件 | `multipart/form-data` |
| `POST` | `/api/submit-bundle` | 提交项目包 + 题目 | `multipart/form-data` |
| `GET` | `/api/status/{task_id}` | 查询任务状态 | - |
| `GET` | `/api/result/{task_id}` | 获取解题结果 | - |
| `GET` | `/api/logs/{task_id}` | 查看运行日志 | - |
| `GET` | `/api/tasks` | 获取所有任务列表 | - |
| `GET` | `/api/download/{task_id}` | 下载单个任务 ZIP | - |
| `GET` | `/api/download-all` | 下载全部已完成任务 ZIP | - |
| `GET` | `/api/integration-guide` | 获取本文档（JSON） | - |
| `GET` | `/api/integration-guide.md` | 获取本文档（Markdown） | `text/markdown` |

---

## 8. 状态 & 进度字段说明

### status — 任务状态

| 值 | 含义 | 下一步 |
|----|------|--------|
| `pending` | 排队等待启动 | 自动转为 running |
| `running` | 正在解题 | 等待 complete 或 error |
| `complete` | 解题完成 | 可调用 `/api/result/{id}` 获取结果 |
| `error` | 出错 | 查看 `error` 字段和 `/api/logs/{id}` |

### phase — 解题阶段（动态检测）

phase 字段根据 workspace 中已生成的文件动态推断，大致对应：

| phase | 含义 |
|-------|------|
| `starting` | 初始化中 |
| `planning` | Planner 正在分析题目 |
| `building` | Builder 正在解题 |
| `evaluating` | Evaluator 正在评审 |
| `complete` | 全部完成 |

### files_done — 已生成文件列表

动态扫描 workspace 中所有 `.md` 文件（排除 problem.md），返回文件名（去掉后缀）。这是一个动态字段，会随着解题进度增长：

```
[]                           → 刚开始
["plan"]                     → 计划已生成
["plan", "solution"]         → 解答已生成
["plan", "solution", "review"] → 评审已生成
["plan", "solution", "review", "final_summary"] → 全部完成
```

---

## 10. 错误码

| HTTP 状态码 | 含义 |
|-------------|------|
| 200 | 成功 |
| 400 | 请求参数错误（如未提供题目） |
| 404 | 任务不存在 / 结果尚未生成 |
| 500 | 服务器内部错误 |

**错误响应格式：**
```json
{
  "error": "No problem provided"
}
```

---

## 11. 常见问题

### Q: 解题需要多长时间？

取决于题目复杂度。简单的题目约 1~3 分钟，复杂的多步推理题可能需要 5~10 分钟。建议轮询间隔 5 秒。

### Q: 同时能提交多少道题？

服务端默认串行执行（同一时间只解一道题），后续题目会排队等待。排队中的任务状态为 `pending`。

### Q: 任务数据会保留多久？

任务数据存储在容器内存和工作目录中。如果 Hugging Face Space 重启，内存中的任务列表会丢失，但 workspaces 目录中的文件可能仍然存在（取决于 Space 是否使用持久化存储）。建议在收到结果后及时下载或保存。

### Q: 支持哪些模型？

模型由 Solver 仓库中的 `config.json` 配置，Docker 侧不指定。默认配置可在 `/api/config` 中查看，也可通过 `POST /api/config` 更新 Solver 代码的下载源。

### Q: 如何调试？

1. 先调 `/api/status/{task_id}` 确认当前状态
2. 如果状态是 `error`，查看 `error` 字段
3. 调 `/api/logs/{task_id}?lines=200` 查看详细日志
4. 如果日志中出现 `ANTHROPIC_API_KEY: NOT SET`，说明 Space 未正确配置 API Key

### Q: 超时怎么办？

超时时间由 Solver 仓库的 `config.json` 中的 `wallClock` 字段控制，默认较长（如 86400 秒 = 24 小时），一般不会触发。

---

## 前端集成示例（JavaScript）

```javascript
const BASE = "https://veryonly123-cc-solver.hf.space/api";
const TOKEN = "YOUR_PASSWORD"; // ← 替换为实际密码

function api(url, opts = {}) {
  const sep = url.includes('?') ? '&' : '?';
  return fetch(url + `${sep}token=${TOKEN}`, opts);
}

// 提交题目
async function submitProblem(text, name) {
  const res = await api(`${BASE}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problem: text, name }),
  });
  const data = await res.json();
  return data.task_id;
}

// 轮询状态直到完成
async function waitForResult(taskId, onProgress) {
  while (true) {
    const res = await api(`${BASE}/status/${taskId}`);
    const task = await res.json();

    if (onProgress) onProgress(task);

    if (task.status === "complete") {
      const resultRes = await api(`${BASE}/result/${taskId}`);
      const result = await resultRes.json();
      return result.content;
    }

    if (task.status === "error") {
      throw new Error(task.error);
    }

    await new Promise((r) => setTimeout(r, 5000));
  }
}

// 使用示例
const taskId = await submitProblem("一个质量为2kg的物体...", "力学题");
const result = await waitForResult(taskId, (task) => {
  console.log(`进度: ${task.phase} | 已完成: ${task.files_done.join(", ")}`);
});
console.log("结果:", result);
```

---

*文档生成时间: 2026-05-14*
