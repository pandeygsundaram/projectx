// Auth types
export interface User {
  id: string
  email: string
  name: string | null
  createdAt: string
}

export interface AuthResponse {
  user: User
  token: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface SignupData {
  email: string
  password: string
  name?: string
}

// Project types
export type ProjectStatus = 'initializing' | 'building' | 'ready' | 'error' | 'deleted' | 'hibernated'
export type PodStatus = 'ready' | 'pending' | 'failed' | null

export interface Project {
  id: string
  userId: string
  name: string | null
  status: ProjectStatus
  template: string
  podName: string | null
  serviceName: string | null
  pvcName: string | null
  createdAt: string
  lastActivityAt: string
  deletedAt: string | null
  podStatus?: PodStatus
  previewUrl?: string | null
}

export interface ProjectCreateData {
  name: string
  prompt?: string
}

export interface ProjectCreateResponse {
  project: {
    id: string
    name: string
    status: ProjectStatus
    previewUrl: string
  }
  message: string
}

// SSE types for project stream
export interface SSEStageEvent {
  stage: 'creating_project' | 'deploying' | 'starting' | 'cloning_repo' | 'installing_deps' | 'ready'
  message: string
  previewUrl?: string
  projectId?: string
}

export interface SSEErrorEvent {
  error: string
}

// Conversation types (for future implementation)
export interface Conversation {
  id: string
  projectId: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: any[]
  fileDiffs?: FileDiff[]
  createdAt: string
}

export interface FileDiff {
  path: string
  action: 'create' | 'update' | 'delete'
  content?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

// API Error types
export interface APIError {
  error: string
  activeProject?: {
    id: string
    name: string
    status: ProjectStatus
    previewUrl: string
  }
}
