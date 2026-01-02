import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { getPodLogs, readProjectFile, writeProjectFile, executeInPod } from './kubernetes';

export interface ToolCall {
  name: string;
  args: any;
}

export interface ToolResponse {
  name: string;
  result: string;
}

export interface ConversationMessage {
  role: string;
  content?: string;
  toolCalls?: ToolCall[];
  toolResponses?: ToolResponse[];
}

export interface GeminiChatOptions {
  apiKey: string;
  projectId: string;
  projectPath: string;
  gameType: '2d' | '3d';
  userMessage: string;
  conversationHistory?: ConversationMessage[];
  taskHistory?: string;
  onEvent: (event: string, data: any) => void;
  abortSignal?: () => boolean; // Function to check if execution should be aborted
}

export interface GeminiChatResult {
  response: string;
  conversationHistory: ConversationMessage[];
}

export class GeminiChatService {
  private model: any;
  private projectId: string;
  private projectPath: string;
  private onEvent: (event: string, data: any) => void;
  private conversationHistory: ConversationMessage[];
  private abortSignal: () => boolean;

  constructor(options: GeminiChatOptions) {
    this.conversationHistory = options.conversationHistory || [];
    this.abortSignal = options.abortSignal || (() => false);
    const genAI = new GoogleGenerativeAI(options.apiKey);

    // Define tools for Gemini
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'read_file',
            description: 'Read file contents from the project',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                path: {
                  type: SchemaType.STRING,
                  description: 'File path relative to /app directory',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'write_file',
            description: 'Write content to a file in the project',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                path: {
                  type: SchemaType.STRING,
                  description: 'File path relative to /app directory',
                },
                content: {
                  type: SchemaType.STRING,
                  description: 'Content to write',
                },
              },
              required: ['path', 'content'],
            },
          },
          {
            name: 'list_files',
            description: 'List files in a directory',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                path: {
                  type: SchemaType.STRING,
                  description: 'Directory path relative to /app',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'get_folder_structure',
            description: 'Get folder structure of project',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                path: {
                  type: SchemaType.STRING,
                  description: 'Directory path relative to /app',
                },
                max_depth: {
                  type: SchemaType.NUMBER,
                  description: 'Maximum depth (default: 2)',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'get_pod_logs',
            description: 'Get recent logs from the Vite dev server',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                seconds: {
                  type: SchemaType.NUMBER,
                  description: 'Seconds of logs to retrieve (default: 60)',
                },
              },
            },
          },
          {
            name: 'execute_command',
            description: 'Execute a shell command in the project',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                command: {
                  type: SchemaType.STRING,
                  description: 'Shell command to execute',
                },
              },
              required: ['command'],
            },
          },
        ],
      },
    ];

    this.model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-preview',
      tools: tools as any,
    });

    this.projectId = options.projectId;
    this.projectPath = options.projectPath;
    this.onEvent = options.onEvent;
  }

  private async executeTool(toolName: string, args: any): Promise<string> {
    try {
      switch (toolName) {
        case 'read_file': {
          const content = await readProjectFile(this.projectId, args.path);
          const lines = content.split('\n');

          if (content.length > 10000 || lines.length > 100) {
            const firstLines = lines.slice(0, 50).join('\n');
            const lastLines = lines.slice(-50).join('\n');
            return `File: ${args.path} (${lines.length} lines)\n\nFirst 50 lines:\n${firstLines}\n\n...\n\nLast 50 lines:\n${lastLines}`;
          }

          return `File content of ${args.path}:\n\`\`\`\n${content}\n\`\`\``;
        }

        case 'write_file': {
          await writeProjectFile(this.projectId, args.path, args.content);
          const lines = args.content.split('\n').length;
          return `✅ Successfully wrote ${lines} lines to ${args.path}`;
        }

        case 'list_files': {
          const result = await executeInPod(this.projectId, `ls -la /app/${args.path || '.'}`);
          return `Files in ${args.path || '.'}:\n\`\`\`\n${result}\n\`\`\``;
        }

        case 'get_folder_structure': {
          const depth = args.max_depth || 2;
          const result = await executeInPod(
            this.projectId,
            `tree -L ${depth} -I 'node_modules|dist|build' /app/${args.path || '.'} || find /app/${args.path || '.'} -maxdepth ${depth} -type f`
          );
          return `Folder structure of ${args.path || '.'}:\n\`\`\`\n${result}\n\`\`\``;
        }

        case 'get_pod_logs': {
          const seconds = args.seconds || 60;
          const logs = await getPodLogs(this.projectId, seconds);

          // Filter for errors
          const lines = logs.split('\n');
          const hasErrors = lines.some(line =>
            line.toLowerCase().includes('error') ||
            line.toLowerCase().includes('failed') ||
            line.toLowerCase().includes('cannot find')
          );

          return `Pod logs (last ${seconds} seconds):\n\`\`\`\n${logs}\n\`\`\`\n\n${hasErrors ? '⚠️ ERRORS DETECTED - Please fix these issues!' : '✅ No errors detected'}`;
        }

        case 'execute_command': {
          const result = await executeInPod(this.projectId, args.command);
          return `Command executed: ${args.command}\n\nOutput:\n\`\`\`\n${result}\n\`\`\``;
        }

        default:
          return `Error: Unknown tool '${toolName}'`;
      }
    } catch (error: any) {
      return `Error executing ${toolName}: ${error.message}`;
    }
  }

  async chat(prompt: string): Promise<GeminiChatResult> {
    try {
      this.onEvent('status', { message: 'Starting Gemini AI...' });

      // Convert conversation history to Gemini format
      const geminiHistory = this.conversationHistory.flatMap(msg => {
        const messages = [];

        if (msg.role === 'user' && msg.content) {
          // User message with text
          messages.push({
            role: 'user',
            parts: [{ text: msg.content }],
          });
        } else if (msg.role === 'assistant' && msg.content) {
          // Assistant message with text
          const parts: any[] = [{ text: msg.content }];

          // If there are tool calls, add them to the same message
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const toolCall of msg.toolCalls) {
              parts.push({
                functionCall: {
                  name: toolCall.name,
                  args: toolCall.args,
                },
              });
            }
          }

          messages.push({
            role: 'model',
            parts,
          });
        } else if (msg.role === 'tool' && msg.toolResponses) {
          // Tool responses
          const parts = msg.toolResponses.map(tr => ({
            functionResponse: {
              name: tr.name,
              response: {
                result: tr.result,
              },
            },
          }));

          messages.push({
            role: 'user',
            parts,
          });
        }

        return messages;
      });

      const chat = this.model.startChat({
        history: geminiHistory,
      });

      // Add current user message to history
      this.conversationHistory.push({ role: 'user', content: prompt });

      // Emit LLM request event
      const requestStartTime = Date.now();
      this.onEvent('llm_request', {
        timestamp: new Date().toISOString(),
        model: 'gemini-2.0-flash-exp',
        request: {
          prompt,
          history: geminiHistory.map(h => ({ role: h.role, partsCount: h.parts.length })),
        },
      });

      let result = await chat.sendMessage(prompt);
      let maxIterations = 50;
      let iteration = 0;
      let assistantResponse = '';

      while (iteration < maxIterations) {
        // Check if client disconnected
        if (this.abortSignal()) {
          console.log('⏹️ [GEMINI] Client disconnected - aborting execution');
          this.onEvent('status', { message: 'Execution stopped by user' });
          break;
        }

        iteration++;

        const response = result.response;
        const candidates = response.candidates;

        if (!candidates || candidates.length === 0) {
          break;
        }

        const candidate = candidates[0];
        const content = candidate.content;

        // Check for text FIRST - Gemini might explain before/during tool calls
        const textParts = content.parts?.filter((part: any) => part.text);
        let currentIterationText = '';
        if (textParts && textParts.length > 0) {
          const text = textParts.map((p: any) => p.text).join('\n');
          currentIterationText = text;
          assistantResponse += text + '\n';
          this.onEvent('message', { text });
        }

        // Check for function calls
        const functionCalls = content.parts?.filter((part: any) => part.functionCall);

        if (functionCalls && functionCalls.length > 0) {
          const functionResponses = [];
          const toolCalls: ToolCall[] = [];
          const toolResponses: ToolResponse[] = [];

          for (const fcPart of functionCalls) {
            const fc = fcPart.functionCall;
            const toolName = fc.name;
            const args = fc.args;

            this.onEvent('tool', {
              name: toolName,
              input: args,
            });

            this.onEvent('status', { message: `Executing: ${toolName}` });

            // Save tool call
            toolCalls.push({
              name: toolName,
              args: args,
            });

            // Execute the tool
            const toolResult = await this.executeTool(toolName, args);

            // Save tool response
            toolResponses.push({
              name: toolName,
              result: toolResult,
            });

            functionResponses.push({
              functionResponse: {
                name: toolName,
                response: {
                  result: toolResult,
                },
              },
            });
          }

          // Save assistant message with tool calls to history
          this.conversationHistory.push({
            role: 'assistant',
            content: currentIterationText || undefined,
            toolCalls: toolCalls,
          });

          // Save tool responses to history
          this.conversationHistory.push({
            role: 'tool',
            toolResponses: toolResponses,
          });

          // Send function responses back and continue the loop
          // Gemini will process the results and may generate text or more tool calls
          result = await chat.sendMessage(functionResponses);
          // Loop continues - will check for text and tool calls in the new response
        } else {
          // No more function calls - save final assistant response if we have text
          if (currentIterationText.trim()) {
            this.conversationHistory.push({
              role: 'assistant',
              content: currentIterationText.trim(),
            });
          }
          break;
        }
      }

      // Emit LLM response event
      const requestDuration = (Date.now() - requestStartTime) / 1000;
      this.onEvent('llm_response', {
        timestamp: new Date().toISOString(),
        duration: requestDuration,
        response: {
          text: assistantResponse.substring(0, 200) + (assistantResponse.length > 200 ? '...' : ''),
          fullLength: assistantResponse.length,
        },
      });

      this.onEvent('complete', {
        result: assistantResponse,
      });

      return {
        response: assistantResponse,
        conversationHistory: this.conversationHistory,
      };
    } catch (error: any) {
      this.onEvent('error', { message: error.message });
      throw error;
    }
  }
}

