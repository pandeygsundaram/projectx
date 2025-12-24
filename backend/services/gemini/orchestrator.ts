import { TaskStore, TaskStatus, Task } from './task-store';
import { TaskPlannerAgent } from './agents/task-planner';
import { TaskExecutorAgent } from './agents/task-executor';
import { ResultVerifierAgent } from './agents/result-verifier';
import { ErrorFixerAgent } from './agents/error-fixer';
import { ExecutionResult } from './agents/task-executor';
import { VerificationResult } from './agents/result-verifier';

export interface OrchestratorConfig {
  apiKey: string;
  modelName?: string;
  projectId: string;
  projectPath: string;
  maxTaskAttempts?: number;
  enableVerification?: boolean;
  enableAutoFix?: boolean;
  taskHistory?: string;
  onEvent?: (event: string, data: any) => void;
}

export class AgentOrchestrator {
  private taskStore: TaskStore;
  private taskPlanner: TaskPlannerAgent;
  private taskExecutor: TaskExecutorAgent;
  private resultVerifier: ResultVerifierAgent;
  private errorFixer: ErrorFixerAgent;

  private config: Required<OrchestratorConfig>;
  private executionResults: Map<string, ExecutionResult> = new Map();
  private verificationResults: Map<string, VerificationResult> = new Map();

  constructor(config: OrchestratorConfig) {
    this.config = {
      apiKey: config.apiKey,
      modelName: config.modelName || 'gemini-2.0-flash-exp',
      projectId: config.projectId,
      projectPath: config.projectPath,
      maxTaskAttempts: config.maxTaskAttempts || 3,
      enableVerification: config.enableVerification !== false,
      enableAutoFix: config.enableAutoFix !== false,
      taskHistory: config.taskHistory || '',
      onEvent: config.onEvent || (() => {}),
    };

    this.taskStore = new TaskStore();
    this.taskPlanner = new TaskPlannerAgent(this.config.apiKey, this.config.modelName);
    this.taskExecutor = new TaskExecutorAgent(this.config.apiKey, this.config.modelName);
    this.resultVerifier = new ResultVerifierAgent(this.config.apiKey, this.config.modelName);
    this.errorFixer = new ErrorFixerAgent(this.config.apiKey, this.config.modelName);
  }

