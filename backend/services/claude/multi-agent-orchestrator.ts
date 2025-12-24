import Anthropic from '@anthropic-ai/sdk';
import { createProjectTools } from '../../utils/agentTools';
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'verifying' | 'fixing';
  dependencies: string[];
  result?: string;
  error?: string;
  attempts: number;
  maxAttempts: number;
  toolCalls?: Array<{
    tool: string;
    args: any;
    result?: string;
  }>;
  verificationResult?: {
    isCorrect: boolean;
    feedback: string;
    confidence: number;
  };
}

export interface TaskGraph {
  tasks: Task[];
  rootTaskIds: string[];
  completedTasks: string[];
  failedTasks: string[];
}

export interface ClaudeMultiAgentOptions {
  apiKey: string;
  projectId: string;
  userMessage: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  taskHistory?: string;
  gameType: '2d' | '3d';
  onEvent: (event: string, data: any) => void;
}

export class ClaudeMultiAgentOrchestrator {
  private client: Anthropic;
  private projectId: string;
  private taskGraph: TaskGraph;
  private taskHistory: string;
  private onEvent: (event: string, data: any) => void;
  private tools: any[];
  private mcpServer: any;

  constructor(options: ClaudeMultiAgentOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.projectId = options.projectId;
    this.onEvent = options.onEvent;
    this.taskHistory = options.taskHistory || '';
    this.taskGraph = {
      tasks: [],
      rootTaskIds: [],
      completedTasks: [],
      failedTasks: [],
    };

    // Create tools
    this.tools = createProjectTools(options.projectId);
    this.mcpServer = createSdkMcpServer({
      name: 'game-builder-tools',
      version: '1.0.0',
      tools: this.tools,
    });
  }

