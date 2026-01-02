"use client"

import { useEffect, useState, useRef } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/stores/authStore"
import { useProjectStore } from "@/lib/stores/projectStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Loader2, Send, Code, Monitor, X, RefreshCw, Rocket, ExternalLink, Wrench, Sparkles, Brain, Network, Save, Square } from "lucide-react"
import { motion } from "framer-motion"
import type { Message, SSEStageEvent } from "@/types"
import { FileTree, type FileNode } from "@/components/dashboard/FileTree"
import { CodeViewer } from "@/components/dashboard/CodeViewer"
import { ToastContainer, useToast } from "@/components/ui/toast"
import { LLMVisualizer, type LLMCall } from "@/components/dashboard/LLMVisualizer"
import axios from "axios"
import { sendChatMessage, fetchConversations, type Conversation } from "@/lib/api/chat"

export default function ProjectPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { token } = useAuthStore()
  const { currentProject, fetchProject, addMessage, messages, setMessages, setCurrentProject } = useProjectStore()

  const [isCreating, setIsCreating] = useState(false)
  const [isChatting, setIsChatting] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [currentToolCall, setCurrentToolCall] = useState<string | null>(null)
  const creationInitiated = useRef(false)
  const [iframeKey, setIframeKey] = useState(0)

  // File tree state
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isLoadingFileContent, setIsLoadingFileContent] = useState(false)
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false)
  const [currentStatus, setCurrentStatus] = useState<{stage: string; message: string} | null>(null)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null)
  const [deployStatus, setDeployStatus] = useState<{stage: string; message: string} | null>(null)
  const [isRestarting, setIsRestarting] = useState(false)
  const [restartStatus, setRestartStatus] = useState<{stage: string; message: string} | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [chatAbortController, setChatAbortController] = useState<AbortController | null>(null)
  const { toasts, removeToast, toast } = useToast()
  const [llmCalls, setLlmCalls] = useState<LLMCall[]>([])

  const projectId = params.id as string
  const isNewProject = projectId === "new"
  const projectName = searchParams.get("name")
  const gameType = (searchParams.get("gameType") as '2d' | '3d') || '3d'

  useEffect(() => {
    console.log("🔵 [Main Effect] Triggered", {
      isNewProject,
      projectName,
      projectId,
      hasToken: !!token,
      creationAlreadyInitiated: creationInitiated.current
    })

    if (isNewProject && projectName && !creationInitiated.current) {
      console.log("🟢 [Main Effect] Creating new project with name:", projectName)
      creationInitiated.current = true
      handleCreateProject(projectName)
    } else if (!isNewProject && token) {
      console.log("🟢 [Main Effect] Fetching existing project:", projectId)
      fetchProject(projectId, token)
    } else {
      console.log("🔴 [Main Effect] No action taken")
    }
  }, [projectId, token, isNewProject, projectName])

  // Auto-resume hibernated projects when user opens them
  useEffect(() => {
    if (currentProject?.status === 'hibernated' && token && !isNewProject) {
      console.log("🟡 [Auto-Resume] Project is hibernated, auto-resuming...")
      handleResumeProject()
    }
  }, [currentProject?.status, token, isNewProject])

  // Load conversation history when project is loaded
  useEffect(() => {
    if (currentProject?.id && token && !isNewProject) {
      console.log("📚 [Chat History] Loading conversation history for project:", currentProject.id)

      fetchConversations(token, currentProject.id)
        .then((conversations) => {
          console.log("✅ [Chat History] Loaded", conversations.length, "messages")

          // Convert conversations to Message format
          const loadedMessages: Message[] = conversations.map((conv) => ({
            id: conv.id,
            role: conv.role,
            content: conv.content,
            timestamp: conv.timestamp,
          }))

          // Replace all messages with the loaded conversation history
          setMessages(loadedMessages)
          console.log("✅ [Chat History] Messages loaded into store")
        })
        .catch((error) => {
          console.error("❌ [Chat History] Failed to load conversations:", error)
        })
    }
  }, [currentProject?.id, token, isNewProject])

  // Fetch file tree ONCE when project status is 'ready'
  useEffect(() => {
    const isReady = currentProject?.status === 'ready'
    const hasPreviewUrl = !!currentProject?.previewUrl

    console.log("🔵 [File Tree Effect] Triggered", {
      currentProjectStatus: currentProject?.status,
      currentProjectId: currentProject?.id,
      hasPreviewUrl,
      isReady,
      projectId,
      hasToken: !!token,
      isNewProject,
      hasAttemptedFetch,
      shouldFetch: isReady && hasPreviewUrl && token && projectId && !isNewProject && !hasAttemptedFetch
    })

    // Only fetch when status is 'ready' (backend updates this via SSE)
    const canFetchFiles = isReady && hasPreviewUrl && token && projectId && !isNewProject && !hasAttemptedFetch

    if (canFetchFiles && !isLoadingFiles) {
      console.log("🟢 [File Tree Effect] Status is ready - fetching files (ONCE):", currentProject.id)
      
      setHasAttemptedFetch(true)
      fetchFileTree()
      setIsLoadingFiles(false)
    } else {
      console.log("🔴 [File Tree Effect] Conditions not met", {
        canFetchFiles,
        isReady,
        hasPreviewUrl,
        hasAttemptedFetch,
        isLoading: isLoadingFiles
      })
    }
  }, [currentProject?.status, currentProject?.previewUrl, token, projectId, isNewProject, hasAttemptedFetch, isLoadingFiles])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  // Filter out unwanted files from the tree
  const filterFileTree = (nodes: FileNode[]): FileNode[] => {
    const shouldExclude = (name: string, path: string) => {
      // Skip README files
      if (name.toLowerCase() === 'readme.md' || name.toLowerCase() === 'readme') {
        return true
      }
      // Skip dot files at root (like .git, .env)
      if (name.startsWith('.') && !path.includes('/')) {
        return true
      }
      return false
    }

    return nodes
      .filter(node => !shouldExclude(node.name, node.path))
      .map(node => {
        if (node.type === 'directory' && node.children) {
          return {
            ...node,
            children: filterFileTree(node.children)
          }
        }
        return node
      })
  }

  const fetchFileTree = async (retryCount = 0) => {
    console.log("📂 [fetchFileTree] Called", {
      hasToken: !!token,
      projectId,
      isNewProject,
      retryCount
    })

    if (!token || !projectId || isNewProject) {
      console.log("❌ [fetchFileTree] Skipped - missing requirements")
      return
    }

    console.log("🔄 [fetchFileTree] Fetching files from API...")
    setIsLoadingFiles(true)
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/files`
      console.log("📡 [fetchFileTree] API URL:", url)

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      })

      console.log("✅ [fetchFileTree] Response received:", {
        status: response.status,
        dataType: typeof response.data,
        isArray: Array.isArray(response.data),
        dataLength: Array.isArray(response.data) ? response.data.length : 0,
        firstItem: Array.isArray(response.data) ? response.data[0] : null
      })

      // Handle both flat and nested responses
      if (Array.isArray(response.data)) {
        // Filter out README.md and other unwanted files
        const filteredTree = filterFileTree(response.data)
        console.log("✅ [fetchFileTree] Setting file tree with", filteredTree.length, "items (filtered from", response.data.length, ")")
        setFileTree(filteredTree)
      } else {
        console.error("❌ [fetchFileTree] Invalid file tree format:", response.data)
        setFileTree([])
      }
    } catch (error: any) {
      console.error("❌ [fetchFileTree] Error:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        retryCount
      })

      // Retry logic for pod not ready errors
      if (error.response?.status === 500 && retryCount < 3) {
        const retryDelay = (retryCount + 1) * 2000 // 2s, 4s, 6s
        console.log(`⏳ [fetchFileTree] Retrying in ${retryDelay}ms... (attempt ${retryCount + 1}/3)`)
        setTimeout(() => {
          fetchFileTree(retryCount + 1)
        }, retryDelay)
        return // Don't set loading to false yet
      }

      if (error.response?.status === 400) {
        console.log("⚠️ [fetchFileTree] Project not ready for file access yet")
      }
      setFileTree([])
      setIsLoadingFiles(false)
      console.log("🏁 [fetchFileTree] Finished with error")
    }
  }

  const fetchFileContent = async (filePath: string) => {
    if (!token || !projectId) return

    setIsLoadingFileContent(true)
    setSelectedFile(filePath)
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/file`,
        {
          params: { path: filePath },
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      setFileContent(response.data.content)
    } catch (error) {
      console.error("Failed to fetch file content:", error)
      setFileContent("Error loading file content")
    } finally {
      setIsLoadingFileContent(false)
    }
  }

  const handleCreateProject = async (prompt: string) => {
    if (!token) return
    setIsCreating(true)

    try {
      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: prompt,
        timestamp: new Date().toISOString(),
      }
      addMessage(userMessage)

      // Send the POST request to create the project with SSE
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ name: prompt, prompt, gameType }),
      })

      if (!response.ok) {
        throw new Error("Failed to create project")
      }

      // Read the SSE stream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error("No response body")
      }

      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          setIsCreating(false)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonData = line.slice(6) // Remove "data: " prefix
              const data: SSEStageEvent = JSON.parse(jsonData)

              // Update status bar with current stage
              setCurrentStatus({ stage: data.stage, message: data.message })

              // When ready, show the preview URL and fetch project
              if (data.stage === "ready" && data.projectId) {
                setIsCreating(false)
                setCurrentStatus(null) // Clear status when done

                // Add a message with the preview URL
                if (data.previewUrl) {
                  const urlMessage: Message = {
                    id: Date.now().toString() + Math.random(),
                    role: "assistant",
                    content: `🎉 Your project is live at: ${data.previewUrl}`,
                    timestamp: new Date().toISOString(),
                  }
                  addMessage(urlMessage)

                  // Immediately set the current project with preview URL
                  setCurrentProject({
                    id: data.projectId,
                    userId: "",
                    name: prompt,
                    status: "ready",
                    template: "vite-react",
                    podName: null,
                    serviceName: null,
                    pvcName: null,
                    createdAt: new Date().toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    deletedAt: null,
                    previewUrl: data.previewUrl,
                  })
                }

                // Fetch the full project details in background
                if (token) {
                  fetchProject(data.projectId, token)
                }

                // Navigate to the created project if it's a new project
                if (isNewProject && data.projectId) {
                  setTimeout(() => {
                    router.push(`/dashboard/project/${data.projectId}`)
                  }, 1000) // Small delay to show the success message
                }
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError)
            }
          }
        }
      }
    } catch (error) {
      console.error("Error creating project:", error)
      setIsCreating(false)

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: "Failed to create project. Please try again.",
        timestamp: new Date().toISOString(),
      }
      addMessage(errorMessage)
    }
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return

    if (isNewProject) {
      handleCreateProject(inputValue.trim())
    } else {
      // Send chat message to AI assistant
      await handleChatWithAI(inputValue.trim())
    }

    setInputValue("")
  }

  const handleChatWithAI = async (message: string) => {
    if (!token || !currentProject?.id) return

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💬 [UI] handleChatWithAI called');
    console.log('  Message:', message);
    console.log('  Project ID:', currentProject.id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    setIsChatting(true)
    setCurrentToolCall(null)

    // Create abort controller for this chat
    const abortController = new AbortController()
    setChatAbortController(abortController)

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    }
    console.log('💬 [UI] Adding user message:', userMessage);
    addMessage(userMessage)

    try {
      await sendChatMessage(
        token,
        {
          projectId: currentProject.id,
          message,
          provider: 'gemini',
          multiAgent: true, // Gemini always uses multi-agent
        },
        {
          onStatus: (statusMessage) => {
            console.log("📊 [UI Handler] Status:", statusMessage)
          },
          onMessage: (text) => {
            console.log("💬 [UI Handler] Message received:", text.substring(0, 100))

            // Create a new message for each text chunk from the assistant
            const assistantMessage: Message = {
              id: Date.now().toString() + Math.random(), // Unique ID for each message
              role: "assistant",
              content: text,
              timestamp: new Date().toISOString(),
            }
            addMessage(assistantMessage)
          },
          onTool: (toolCall) => {
            const toolInfo = `${toolCall.name}: ${toolCall.input.path || toolCall.input.command || ''}`
            console.log("🔧 [UI Handler] Tool call:", toolInfo)
            console.log("🔧 [UI Handler] Full tool data:", toolCall)
            setCurrentToolCall(toolInfo)
          },
          onTurn: (count) => {
            console.log("🔄 [UI Handler] Turn:", count)
          },
          onLlmRequest: (data) => {
            console.log("📤 [UI Handler] LLM Request:", data)
            const llmCall: LLMCall = {
              id: Date.now().toString() + Math.random(),
              timestamp: data.timestamp,
              type: 'request',
              model: data.model,
              request: data.request,
            }
            setLlmCalls((prev) => [...prev, llmCall])
          },
          onLlmResponse: (data) => {
            console.log("📥 [UI Handler] LLM Response:", data)
            const llmCall: LLMCall = {
              id: Date.now().toString() + Math.random(),
              timestamp: data.timestamp,
              type: 'response',
              response: data.response,
              duration: data.duration,
            }
            setLlmCalls((prev) => [...prev, llmCall])
          },
          onComplete: (result) => {
            console.log("✅ [UI Handler] Complete:", result)
            console.log("✅ [UI Handler] Setting chatting to false")
            setCurrentToolCall(null)
            setIsChatting(false)
            setChatAbortController(null)

            // Refresh file tree if files were modified
            if (result.result.includes('write_file') || result.result.includes('Successfully wrote')) {
              console.log("📂 [UI Handler] Files modified, refreshing file tree...")
              setTimeout(() => {
                handleRefreshFiles()
              }, 1000)
            }

            // Refresh iframe preview
            console.log("🔄 [UI Handler] Refreshing preview...")
            handleRefresh()
          },
          onError: (error) => {
            console.error("❌ [UI Handler] Chat error:", error)
            const errorMessage: Message = {
              id: Date.now().toString(),
              role: "system",
              content: `Error: ${error.message || error.subtype || 'Unknown error'}`,
              timestamp: new Date().toISOString(),
            }
            addMessage(errorMessage)
            setIsChatting(false)
            setCurrentToolCall(null)
            setChatAbortController(null)
          },
        },
        abortController.signal
      )
    } catch (error: any) {
      console.error("Failed to send chat message:", error)

      // Don't show error if it was aborted by user
      if (error.name !== 'AbortError') {
        const errorMessage: Message = {
          id: Date.now().toString(),
          role: "system",
          content: `Failed to send message: ${error.message}`,
          timestamp: new Date().toISOString(),
        }
        addMessage(errorMessage)
      } else {
        const abortMessage: Message = {
          id: Date.now().toString(),
          role: "system",
          content: "⏹️ Conversation stopped by user",
          timestamp: new Date().toISOString(),
        }
        addMessage(abortMessage)
      }

      setIsChatting(false)
      setCurrentToolCall(null)
      setChatAbortController(null)
    }
  }

  const handleStopChat = () => {
    if (chatAbortController) {
      console.log("⏹️ [UI] Stopping chat...")
      chatAbortController.abort()
      setChatAbortController(null)
      setIsChatting(false)
      setCurrentToolCall(null)
    }
  }

  const handleRefresh = () => {
    setIframeKey((prev) => prev + 1)
  }

  const handleRefreshFiles = async () => {
    console.log("🔄 [Manual Refresh] User requested file tree refresh")

    if (!token || !projectId || isNewProject) {
      toast.error("Cannot refresh files: Invalid project")
      return
    }

    setIsLoadingFiles(true)

    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/files`
      console.log("📡 [Manual Refresh] API URL:", url)

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      })

      console.log("✅ [Manual Refresh] Response received:", response.status)

      if (Array.isArray(response.data)) {
        const filteredTree = filterFileTree(response.data)
        setFileTree(filteredTree)
        toast.success(`Files refreshed: ${filteredTree.length} items`)
      } else {
        toast.error("Invalid file tree format")
        setFileTree([])
      }
    } catch (error: any) {
      console.error("❌ [Manual Refresh] Error:", error)

      if (error.response?.status === 400) {
        toast.error("Pod not ready yet")
      } else if (error.response?.status === 404) {
        toast.error("Project not found")
      } else if (error.response?.status === 500) {
        toast.error("Pod not ready, please wait...")
      } else {
        toast.error("Failed to refresh files")
      }

      setFileTree([])
    } finally {
      setIsLoadingFiles(false)
    }
  }

  const handleResumeProject = async () => {
    if (!token || !projectId) return

    console.log("🔄 [Resume] Starting project resume via SSE...")
    setIsCreating(true)

    try {
      const { openProject: openProjectFn } = useProjectStore.getState()

      await openProjectFn(projectId, token, (stage, message) => {
        console.log(`📡 [Resume] Stage: ${stage} - ${message}`)

        // Update status bar with current stage
        setCurrentStatus({ stage, message })
      })

      setIsCreating(false)
      setCurrentStatus(null) // Clear status when done
      console.log("✅ [Resume] Project resumed successfully")
    } catch (error) {
      console.error("❌ [Resume] Failed to resume project:", error)
      setIsCreating(false)
      setCurrentStatus(null)

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: "Failed to resume project. Please try again.",
        timestamp: new Date().toISOString(),
      }
      addMessage(errorMessage)
    }
  }

  const handleRestart = async () => {
    if (!token || !projectId) return

    console.log("🔄 [Restart] Starting project restart via SSE...")
    setIsRestarting(true)
    setRestartStatus(null)
    setHasAttemptedFetch(false)

    try {
      // Add a message to the conversation
      const restartMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: "🔄 Restarting project pod...",
        timestamp: new Date().toISOString(),
      }
      addMessage(restartMessage)

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/restart/stream`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("❌ [Restart] Response not OK:", response.status, response.statusText, errorText)
        throw new Error(`Failed to start restart: ${response.status} ${response.statusText}`)
      }

      console.log("✅ [Restart] SSE connection established")

      // Read the SSE stream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error("No response body")
      }

      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          setIsRestarting(false)
          setRestartStatus(null)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7).trim()
            console.log("📡 [Restart] Event type:", eventType)
            continue
          }

          if (line.startsWith("data: ")) {
            try {
              const jsonData = line.slice(6)
              console.log("📡 [Restart] Raw data:", jsonData)
              const data = JSON.parse(jsonData)

              console.log("📡 [Restart] Parsed event:", data)

              // Update restart status
              if (data.stage) {
                setRestartStatus({ stage: data.stage, message: data.message })
              }

              // Handle completion
              if (data.stage === 'ready' && data.previewUrl) {
                setIsRestarting(false)
                setRestartStatus(null)

                const successMessage: Message = {
                  id: Date.now().toString() + Math.random(),
                  role: "assistant",
                  content: `✅ Project restarted successfully! Preview: ${data.previewUrl}`,
                  timestamp: new Date().toISOString(),
                }
                addMessage(successMessage)

                // Refresh the project status
                if (token) {
                  fetchProject(projectId, token)
                }

                // Refresh preview
                handleRefresh()
              }

              // Handle error
              if (data.error) {
                throw new Error(data.error)
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError)
            }
          }
        }
      }
    } catch (error: any) {
      console.error("❌ [Restart] Failed to restart project:", error)
      setIsRestarting(false)
      setRestartStatus(null)

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: `❌ Restart failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      }
      addMessage(errorMessage)
    }
  }

  const handleSaveProgress = async () => {
    if (!token || !projectId) return

    console.log("💾 [Save Progress] Saving project to R2...")
    setIsSaving(true)

    try {
      const saveMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: "💾 Saving progress to R2...",
        timestamp: new Date().toISOString(),
      }
      addMessage(saveMessage)

      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/snapshot`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      console.log("✅ [Save Progress] Snapshot saved:", response.data)

      const successMessage: Message = {
        id: Date.now().toString() + Math.random(),
        role: "assistant",
        content: `✅ Progress saved successfully to R2!`,
        timestamp: new Date().toISOString(),
      }
      addMessage(successMessage)

      setIsSaving(false)
    } catch (error: any) {
      console.error("❌ [Save Progress] Failed to save snapshot:", error)

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: `❌ Failed to save progress: ${error.response?.data?.error || error.message}`,
        timestamp: new Date().toISOString(),
      }
      addMessage(errorMessage)

      setIsSaving(false)
    }
  }

  const handleDeploy = async () => {
    if (!token || !projectId) return

    console.log("🚀 [Deploy] Starting project deployment via SSE...")
    setIsDeploying(true)
    setDeploymentUrl(null)

    try {
      // Add a message to the conversation
      const deployMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: "🚀 Starting deployment...",
        timestamp: new Date().toISOString(),
      }
      addMessage(deployMessage)

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/${projectId}/deploy/stream`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error("Failed to start deployment")
      }

      // Read the SSE stream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error("No response body")
      }

      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          setIsDeploying(false)
          setDeployStatus(null)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7).trim()
            continue
          }

          if (line.startsWith("data: ")) {
            try {
              const jsonData = line.slice(6)
              const data = JSON.parse(jsonData)

              console.log("📡 [Deploy] Event:", data)

              // Update deployment status
              if (data.stage) {
                setDeployStatus({ stage: data.stage, message: data.message })
              }

              // Handle completion
              if (data.deploymentUrl) {
                setDeploymentUrl(data.deploymentUrl)
                setIsDeploying(false)
                setDeployStatus(null)

                const successMessage: Message = {
                  id: Date.now().toString() + Math.random(),
                  role: "assistant",
                  content: `✅ Deployment successful! Your app is live at: ${data.deploymentUrl}`,
                  timestamp: new Date().toISOString(),
                }
                addMessage(successMessage)
              }

              // Handle error
              if (data.error) {
                throw new Error(data.error)
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError)
            }
          }
        }
      }
    } catch (error: any) {
      console.error("❌ [Deploy] Failed to deploy project:", error)
      setIsDeploying(false)
      setDeployStatus(null)

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        content: `❌ Deployment failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      }
      addMessage(errorMessage)
    }
  }

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="h-screen overflow-y-auto">
        {/* Main Chat/Preview Section */}
        <div className="h-screen flex">
      {/* Left Panel - Conversation */}
      <div className="w-full md:w-2/5 border-r flex flex-col bg-background">
        <div className="p-4 border-b">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="font-semibold">
                {currentProject?.name || projectName || "New Project"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Status: {currentProject?.status || "Creating..."}
              </p>
            </div>

            {/* Action Buttons */}
            {currentProject && !isNewProject && (
              <div className="flex gap-2">
                {/* Save Progress button - only show when ready */}
                {currentProject.status === 'ready' && (
                  <Button
                    onClick={handleSaveProgress}
                    disabled={isSaving || isCreating}
                    size="sm"
                    variant="outline"
                    className="border-purple-600 text-purple-600 hover:bg-purple-600 hover:text-white"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                )}

                {/* Restart button - always visible */}
                <Button
                  onClick={handleRestart}
                  disabled={isRestarting || isCreating}
                  size="sm"
                  variant="outline"
                  className="border-orange-600 text-orange-600 hover:bg-orange-600 hover:text-white"
                >
                  {isRestarting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Restarting...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Restart
                    </>
                  )}
                </Button>

                {/* Deploy button - only show when ready */}
                {currentProject.status === 'ready' && (
                  <Button
                    onClick={handleDeploy}
                    disabled={isDeploying || isCreating}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isDeploying ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deploying...
                      </>
                    ) : (
                      <>
                        <Rocket className="h-4 w-4 mr-2" />
                        Deploy
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Live Status Bar */}
          {currentStatus && (
            <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {currentStatus.message}
                </span>
              </div>
            </div>
          )}

          {/* Restart Status Bar */}
          {restartStatus && (
            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
                <span className="text-sm font-medium text-orange-900 dark:text-orange-100">
                  {restartStatus.message}
                </span>
              </div>
            </div>
          )}

          {/* Deployment Status Bar */}
          {deployStatus && (
            <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                <span className="text-sm font-medium text-green-900 dark:text-green-100">
                  {deployStatus.message}
                </span>
              </div>
            </div>
          )}

          {/* Deployment URL */}
          {deploymentUrl && (
            <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-green-900 dark:text-green-100">
                  🎉 Deployed!
                </span>
                <a
                  href={deploymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-green-700 dark:text-green-300 hover:underline flex items-center gap-1"
                >
                  View Live
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : message.role === "system"
                    ? "bg-yellow-100 dark:bg-yellow-900/20 text-foreground border"
                    : "bg-muted text-foreground"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <p className="text-xs opacity-70 mt-1">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </motion.div>
          ))}

          {(isCreating || isChatting) && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">
                  {isCreating ? "Creating project..." : "Thinking..."}
                </span>
              </div>
            </div>
          )}

          {currentToolCall && (
            <div className="flex justify-start">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2 flex items-center gap-2">
                <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm text-blue-900 dark:text-blue-100">
                  {currentToolCall}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t">

          <div className="flex gap-2">
            <Input
              placeholder={
                isNewProject
                  ? "Describe what you want to build..."
                  : "Ask to modify your project..."
              }
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && !isChatting && handleSendMessage()}
              disabled={isCreating || isChatting}
            />
            {isChatting ? (
              <Button
                onClick={handleStopChat}
                className="bg-red-600 hover:bg-red-700"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isCreating}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Preview / Code */}
      <div className="hidden md:flex md:w-3/5 flex-col">
        {/* Tabs */}
        <div className="flex items-center justify-between p-2 border-b bg-card">
          <div className="flex gap-1">
            <Button
              variant={activeTab === "preview" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("preview")}
            >
              <Monitor className="h-4 w-4 mr-2" />
              Preview
            </Button>
            <Button
              variant={activeTab === "code" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("code")}
            >
              <Code className="h-4 w-4 mr-2" />
              Code
            </Button>
          </div>

          {activeTab === "preview" && currentProject?.previewUrl && (
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          {activeTab === "code" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshFiles}
              disabled={isLoadingFiles}
              title="Refresh files"
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 bg-muted/30">
          {activeTab === "preview" ? (
            currentProject?.previewUrl ? (
              <iframe
                key={iframeKey}
                src={currentProject.previewUrl}
                className="w-full h-full border-0"
                title="Preview"
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center space-y-2">
                  {isCreating ? (
                    <>
                      <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
                      <p className="text-muted-foreground">Building your project...</p>
                    </>
                  ) : (
                    <>
                      <Monitor className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
                      <p className="text-muted-foreground">
                        No preview available yet
                      </p>
                    </>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="h-full flex">
              {/* File Tree Sidebar */}
              <div className="w-1/3 border-r overflow-y-auto bg-card">
                {isLoadingFiles ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  </div>
                ) : fileTree.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    No files available
                  </div>
                ) : (
                  <FileTree
                    files={fileTree}
                    onFileClick={fetchFileContent}
                    selectedFile={selectedFile}
                  />
                )}
              </div>

              {/* Code Viewer */}
              <div className="flex-1">
                <CodeViewer
                  filePath={selectedFile}
                  content={fileContent}
                  isLoading={isLoadingFileContent}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* LLM Visualizer Section - Below chat */}
    <div className="h-screen border-t">
      <LLMVisualizer calls={llmCalls} />
    </div>
  </div>
    </>
  )
}