export async function chatWithGemini(options: GeminiChatOptions): Promise<GeminiChatResult> {
  const service = new GeminiChatService(options);

  // Build prompt with context
  const is3D = options.gameType === '3d';
  const gameType = options.gameType.toUpperCase()
  const projectPath = options.projectPath
  const userMessage = options.userMessage
  const taskHistory = options.taskHistory

  const gamePrompt = `You are Hitbox, an expert game development AI assistant specializing in creating high-quality 2D and 3D games using React, Three.js, and HTML5 Canvas. You operate in a containerized environment with specific directory constraints and tooling capabilities.

ENVIRONMENT OVERVIEW

Working Directory: /app/react-templete (READ & WRITE)
Inspiration Directory: /app/2d-test-mario or /app/3d-test-threejs (READ ONLY)
Current Game Type: 2D or 3D
Tech Stack: React + Three.js for 3D or HTML5 Canvas for 2D

CRITICAL DIRECTORY RULES

ABSOLUTE WORKING DIRECTORY CONSTRAINT:
- ALL file operations (create, write, edit, delete) MUST occur in /app/react-templete or its subdirectories
- NEVER create, modify, or delete files outside /app/react-templete
- NEVER create new root-level folders outside /app/react-templete

INSPIRATION RESOURCES (READ ONLY):
- For 2D games: Reference /app/2d-test-mario for examples
- For 3D games: Reference /app/3d-test-threejs for examples
- You may READ these folders for patterns, code structure, and implementation ideas
- NEVER write to or modify inspiration directories

PATH VALIDATION:
- Before ANY write operation, verify the path starts with /app/react-templete/
- If a user requests changes outside this directory, politely explain the constraint and offer an alternative approach

AVAILABLE TOOLS

FILE OPERATIONS:
- read_file: Read file contents (works in both working and inspiration directories)
- write_file: Write/update files (ONLY in /app/react-templete)
- list_files: List directory contents
- get_folder_structure: View complete project structure

DEVELOPMENT TOOLS:
- get_pod_logs: Check Vite dev server logs for errors and warnings
- execute_command: Run shell commands (npm install, npm run dev, etc.)

CORE DEVELOPMENT PRINCIPLES

STYLING REQUIREMENTS:
- ONLY use Tailwind CSS for all styling
- NO separate CSS files
- NO style tags or inline styles
- NO CSS-in-JS libraries (styled-components, emotion, etc.)
- Use Tailwind utility classes directly in JSX

CODE QUALITY STANDARDS:
- Write clean, modular, well-commented code
- Split functionality into smaller, reusable components
- Follow React best practices (hooks, component composition)
- Use descriptive variable and function names
- Add comments explaining complex game logic

ERROR HANDLING WORKFLOW (CRITICAL):
After EVERY file write operation:
1. Check pod logs using get_pod_logs
2. Identify any errors or warnings
3. Fix ALL errors before proceeding
4. Verify the fix by checking logs again
5. NEVER leave broken code

DEPENDENCY MANAGEMENT:
- Check package.json before installing new packages
- Avoid duplicate or conflicting dependencies
- For 3D games: Ensure Three.js, @react-three/fiber, @react-three/drei are installed
- For 2D games: No additional canvas libraries needed (use native Canvas API)
- Always use npm install (not yarn or pnpm)

GAME DEVELOPMENT BEST PRACTICES

FOR 2D GAMES (HTML5 CANVAS):
- Use useEffect for game loop setup
- Implement requestAnimationFrame for smooth rendering
- Handle keyboard/mouse input with event listeners
- Separate game state from rendering logic
- Consider using useRef for canvas element access

FOR 3D GAMES (THREE.JS):
- Use @react-three/fiber for React integration
- Leverage @react-three/drei helpers (OrbitControls, useGLTF, etc.)
- Organize scenes with proper component hierarchy
- Optimize performance (frustum culling, LOD, instancing)
- Use useFrame for animation loops

PHYSICS AND COLLISION:
- For 2D: Implement basic AABB or circle collision detection
- For 3D: Consider react-three/rapier for physics
- Always validate hitbox boundaries
- Handle edge cases (screen boundaries, object stacking)

STATE MANAGEMENT:
- Use React hooks (useState, useReducer) for game state
- Consider zustand for complex state (already common in Three.js projects)
- Avoid prop drilling - lift state appropriately
- Keep game logic separate from rendering

WORKFLOW AND COMMUNICATION

TASK EXECUTION FLOW:
1. Understand: Analyze the user's request thoroughly
2. Plan: Explain what you're going to do (briefly, no walls of text)
3. Inspect: Check existing code structure if modifying
4. Implement: Write code with proper organization
5. Verify: Check logs and test functionality
6. Report: Summarize what was done and next steps

COMMUNICATION STYLE:
- Be concise and direct (GenZ-friendly, no corporate speak)
- Use simple English, avoid jargon unless necessary
- Show original error logs when debugging
- Explain WHY you're making specific choices
- Offer alternatives when constraints prevent direct solutions
- NEVER say "artifact" - just describe what you're building

RESPONSE FORMAT:
- Start with brief explanation of approach
- Use tool calls to implement changes
- Show relevant code snippets when helpful
- End with verification status and next steps
- Keep responses focused and actionable

EDGE CASES AND CONSTRAINTS

HANDLING INVALID REQUESTS:
Example - User: "Create a file at /app/new-project/game.js"
Response: "I can only create files inside /app/react-templete. I can create /app/react-templete/game.js instead. Would that work?"

MISSING DEPENDENCIES:
- Check package.json before assuming packages exist
- Install missing dependencies before writing code that needs them
- Verify installation succeeded via logs

FILE ALREADY EXISTS:
- Read existing file first before overwriting
- Ask for confirmation if making major changes
- Preserve working code unless explicitly told to replace

BUILD ERRORS:
- NEVER ignore TypeScript errors
- Fix import path issues immediately
- Resolve missing module errors before continuing
- Check for syntax errors after every write

ASSET MANAGEMENT:
- For images/models: Suggest placing in /app/react-templete/public
- Handle missing assets gracefully (placeholders, error states)
- Optimize asset loading (lazy loading, compression)

EXAMPLE INTERACTIONS

GOOD RESPONSE PATTERN:
User: "Add player movement to my 2D game"
Response: "Alright, I'll add WASD keyboard controls for player movement. Let me: 1. Read the current player component 2. Add keyboard event listeners 3. Update player position in game loop [executes tool calls] Done! Player now moves with WASD keys. Checked logs - no errors. The movement uses 5px steps and stays within canvas bounds."

BAD RESPONSE PATTERN (DON'T DO THIS):
User: "Add player movement"
Response: "I notice you want to add player movement to your game. This is a common feature in game development. Let me explain the various approaches... [3 paragraphs of explanation] There are several methods we could use including... [2 more paragraphs] [finally makes changes but doesn't check logs]"

CRITICAL REMINDERS

DO THESE THINGS:
- Work ONLY in /app/react-templete
- Use ONLY Tailwind CSS for styling
- Check logs after EVERY file write
- Fix ALL errors before finishing
- Keep responses concise and actionable
- Show original error logs when debugging
- Explain your approach briefly before implementing

NEVER DO THESE THINGS:
- NEVER write outside /app/react-templete
- NEVER create CSS files or style tags
- NEVER ignore build errors
- NEVER write verbose explanations (keep it short!)

CURRENT TASK CONTEXT

Project Path: ${projectPath}
Game Type: ${gameType}
Previous Tasks: ${taskHistory}
User Request: ${userMessage}

Let's build something awesome!`;

  return await service.chat(gamePrompt);
}
