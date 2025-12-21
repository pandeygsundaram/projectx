"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/stores/authStore"
import { useProjectStore } from "@/lib/stores/projectStore"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Plus, Folder, Clock, ExternalLink, Play, Square } from "lucide-react"
import { motion } from "framer-motion"
import type { Project } from "@/types"

export default function DashboardPage() {
  const router = useRouter()
  const { token } = useAuthStore()
  const { projects, isLoading, fetchProjects, stopProject, openProject, deleteProject } = useProjectStore()
  const [newProjectName, setNewProjectName] = useState("")
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    if (token) {
      fetchProjects(token)
    }
  }, [token, fetchProjects])

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      // Navigate to project creation screen with the name
      router.push(`/dashboard/project/new?name=${encodeURIComponent(newProjectName.trim())}`)
    }
  }

  const handleOpenProject = (project: Project) => {
    router.push(`/dashboard/project/${project.id}`)
  }

  const handleStopProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (token) {
      await stopProject(id, token)
      // Refresh projects to get updated status
      await fetchProjects(token)
    }
  }

  const handleResumeProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (token) {
      try {
        await openProject(id, token, (stage, message) => {
          console.log(`Resume progress: ${stage} - ${message}`)
        })
        // Refresh projects to get updated status
        await fetchProjects(token)
      } catch (error) {
        console.error('Failed to resume project:', error)
      }
    }
  }

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm("Are you sure you want to delete this project?")) {
      if (token) {
        await deleteProject(id, token)
      }
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready":
        return "text-green-600 dark:text-green-400"
      case "building":
      case "initializing":
        return "text-yellow-600 dark:text-yellow-400"
      case "error":
        return "text-red-600 dark:text-red-400"
      case "hibernated":
        return "text-gray-600 dark:text-gray-400"
      default:
        return "text-muted-foreground"
    }
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Your Projects</h1>
            <p className="text-muted-foreground mt-1">
              Create and manage your AI-powered applications
            </p>
          </div>
          <Button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-600 hover:bg-blue-700 gap-2"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>

        {/* Create Project Form */}
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Create New Project</CardTitle>
                <CardDescription>
                  Give your project a name and start building
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="My Awesome App"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleCreateProject()}
                    autoFocus
                  />
                  <Button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Create
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Projects Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : projects.length === 0 ? (
          <Card className="p-12">
            <div className="text-center space-y-4">
              <Folder className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
              <div>
                <h3 className="text-xl font-semibold">No projects yet</h3>
                <p className="text-muted-foreground mt-1">
                  Create your first project to get started
                </p>
              </div>
              <Button
                onClick={() => setShowCreateForm(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Project
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card
                  className="cursor-pointer hover:shadow-lg transition-shadow h-full flex flex-col"
                  onClick={() => handleOpenProject(project)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg line-clamp-1">
                          {project.name || "Untitled Project"}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          <Clock className="h-3 w-3" />
                          {new Date(project.lastActivityAt).toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <div className={`text-xs font-medium ${getStatusColor(project.status)}`}>
                        {project.status}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <p className="text-sm text-muted-foreground">
                      Template: {project.template}
                    </p>
                    {project.previewUrl && (
                      <a
                        href={project.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-2"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Preview
                      </a>
                    )}
                  </CardContent>
                  <CardFooter className="flex gap-2">
                    {project.status === "ready" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleStopProject(project.id, e)}
                        className="flex-1"
                      >
                        <Square className="h-3 w-3 mr-1" />
                        Stop
                      </Button>
                    ) : project.status === "hibernated" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleResumeProject(project.id, e)}
                        className="flex-1"
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Resume
                      </Button>
                    ) : null}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={(e) => handleDeleteProject(project.id, e)}
                    >
                      Delete
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
