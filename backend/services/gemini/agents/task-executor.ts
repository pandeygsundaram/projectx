import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task, TaskStatus } from '../task-store';
import { getToolDeclarations, executeTool } from '../tools';

export interface ExecutionResult {
  success: boolean;
  result: string;
  toolCalls: Array<{
    tool: string;
    args: any;
    result: string;
  }>;
  error?: string;
}

export class TaskExecutorAgent {
  private model: any;

  constructor(apiKey: string, modelName: string = 'gemini-2.0-flash-exp') {
    const genAI = new GoogleGenerativeAI(apiKey);

    const tools = getToolDeclarations();

    this.model = genAI.getGenerativeModel({
      model: modelName,
      tools: [
        {
          functionDeclarations: tools,
        },
      ],
    });
  }

  async executeTask(task: Task, context?: string, projectId?: string, projectPath?: string): Promise<ExecutionResult> {
    const executionPrompt = `You are a task execution agent. Your job is to complete the following task by using the available tools.

Task: ${task.description}

${context ? `Context:\n${context}\n` : ''}

Available Tools:
- read_file: Read file contents
- write_file: Write content to a file
- edit_file: Edit a file by replacing text
- list_files: List files in a directory
- get_folder_structure: Get folder structure
- execute_command: Execute shell commands

CRITICAL WORKING DIRECTORY RULES:
- You MUST work ONLY in the /app/react-templete folder at ALL times
- ALL file operations (read, write, edit) must be in /app/react-templete or its subdirectories
- You can READ from /app/mario (for 2D game inspiration) or /app/3d-test-threejs (for 3D game inspiration) for examples
- NEVER create, write, or modify files outside of /app/react-templete
- NEVER create new folders outside of /app/react-templete
- When reading inspiration files, use paths like /app/mario/... or /app/3d-test-threejs/... (READ ONLY)
- When working on the actual project, use paths like /app/react-templete/... (READ & WRITE)

Instructions:
1. Analyze the task and determine which tools you need to use
2. Call the appropriate tools in the correct order
3. Provide clear, specific arguments to each tool
4. After completing the task, summarize what you did
5. Be efficient - don't read files unnecessarily
6. ALWAYS respect the working directory rules above

Execute the task now:`;

    const toolCalls: Array<{ tool: string; args: any; result: string }> = [];
    let conversationHistory: any[] = [];

    try {
      // Start chat session
      const chat = this.model.startChat({
        history: conversationHistory,
      });

      let result = await chat.sendMessage(executionPrompt);
      let maxIterations = 10; // Prevent infinite loops
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        const response = result.response;
        const candidates = response.candidates;

        if (!candidates || candidates.length === 0) {
          break;
        }

        const candidate = candidates[0];
        const content = candidate.content;

        // Check if there are function calls
        const functionCalls = content.parts?.filter(
          (part: any) => part.functionCall
        );

        if (functionCalls && functionCalls.length > 0) {
          // Execute each function call
          const functionResponses = [];

          for (const fcPart of functionCalls) {
            const fc = fcPart.functionCall;
            const toolName = fc.name;
            const args = fc.args;

            console.log(`  🔧 Calling tool: ${toolName}`);
            console.log(`     Args: ${JSON.stringify(args, null, 2)}`);

            // Execute the tool
            const toolResult = await executeTool(toolName, args, projectId || '', projectPath || '');

            console.log(`     Result: ${toolResult.substring(0, 100)}...`);

            toolCalls.push({
              tool: toolName,
              args,
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

          // Send function responses back to model
          result = await chat.sendMessage(functionResponses);
        } else {
          // No more function calls, task is complete
          const textParts = content.parts?.filter((part: any) => part.text);
          const finalText = textParts?.map((p: any) => p.text).join('\n') || '';

          return {
            success: true,
            result: finalText,
            toolCalls,
          };
        }
      }

      // Max iterations reached
      return {
        success: false,
        result: 'Max iterations reached',
        toolCalls,
        error: 'Task execution exceeded maximum iterations',
      };
    } catch (error: any) {
      console.error('Error executing task:', error.message);

      return {
        success: false,
        result: '',
        toolCalls,
        error: error.message,
      };
    }
  }

  async executeWithRetry(
    task: Task,
    context?: string,
    projectId?: string,
    projectPath?: string,
    maxRetries: number = 3
  ): Promise<ExecutionResult> {
    let lastError = '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`\n  Attempt ${attempt}/${maxRetries}`);

      const result = await this.executeTask(task, context, projectId, projectPath);

      if (result.success) {
        return result;
      }

      lastError = result.error || 'Unknown error';
      console.log(`  ❌ Attempt ${attempt} failed: ${lastError}`);

      // Wait before retry
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return {
      success: false,
      result: '',
      toolCalls: [],
      error: `Failed after ${maxRetries} attempts. Last error: ${lastError}`,
    };
  }
}
