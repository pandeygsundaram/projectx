import * as fs from 'fs/promises';
import * as path from 'path';

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  VERIFYING = 'verifying',
  FIXING = 'fixing',
}

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  dependencies: string[]; // IDs of tasks that must complete before this one
  result?: string;
  error?: string;
  attempts: number;
  maxAttempts: number;
  toolCalls?: Array<{
    tool: string;
    args: any;
    result: string;
  }>;
  verificationResult?: {
    isCorrect: boolean;
    feedback: string;
  };
}

export interface TaskGraph {
  tasks: Map<string, Task>;
  rootTaskIds: string[];
}

export class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private rootTaskIds: string[] = [];
  private storePath?: string;

  constructor(storePath?: string) {
    this.storePath = storePath;
  }

  // Initialize store from file (if exists)
  async load(): Promise<void> {
    if (!this.storePath) return;

    try {
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);

      this.tasks = new Map(
        parsed.tasks.map((t: any) => [t.id, t])
      );
      this.rootTaskIds = parsed.rootTaskIds;
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      this.tasks = new Map();
      this.rootTaskIds = [];
    }
  }

  // Save store to file
  async save(): Promise<void> {
    if (!this.storePath) return;

    const data = {
      tasks: Array.from(this.tasks.values()),
      rootTaskIds: this.rootTaskIds,
    };

    const dir = path.dirname(this.storePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // Add a new task
  addTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  // Get a task by ID
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  // Update a task
  updateTask(id: string, updates: Partial<Task>): void {
    const task = this.tasks.get(id);
    if (task) {
      Object.assign(task, updates);
    }
  }

  // Get all tasks
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  // Get tasks by status
  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  // Get next executable task (dependencies satisfied, status PENDING)
  getNextExecutableTask(): Task | undefined {
    return Array.from(this.tasks.values()).find((task) => {
      if (task.status !== TaskStatus.PENDING) return false;

      // Check if all dependencies are completed
      return task.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep?.status === TaskStatus.COMPLETED;
      });
    });
  }

  // Set root task IDs
  setRootTasks(taskIds: string[]): void {
    this.rootTaskIds = taskIds;
  }

  // Get task graph for visualization
  getTaskGraph(): TaskGraph {
    return {
      tasks: this.tasks,
      rootTaskIds: this.rootTaskIds,
    };
  }

  // Check if all tasks are completed
  areAllTasksCompleted(): boolean {
    return Array.from(this.tasks.values()).every(
      (t) => t.status === TaskStatus.COMPLETED || t.status === TaskStatus.FAILED
    );
  }

  // Get completion summary
  getSummary(): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    inProgress: number;
  } {
    const tasks = Array.from(this.tasks.values());
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
      failed: tasks.filter((t) => t.status === TaskStatus.FAILED).length,
      pending: tasks.filter((t) => t.status === TaskStatus.PENDING).length,
      inProgress: tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
    };
  }

  // Clear all tasks
  clear(): void {
    this.tasks.clear();
    this.rootTaskIds = [];
  }

  // Mark task as failed
  markTaskFailed(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = TaskStatus.FAILED;
      task.error = error;
    }
  }

  // Retry a failed task
  retryTask(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === TaskStatus.FAILED) {
      task.status = TaskStatus.PENDING;
      task.error = undefined;
    }
  }
}
