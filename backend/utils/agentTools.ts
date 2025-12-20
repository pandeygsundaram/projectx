import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readProjectFile, writeProjectFile, executeInPod } from '../services/kubernetes';

// Factory function to create tools bound to a specific project
export function createProjectTools(projectId: string) {
  // Read File Tool - reads file from pod
  const readFileTool = tool(
    'read_file',
    'Read file contents from the project. Returns file content.',
    {
      path: z.string().describe('The file path to read (relative to project root)'),
    },
    async (args) => {
      try {
        const content = await readProjectFile(projectId, args.path);

        return {
          content: [
            {
              type: 'text',
              text: `File content of ${args.path}:\n\`\`\`\n${content}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error reading file: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Write File Tool - writes file to pod
  const writeFileTool = tool(
    'write_file',
    'Write or overwrite a file in the project. Creates parent directories if needed.',
    {
      path: z.string().describe('The file path to write (relative to project root)'),
      content: z.string().describe('The content to write to the file'),
    },
    async (args) => {
      try {
        await writeProjectFile(projectId, args.path, args.content);

      return {
        content: [
          {
            type: 'text',
            text: `✅ Successfully wrote ${args.content.split('\n').length} lines to ${args.path}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error writing file: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
  );

  // Execute Command Tool - runs command in pod
  const executeCommandTool = tool(
    'execute_command',
    'Execute a shell command in the project environment. Use for npm install, running scripts, etc.',
    {
      command: z.string().describe('The shell command to execute'),
    },
    async (args) => {
      try {
        const result = await executeInPod(projectId, args.command);

        return {
          content: [
            {
              type: 'text',
              text: `Command executed: ${args.command}\n\nOutput:\n\`\`\`\n${result}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing command: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // List Files Tool - lists files in directory
  const listFilesTool = tool(
    'list_files',
    'List files and directories in a specific path',
    {
      path: z.string().default('.').describe('The directory path to list (relative to project root)'),
    },
    async (args) => {
      try {
        const result = await executeInPod(projectId, `ls -la /app/${args.path}`);

        return {
          content: [
            {
              type: 'text',
              text: `Files in ${args.path}:\n\`\`\`\n${result}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error listing files: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get Folder Structure Tool
  const getFolderStructureTool = tool(
    'get_folder_structure',
    'Get the folder structure as a tree view',
    {
      path: z.string().default('.').describe('The directory path to show structure for'),
      depth: z.number().default(3).describe('Maximum depth to show (default 3)'),
    },
    async (args) => {
      try {
        const result = await executeInPod(
          projectId,
          `tree -L ${args.depth} -I 'node_modules|dist|build' /app/${args.path} || find /app/${args.path} -maxdepth ${args.depth} -type f`
        );

        return {
          content: [
            {
              type: 'text',
              text: `Folder structure of ${args.path}:\n\`\`\`\n${result}\n\`\`\``,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting folder structure: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return [
    readFileTool,
    writeFileTool,
    executeCommandTool,
    listFilesTool,
    getFolderStructureTool,
  ];
}