  async run(userPrompt: string, context?: string): Promise<void> {
    this.config.onEvent('status', { message: 'Creating task plan...' });

    // Step 1: Task Planning
    const fullContext = context ? `${context}\n\n${this.config.taskHistory || ''}` : this.config.taskHistory || '';
    const taskPlan = await this.taskPlanner.planTasks(userPrompt, fullContext);

    this.config.onEvent('plan', {
      totalTasks: taskPlan.tasks.length,
      tasks: taskPlan.tasks.map(t => ({ id: t.id, description: t.description })),
    });

    // Add tasks to store
    taskPlan.tasks.forEach((task) => this.taskStore.addTask(task));
    this.taskStore.setRootTasks(taskPlan.rootTaskIds);

    // Step 2: Execute tasks
    let iteration = 0;
    const maxIterations = 50;

    while (!this.taskStore.areAllTasksCompleted() && iteration < maxIterations) {
      iteration++;

      const nextTask = this.taskStore.getNextExecutableTask();

      if (!nextTask) {
        // Deadlock - mark remaining tasks as failed
        const pending = this.taskStore.getTasksByStatus(TaskStatus.PENDING);
        pending.forEach((t) => {
          this.taskStore.markTaskFailed(t.id, 'Deadlock: dependencies not satisfied');
        });
        break;
      }

      this.config.onEvent('task_start', {
        taskId: nextTask.id,
        description: nextTask.description,
      });

      // Mark as in progress
      this.taskStore.updateTask(nextTask.id, { status: TaskStatus.IN_PROGRESS });

      // Execute the task with full context including task history
      const executionResult = await this.taskExecutor.executeTask(nextTask, fullContext);

      this.executionResults.set(nextTask.id, executionResult);

      // Send tool calls to frontend
      if (executionResult.toolCalls && executionResult.toolCalls.length > 0) {
        executionResult.toolCalls.forEach((tc) => {
          this.config.onEvent('tool', {
            name: tc.tool,
            input: tc.args,
          });
        });
      }

      if (!executionResult.success) {
        this.config.onEvent('task_failed', {
          taskId: nextTask.id,
          error: executionResult.error,
        });

        // Attempt retry or mark as failed
        if (nextTask.attempts < this.config.maxTaskAttempts) {
          this.taskStore.updateTask(nextTask.id, {
            attempts: nextTask.attempts + 1,
            status: TaskStatus.PENDING,
          });
        } else {
          this.taskStore.markTaskFailed(nextTask.id, executionResult.error || 'Unknown error');
        }

        continue;
      }

      this.config.onEvent('task_executed', {
        taskId: nextTask.id,
        result: executionResult.result,
      });

      // Step 3: Verify result (if enabled)
      if (this.config.enableVerification) {
        this.config.onEvent('status', { message: 'Verifying task result...' });
        this.taskStore.updateTask(nextTask.id, { status: TaskStatus.VERIFYING });

        const verificationResult = await this.resultVerifier.verifyResult(
          nextTask,
          executionResult,
          fullContext
        );

        this.verificationResults.set(nextTask.id, verificationResult);

        this.config.onEvent('task_verified', {
          taskId: nextTask.id,
          isCorrect: verificationResult.isCorrect,
          feedback: verificationResult.feedback,
        });

        if (!verificationResult.isCorrect && this.config.enableAutoFix) {
          // Step 4: Fix error
          this.config.onEvent('status', { message: 'Attempting to fix error...' });
          this.taskStore.updateTask(nextTask.id, { status: TaskStatus.FIXING });

          const fixResult = await this.errorFixer.attemptFix(
            nextTask,
            executionResult,
            verificationResult,
            fullContext
          );

          if (fixResult.success) {
            this.config.onEvent('task_fixed', {
              taskId: nextTask.id,
              result: fixResult.result,
            });

            this.taskStore.updateTask(nextTask.id, {
              status: TaskStatus.COMPLETED,
              result: fixResult.result,
              toolCalls: [...executionResult.toolCalls, ...fixResult.toolCalls],
            });
          } else {
            if (nextTask.attempts < this.config.maxTaskAttempts) {
              this.taskStore.updateTask(nextTask.id, {
                attempts: nextTask.attempts + 1,
                status: TaskStatus.PENDING,
              });
            } else {
              this.taskStore.markTaskFailed(
                nextTask.id,
                `Verification failed: ${verificationResult.feedback}`
              );
            }
          }
        } else if (!verificationResult.isCorrect) {
          this.taskStore.markTaskFailed(
            nextTask.id,
            `Verification failed: ${verificationResult.feedback}`
          );
        } else {
          this.taskStore.updateTask(nextTask.id, {
            status: TaskStatus.COMPLETED,
            result: executionResult.result,
            toolCalls: executionResult.toolCalls,
            verificationResult,
          });
        }
      } else {
        // No verification, mark as completed
        this.taskStore.updateTask(nextTask.id, {
          status: TaskStatus.COMPLETED,
          result: executionResult.result,
          toolCalls: executionResult.toolCalls,
        });
      }
    }

    // Final summary
    const summary = this.taskStore.getSummary();
    this.config.onEvent('complete', {
      summary,
      failedTasks: this.taskStore.getTasksByStatus(TaskStatus.FAILED).map(t => ({
        id: t.id,
        description: t.description,
        error: t.error,
      })),
    });
  }

  getTaskStore(): TaskStore {
    return this.taskStore;
  }

  getExecutionResults(): Map<string, ExecutionResult> {
    return this.executionResults;
  }

  getVerificationResults(): Map<string, VerificationResult> {
    return this.verificationResults;
  }
}
