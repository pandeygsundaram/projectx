import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task, TaskStatus, TaskStore } from '../task-store';
import { v4 as uuidv4 } from 'uuid';

export interface TaskPlan {
  tasks: Task[];
  rootTaskIds: string[];
}

export class TaskPlannerAgent {
  private model: any;

  constructor(apiKey: string, modelName: string = 'gemini-2.0-flash-exp') {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: modelName });
  }

  async planTasks(userPrompt: string, context?: string): Promise<TaskPlan> {
    const planningPrompt = `You are a task planning agent. Break down the following user request into a dependency graph of tasks.

User Request: ${userPrompt}

${context ? `Context:\n${context}\n` : ''}

CRITICAL WORKING DIRECTORY RULES:
- ALL tasks MUST work ONLY in the /app/react-templete folder
- Tasks can READ from /app/mario (2D examples) or /app/3d-test-threejs (3D examples) for inspiration
- NEVER plan tasks that create, write, or modify files outside of /app/react-templete
- NEVER plan tasks that create new folders outside of /app/react-templete

Instructions:
1. Analyze the user request and break it down into discrete, executable tasks
2. Identify dependencies between tasks (which tasks must complete before others)
3. Each task should be specific and actionable
4. Ensure all tasks respect the working directory rules above
5. Return a JSON object with the following structure:

{
  "tasks": [
    {
      "id": "task-1",
      "description": "Detailed description of the task",
      "dependencies": []
    },
    {
      "id": "task-2",
      "description": "Another task that depends on task-1",
      "dependencies": ["task-1"]
    }
  ]
}

IMPORTANT:
- Use sequential IDs like "task-1", "task-2", etc.
- dependencies should be an array of task IDs
- Tasks with no dependencies can run first
- Be specific and actionable in task descriptions
- Limit to 10 tasks maximum for efficiency
- Return ONLY the JSON object, no additional text

Now create the task plan:`;

    try {
      const result = await this.model.generateContent(planningPrompt);
      const response = result.response.text();

      // Extract JSON from the response
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\s*/g, '').replace(/```\s*$/g, '');
      }

      const parsed = JSON.parse(jsonStr);

      // Convert to Task objects
      const tasks: Task[] = parsed.tasks.map((t: any) => ({
        id: t.id || uuidv4(),
        description: t.description,
        status: TaskStatus.PENDING,
        dependencies: t.dependencies || [],
        attempts: 0,
        maxAttempts: 3,
        toolCalls: [],
      }));

      // Find root tasks (tasks with no dependencies)
      const rootTaskIds = tasks
        .filter((t) => t.dependencies.length === 0)
        .map((t) => t.id);

      return {
        tasks,
        rootTaskIds,
      };
    } catch (error: any) {
      console.error('Error planning tasks:', error.message);

      // Fallback: create a single task
      const fallbackTask: Task = {
        id: 'task-1',
        description: userPrompt,
        status: TaskStatus.PENDING,
        dependencies: [],
        attempts: 0,
        maxAttempts: 3,
        toolCalls: [],
      };

      return {
        tasks: [fallbackTask],
        rootTaskIds: ['task-1'],
      };
    }
  }

  async replanFromError(
    failedTask: Task,
    taskStore: TaskStore,
    errorMessage: string
  ): Promise<Task[]> {
    const remainingTasks = taskStore.getTasksByStatus(TaskStatus.PENDING);

    const replanPrompt = `A task has failed during execution. Analyze the error and create new tasks to recover.

Failed Task: ${failedTask.description}
Error: ${errorMessage}

Remaining Tasks:
${remainingTasks.map((t) => `- ${t.id}: ${t.description}`).join('\n')}

Instructions:
1. Analyze why the task failed
2. Create corrective tasks to fix the issue
3. Return a JSON array of new tasks to insert before continuing

Return format:
{
  "tasks": [
    {
      "id": "fix-1",
      "description": "Task to fix the error",
      "dependencies": []
    }
  ]
}

Return ONLY the JSON object:`;

    try {
      const result = await this.model.generateContent(replanPrompt);
      const response = result.response.text();

      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\s*/g, '').replace(/```\s*$/g, '');
      }

      const parsed = JSON.parse(jsonStr);

      return parsed.tasks.map((t: any) => ({
        id: t.id || uuidv4(),
        description: t.description,
        status: TaskStatus.PENDING,
        dependencies: t.dependencies || [],
        attempts: 0,
        maxAttempts: 3,
        toolCalls: [],
      }));
    } catch (error) {
      return [];
    }
  }
}
