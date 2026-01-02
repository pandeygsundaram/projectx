import { Request, Response } from 'express';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createProjectTools } from '../utils/agentTools';
import { getPodLogs } from '../services/kubernetes';
import prisma from '../config/database';
import { chatWithGemini } from '../services/gemini-chat';
import { ClaudeMultiAgentOrchestrator } from '../services/claude/multi-agent-orchestrator';

interface ChatRequest {
  projectId: string;
  message: string;
  gameType?: '2d' | '3d'; // Optional game type hint
  provider?: 'claude' | 'gemini'; // AI provider selection
  multiAgent?: boolean; // Enable multi-agent mode for Claude
}

// Store session IDs for conversation continuity
const sessionStore = new Map<string, string>();

export async function getProjectConversations(req: Request, res: Response) {
  try {
    const { projectId } = req.params;
    const userId = (req as any).userId;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📚 [CONVERSATIONS] Fetching conversations for project:', projectId);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Verify project exists and belongs to user
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      console.log('❌ [CONVERSATIONS] Project not found');
      return res.status(404).json({ error: 'Project not found' });
    }

    // Fetch conversations ordered by creation time
    const conversations = await prisma.conversation.findMany({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        role: true,
        content: true,
        toolCalls: true,
        fileDiffs: true,
        createdAt: true,
      },
    });

    console.log(`✅ [CONVERSATIONS] Found ${conversations.length} messages`);

    res.json({
      conversations: conversations.map(conv => ({
        id: conv.id,
        role: conv.role,
        content: conv.content,
        timestamp: conv.createdAt.toISOString(),
        toolCalls: conv.toolCalls,
        fileDiffs: conv.fileDiffs,
      })),
    });
  } catch (error: any) {
    console.error('❌ [CONVERSATIONS] Error fetching conversations:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function chatWithProject(req: Request, res: Response) {
  try {
    const { projectId, message, provider = 'claude', multiAgent = false } = req.body as ChatRequest;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📨 [CHAT] New chat request received');
    console.log('  Project ID:', projectId);
    console.log('  Message:', message);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!projectId || !message) {
      console.log('❌ [CHAT] Missing required fields');
      return res.status(400).json({ error: 'Project ID and message are required' });
    }

    // Verify project exists and belongs to user
    const userId = (req as any).userId;
    console.log('🔍 [CHAT] Verifying project for user:', userId);

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      console.log('❌ [CHAT] Project not found');
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log('✅ [CHAT] Project found:', project.name);

    // Get game type from project
    const gameType = (project.gameType as '2d' | '3d') || '3d';
    console.log('🎮 [CHAT] Game Type:', gameType);

    // Save user message to database
    console.log('💾 [CHAT] Saving user message to database...');
    await prisma.conversation.create({
      data: {
        projectId,
        role: 'user',
        content: message,
      },
    });
    console.log('✅ [CHAT] User message saved');

    console.log('🤖 [CHAT] Using provider:', provider);
    console.log('🤖 [CHAT] Multi-agent mode:', multiAgent);

    // Fetch previous conversations for context (last 10 messages)
    console.log('📚 [CHAT] Fetching previous conversations for context...');
    const previousConversations = await prisma.conversation.findMany({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 20, // Get last 20 messages (10 pairs of user+assistant)
      select: {
        role: true,
        content: true,
        createdAt: true,
        taskGraph: true,
        toolCalls: true,
      },
    });
    console.log(`✅ [CHAT] Found ${previousConversations.length} previous messages`);

    // Build task history from previous conversations
    console.log('📋 [CHAT] Building task history from previous conversations...');
    const taskHistory = buildTaskHistory(previousConversations);
    console.log(`✅ [CHAT] Task history built: ${taskHistory.completedCount} completed, ${taskHistory.failedCount} failed`);

    // Set up SSE
    console.log('📡 [CHAT] Setting up SSE stream...');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Helper to send SSE messages
    const sendEvent = (event: string, data: any) => {
      console.log(`📤 [SSE] Sending event: ${event}`, JSON.stringify(data).substring(0, 100));
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // Route to Claude Multi-Agent if enabled
      if (provider === 'claude' && multiAgent) {
        console.log('🟦 [CHAT] Using Claude Multi-Agent system');

        const claudeApiKey = process.env.ANTHROPIC_API_KEY;
        if (!claudeApiKey) {
          sendEvent('error', { message: 'ANTHROPIC_API_KEY not configured' });
          res.end();
          return;
        }

        sendEvent('status', { message: 'Starting Claude multi-agent system...' });

        const orchestrator = new ClaudeMultiAgentOrchestrator({
          apiKey: claudeApiKey,
          projectId,
          userMessage: message,
          conversationHistory: previousConversations.map(c => ({
            role: c.role,
            content: c.content,
          })),
          taskHistory: taskHistory.summary,
          gameType,
          onEvent: (event: string, data: any) => {
            sendEvent(event, data);
          },
        });

        await orchestrator.execute(message);

        const taskGraph = orchestrator.getTaskGraph();

        // Save assistant response with task graph
        const completedTasks = taskGraph.tasks.filter(t => t.status === 'completed');
        const assistantResponse = completedTasks
          .map(t => `✅ ${t.description}\n${t.result}`)
          .join('\n\n');

        await prisma.conversation.create({
          data: {
            projectId,
            role: 'assistant',
            content: assistantResponse || 'Tasks completed',
            provider: 'claude',
            taskGraph: taskGraph as any,
          },
        });

        console.log('✅ [CLAUDE MA] Response saved to database');

        res.end();
        console.log('🏁 [CHAT] Claude multi-agent response stream ended');
        return;
      }

      // Route to Gemini if selected
      if (provider === 'gemini') {
        console.log('🟣 [CHAT] Using Gemini provider');

        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) {
          sendEvent('error', { message: 'GEMINI_API_KEY not configured' });
          res.end();
          return;
        }

        sendEvent('status', { message: 'Starting Gemini AI multi-agent system...' });

        // Track if client disconnected
        let clientDisconnected = false;
        req.on('close', () => {
          console.log('⏹️ [GEMINI] Client disconnected from SSE stream');
          clientDisconnected = true;
        });

        const result = await chatWithGemini({
          apiKey: geminiApiKey,
          projectId,
          projectPath: `/var/lib/rancher/k3s/storage/${projectId}/app`,
          gameType,
          userMessage: message,
          conversationHistory: previousConversations.map(c => {
            const msg: any = {
              role: c.role,
              content: c.content,
            };

            // Include tool calls if present
            if (c.toolCalls && Array.isArray(c.toolCalls)) {
              msg.toolCalls = c.toolCalls;
            }

            return msg;
          }),
          taskHistory: taskHistory.summary,
          onEvent: (event: string, data: any) => {
            sendEvent(event, data);
          },
          abortSignal: () => clientDisconnected, // Check if client disconnected
        });

        // Extract tool calls from the final conversation history
        const lastMessages = result.conversationHistory.slice(-10); // Get last few messages
        const toolCallsFromHistory = lastMessages
          .filter(m => m.toolCalls && m.toolCalls.length > 0)
          .flatMap(m => m.toolCalls || []);

        // Save assistant response with full conversation history
        await prisma.conversation.create({
          data: {
            projectId,
            role: 'assistant',
            content: result.response || 'Task completed',
            provider: 'gemini',
            ...(toolCallsFromHistory.length > 0 && { toolCalls: toolCallsFromHistory as any }),
          },
        });
        console.log('✅ [GEMINI] Response saved to database');

        res.end();
        console.log('🏁 [CHAT] Gemini response stream ended');
        return;
      }
      // Get recent pod logs for context
      console.log('📋 [CHAT] Fetching pod logs for context...');
      const recentLogs = await getPodLogs(projectId, 60).catch(() => '');
      const errors = recentLogs.split('\n').filter(line =>
        line.toLowerCase().includes('error') ||
        line.toLowerCase().includes('failed') ||
        line.toLowerCase().includes('warn')
      ).slice(-5).join('\n');
      console.log('📋 [CHAT] Found errors:', errors ? errors.substring(0, 200) : 'none');

      // Build conversation history context
      let conversationContext = '';
      if (previousConversations.length > 0) {
        console.log('📝 [CHAT] Building conversation context from previous messages...');
        conversationContext = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        conversationContext += '📜 PREVIOUS CONVERSATION HISTORY:\n';
        conversationContext += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        conversationContext += 'Here is the conversation history for this project. Use this to understand\n';
        conversationContext += 'the context and continue the conversation naturally:\n\n';

        previousConversations.forEach((conv, index) => {
          const role = conv.role === 'user' ? 'User' : (conv.role === 'assistant' ? 'You (Assistant)' : 'System');
          conversationContext += `${role}: ${conv.content}\n\n`;
        });

        conversationContext += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      }

      // Create enhanced prompt for game building
      console.log('✍️  [CHAT] Creating enhanced prompt...');
      const enhancedPrompt = createGamePrompt(message, gameType, errors, conversationContext, taskHistory.summary);
      console.log('✍️  [CHAT] Prompt length:', enhancedPrompt.length, 'chars');

      // Create tools bound to this project
      console.log('🔧 [CHAT] Creating project tools...');
      const projectTools = createProjectTools(projectId);
      console.log('🔧 [CHAT] Tools created:', Object.keys(projectTools).length, 'tools');

      // Create MCP server with tools
      console.log('🔧 [CHAT] Creating MCP server...');
      const mcpServer = createSdkMcpServer({
        name: 'game-builder-tools',
        version: '1.0.0',
        tools: projectTools,
      });
      console.log('✅ [CHAT] MCP server created');

      // Get or create session ID
      const sessionKey = `${userId}-${projectId}`;
      const sessionId = sessionStore.get(sessionKey);
      console.log('🔑 [CHAT] Session:', sessionId ? `Resuming ${sessionId.substring(0, 8)}...` : 'New session');

      sendEvent('status', { message: 'Starting AI assistant...' });

      // Query Claude Agent SDK
      console.log('🤖 [CHAT] Starting Claude Agent SDK query...');
      console.log('🤖 [CHAT] Model: claude-sonnet-4-5-20250929');
      console.log('🤖 [CHAT] Max turns: 30');

      const result = query({
        prompt: enhancedPrompt,
        options: {
          model: 'claude-sonnet-4-5-20250929',
          maxTurns: 30,
          maxBudgetUsd: 0.5,
          permissionMode: 'bypassPermissions', // Auto-approve all tool calls without prompts
          mcpServers: {
            'game-builder-tools': mcpServer,
          },
          resume: sessionId,
        },
      });

      let turnCount = 0;
      let assistantResponse = '';
      let toolCallsLog: any[] = [];
      let fileChanges: any[] = [];

      console.log('🔄 [CHAT] Starting to process Claude Agent SDK responses...');

      for await (const msg of result) {
        console.log('📨 [SDK] Received message:', msg.type, (msg as any).subtype || '');

        // Capture session ID for conversation continuity
        if (msg.type === 'system' && msg.subtype === 'init') {
          console.log('🔑 [SDK] Session initialized:', msg.session_id);
          sessionStore.set(sessionKey, msg.session_id);
          sendEvent('session', { sessionId: msg.session_id });
        }

        if (msg.type === 'assistant') {
          turnCount++;
          console.log(`🔄 [SDK] Turn ${turnCount} - Processing assistant message`);
          sendEvent('turn', { count: turnCount });
          sendEvent('status', { message: `Processing turn ${turnCount}...` });

          // Send assistant text content
          const textContent = msg.message.content.find((c: any) => c.type === 'text');
          if (textContent) {
            const text = (textContent as any).text;
            console.log(`💬 [SDK] Assistant text (${text.length} chars):`, text.substring(0, 100));
            assistantResponse += text;
            sendEvent('message', { text });
          }

          // Send tool usage info
          const toolUses = msg.message.content.filter((c: any) => c.type === 'tool_use');
          if (toolUses.length > 0) {
            console.log(`🔧 [SDK] ${toolUses.length} tool call(s) in this turn`);
            for (const tool of toolUses) {
              const toolCall = {
                name: (tool as any).name,
                input: (tool as any).input,
              };
              console.log(`🔧 [SDK] Tool call: ${toolCall.name}`);
              console.log(`🔧 [SDK] Input:`, JSON.stringify(toolCall.input).substring(0, 200));
              toolCallsLog.push(toolCall);

              // Track file changes
              if (toolCall.name === 'write_file') {
                console.log(`📝 [SDK] File write: ${toolCall.input.path}`);
                fileChanges.push({
                  path: toolCall.input.path,
                  action: 'modified',
                  content: toolCall.input.content,
                });
              }

              sendEvent('tool', toolCall);
              sendEvent('status', { message: `Executing: ${toolCall.name}` });
            }
          }
        } else if (msg.type === 'result') {
          console.log('✅ [SDK] Result received:', msg.subtype);
          if (msg.subtype === 'success') {
            console.log('💾 [SDK] Saving conversation to database...');
            // Save assistant response to database
            await prisma.conversation.create({
              data: {
                projectId,
                role: 'assistant',
                content: assistantResponse || msg.result || '',
                ...(toolCallsLog.length > 0 && { toolCalls: toolCallsLog }),
                ...(fileChanges.length > 0 && { fileDiffs: fileChanges }),
              },
            });
            console.log('✅ [SDK] Conversation saved');

            sendEvent('complete', {
              result: msg.result || assistantResponse,
              usage: msg.usage,
            });
          } else {
            console.log('❌ [SDK] Error:', msg.subtype);
            sendEvent('error', { subtype: msg.subtype });
          }
        }
      }

      console.log('✅ [CHAT] Claude Agent SDK query completed');

      res.end();
      console.log('🏁 [CHAT] Response stream ended');
    } catch (error: any) {
      console.error('❌ [CHAT] Error during Claude Agent SDK query:', error);
      console.error('❌ [CHAT] Error stack:', error.stack);
      sendEvent('error', { message: error.message });
      res.end();
    }
  } catch (error: any) {
    console.error('❌ [CHAT] Fatal error:', error);
    console.error('❌ [CHAT] Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
}

interface TaskHistory {
  completedTasks: Array<{ id: string; description: string; result?: string }>;
  failedTasks: Array<{ id: string; description: string; error?: string }>;
  pendingTasks: Array<{ id: string; description: string }>;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  summary: string;
}

function buildTaskHistory(conversations: any[]): TaskHistory {
  const allCompletedTasks: Array<{ id: string; description: string; result?: string }> = [];
  const allFailedTasks: Array<{ id: string; description: string; error?: string }> = [];
  const allPendingTasks: Array<{ id: string; description: string }> = [];

  for (const conv of conversations) {
    if (conv.taskGraph && typeof conv.taskGraph === 'object') {
      const taskGraph = conv.taskGraph as any;

      if (taskGraph.tasks && Array.isArray(taskGraph.tasks)) {
        for (const task of taskGraph.tasks) {
          if (task.status === 'completed') {
            allCompletedTasks.push({
              id: task.id,
              description: task.description,
              result: task.result,
            });
          } else if (task.status === 'failed') {
            allFailedTasks.push({
              id: task.id,
              description: task.description,
              error: task.error,
            });
          } else if (task.status === 'pending' || task.status === 'in_progress') {
            allPendingTasks.push({
              id: task.id,
              description: task.description,
            });
          }
        }
      }
    }
  }

  // Build summary
  let summary = '';
  if (allCompletedTasks.length > 0 || allFailedTasks.length > 0 || allPendingTasks.length > 0) {
    summary = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    summary += '📊 TASK HISTORY FOR THIS PROJECT:\n';
    summary += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    if (allCompletedTasks.length > 0) {
      summary += `✅ COMPLETED TASKS (${allCompletedTasks.length}):\n`;
      allCompletedTasks.forEach((task, i) => {
        summary += `${i + 1}. ${task.description}\n`;
        if (task.result) {
          const resultPreview = task.result.substring(0, 100);
          summary += `   Result: ${resultPreview}${task.result.length > 100 ? '...' : ''}\n`;
        }
      });
      summary += '\n';
    }

    if (allFailedTasks.length > 0) {
      summary += `❌ FAILED TASKS (${allFailedTasks.length}):\n`;
      allFailedTasks.forEach((task, i) => {
        summary += `${i + 1}. ${task.description}\n`;
        if (task.error) {
          summary += `   Error: ${task.error}\n`;
        }
      });
      summary += '\n';
    }

    if (allPendingTasks.length > 0) {
      summary += `⏳ PENDING TASKS (${allPendingTasks.length}):\n`;
      allPendingTasks.forEach((task, i) => {
        summary += `${i + 1}. ${task.description}\n`;
      });
      summary += '\n';
    }

    summary += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    summary += 'Use this task history to understand what has already been done and what remains.\n';
    summary += 'Avoid redoing completed tasks unless explicitly requested.\n';
    summary += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  }

  return {
    completedTasks: allCompletedTasks,
    failedTasks: allFailedTasks,
    pendingTasks: allPendingTasks,
    completedCount: allCompletedTasks.length,
    failedCount: allFailedTasks.length,
    pendingCount: allPendingTasks.length,
    summary,
  };
}

function createGamePrompt(userMessage: string, gameType: '2d' | '3d', recentErrors: string, conversationContext: string = '', taskHistoryContext: string = ''): string {
  const is3D = gameType === '3d';

  return `You are an expert game developer helping to build a ${gameType.toUpperCase()} game using React + ${is3D ? 'Three.js' : 'HTML5 Canvas'}.

${conversationContext}

${taskHistoryContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  CRITICAL: PROJECT CONTEXT - READ FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GAME PROJECT TYPE: ${is3D ? '3D Game (Three.js + React + Vite)' : '2D Game (Canvas + React + Vite)'}

PROJECT STRUCTURE (already initialized):
├── src/
│   ├── App.tsx          → Main app entry with game canvas/3D scene
│   ├── main.tsx         → Entry point
│   ├── components/
│   │   ├── Game.tsx     → Main game component
│   │   ├── GameCanvas.tsx → ${is3D ? '3D scene with Three.js renderer' : '2D canvas renderer'}
│   │   └── ui/          → UI components (HUD, menus, etc.)
│   ├── game/
│   │   ├── Engine.ts    → Game engine/loop
│   │   ├── entities/    → Game objects (player, enemies, etc.)
│   │   ├── physics/     → Physics/collision system
│   │   └── utils/       → Game utilities
│   └── assets/
│       ├── models/      → ${is3D ? '3D models (GLTF/GLB)' : '2D sprites/images'}
│       ├── textures/    → Textures and materials
│       └── sounds/      → Audio files

${is3D ? `
THREE.JS SETUP (already configured):
- @react-three/fiber: React renderer for Three.js
- @react-three/drei: Useful helpers and abstractions
- three: Core Three.js library
- Camera, lighting, and basic scene already set up
- Use declarative JSX for 3D objects: <mesh>, <boxGeometry>, <meshStandardMaterial>
` : `
CANVAS 2D SETUP (already configured):
- HTML5 Canvas API for rendering
- RequestAnimationFrame for game loop
- Basic sprite rendering system
- Keyboard/mouse input handling
- Collision detection helpers
`}

INSTALLED DEPENDENCIES (DO NOT REINSTALL):
Core:
  - react@18.3.1, react-dom@18.3.1
  - vite@5.0.0 (dev server, HMR enabled)
  - typescript@5.6.0
  - tailwindcss@3.4.0 (for styling - USE THIS EXCLUSIVELY)
${is3D ? `
3D Game:
  - three@0.160.0
  - @react-three/fiber@8.15.0
  - @react-three/drei@9.92.0
  - @react-three/postprocessing@2.16.0 (effects)
` : `
2D Game:
  - No special game libraries (uses native Canvas API)
`}

VITE CONFIG:
  - Server: host "::", port 5173
  - Plugin: @vitejs/plugin-react-swc (Fast Refresh)
  - Alias: "@" → "./src"

GAME DEVELOPMENT BEST PRACTICES:
1. **Game Loop**: Use requestAnimationFrame for smooth 60 FPS
2. **State Management**: Use React state for UI, separate game state for engine
3. **Performance**:
   - Keep render calls minimal
   - Use object pooling for frequently created/destroyed objects
   - Batch similar rendering operations
4. **Physics**: Implement simple AABB collision detection
5. **Input**: Handle keyboard/mouse in event listeners, store state in game engine
${is3D ? `6. **3D Specific**:
   - Use instanced meshes for repeated objects
   - Implement frustum culling
   - Use LOD for distant objects
   - Optimize materials and textures` : `6. **2D Specific**:
   - Use sprite sheets for animations
   - Implement viewport culling
   - Use requestAnimationFrame wisely`}

DESIGN GUIDELINES:
- Create engaging, fun gameplay mechanics
- Smooth, responsive controls
- Clear visual feedback for actions
- Simple but polished graphics
- Satisfying sound effects
- Balanced difficulty curve

AVAILABLE TOOLS:
- read_file: Read file contents from the project
- write_file: Write/create files in the project
- execute_command: Run commands (npm install, etc.)
- list_files: List directory contents
- get_folder_structure: View project structure
- get_pod_logs: Read the last N seconds of logs from the Vite dev server (USE THIS TO CHECK FOR ERRORS!)
- run_build: Run npm run build to verify the project builds successfully (REQUIRED AT THE END!)

⚠️  CRITICAL - DO NOT:
- **NEVER CREATE .css FILES** - Tailwind CSS is already configured, use it exclusively
- **NEVER USE <style> TAGS** - All styling must be done with Tailwind utility classes
- **NEVER WRITE CUSTOM CSS** - Use only Tailwind classes like "bg-blue-500", "text-xl", etc.
- Read config files unless debugging specific issues
- Reinstall packages that are already there
- Create overly complex systems for simple games
- Use external APIs without explicit instruction
- Write files outside /app directory

✅ CRITICAL - ALWAYS DO:
- **USE TAILWIND CSS ONLY** - Style all components with Tailwind utility classes
- **VERIFY BUILD WORKS** - After making changes, read the pod logs to check for errors
- **FIX ALL ERRORS** - If you see errors in logs, fix them before finishing
- **TEST YOUR CHANGES** - Read logs after writing files to ensure no syntax errors
- Start implementing game logic immediately
- Focus on core gameplay first, polish later
- Write clean, commented code for game logic
- Keep game loop and rendering separate
- Use meaningful variable names for game entities

${recentErrors ? `⚠️  RECENT ERRORS:\n${recentErrors}\n\nPlease address these errors if they're related to the current task.\n` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 VERIFICATION WORKFLOW - FOLLOW THIS PROCESS EVERY TIME:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **Make your changes** - Write/edit files as needed
2. **Read pod logs** - Use get_pod_logs tool to check for runtime errors
3. **Fix any errors** - If you see errors in logs, fix them immediately
4. **RUN BUILD** - Use run_build tool to verify the project builds successfully
5. **Fix build errors** - If build fails, fix ALL errors and run build again
6. **Only then finish** - Don't complete until build succeeds with no errors

⚠️  CRITICAL: You MUST run the run_build tool before finishing your work!
This ensures the project actually compiles and has no TypeScript/build errors.

If you see errors like:
- "Failed to resolve import"
- "Expected ';'"
- "Cannot find module"
- "Type error"
Then you MUST fix them and run build again!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USER REQUEST: ${userMessage}

Let's build an amazing game! Focus on fun, responsive gameplay. Remember to verify there are no errors before finishing!`;
}
