import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task } from '../task-store';
import { ExecutionResult } from './task-executor';

export interface VerificationResult {
  isCorrect: boolean;
  feedback: string;
  confidence: number; // 0-100
}

export class ResultVerifierAgent {
  private model: any;

  constructor(apiKey: string, modelName: string = 'gemini-2.0-flash-exp') {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: modelName });
  }

  async verifyResult(
    task: Task,
    executionResult: ExecutionResult,
    context?: string
  ): Promise<VerificationResult> {
    const verificationPrompt = `You are a result verification agent. Your job is to verify if a task was completed correctly.

Task Description: ${task.description}

Execution Result: ${executionResult.result}

Tool Calls Made:
${executionResult.toolCalls
  .map(
    (tc, i) => `${i + 1}. ${tc.tool}(${JSON.stringify(tc.args)})
   Result: ${tc.result.substring(0, 200)}${tc.result.length > 200 ? '...' : ''}`
  )
  .join('\n')}

${context ? `Context:\n${context}\n` : ''}

CRITICAL VERIFICATION CHECKS:
- Verify that ALL file operations were performed in /app/react-templete (or its subdirectories)
- Ensure NO files were created, written, or modified outside of /app/react-templete
- Confirm that reads from example folders (/app/mario or /app/3d-test-threejs) were READ-ONLY
- Flag as incorrect if any violations of working directory rules occurred

Instructions:
1. Analyze whether the task was completed successfully
2. Check if the tool calls were appropriate for the task
3. Verify the execution result makes sense
4. Verify all working directory rules were followed
5. Provide specific feedback on what was done well or what went wrong
6. Rate your confidence in the verification (0-100)

Return a JSON object with this exact format:
{
  "isCorrect": true or false,
  "feedback": "Detailed feedback about the execution",
  "confidence": 0-100
}

IMPORTANT: Return ONLY the JSON object, no additional text.

Verify now:`;

    try {
      const result = await this.model.generateContent(verificationPrompt);
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

      return {
        isCorrect: parsed.isCorrect,
        feedback: parsed.feedback,
        confidence: parsed.confidence || 50,
      };
    } catch (error: any) {
      console.error('Error verifying result:', error.message);

      // Fallback: assume success if no errors in execution
      return {
        isCorrect: executionResult.success,
        feedback: executionResult.success
          ? 'Task appears to have completed successfully (default verification)'
          : 'Task failed during execution',
        confidence: 30,
      };
    }
  }

  async verifyMultipleTasks(
    tasks: Task[],
    results: Map<string, ExecutionResult>,
    context?: string
  ): Promise<Map<string, VerificationResult>> {
    const verifications = new Map<string, VerificationResult>();

    for (const task of tasks) {
      const executionResult = results.get(task.id);
      if (!executionResult) continue;

      const verification = await this.verifyResult(task, executionResult, context);
      verifications.set(task.id, verification);
    }

    return verifications;
  }
}
