"use client"

import { useState } from "react"
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

export interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: FileNode[]
}

interface FileTreeProps {
  files: FileNode[]
  onFileClick: (path: string) => void
  selectedFile: string | null
}

interface FileTreeNodeProps {
  node: FileNode
  onFileClick: (path: string) => void
  selectedFile: string | null
  level: number
}

function FileTreeNode({ node, onFileClick, selectedFile, level }: FileTreeNodeProps) {
  const [isOpen, setIsOpen] = useState(level === 0) // Auto-expand root level

  const isDirectory = node.type === "directory"
  const isSelected = selectedFile === node.path
  const hasChildren = node.children && node.children.length > 0

  const handleClick = () => {
    if (isDirectory) {
      setIsOpen(!isOpen)
    } else {
      onFileClick(node.path)
    }
  }

  return (
    <div>
      <div
        onClick={handleClick}
        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent rounded-md transition-colors ${
          isSelected ? "bg-blue-600/20 text-blue-600 dark:text-blue-400" : ""
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {isDirectory ? (
          <>
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            {isOpen ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-blue-500" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-blue-500" />
            )}
          </>
        ) : (
          <>
            <span className="h-4 w-4 shrink-0" /> {/* Spacer for alignment */}
            <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="text-sm truncate">{node.name}</span>
      </div>

      {/* Children */}
      <AnimatePresence>
        {isDirectory && isOpen && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {node.children?.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                onFileClick={onFileClick}
                selectedFile={selectedFile}
                level={level + 1}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function FileTree({ files, onFileClick, selectedFile }: FileTreeProps) {
  if (files.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        No files found
      </div>
    )
  }

  return (
    <div className="py-2">
      {files.map((file) => (
        <FileTreeNode
          key={file.path}
          node={file}
          onFileClick={onFileClick}
          selectedFile={selectedFile}
          level={0}
        />
      ))}
    </div>
  )
}
