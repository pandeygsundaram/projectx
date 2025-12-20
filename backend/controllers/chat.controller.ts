import { Request, Response } from 'express';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createProjectTools } from '../utils/agentTools';
import { getPodLogs } from '../services/kubernetes';
import prisma from '../config/database';

interface ChatRequest {
  projectId: string;
  message: string;
  gameType?: '2d' | '3d'; // Optional game type hint
}

// Store session IDs for conversation continuity
const sessionStore = new Map<string, string>();

export async function chatWithProject(req: Request, res: Response) {
  try {
    const { projectId, message, gameType = '3d' } = req.body as ChatRequest;

    if (!projectId || !message) {
      return res.status(400).json({ error: 'Project ID and message are required' });
    }

    // Verify project exists and belongs to user
    const userId = (req as any).userId;
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId,
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Helper to send SSE messages
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // Get recent pod logs for context
      const recentLogs = await getPodLogs(projectId, 60).catch(() => '');
      const errors = recentLogs.split('\n').filter(line =>
        line.toLowerCase().includes('error') ||
        line.toLowerCase().includes('failed') ||
        line.toLowerCase().includes('warn')
      ).slice(-5).join('\n');

      // Create enhanced prompt for game building
      const enhancedPrompt = createGamePrompt(message, gameType, errors);

      // Create tools bound to this project
      const projectTools = createProjectTools(projectId);

      // Create MCP server with tools
      const mcpServer = createSdkMcpServer({
        name: 'game-builder-tools',
        version: '1.0.0',
        tools: projectTools,
      });

      // Get or create session ID
      const sessionKey = `${userId}-${projectId}`;
      const sessionId = sessionStore.get(sessionKey);

      sendEvent('status', { message: 'Starting AI assistant...' });

      // Query Claude Agent SDK
      const result = query({
        prompt: enhancedPrompt,
        options: {
          model: 'claude-sonnet-4-5-20251022',
          maxTurns: 30,
          maxBudgetUsd: 0.5,
          mcpServers: {
            'game-builder-tools': mcpServer,
          },
          resume: sessionId,
        },
      });

      let turnCount = 0;
      let assistantResponse = '';

      for await (const msg of result) {
        // Capture session ID for conversation continuity
        if (msg.type === 'system' && msg.subtype === 'init') {
          sessionStore.set(sessionKey, msg.session_id);
          sendEvent('session', { sessionId: msg.session_id });
        }

        if (msg.type === 'assistant') {
          turnCount++;
          sendEvent('turn', { count: turnCount });

          // Send assistant text content
          const textContent = msg.message.content.find((c: any) => c.type === 'text');
          if (textContent) {
            const text = (textContent as any).text;
            assistantResponse += text;
            sendEvent('message', { text });
          }

          // Send tool usage info
          const toolUses = msg.message.content.filter((c: any) => c.type === 'tool_use');
          if (toolUses.length > 0) {
            for (const tool of toolUses) {
              sendEvent('tool', {
                name: (tool as any).name,
                input: (tool as any).input,
              });
            }
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            sendEvent('complete', {
              result: msg.result || assistantResponse,
              usage: msg.usage,
            });
          } else {
            sendEvent('error', { subtype: msg.subtype });
          }
        }
      }

      res.end();
    } catch (error: any) {
      sendEvent('error', { message: error.message });
      res.end();
    }
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
}

function createGamePrompt(userMessage: string, gameType: '2d' | '3d', recentErrors: string): string {
  const is3D = gameType === '3d';

  return `You are an expert game developer helping to build a ${gameType.toUpperCase()} game using React + ${is3D ? 'Three.js' : 'HTML5 Canvas'}.

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

⚠️  DO NOT:
- Read config files unless debugging specific issues
- Reinstall packages that are already there
- Create overly complex systems for simple games
- Use external APIs without explicit instruction
- Write files outside /app directory

✅ DO:
- Start implementing game logic immediately
- Focus on core gameplay first, polish later
- Write clean, commented code for game logic
- Test frequently during development
- Keep game loop and rendering separate
- Use meaningful variable names for game entities

${recentErrors ? `⚠️  RECENT ERRORS:\n${recentErrors}\n\nPlease address these errors if they're related to the current task.\n` : ''}

USER REQUEST: ${userMessage}

Let's build an amazing game! Focus on fun, responsive gameplay.`;
}
