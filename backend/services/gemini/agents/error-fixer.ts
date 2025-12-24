import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task } from '../task-store';
import { ExecutionResult, TaskExecutorAgent } from './task-executor';
import { VerificationResult } from './result-verifier';
import { getToolDeclarations, executeTool } from '../tools';

export interface FixResult {
  success: boolean;
  result: string;
  toolCalls: Array<{
    tool: string;
    args: any;
    result: string;
  }>;
  error?: string;
}

export class ErrorFixerAgent {
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

  async fixError(
    task: Task,
    executionResult: ExecutionResult,
    verificationResult: VerificationResult,
    context?: string,
    projectId?: string,
    projectPath?: string
  ): Promise<FixResult> {
    const fixPrompt = `You are an error fixing agent. A task was executed but the result was incorrect. Your job is to fix the issue.

Original Task: ${task.description}

Execution Result: ${executionResult.result}

Verification Feedback: ${verificationResult.feedback}

Tool Calls That Were Made:
${executionResult.toolCalls
  .map(
    (tc, i) => `${i + 1}. ${tc.tool}(${JSON.stringify(tc.args)})
   Result: ${tc.result.substring(0, 200)}${tc.result.length > 200 ? '...' : ''}`
  )
  .join('\n')}

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
1. Analyze what went wrong based on the verification feedback
2. Determine the corrective actions needed
3. Use the available tools to fix the issue
4. Be specific and precise in your fixes
5. Respect the working directory rules above
6. After fixing, explain what you changed and why

Fix the error now:`;

    const toolCalls: Array<{ tool: string; args: any; result: string }> = [];

    try {
      const chat = this.model.startChat({
        history: [],
      });

      let result = await chat.sendMessage(fixPrompt);
      let maxIterations = 10;
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

        const functionCalls = content.parts?.filter((part: any) => part.functionCall);

        if (functionCalls && functionCalls.length > 0) {
          const functionResponses = [];

          for (const fcPart of functionCalls) {
            const fc = fcPart.functionCall;
            const toolName = fc.name;
            const args = fc.args;

            console.log(`  🔧 [FIX] Calling tool: ${toolName}`);
            console.log(`     Args: ${JSON.stringify(args, null, 2)}`);

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

          result = await chat.sendMessage(functionResponses);
        } else {
          const textParts = content.parts?.filter((part: any) => part.text);
          const finalText = textParts?.map((p: any) => p.text).join('\n') || '';

          return {
            success: true,
            result: finalText,
            toolCalls,
          };
        }
      }

      return {
        success: false,
        result: 'Max iterations reached during fix',
        toolCalls,
        error: 'Fix exceeded maximum iterations',
      };
    } catch (error: any) {
      console.error('Error during fix:', error.message);

      return {
        success: false,
        result: '',
        toolCalls,
        error: error.message,
      };
    }
  }

  async attemptFix(
    task: Task,
    executionResult: ExecutionResult,
    verificationResult: VerificationResult,
    context?: string,
    projectId?: string,
    projectPath?: string,
    maxAttempts: number = 2
  ): Promise<FixResult> {
    let lastError = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`\n  🔧 Fix Attempt ${attempt}/${maxAttempts}`);

      const result = await this.fixError(
        task,
        executionResult,
        verificationResult,
        context,
        projectId,
        projectPath
      );

      if (result.success) {
        return result;
      }

      lastError = result.error || 'Unknown error';
      console.log(`  ❌ Fix attempt ${attempt} failed: ${lastError}`);

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return {
      success: false,
      result: '',
      toolCalls: [],
      error: `Failed to fix after ${maxAttempts} attempts. Last error: ${lastError}`,
    };
  }
}