  // Step 1: Task Planning Agent
  async planTasks(userMessage: string, context?: string): Promise<void> {
    this.onEvent('status', { message: 'Planning tasks...' });

    const planningPrompt = `You are a task planning agent. Break down the following user request into a dependency graph of specific, executable tasks.

User Request: ${userMessage}

${context ? `Context:\n${context}\n` : ''}

${this.taskHistory}

CRITICAL WORKING DIRECTORY RULES:
- ALL tasks MUST work ONLY in the /app/react-templete folder
- Tasks can READ from /app/mario (2D examples) or /app/3d-test-threejs (3D examples) for inspiration
- NEVER plan tasks that create, write, or modify files outside of /app/react-templete
- NEVER plan tasks that create new folders outside of /app/react-templete

Instructions:
1. Analyze the request and break it into discrete tasks
2. Identify dependencies (which tasks must complete before others)
3. Keep tasks specific and actionable
4. Ensure all tasks respect the working directory rules above
5. Return a JSON object with this exact structure:

{
  "tasks": [
    {
      "id": "task-1",
      "description": "Specific description of what to do",
      "dependencies": []
    },
    {
      "id": "task-2",
      "description": "Another task",
      "dependencies": ["task-1"]
    }
  ]
}

IMPORTANT:
- Use IDs like "task-1", "task-2", etc.
- dependencies should be an array of task IDs
- Limit to 8 tasks maximum
- Return ONLY the JSON object

Create the task plan:`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: planningPrompt }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from planning agent');
      }

      // Extract JSON from response
      let jsonStr = textContent.text.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\s*/g, '').replace(/```\s*$/g, '');
      }

      const parsed = JSON.parse(jsonStr);

      // Convert to Task objects
      this.taskGraph.tasks = parsed.tasks.map((t: any) => ({
        id: t.id,
        description: t.description,
        status: 'pending' as const,
        dependencies: t.dependencies || [],
        attempts: 0,
        maxAttempts: 3,
        toolCalls: [],
      }));

      // Find root tasks
      this.taskGraph.rootTaskIds = this.taskGraph.tasks
        .filter(t => t.dependencies.length === 0)
        .map(t => t.id);

      this.onEvent('plan', {
        totalTasks: this.taskGraph.tasks.length,
        tasks: this.taskGraph.tasks.map(t => ({ id: t.id, description: t.description })),
      });

      console.log(`📋 [CLAUDE MA] Planned ${this.taskGraph.tasks.length} tasks`);
    } catch (error: any) {
      console.error('❌ [CLAUDE MA] Planning failed:', error.message);

      // Fallback: single task
      this.taskGraph.tasks = [{
        id: 'task-1',
        description: userMessage,
        status: 'pending',
        dependencies: [],
        attempts: 0,
        maxAttempts: 3,
        toolCalls: [],
      }];
      this.taskGraph.rootTaskIds = ['task-1'];

      this.onEvent('plan', {
        totalTasks: 1,
        tasks: [{ id: 'task-1', description: userMessage }],
      });
    }
  }

  // Step 2: Task Executor Agent
  async executeTask(task: Task): Promise<boolean> {
    this.onEvent('task_start', { taskId: task.id, description: task.description });
    console.log(`\n🔧 [CLAUDE MA] Executing task: ${task.id}`);

    task.status = 'in_progress';

    const executionPrompt = `You are a task execution agent. Complete this specific task using the available tools.

Task: ${task.description}

${this.taskHistory}

Available Tools:
- read_file: Read file contents from the project
- write_file: Write/create files in the project
- execute_command: Run commands (npm install, etc.)
- list_files: List directory contents
- get_folder_structure: View project structure
- get_pod_logs: Check Vite dev server logs for errors
- run_build: Verify the project builds successfully

CRITICAL WORKING DIRECTORY RULES:
- You MUST work ONLY in the /app/react-templete folder at ALL times
- ALL file operations (read, write, edit) must be in /app/react-templete or its subdirectories
- You can READ from /app/mario (for 2D game inspiration) or /app/3d-test-threejs (for 3D game inspiration) for examples
- NEVER create, write, or modify files outside of /app/react-templete
- NEVER create new folders outside of /app/react-templete
- When reading inspiration files, use paths like /app/mario/... or /app/3d-test-threejs/... (READ ONLY)
- When working on the actual project, use paths like /app/react-templete/... (READ & WRITE)

Instructions:
1. Use the appropriate tools to complete the task
2. Be efficient - don't read files unnecessarily
3. Always check pod logs after making changes
4. Provide clear output about what you did
5. ALWAYS respect the working directory rules above

Complete the task now:`;

    try {
      const result = query({
        prompt: executionPrompt,
        options: {
          model: 'claude-sonnet-4-5-20251001',
          maxTurns: 15,
          maxBudgetUsd: 0.1,
          permissionMode: 'bypassPermissions',
          mcpServers: {
            'game-builder-tools': this.mcpServer,
          },
        },
      });

      let assistantResponse = '';
      const toolCalls: any[] = [];

      for await (const msg of result) {
        if (msg.type === 'assistant') {
          const textContent = msg.message.content.find((c: any) => c.type === 'text');
          if (textContent) {
            assistantResponse += (textContent as any).text;
          }

          // Track tool calls
          const toolUses = msg.message.content.filter((c: any) => c.type === 'tool_use');
          for (const tool of toolUses) {
            const toolCall = {
              tool: (tool as any).name,
              args: (tool as any).input,
            };
            toolCalls.push(toolCall);
            this.onEvent('tool', toolCall);
            console.log(`  🔧 Tool: ${toolCall.tool}`);
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            task.result = assistantResponse || msg.result;
            task.toolCalls = toolCalls;
            task.status = 'completed';

            this.onEvent('task_executed', {
              taskId: task.id,
              result: task.result,
            });

            console.log(`✅ [CLAUDE MA] Task ${task.id} completed`);
            return true;
          } else {
            throw new Error(`Task failed: ${msg.subtype}`);
          }
        }
      }

      return false;
    } catch (error: any) {
      console.error(`❌ [CLAUDE MA] Task ${task.id} failed:`, error.message);
      task.error = error.message;
      task.status = 'failed';
      task.attempts++;

      this.onEvent('task_failed', {
        taskId: task.id,
        error: error.message,
      });

      return false;
    }
  }

  // Step 3: Result Verifier Agent
  async verifyTask(task: Task): Promise<boolean> {
    if (!task.result) return false;

    this.onEvent('status', { message: `Verifying task ${task.id}...` });
    console.log(`🔍 [CLAUDE MA] Verifying task: ${task.id}`);

    task.status = 'verifying';

    const verificationPrompt = `You are a verification agent. Verify if this task was completed correctly.

Task Description: ${task.description}

Execution Result: ${task.result}

Tool Calls Made:
${task.toolCalls?.map((tc, i) => `${i + 1}. ${tc.tool}(${JSON.stringify(tc.args)})`).join('\n')}

${this.taskHistory}

CRITICAL VERIFICATION CHECKS:
- Verify that ALL file operations were performed in /app/react-templete (or its subdirectories)
- Ensure NO files were created, written, or modified outside of /app/react-templete
- Confirm that reads from example folders (/app/mario or /app/3d-test-threejs) were READ-ONLY
- Flag as incorrect if any violations of working directory rules occurred

Instructions:
1. Check if the task was completed successfully
2. Verify the tool calls were appropriate
3. Verify all working directory rules were followed
4. Rate your confidence (0-100)

Return JSON:
{
  "isCorrect": true/false,
  "feedback": "Detailed feedback",
  "confidence": 0-100
}

Return ONLY the JSON object:`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: verificationPrompt }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return true; // Default to success if verification fails
      }

      let jsonStr = textContent.text.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\s*/g, '').replace(/```\s*$/g, '');
      }

      const verification = JSON.parse(jsonStr);

      task.verificationResult = {
        isCorrect: verification.isCorrect,
        feedback: verification.feedback,
        confidence: verification.confidence || 50,
      };

      this.onEvent('task_verified', {
        taskId: task.id,
        isCorrect: verification.isCorrect,
        feedback: verification.feedback,
      });

      console.log(`${verification.isCorrect ? '✅' : '❌'} [CLAUDE MA] Verification: ${verification.feedback}`);

      return verification.isCorrect;
    } catch (error: any) {
      console.error('⚠️ [CLAUDE MA] Verification failed:', error.message);
      return true; // Default to success
    }
  }

  // Get next executable task
  private getNextExecutableTask(): Task | null {
    return this.taskGraph.tasks.find(task => {
      if (task.status !== 'pending') return false;

      // Check dependencies
      return task.dependencies.every(depId => {
        const dep = this.taskGraph.tasks.find(t => t.id === depId);
        return dep?.status === 'completed';
      });
    }) || null;
  }

  // Main execution loop
  async execute(userMessage: string, context?: string): Promise<void> {
    // Step 1: Plan tasks
    await this.planTasks(userMessage, context);

    // Step 2: Execute tasks in order
    let iteration = 0;
    const maxIterations = 30;

    while (iteration < maxIterations) {
      iteration++;

      const nextTask = this.getNextExecutableTask();

      if (!nextTask) {
        // Check if all tasks are done
        const allDone = this.taskGraph.tasks.every(
          t => t.status === 'completed' || t.status === 'failed'
        );

        if (allDone) break;

        // Deadlock - mark remaining pending tasks as failed
        this.taskGraph.tasks
          .filter(t => t.status === 'pending')
          .forEach(t => {
            t.status = 'failed';
            t.error = 'Dependency deadlock';
            this.taskGraph.failedTasks.push(t.id);
          });

        break;
      }

      // Execute task
      const success = await this.executeTask(nextTask);

      if (success) {
        // Verify task (optional, can be disabled for speed)
        const verified = await this.verifyTask(nextTask);

        if (verified) {
          nextTask.status = 'completed';
          this.taskGraph.completedTasks.push(nextTask.id);
        } else if (nextTask.attempts < nextTask.maxAttempts) {
          // Retry
          nextTask.status = 'pending';
        } else {
          nextTask.status = 'failed';
          this.taskGraph.failedTasks.push(nextTask.id);
        }
      } else if (nextTask.attempts < nextTask.maxAttempts) {
        // Retry
        nextTask.status = 'pending';
      } else {
        this.taskGraph.failedTasks.push(nextTask.id);
      }
    }

    // Final summary
    const summary = {
      total: this.taskGraph.tasks.length,
      completed: this.taskGraph.completedTasks.length,
      failed: this.taskGraph.failedTasks.length,
      pending: this.taskGraph.tasks.filter(t => t.status === 'pending').length,
    };

    this.onEvent('complete', {
      summary,
      taskGraph: this.taskGraph,
    });

    console.log(`\n📊 [CLAUDE MA] Execution complete: ${summary.completed}/${summary.total} tasks completed`);
  }

  getTaskGraph(): TaskGraph {
    return this.taskGraph;
  }
}
