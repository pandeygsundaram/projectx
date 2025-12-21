import { create } from 'zustand'
import type { Project, ProjectCreateData, Message } from '@/types'
import { toast } from 'sonner'

interface ProjectState {
  projects: Project[]
  currentProject: Project | null
  messages: Message[]
  isLoading: boolean
  isCreating: boolean

  // Actions
  fetchProjects: (token: string) => Promise<void>
  fetchProject: (id: string, token: string) => Promise<void>
  setCurrentProject: (project: Project | null) => void
  addMessage: (message: Message) => void
  clearMessages: () => void
  setMessages: (messages: Message[]) => void
  deleteProject: (id: string, token: string) => Promise<void>
  stopProject: (id: string, token: string) => Promise<void>
  openProject: (id: string, token: string, onProgress?: (stage: string, message: string) => void) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  messages: [],
  isLoading: false,
  isCreating: false,

  fetchProjects: async (token: string) => {
    set({ isLoading: true })
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch projects')
      }

      const projects: Project[] = await response.json()
      set({ projects, isLoading: false })
    } catch (error) {
      set({ isLoading: false })
      toast.error('Failed to fetch projects')
      throw error
    }
  },

  fetchProject: async (id: string, token: string) => {
    console.log("🔍 [Store] fetchProject called for ID:", id)
    set({ isLoading: true })
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/projects/${id}`
      console.log("📡 [Store] Fetching from:", url)

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      console.log("📥 [Store] Response status:", response.status)

      if (!response.ok) {
        throw new Error('Project not found')
      }

      const project: Project = await response.json()
      console.log("✅ [Store] Project fetched successfully:", {
        id: project.id,
        name: project.name,
        status: project.status,
        hasPreviewUrl: !!project.previewUrl
      })

      set({ currentProject: project, isLoading: false })
    } catch (error) {
      console.error("❌ [Store] Failed to fetch project:", error)
      set({ isLoading: false })
      toast.error('Failed to fetch project')
      throw error
    }
  },

  setCurrentProject: (project: Project | null) => set({ currentProject: project }),

  addMessage: (message: Message) => {
    set((state) => ({ messages: [...state.messages, message] }))
  },

  clearMessages: () => set({ messages: [] }),

  setMessages: (messages: Message[]) => set({ messages }),

  deleteProject: async (id: string, token: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to delete project')
      }

      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
      }))
      toast.success('Project deleted successfully')
    } catch (error) {
      toast.error('Failed to delete project')
      throw error
    }
  },

  stopProject: async (id: string, token: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/${id}/stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to stop project')
      }

      toast.success('Project stopped successfully')

      // Refresh the project to get updated status
      await get().fetchProject(id, token)
    } catch (error) {
      toast.error('Failed to stop project')
      throw error
    }
  },

  openProject: async (id: string, token: string, onProgress?: (stage: string, message: string) => void) => {
    console.log("🔄 [Store] openProject called for ID:", id)

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/${id}/open/stream`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error('Failed to open project')
      }

      console.log("📡 [Store] SSE stream started for opening project")

      // Read the SSE stream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log("✅ [Store] SSE stream ended")
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonData = line.slice(6)
              const data: any = JSON.parse(jsonData)

              console.log("📥 [Store] SSE event:", data)

              if (data.stage === 'ready') {
                console.log("✅ [Store] Project is ready!")
                toast.success('Project is ready!')

                // Update store with ready project
                set({
                  currentProject: {
                    ...get().currentProject!,
                    status: 'ready',
                    previewUrl: data.previewUrl,
                  }
                })

                // Refresh the project to get full details
                await get().fetchProject(id, token)

                if (onProgress) {
                  onProgress(data.stage, data.message)
                }
                break
              } else if (data.error) {
                console.error("❌ [Store] SSE error:", data.error)
                toast.error(data.error)
                throw new Error(data.error)
              } else {
                // Progress update
                console.log(`⏳ [Store] Stage: ${data.stage} - ${data.message}`)
                if (onProgress) {
                  onProgress(data.stage, data.message)
                }
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError)
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ [Store] Failed to open project:", error)
      toast.error(error instanceof Error ? error.message : 'Failed to open project')
      throw error
    }
  },
}))
