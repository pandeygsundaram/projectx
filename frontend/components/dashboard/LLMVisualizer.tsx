"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Activity, Clock, Zap } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

export interface LLMCall {
  id: string
  timestamp: string
  type: 'request' | 'response'
  model?: string
  request?: any
  response?: any
  duration?: number
  tokenUsage?: {
    input?: number
    output?: number
  }
}

interface LLMVisualizerProps {
  calls: LLMCall[]
}

export function LLMVisualizer({ calls }: LLMVisualizerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  if (calls.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-2">
          <Activity className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
          <p className="text-muted-foreground">No LLM calls yet</p>
          <p className="text-sm text-muted-foreground">Start chatting to see LLM execution details</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="p-4 border-b bg-muted/30 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">LLM Execution Monitor</h3>
            <p className="text-sm text-muted-foreground">{calls.length} calls total</p>
          </div>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-1">
              <Zap className="h-4 w-4 text-yellow-600" />
              <span className="text-muted-foreground">
                {calls.reduce((sum, call) => sum + (call.tokenUsage?.input || 0) + (call.tokenUsage?.output || 0), 0)} tokens
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y">
        {calls.map((call) => (
          <div key={call.id} className="hover:bg-muted/50 transition-colors">
            <div
              className="p-4 cursor-pointer flex items-center gap-3"
              onClick={() => toggleExpand(call.id)}
            >
              {expandedId === call.id ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-mono text-muted-foreground">
                    {new Date(call.timestamp).toLocaleTimeString()}
                  </span>
                  {call.model && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                      {call.model}
                    </span>
                  )}
                  {call.type === 'request' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                      REQUEST
                    </span>
                  )}
                  {call.type === 'response' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                      RESPONSE
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {call.duration && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>{call.duration.toFixed(2)}s</span>
                    </div>
                  )}
                  {call.tokenUsage && (
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      <span>
                        {call.tokenUsage.input || 0} in / {call.tokenUsage.output || 0} out
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <AnimatePresence>
              {expandedId === call.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pl-11 space-y-4">
                    {call.request && (
                      <div>
                        <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase">Request</h4>
                        <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                          <code>{JSON.stringify(call.request, null, 2)}</code>
                        </pre>
                      </div>
                    )}

                    {call.response && (
                      <div>
                        <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase">Response</h4>
                        <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                          <code>{JSON.stringify(call.response, null, 2)}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  )
}
