# Apna Loveable - AI-Powered Code Generation Platform

A Loveable-inspired platform that enables users to generate and iterate on React applications using natural language, powered by Claude AI and Kubernetes.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [System Components](#system-components)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Kubernetes Configuration](#kubernetes-configuration)
- [Claude Tools Integration](#claude-tools-integration)
- [Caddy Routing](#caddy-routing)
- [Implementation Flow](#implementation-flow)
- [Deployment Guide](#deployment-guide)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USER REQUEST                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   API Server    │
                    │  (Node/Express) │
                    │                 │
                    │  - REST API     │
                    │  - Auth         │
                    │  - Business     │
                    │    Logic        │
                    └────┬───────┬────┘
                         │       │
           ┌─────────────┘       └──────────────┐
           ▼                                    ▼
    ┌─────────────┐                    ┌──────────────┐
    │ PostgreSQL  │                    │   Claude AI  │
    │             │                    │              │
    │ - Projects  │                    │ + Tools:     │
    │ - Convos    │                    │   read_file  │
    │ - Metadata  │                    │   write_file │
    └─────────────┘                    │   check_logs │
                                       │   list_files │
           ┌───────────────────────────│   run_cmd    │
           │                           └──────┬───────┘
           │                                  │
           ▼                                  │ kubectl exec
    ┌─────────────┐                          │
    │   S3/R2     │                          │
    │             │                          ▼
    │ - Snapshots │            ┌──────────────────────────────┐
    │ - Patches   │            │   Kubernetes Cluster         │
    │ - Backups   │            │                              │
    └─────────────┘            │  ┌────────────────────────┐  │
                               │  │  Pod: project-{uuid}   │  │
                               │  │                        │  │
           ┌───────────────────┼──│  - Ubuntu + Node 22   │  │
           │                   │  │  - Vite Dev Server    │  │
           │  Caddy Routing    │  │  - Port 5173          │  │
           │  *.project        │  │                        │  │
           │  .apnaloveable    │  │  PVC: /app            │  │
           │  .com             │  │  (1 hour TTL)         │  │
           │                   │  └────────────────────────┘  │
           │                   │                              │
           │                   │  Service: project-{uuid}     │
           │                   │  ClusterIP: 10.x.x.x:5173   │
           │                   └──────────────────────────────┘
           │                                  ▲
           └──────────────────────────────────┘
                                              │
                                              │
                                    ┌─────────┴─────────┐
                                    │   User Browser    │
                                    │   Preview Link    │
                                    │ project-abc123    │
                                    │ .project          │
                                    │ .apnaloveable.com │
                                    └───────────────────┘
```

---

## System Components

### 1. API Server

**Responsibilities**:
- Handle HTTP requests from frontend
- Manage project lifecycle (create, resume, delete)
- Orchestrate Claude AI interactions
- Execute kubectl commands via tools
- Store conversation history in PostgreSQL
- Save snapshots to S3/R2

**Tech Stack**:
- Node.js 22+ with Express/Fastify
- TypeScript
- Anthropic SDK (Claude integration)
- Kubernetes client library (@kubernetes/client-node)
- PostgreSQL client (pg/Prisma)
- S3 SDK (AWS SDK or Cloudflare R2)

### 2. PostgreSQL Database

**Purpose**:
- Store project metadata
- Maintain conversation history
- Track pod lifecycle

### 3. S3/R2 Object Storage

**Purpose**:
- Full project snapshots (when PVC is deleted)
- Git patch history
- Backup and disaster recovery

### 4. Kubernetes Cluster

**Purpose**:
- Isolated execution environments for each project
- Run Vite dev server for live preview
- Auto-scaling and resource management

**Per Project**:
- 1 Pod (Ubuntu + Node 22)
- 1 Service (ClusterIP)
- 1 PVC (Persistent Volume Claim, 1 hour TTL)

### 5. Caddy Reverse Proxy

**Purpose**:
- Dynamic routing to project pods
- SSL/TLS termination
- Load balancing

**Pattern**: `{project-id}.project.apnaloveable.com` → `Service/project-{id}:5173`

### 6. Claude AI (Anthropic)

**Purpose**:
- Generate code based on user prompts
- Iterate on code until error-free
- Use tools to interact with K8s pods

**Tools Provided**:
- `read_file` - Read files from pod
- `write_file` - Create/update files in pod
- `list_files` - List directory contents
- `check_logs` - Check Vite dev server logs
- `run_command` - Execute arbitrary commands

---

## API Endpoints

### POST `/api/projects/create`

**Description**: Create a new project from user prompt

**Request**:
```json
{
  "prompt": "Create a todo app with dark mode",
  "userId": "user-123",
  "template": "vite-react" // optional, default: vite-react
}
```

**Response**:
```json
{
  "projectId": "proj-abc123",
  "status": "building",
  "previewUrl": "https://proj-abc123.project.apnaloveable.com",
  "message": "Project is being created..."
}
```

**Pseudo Code**:
```javascript
async function createProject(req, res) {
  const { prompt, userId, template = 'vite-react' } = req.body;

  // 1. Generate unique project ID
  const projectId = generateUUID();
  const podName = `project-${projectId}`;

  // 2. Create database record
  await db.projects.create({
    id: projectId,
    userId: userId,
    status: 'initializing',
    lastActivityAt: new Date()
  });

  // 3. Create Kubernetes resources
  await createK8sResources(projectId);
  // - Creates PVC
  // - Creates Pod (with template files)
  // - Creates Service
  // - Waits for pod to be ready

  // 4. Start Vite dev server in pod
  await executeInPod(podName, 'npm install');
  await executeInPod(podName, 'npm run dev -- --host 0.0.0.0 --port 5173', { background: true });

  // 5. Wait for Vite to be ready
  await waitForViteReady(podName);

  // 6. Save initial conversation
  await db.conversations.create({
    projectId: projectId,
    role: 'user',
    content: prompt,
    fileDiffs: []
  });

  // 7. Call Claude with tools
  const result = await generateCodeWithClaude({
    projectId: projectId,
    podName: podName,
    prompt: prompt,
    conversationHistory: []
  });

  // 8. Update project status
  await db.projects.update({
    where: { id: projectId },
    data: {
      status: result.success ? 'ready' : 'error',
      lastActivityAt: new Date()
    }
  });

  // 9. Return response
  return res.json({
    projectId: projectId,
    status: result.success ? 'ready' : 'error',
    previewUrl: `https://${podName}.project.apnaloveable.com`,
    message: result.message,
    errors: result.errors || []
  });
}
```

---

### POST `/api/projects/:projectId/chat`

**Description**: Continue conversation and iterate on existing project

**Request**:
```json
{
  "message": "Add a dark mode toggle to the header",
  "userId": "user-123"
}
```

**Response**:
```json
{
  "status": "success",
  "message": "Dark mode toggle added successfully",
  "changedFiles": [
    "src/App.tsx",
    "src/components/Header.tsx",
    "src/styles/theme.css"
  ]
}
```

**Pseudo Code**:
```javascript
async function chatWithProject(req, res) {
  const { projectId } = req.params;
  const { message, userId } = req.body;

  // 1. Verify project exists and user owns it
  const project = await db.projects.findUnique({
    where: { id: projectId, userId: userId }
  });

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // 2. Check if pod exists, if not restore from S3
  const podName = `project-${projectId}`;
  const podExists = await checkPodExists(podName);

  if (!podExists) {
    await restoreProjectFromS3(projectId);
  }

  // 3. Load conversation history
  const conversationHistory = await db.conversations.findMany({
    where: { projectId: projectId },
    orderBy: { createdAt: 'asc' }
  });

  // 4. Save user message
  await db.conversations.create({
    projectId: projectId,
    role: 'user',
    content: message,
    fileDiffs: []
  });

  // 5. Call Claude with full context
  const result = await generateCodeWithClaude({
    projectId: projectId,
    podName: podName,
    prompt: message,
    conversationHistory: conversationHistory
  });

  // 6. Update last activity
  await db.projects.update({
    where: { id: projectId },
    data: { lastActivityAt: new Date() }
  });

  // 7. Return response
  return res.json({
    status: result.success ? 'success' : 'error',
    message: result.message,
    changedFiles: result.changedFiles || [],
    errors: result.errors || []
  });
}
```

---

### GET `/api/projects/:projectId`

**Description**: Get project details and status

**Response**:
```json
{
  "id": "proj-abc123",
  "userId": "user-123",
  "status": "ready",
  "previewUrl": "https://proj-abc123.project.apnaloveable.com",
  "createdAt": "2025-01-15T10:30:00Z",
  "lastActivityAt": "2025-01-15T11:45:00Z",
  "podStatus": "running"
}
```

**Pseudo Code**:
```javascript
async function getProject(req, res) {
  const { projectId } = req.params;
  const { userId } = req.user; // from auth middleware

  const project = await db.projects.findUnique({
    where: { id: projectId, userId: userId }
  });

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Check pod status
  const podName = `project-${projectId}`;
  const podStatus = await getK8sPodStatus(podName);

  return res.json({
    ...project,
    previewUrl: `https://${podName}.project.apnaloveable.com`,
    podStatus: podStatus || 'terminated'
  });
}
```

---

### GET `/api/projects/:projectId/files/:path`

**Description**: Get specific file content from project

**Example**: `GET /api/projects/proj-abc123/files/src/App.tsx`

**Response**:
```json
{
  "path": "src/App.tsx",
  "content": "import React from 'react'...",
  "size": 1234,
  "lastModified": "2025-01-15T11:45:00Z"
}
```

**Pseudo Code**:
```javascript
async function getFile(req, res) {
  const { projectId, path } = req.params;
  const { userId } = req.user;

  // Verify ownership
  const project = await db.projects.findUnique({
    where: { id: projectId, userId: userId }
  });

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Read file from pod or S3
  const podName = `project-${projectId}`;
  const podExists = await checkPodExists(podName);

  let content;
  if (podExists) {
    // Read from pod
    content = await executeInPod(podName, `cat /app/${path}`);
  } else {
    // Read from S3 snapshot
    content = await getFileFromS3(projectId, path);
  }

  return res.json({
    path: path,
    content: content,
    size: content.length
  });
}
```

---

### DELETE `/api/projects/:projectId`

**Description**: Delete project and cleanup resources

**Response**:
```json
{
  "message": "Project deleted successfully"
}
```

**Pseudo Code**:
```javascript
async function deleteProject(req, res) {
  const { projectId } = req.params;
  const { userId } = req.user;

  // 1. Verify ownership
  const project = await db.projects.findUnique({
    where: { id: projectId, userId: userId }
  });

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // 2. Save final snapshot to S3 (if pod exists)
  const podName = `project-${projectId}`;
  const podExists = await checkPodExists(podName);

  if (podExists) {
    await saveSnapshotToS3(projectId, podName);
  }

  // 3. Delete Kubernetes resources
  await deleteK8sResources(projectId);
  // - Deletes Service
  // - Deletes Pod
  // - Deletes PVC

  // 4. Mark project as deleted in DB (soft delete)
  await db.projects.update({
    where: { id: projectId },
    data: {
      status: 'deleted',
      deletedAt: new Date()
    }
  });

  return res.json({
    message: 'Project deleted successfully'
  });
}
```

---

## Database Schema

### PostgreSQL Tables

```sql
-- Projects table
CREATE TABLE projects (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255),
  status VARCHAR(50) NOT NULL, -- 'initializing', 'building', 'ready', 'error', 'deleted'
  template VARCHAR(50) DEFAULT 'vite-react',
  pod_name VARCHAR(100),
  service_name VARCHAR(100),
  pvc_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_last_activity (last_activity_at)
);

-- Conversations table
CREATE TABLE conversations (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  tool_calls JSONB, -- Array of tool calls made by Claude
  file_diffs JSONB, -- Array of file changes: [{ path, action, content }]
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX idx_project_id (project_id),
  INDEX idx_created_at (created_at)
);

-- S3 Snapshots tracking table
CREATE TABLE snapshots (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  snapshot_type VARCHAR(50), -- 'full', 'patch'
  size_bytes BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX idx_project_id (project_id)
);

-- Users table (basic for MVP)
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Conversation Example

```json
{
  "id": "conv-xyz789",
  "project_id": "proj-abc123",
  "role": "assistant",
  "content": "I've added a dark mode toggle to your header component. The toggle uses React context to manage the theme state globally.",
  "tool_calls": [
    {
      "tool": "write_file",
      "input": {
        "pod_id": "project-proj-abc123",
        "file_path": "/app/src/contexts/ThemeContext.tsx",
        "content": "import React, { createContext... }"
      },
      "output": "File written successfully"
    },
    {
      "tool": "write_file",
      "input": {
        "pod_id": "project-proj-abc123",
        "file_path": "/app/src/components/Header.tsx",
        "content": "import { useTheme } from '../contexts/ThemeContext'..."
      },
      "output": "File written successfully"
    },
    {
      "tool": "check_logs",
      "input": {
        "pod_id": "project-proj-abc123"
      },
      "output": "✓ built in 245ms\n  No errors found"
    }
  ],
  "file_diffs": [
    {
      "path": "src/contexts/ThemeContext.tsx",
      "action": "create",
      "content": "import React, { createContext... }",
      "size": 1456
    },
    {
      "path": "src/components/Header.tsx",
      "action": "update",
      "content": "import { useTheme } from '../contexts/ThemeContext'...",
      "size": 2340
    },
    {
      "path": "src/App.tsx",
      "action": "update",
      "content": "import { ThemeProvider } from './contexts/ThemeContext'...",
      "size": 1890
    }
  ],
  "created_at": "2025-01-15T11:45:32Z"
}
```

---

## Kubernetes Configuration

### Pod Template

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: project-{PROJECT_ID}
  labels:
    app: project
    project-id: {PROJECT_ID}
    managed-by: apna-loveable
spec:
  containers:
  - name: vite-dev
    image: ubuntu:22.04
    command: ["/bin/bash", "-c"]
    args:
      - |
        # Install Node.js 22
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs git

        # Copy Vite template to /app
        cp -r /templates/vite-react/* /app/

        # Keep container running
        tail -f /dev/null

    ports:
    - containerPort: 5173
      name: vite-dev

    volumeMounts:
    - name: project-storage
      mountPath: /app
    - name: templates
      mountPath: /templates

    resources:
      requests:
        memory: "512Mi"
        cpu: "250m"
      limits:
        memory: "2Gi"
        cpu: "1000m"

    env:
    - name: NODE_ENV
      value: "development"

  volumes:
  - name: project-storage
    persistentVolumeClaim:
      claimName: pvc-{PROJECT_ID}
  - name: templates
    configMap:
      name: vite-templates

  restartPolicy: Never
```

### PVC Template

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pvc-{PROJECT_ID}
  labels:
    project-id: {PROJECT_ID}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: standard # or your cloud provider's storage class
```

### Service Template

```yaml
apiVersion: v1
kind: Service
metadata:
  name: project-{PROJECT_ID}
  labels:
    project-id: {PROJECT_ID}
spec:
  selector:
    project-id: {PROJECT_ID}
  ports:
  - protocol: TCP
    port: 5173
    targetPort: 5173
  type: ClusterIP
```

### Kubernetes Helper Functions

```javascript
const k8s = require('@kubernetes/client-node');

const kc = new k8s.KubeConfig();
kc.loadFromDefault(); // or loadFromFile for remote clusters

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sExec = new k8s.Exec(kc);

async function createK8sResources(projectId) {
  const podName = `project-${projectId}`;
  const pvcName = `pvc-${projectId}`;
  const serviceName = `project-${projectId}`;
  const namespace = 'default'; // or your namespace

  // 1. Create PVC
  const pvc = {
    metadata: {
      name: pvcName,
      labels: { 'project-id': projectId }
    },
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: {
        requests: { storage: '5Gi' }
      }
    }
  };

  await k8sApi.createNamespacedPersistentVolumeClaim(namespace, pvc);

  // 2. Create Pod
  const pod = {
    metadata: {
      name: podName,
      labels: {
        'app': 'project',
        'project-id': projectId
      }
    },
    spec: {
      containers: [{
        name: 'vite-dev',
        image: 'your-registry/vite-node22:latest', // Pre-built image
        ports: [{ containerPort: 5173, name: 'vite-dev' }],
        volumeMounts: [{
          name: 'project-storage',
          mountPath: '/app'
        }],
        resources: {
          requests: { memory: '512Mi', cpu: '250m' },
          limits: { memory: '2Gi', cpu: '1000m' }
        }
      }],
      volumes: [{
        name: 'project-storage',
        persistentVolumeClaim: { claimName: pvcName }
      }],
      restartPolicy: 'Never'
    }
  };

  await k8sApi.createNamespacedPod(namespace, pod);

  // 3. Wait for pod to be ready
  await waitForPodReady(podName, namespace);

  // 4. Create Service
  const service = {
    metadata: {
      name: serviceName,
      labels: { 'project-id': projectId }
    },
    spec: {
      selector: { 'project-id': projectId },
      ports: [{
        protocol: 'TCP',
        port: 5173,
        targetPort: 5173
      }],
      type: 'ClusterIP'
    }
  };

  await k8sApi.createNamespacedService(namespace, service);

  return { podName, serviceName, pvcName };
}

async function executeInPod(podName, command, options = {}) {
  const namespace = 'default';
  const containerName = 'vite-dev';

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    k8sExec.exec(
      namespace,
      podName,
      containerName,
      ['/bin/bash', '-c', command],
      process.stdout, // or capture output
      process.stderr,
      process.stdin,
      false, // tty
      (status) => {
        if (status.status === 'Success') {
          resolve(stdout);
        } else {
          reject(new Error(stderr));
        }
      }
    );
  });
}

async function deleteK8sResources(projectId) {
  const namespace = 'default';
  const podName = `project-${projectId}`;
  const serviceName = `project-${projectId}`;
  const pvcName = `pvc-${projectId}`;

  // Delete in reverse order
  await k8sApi.deleteNamespacedService(serviceName, namespace);
  await k8sApi.deleteNamespacedPod(podName, namespace);
  await k8sApi.deleteNamespacedPersistentVolumeClaim(pvcName, namespace);
}
```

---

## Claude Tools Integration

### Tool Definitions

```javascript
const claudeTools = [
  {
    name: "read_file",
    description: "Read the contents of a file from the project. Use this to understand existing code before making changes.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file relative to /app (e.g., 'src/App.tsx', 'package.json')"
        }
      },
      required: ["file_path"]
    }
  },
  {
    name: "write_file",
    description: "Create a new file or completely overwrite an existing file with new content. Always provide the full file content.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file relative to /app (e.g., 'src/components/Header.tsx')"
        },
        content: {
          type: "string",
          description: "Complete content of the file"
        }
      },
      required: ["file_path", "content"]
    }
  },
  {
    name: "list_files",
    description: "List all files and directories in a given path. Useful for exploring the project structure.",
    input_schema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory path relative to /app (e.g., 'src', 'src/components'). Use '.' for root.",
          default: "."
        }
      },
      required: []
    }
  },
  {
    name: "check_logs",
    description: "Check the Vite dev server logs to see if there are any build errors, warnings, or console output. Use this after making changes to verify everything works.",
    input_schema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of recent log lines to retrieve",
          default: 50
        }
      },
      required: []
    }
  },
  {
    name: "run_command",
    description: "Execute a shell command in the project directory. Use for npm install, running tests, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute (e.g., 'npm install lodash', 'ls -la')"
        }
      },
      required: ["command"]
    }
  }
];
```

### Tool Implementation

```javascript
const Anthropic = require('@anthropic-ai/sdk');

class ClaudeToolExecutor {
  constructor(podName, namespace = 'default') {
    this.podName = podName;
    this.namespace = namespace;
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  async executeTool(toolName, toolInput) {
    switch (toolName) {
      case 'read_file':
        return await this.readFile(toolInput.file_path);

      case 'write_file':
        return await this.writeFile(toolInput.file_path, toolInput.content);

      case 'list_files':
        return await this.listFiles(toolInput.directory || '.');

      case 'check_logs':
        return await this.checkLogs(toolInput.lines || 50);

      case 'run_command':
        return await this.runCommand(toolInput.command);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async readFile(filePath) {
    try {
      const content = await executeInPod(
        this.podName,
        `cat /app/${filePath}`
      );
      return {
        success: true,
        content: content
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error.message}`
      };
    }
  }

  async writeFile(filePath, content) {
    try {
      // Ensure directory exists
      const dir = filePath.split('/').slice(0, -1).join('/');
      if (dir) {
        await executeInPod(this.podName, `mkdir -p /app/${dir}`);
      }

      // Write file using heredoc to handle special characters
      const escapedContent = content.replace(/'/g, "'\\''");
      await executeInPod(
        this.podName,
        `cat > /app/${filePath} << 'EOFMARKER'\n${content}\nEOFMARKER`
      );

      return {
        success: true,
        message: `File written: ${filePath}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to write file: ${error.message}`
      };
    }
  }

  async listFiles(directory) {
    try {
      const output = await executeInPod(
        this.podName,
        `ls -lah /app/${directory}`
      );
      return {
        success: true,
        output: output
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list files: ${error.message}`
      };
    }
  }

  async checkLogs(lines) {
    try {
      // Get container logs from Kubernetes
      const logs = await k8sApi.readNamespacedPodLog(
        this.podName,
        this.namespace,
        'vite-dev',
        undefined, // follow
        undefined, // insecureSkipTLSVerifyBackend
        undefined, // limitBytes
        undefined, // pretty
        undefined, // previous
        undefined, // sinceSeconds
        lines, // tailLines
        undefined  // timestamps
      );

      return {
        success: true,
        logs: logs.body
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get logs: ${error.message}`
      };
    }
  }

  async runCommand(command) {
    try {
      const output = await executeInPod(
        this.podName,
        `cd /app && ${command}`
      );
      return {
        success: true,
        output: output
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        output: error.stderr || error.stdout
      };
    }
  }
}
```

### Main Generation Loop

```javascript
async function generateCodeWithClaude({
  projectId,
  podName,
  prompt,
  conversationHistory,
  maxRetries = 4
}) {
  const toolExecutor = new ClaudeToolExecutor(podName);

  // Build messages array from conversation history
  const messages = conversationHistory.map(conv => ({
    role: conv.role,
    content: conv.content
  }));

  // Add current user prompt
  messages.push({
    role: 'user',
    content: prompt
  });

  const systemPrompt = `You are an expert React developer. You are helping a user build a web application using Vite + React + TypeScript.

The project is running in a Kubernetes pod at /app. You have access to tools to read files, write files, list files, check logs, and run commands.

Your goal is to:
1. Understand the user's request
2. Read relevant existing files if needed
3. Make the necessary code changes
4. Verify there are no errors by checking the logs
5. If there are errors, fix them and check again (max ${maxRetries} attempts)

Best practices:
- Always read files before modifying them to understand the current code
- Write complete files, not partial changes
- Check logs after making changes to ensure no errors
- Use TypeScript for type safety
- Follow React best practices and hooks conventions
- Keep code clean and well-organized

Current project structure (default Vite template):
- /app/src/App.tsx - Main app component
- /app/src/main.tsx - Entry point
- /app/src/index.css - Global styles
- /app/package.json - Dependencies
- /app/vite.config.ts - Vite configuration

The Vite dev server is already running on port 5173.`;

  let attemptCount = 0;
  let lastError = null;
  let changedFiles = [];

  while (attemptCount < maxRetries) {
    try {
      const response = await toolExecutor.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8000,
        system: systemPrompt,
        messages: messages,
        tools: claudeTools
      });

      // Process response
      const { content, stop_reason } = response;

      let assistantMessage = '';
      let toolCalls = [];
      let shouldContinue = false;

      for (const block of content) {
        if (block.type === 'text') {
          assistantMessage += block.text;
        } else if (block.type === 'tool_use') {
          // Execute tool
          const toolResult = await toolExecutor.executeTool(
            block.name,
            block.input
          );

          toolCalls.push({
            tool: block.name,
            input: block.input,
            output: toolResult
          });

          // Track file changes
          if (block.name === 'write_file' && toolResult.success) {
            changedFiles.push(block.input.file_path);
          }

          // Add tool result to conversation
          messages.push({
            role: 'assistant',
            content: content
          });

          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(toolResult)
            }]
          });

          shouldContinue = true;
        }
      }

      // Save assistant message to DB
      await db.conversations.create({
        projectId: projectId,
        role: 'assistant',
        content: assistantMessage,
        toolCalls: toolCalls,
        fileDiffs: changedFiles.map(path => ({
          path: path,
          action: 'update' // simplified for MVP
        }))
      });

      // If Claude used tools, continue the loop
      if (shouldContinue) {
        attemptCount++;
        continue;
      }

      // Check if there are errors in logs
      const logsResult = await toolExecutor.checkLogs(100);

      if (logsResult.success && logsResult.logs.includes('error')) {
        lastError = logsResult.logs;

        // Add error feedback to conversation
        messages.push({
          role: 'user',
          content: `There are errors in the logs. Please fix them:\n\n${logsResult.logs}`
        });

        attemptCount++;
        continue;
      }

      // Success!
      return {
        success: true,
        message: assistantMessage,
        changedFiles: [...new Set(changedFiles)],
        attempts: attemptCount + 1
      };

    } catch (error) {
      console.error('Claude API error:', error);
      lastError = error.message;
      attemptCount++;
    }
  }

  // Max retries reached
  return {
    success: false,
    message: `Failed to generate error-free code after ${maxRetries} attempts`,
    errors: [lastError],
    changedFiles: [...new Set(changedFiles)],
    attempts: attemptCount
  };
}
```

---

## Caddy Routing

### Caddy Configuration

```caddy
# Caddyfile

# Main API server
api.apnaloveable.com {
    reverse_proxy localhost:3000
}

# Dynamic project routing
*.project.apnaloveable.com {
    @project {
        header_regexp host Host ^(.+)\.project\.apnaloveable\.com$
    }

    reverse_proxy @project {
        # Extract project ID from subdomain
        to http://project-{re.host.1}.default.svc.cluster.local:5173

        # WebSocket support for HMR
        header_up Upgrade {>Upgrade}
        header_up Connection {>Connection}

        # Health check
        health_uri /
        health_interval 10s
        health_timeout 5s
    }

    # CORS headers for development
    header {
        Access-Control-Allow-Origin *
        Access-Control-Allow-Methods "GET, POST, OPTIONS"
        Access-Control-Allow-Headers "Content-Type"
    }
}
```

### Dynamic Service Discovery

Since we're using Kubernetes Services with predictable names (`project-{id}`), Caddy can route directly to them using Kubernetes DNS:

```
Subdomain: proj-abc123.project.apnaloveable.com
    ↓
Extract: proj-abc123
    ↓
Route to: http://project-proj-abc123.default.svc.cluster.local:5173
    ↓
K8s resolves to Pod IP
```

### Alternative: Caddy API Dynamic Config

If you need more dynamic control:

```javascript
async function registerProjectRoute(projectId) {
  const caddyApiUrl = 'http://caddy-admin:2019';
  const serviceName = `project-${projectId}`;
  const subdomain = `${serviceName}.project.apnaloveable.com`;

  const route = {
    "@id": serviceName,
    "match": [{
      "host": [subdomain]
    }],
    "handle": [{
      "handler": "reverse_proxy",
      "upstreams": [{
        "dial": `${serviceName}.default.svc.cluster.local:5173`
      }],
      "headers": {
        "request": {
          "set": {
            "Upgrade": ["{http.request.header.Upgrade}"],
            "Connection": ["{http.request.header.Connection}"]
          }
        }
      }
    }]
  };

  await fetch(`${caddyApiUrl}/config/apps/http/servers/srv0/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(route)
  });
}

async function removeProjectRoute(projectId) {
  const caddyApiUrl = 'http://caddy-admin:2019';
  const serviceName = `project-${projectId}`;

  await fetch(`${caddyApiUrl}/id/${serviceName}`, {
    method: 'DELETE'
  });
}
```

---

## Implementation Flow

### Flow 1: Create New Project

```
┌──────┐
│ User │
└──┬───┘
   │ POST /api/projects/create
   │ { prompt: "Create a todo app" }
   ▼
┌──────────────┐
│ API Server   │
└──┬───────────┘
   │
   │ 1. Generate project ID: proj-abc123
   │ 2. Create DB record (status: initializing)
   │
   │ 3. Create K8s resources
   ▼
┌──────────────┐
│ Kubernetes   │
│ - PVC        │
│ - Pod        │
│ - Service    │
└──┬───────────┘
   │
   │ 4. Wait for pod ready
   │ 5. Run: npm install
   │ 6. Run: npm run dev (background)
   │ 7. Wait for Vite ready
   │
   ▼
┌──────────────┐
│ Claude AI    │ ← 8. Send prompt + tools + system instructions
└──┬───────────┘
   │
   │ Loop (max 4 attempts):
   │   ├─ read_file('src/App.tsx')
   │   ├─ write_file('src/App.tsx', newContent)
   │   ├─ write_file('src/Todo.tsx', todoContent)
   │   ├─ check_logs() → errors?
   │   │   ├─ No errors → break
   │   │   └─ Has errors → fix and retry
   │   └─ repeat
   │
   ▼
┌──────────────┐
│ Save to DB   │
│ - Conversation
│ - File diffs │
└──┬───────────┘
   │
   │ 9. Update project status: ready
   │ 10. Return response
   ▼
┌──────┐
│ User │ ← { projectId, previewUrl, status: 'ready' }
└──────┘
```

### Flow 2: Resume Project (Pod Deleted)

```
┌──────┐
│ User │
└──┬───┘
   │ POST /api/projects/proj-abc123/chat
   │ { message: "Add dark mode" }
   ▼
┌──────────────┐
│ API Server   │
└──┬───────────┘
   │
   │ 1. Check pod exists
   │    → Pod not found (deleted after 1 hour)
   │
   │ 2. Restore from S3
   ▼
┌──────────────┐
│ S3/R2        │
│ - Download   │
│   snapshot   │
└──┬───────────┘
   │
   │ 3. Create new K8s resources
   ▼
┌──────────────┐
│ Kubernetes   │
│ - New PVC    │
│ - New Pod    │
│ - Service    │
└──┬───────────┘
   │
   │ 4. Extract snapshot to /app
   │ 5. npm install
   │ 6. npm run dev
   │
   │ 7. Load conversation history from DB
   │
   ▼
┌──────────────┐
│ Claude AI    │ ← 8. Send full context:
└──────────────┘      - Previous conversation
                      - File diffs from DB
                      - Current message
   │
   │ Continue as normal...
   ▼
```

### Flow 3: Pod Cleanup (1 Hour Inactivity)

```
┌──────────────┐
│ Cron Job     │ (runs every 10 minutes)
└──┬───────────┘
   │
   │ 1. Query DB for projects:
   │    WHERE last_activity_at < NOW() - INTERVAL '1 hour'
   │    AND status != 'deleted'
   │
   ▼
┌──────────────┐
│ For each     │
│ project:     │
└──┬───────────┘
   │
   │ 2. Check if pod exists
   │    → Pod exists
   │
   │ 3. Create snapshot
   ▼
┌──────────────┐
│ - tar /app   │
│ - Upload to  │
│   S3/R2      │
└──┬───────────┘
   │
   │ 4. Save snapshot metadata to DB
   │
   │ 5. Delete K8s resources
   ▼
┌──────────────┐
│ Kubernetes   │
│ - Delete Pod │
│ - Delete PVC │
│ (Keep Service)
└──────────────┘
   │
   │ 6. Update project status: 'hibernated'
   ▼
```

---

## S3/R2 Storage Structure

```
bucket: apna-loveable-projects

Structure:
/snapshots/
  /proj-abc123/
    /snapshot-20250115-1045.tar.gz     # Full project snapshot
    /snapshot-20250115-1145.tar.gz
    /latest.tar.gz → snapshot-...      # Symlink to latest
  /proj-xyz789/
    /snapshot-20250115-1000.tar.gz
    /latest.tar.gz

/patches/ (optional, for granular history)
  /proj-abc123/
    /patch-001.json  # { file: "src/App.tsx", diff: "..." }
    /patch-002.json
```

### Snapshot Creation

```javascript
const tar = require('tar');
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT, // For R2
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY
});

async function saveSnapshotToS3(projectId, podName) {
  const namespace = 'default';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tarFileName = `snapshot-${timestamp}.tar.gz`;
  const s3Key = `snapshots/${projectId}/${tarFileName}`;

  // 1. Create tar archive in pod
  await executeInPod(
    podName,
    `cd /app && tar -czf /tmp/${tarFileName} .`
  );

  // 2. Copy tar from pod to local
  const tarContent = await executeInPod(
    podName,
    `cat /tmp/${tarFileName}`,
    { binary: true }
  );

  // 3. Upload to S3
  await s3.putObject({
    Bucket: 'apna-loveable-projects',
    Key: s3Key,
    Body: tarContent,
    ContentType: 'application/gzip',
    Metadata: {
      'project-id': projectId,
      'created-at': new Date().toISOString()
    }
  }).promise();

  // 4. Update 'latest' reference
  await s3.putObject({
    Bucket: 'apna-loveable-projects',
    Key: `snapshots/${projectId}/latest.tar.gz`,
    Body: tarContent,
    ContentType: 'application/gzip'
  }).promise();

  // 5. Save to DB
  await db.snapshots.create({
    projectId: projectId,
    s3Key: s3Key,
    snapshotType: 'full',
    sizeBytes: tarContent.length
  });

  return s3Key;
}

async function restoreProjectFromS3(projectId) {
  const s3Key = `snapshots/${projectId}/latest.tar.gz`;

  // 1. Download from S3
  const s3Object = await s3.getObject({
    Bucket: 'apna-loveable-projects',
    Key: s3Key
  }).promise();

  const tarContent = s3Object.Body;

  // 2. Create new K8s resources
  const { podName } = await createK8sResources(projectId);

  // 3. Wait for pod ready
  await waitForPodReady(podName);

  // 4. Copy tar to pod
  // (This is complex with kubectl - easier to upload to temp storage and wget)
  // Alternative: mount S3 as volume, or use init container

  // Simplified approach: write tar content via kubectl cp
  const tempFile = `/tmp/${projectId}.tar.gz`;
  fs.writeFileSync(tempFile, tarContent);

  await execSync(`kubectl cp ${tempFile} ${podName}:/tmp/restore.tar.gz`);

  // 5. Extract in pod
  await executeInPod(
    podName,
    'cd /app && tar -xzf /tmp/restore.tar.gz && rm /tmp/restore.tar.gz'
  );

  // 6. Reinstall dependencies and start dev server
  await executeInPod(podName, 'cd /app && npm install');
  await executeInPod(podName, 'cd /app && npm run dev -- --host 0.0.0.0 --port 5173 &');

  return podName;
}
```

---

## Deployment Guide

### Prerequisites

1. **Kubernetes Cluster**
   - EKS (AWS), GKE (Google Cloud), AKS (Azure), or self-hosted
   - kubectl configured with cluster access
   - Storage class configured (for PVCs)

2. **Object Storage**
   - S3 (AWS) or R2 (Cloudflare)
   - Bucket created: `apna-loveable-projects`
   - Access keys configured

3. **PostgreSQL Database**
   - Version 14+
   - Connection URL

4. **Caddy Server**
   - Installed on edge/load balancer
   - DNS configured: `*.project.apnaloveable.com` → Caddy IP

5. **Anthropic API Key**
   - Sign up at https://console.anthropic.com
   - Create API key with access to Claude 3.5 Sonnet

### Step 1: Build Container Image

Create a Dockerfile for the Vite template image:

```dockerfile
# Dockerfile.vite-template
FROM ubuntu:22.04

# Install Node.js 22
RUN apt-get update && \
    apt-get install -y curl git && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs

# Create template directory
RUN mkdir -p /templates/vite-react

# Copy Vite template
WORKDIR /templates/vite-react
RUN npx create-vite@latest . --template react-ts && \
    npm install

# Create app directory
RUN mkdir -p /app

WORKDIR /app

CMD ["/bin/bash"]
```

Build and push:
```bash
docker build -t your-registry/vite-node22:latest -f Dockerfile.vite-template .
docker push your-registry/vite-node22:latest
```

### Step 2: Deploy API Server

```bash
# Clone repository
git clone https://github.com/your-org/apna-loveable.git
cd apna-loveable

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your values:
# - DATABASE_URL
# - ANTHROPIC_API_KEY
# - S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY
# - KUBE_CONFIG_PATH (if remote cluster)

# Run migrations
npm run db:migrate

# Start server
npm run dev  # development
npm run build && npm start  # production
```

### Step 3: Configure Kubernetes

```bash
# Create namespace
kubectl create namespace apna-loveable

# Set default namespace
kubectl config set-context --current --namespace=apna-loveable

# Create secret for image pull (if private registry)
kubectl create secret docker-registry regcred \
  --docker-server=your-registry \
  --docker-username=your-username \
  --docker-password=your-password
```

### Step 4: Deploy Caddy

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Copy Caddyfile
sudo cp Caddyfile /etc/caddy/Caddyfile

# Reload Caddy
sudo systemctl reload caddy
```

### Step 5: Set Up DNS

Point your domain to Caddy server:

```
A     api.apnaloveable.com        →  <caddy-server-ip>
A     *.project.apnaloveable.com  →  <caddy-server-ip>
```

### Step 6: Test the System

```bash
# Create a test project
curl -X POST https://api.apnaloveable.com/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a simple hello world app",
    "userId": "test-user-123"
  }'

# Response:
# {
#   "projectId": "proj-abc123",
#   "status": "ready",
#   "previewUrl": "https://proj-abc123.project.apnaloveable.com"
# }

# Visit preview URL in browser
```

### Step 7: Set Up Cleanup Cron Job

```javascript
// cleanup-cron.js
const cron = require('node-cron');

// Run every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  console.log('Running cleanup job...');

  const cutoffTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

  const inactiveProjects = await db.projects.findMany({
    where: {
      lastActivityAt: { lt: cutoffTime },
      status: { notIn: ['deleted', 'hibernated'] }
    }
  });

  for (const project of inactiveProjects) {
    try {
      const podName = `project-${project.id}`;
      const podExists = await checkPodExists(podName);

      if (podExists) {
        // Save snapshot
        await saveSnapshotToS3(project.id, podName);

        // Delete resources
        await deleteK8sResources(project.id);

        // Update status
        await db.projects.update({
          where: { id: project.id },
          data: { status: 'hibernated' }
        });

        console.log(`Cleaned up project: ${project.id}`);
      }
    } catch (error) {
      console.error(`Failed to cleanup project ${project.id}:`, error);
    }
  }
});
```

Run as service:
```bash
pm2 start cleanup-cron.js --name cleanup-job
pm2 save
```

---

## Environment Variables

```bash
# .env

# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/apna_loveable

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# S3/R2
S3_ENDPOINT=https://your-account.r2.cloudflarestorage.com
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_BUCKET=apna-loveable-projects

# Kubernetes
KUBE_CONFIG_PATH=/path/to/kubeconfig  # optional, uses default if not set
KUBE_NAMESPACE=apna-loveable

# Container Registry
CONTAINER_IMAGE=your-registry/vite-node22:latest

# Caddy
CADDY_DOMAIN=project.apnaloveable.com

# Cleanup
CLEANUP_INTERVAL_MINUTES=10
POD_TTL_HOURS=1
```

---

## Future Enhancements

### Phase 2
- [ ] User authentication (JWT)
- [ ] WebSocket streaming for real-time updates
- [ ] Support for multiple templates (Next.js, Vue, Svelte)
- [ ] Collaborative editing (multiple users per project)
- [ ] Git integration (push to GitHub)

### Phase 3
- [ ] Custom domain support for projects
- [ ] Production builds and deployments
- [ ] Usage analytics and billing
- [ ] Template marketplace
- [ ] IDE integration (VSCode extension)

---

## Troubleshooting

### Pod Won't Start

```bash
# Check pod status
kubectl get pod project-{id}

# Check pod logs
kubectl logs project-{id}

# Describe pod for events
kubectl describe pod project-{id}
```

### Vite Dev Server Not Accessible

```bash
# Check service
kubectl get svc project-{id}

# Port forward for testing
kubectl port-forward pod/project-{id} 5173:5173

# Visit http://localhost:5173
```

### Claude API Errors

```bash
# Check API key
echo $ANTHROPIC_API_KEY

# Test API directly
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

### S3 Connection Issues

```bash
# Test S3 credentials
aws s3 ls s3://apna-loveable-projects --endpoint-url $S3_ENDPOINT
```

---

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Support

For questions or issues:
- GitHub Issues: https://github.com/your-org/apna-loveable/issues
- Email: support@apnaloveable.com
