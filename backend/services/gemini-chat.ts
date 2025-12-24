import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { getPodLogs, readProjectFile, writeProjectFile, executeInPod } from './kubernetes';

export interface GeminiChatOptions {
  apiKey: string;
  projectId: string;
  projectPath: string;
  gameType: '2d' | '3d';
  userMessage: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  taskHistory?: string;
  onEvent: (event: string, data: any) => void;
}

export interface GeminiChatResult {
  response: string;
  conversationHistory: Array<{ role: string; content: string }>;
}

export class GeminiChatService {
  private model: any;
  private projectId: string;
  private projectPath: string;
  private onEvent: (event: string, data: any) => void;
  private conversationHistory: Array<{ role: string; content: string }>;

  constructor(options: GeminiChatOptions) {
    this.conversationHistory = options.conversationHistory || [];
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
      const geminiHistory = this.conversationHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const chat = this.model.startChat({
        history: geminiHistory,
      });

      // Add current user message to history
      this.conversationHistory.push({ role: 'user', content: prompt });

      let result = await chat.sendMessage(prompt);
      let maxIterations = 20;
      let iteration = 0;
      let assistantResponse = '';

      while (iteration < maxIterations) {
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
        if (textParts && textParts.length > 0) {
          const text = textParts.map((p: any) => p.text).join('\n');
          assistantResponse += text + '\n';
          this.onEvent('message', { text });
        }

        // Check for function calls
        const functionCalls = content.parts?.filter((part: any) => part.functionCall);

        if (functionCalls && functionCalls.length > 0) {
          const functionResponses = [];

          for (const fcPart of functionCalls) {
            const fc = fcPart.functionCall;
            const toolName = fc.name;
            const args = fc.args;

            this.onEvent('tool', {
              name: toolName,
              input: args,
            });

            this.onEvent('status', { message: `Executing: ${toolName}` });

            // Execute the tool
            const toolResult = await this.executeTool(toolName, args);

            functionResponses.push({
              functionResponse: {
                name: toolName,
                response: {
                  result: toolResult,
                },
              },
            });
          }

          // Send function responses back and continue the loop
          // Gemini will process the results and may generate text or more tool calls
          result = await chat.sendMessage(functionResponses);
          // Loop continues - will check for text and tool calls in the new response
        } else {
          // No more function calls
          break;
        }
      }

      // Add assistant's full response to history
      if (assistantResponse.trim()) {
        this.conversationHistory.push({
          role: 'assistant',
          content: assistantResponse.trim()
        });
      }

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
  const inspirationFolder = is3D ? '3d-test-threejs' : 'mario';

  const gamePrompt = `You are an expert game developer helping to build a ${options.gameType.toUpperCase()} game using React + ${is3D ? 'Three.js' : 'HTML5 Canvas'}.

Project path: ${options.projectPath}

${options.taskHistory || ''}

User request: ${options.userMessage}

You have access to these tools:
- read_file: Read files from the project
- write_file: Write files to the project
- list_files: List directory contents
- get_folder_structure: View project structure
- get_pod_logs: Check Vite dev server logs for errors
- execute_command: Run shell commands (npm, etc.)

CRITICAL WORKING DIRECTORY RULES:
- You MUST work ONLY in the /app/react-templete folder at ALL times
- ALL file operations (read, write, edit) must be in /app/react-templete or its subdirectories
- You can READ from /app/${inspirationFolder} for inspiration and examples (${is3D ? '3D game examples' : '2D game examples like Mario'})
- NEVER create, write, or modify files outside of /app/react-templete
- NEVER create new folders outside of /app/react-templete
- When reading inspiration files, use paths like /app/${inspirationFolder}/... (READ ONLY)
- When working on the actual project, use paths like /app/react-templete/... (READ & WRITE)

Important:
- ONLY use Tailwind CSS for styling (no CSS files or style tags)
- Always check pod logs after writing files
- Fix all errors before finishing
- Write clean, commented code
- Explain what you're doing as you work through the task

Let's build an amazing game!`;

  return await service.chat(gamePrompt);
}
