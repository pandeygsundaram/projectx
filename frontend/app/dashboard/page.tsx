"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/stores/authStore"
import { useProjectStore } from "@/lib/stores/projectStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Plus, Folder, Clock, ExternalLink, Play, Square, Rocket, Zap, Box, Gamepad2 } from "lucide-react"
import { motion } from "framer-motion"
import type { Project } from "@/types"

// SpotlightCard component for premium hover effects
const SpotlightCard = ({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/30 cursor-pointer ${className}`}
    >
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition duration-300"
        style={{
          opacity,
          background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, rgba(139,92,246,0.1), transparent 40%)`,
        }}
      />
      <div className="relative h-full flex flex-col">{children}</div>
    </div>
  );
};

export default function DashboardPage() {
  const router = useRouter()
  const { token } = useAuthStore()
  const { projects, isLoading, fetchProjects, stopProject, openProject, deleteProject } = useProjectStore()
  const [newProjectName, setNewProjectName] = useState("")
  const [gameType, setGameType] = useState<'2d' | '3d'>('2d')
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    if (token) {
      fetchProjects(token)
    }
  }, [token, fetchProjects])

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      // Navigate to project creation screen with the name and game type
      router.push(`/dashboard/project/new?name=${encodeURIComponent(newProjectName.trim())}&gameType=${gameType}`)
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
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
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
            <SpotlightCard className="overflow-visible">
              <div className="p-8">
                {/* Header */}
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-medium text-primary mb-4 uppercase tracking-wider">
                    <Zap className="w-3 h-3" />
                    <span>New Project</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
                    Create Your Game
                  </h3>
                  <p className="text-muted-foreground">
                    Choose your game type and give it a name to get started
                  </p>
                </div>

                {/* Game Type Selection */}
                <div className="mb-6">
                  <label className="text-sm font-medium text-foreground mb-3 block">Select Game Type</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 2D Game Option - Active/Available */}
                    <button
                      type="button"
                      onClick={() => setGameType('2d')}
                      className="relative p-6 rounded-xl border border-primary bg-primary/10 shadow-[0_0_30px_rgba(139,92,246,0.2)] transition-all hover:shadow-[0_0_40px_rgba(139,92,246,0.3)]"
                    >
                      <div className="flex flex-col items-center text-center gap-3">
                        <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/20 text-primary">
                          <Gamepad2 className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="font-bold text-foreground mb-1">2D Game</h4>
                          <p className="text-xs text-muted-foreground">
                            HTML5 Canvas based 2D games
                          </p>
                        </div>
                      </div>
                      {/* Selected Badge */}
                      <div className="absolute top-3 right-3">
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>
                      {/* Available Badge */}
                      <div className="absolute top-3 left-3">
                        <div className="px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                          <span className="text-[10px] font-medium text-green-400 uppercase tracking-wider">
                            Available
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* 3D Game Option - Coming Soon */}
                    <div className="relative">
                      <button
                        type="button"
                        disabled
                        className="relative p-6 rounded-xl border border-border bg-muted/30 opacity-50 cursor-not-allowed w-full"
                      >
                        <div className="flex flex-col items-center text-center gap-3">
                          <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-muted text-muted-foreground">
                            <Box className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="font-bold text-foreground mb-1">3D Game</h4>
                            <p className="text-xs text-muted-foreground">
                              Three.js & React Three Fiber
                            </p>
                          </div>
                        </div>
                      </button>
                      {/* Coming Soon Badge */}
                      <div className="absolute top-3 right-3">
                        <div className="px-2 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                          <span className="text-[10px] font-medium text-yellow-400 uppercase tracking-wider">
                            Coming Soon
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Project Name Input */}
                <div className="mb-6">
                  <label className="text-sm font-medium text-foreground mb-2 block">Project Name</label>
                  <div className="relative">
                    <Input
                      placeholder="My Awesome Game"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleCreateProject()}
                      autoFocus
                      className="h-12 bg-background border-border text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-primary/20"
                    />
                  </div>
                </div>

                {/* Create Button */}
                <Button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim()}
                  className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:shadow-[0_0_50px_rgba(139,92,246,0.5)] transition-all duration-300 text-base font-semibold"
                >
                  <Rocket className="w-4 h-4 mr-2" />
                  Create Project
                </Button>
              </div>
            </SpotlightCard>
          </motion.div>
        )}

        {/* Projects Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 mx-auto rounded-xl border border-border bg-muted flex items-center justify-center">
                <Folder className="h-10 w-10 text-muted-foreground opacity-50" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">No projects yet</h3>
                <p className="text-muted-foreground mt-1">
                  Create your first project to get started
                </p>
              </div>
              <Button
                onClick={() => setShowCreateForm(true)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Project
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <SpotlightCard
                  className="group h-full"
                  onClick={() => handleOpenProject(project)}
                >
                  <div className="p-6 h-full flex flex-col">
                    {/* Project Icon/Visual */}
                    <div className="relative w-full h-32 mb-4 rounded-lg overflow-hidden bg-gradient-to-br from-primary/10 via-transparent to-transparent border border-border">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 rounded-lg border border-primary/40 bg-primary/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                          <Rocket className="w-8 h-8 text-primary" />
                        </div>
                      </div>
                      <div className="absolute top-2 right-2">
                        <div className={`text-[10px] font-medium px-2 py-1 rounded-full border ${
                          project.status === "ready"
                            ? "bg-green-500/10 border-green-500/20 text-green-400"
                            : project.status === "hibernated"
                            ? "bg-gray-500/10 border-gray-500/20 text-gray-400"
                            : project.status === "building" || project.status === "initializing"
                            ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
                            : "bg-red-500/10 border-red-500/20 text-red-400"
                        }`}>
                          {project.status}
                        </div>
                      </div>
                    </div>

                    {/* Project Info */}
                    <div className="flex-1 mb-4">
                      <h3 className="text-lg font-bold text-foreground mb-1 line-clamp-1 flex items-center gap-2">
                        {project.name || "Untitled Project"}
                      </h3>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                        <Clock className="h-3 w-3" />
                        {new Date(project.lastActivityAt).toLocaleDateString()}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {project.template}
                      </p>
                    </div>

                    {/* Preview Link */}
                    {project.previewUrl && (
                      <div className="mb-4 pb-4 border-b border-border">
                        <a
                          href={project.previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-2"
                        >
                          View Live Preview
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2">
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
                    </div>
                  </div>
                </SpotlightCard>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
