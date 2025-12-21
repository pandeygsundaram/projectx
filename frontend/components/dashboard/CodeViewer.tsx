"use client"

import { useState, useEffect } from "react"
import { Loader2, FileCode } from "lucide-react"

interface CodeViewerProps {
  filePath: string | null
  content: string | null
  isLoading: boolean
}

export function CodeViewer({ filePath, content, isLoading }: CodeViewerProps) {
  if (!filePath && !content) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <FileCode className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
          <p className="text-muted-foreground">Select a file to view its content</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
          <p className="text-sm text-muted-foreground">Loading file...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* File path header */}
      <div className="px-4 py-2 border-b bg-muted/30">
        <p className="text-sm font-mono text-muted-foreground">{filePath}</p>
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto">
        <pre className="p-4 text-sm font-mono leading-relaxed">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  )
}
