import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getPodLogs } from '../kubernetes';

const execPromise = promisify(exec);

// Tool types for Gemini
export interface GeminiTool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any, projectId: string, projectPath: string) => Promise<string>;
}

// Function declarations for Gemini API
export function getToolDeclarations() {
  return allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

// Read File Tool
export const readFileTool: GeminiTool = {
  name: 'read_file',
  description: 'Read file contents from the project. For large files, returns first and last 50 lines.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path relative to /app directory',
      },
    },
    required: ['path'],
  },
  execute: async (args: { path: string }, projectId: string, projectPath: string) => {
    try {
      const fullPath = path.join(projectPath, args.path);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      if (content.length > 10000 || lines.length > 100) {
        const firstLines = lines.slice(0, 50).join('\n');
        const lastLines = lines.slice(-50).join('\n');
        const truncatedCount = lines.length - 100;

        return `File: ${args.path} (${lines.length} lines, ${content.length} chars)\n` +
               `⚠️  Large file truncated for preview\n\n` +
               `First 50 lines:\n\`\`\`\n${firstLines}\n\`\`\`\n\n` +
               `... [${truncatedCount} lines omitted] ...\n\n` +
               `Last 50 lines:\n\`\`\`\n${lastLines}\n\`\`\``;
      }

      return `File content of ${args.path}:\n\`\`\`\n${content}\n\`\`\``;
    } catch (error: any) {
      return `Error reading file: ${error.message}`;
    }
  },
};

// Write File Tool
export const writeFileTool: GeminiTool = {
  name: 'write_file',
  description: 'Write content to a file in the project. Creates the file if it does not exist.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path relative to /app directory',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (args: { path: string; content: string }, projectId: string, projectPath: string) => {
    try {
      const fullPath = path.join(projectPath, args.path);
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, args.content, 'utf-8');

      const lines = args.content.split('\n').length;
      return `✅ Successfully wrote ${lines} lines to ${args.path}`;
    } catch (error: any) {
      return `Error writing file: ${error.message}`;
    }
  },
};

// List Files Tool
export const listFilesTool: GeminiTool = {
  name: 'list_files',
  description: 'List all files in a directory with file sizes',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path relative to /app',
      },
    },
    required: ['path'],
  },
  execute: async (args: { path: string }, projectId: string, projectPath: string) => {
    try {
      const fullPath = path.join(projectPath, args.path);
      const items = await fs.readdir(fullPath, { withFileTypes: true });

      const filesWithStats = await Promise.all(
        items
          .filter((item) => item.isFile())
          .map(async (item) => {
            const stats = await fs.stat(path.join(fullPath, item.name));
            return { name: item.name, size: stats.size };
          })
      );

      const dirs = items.filter((item) => item.isDirectory()).map((item) => item.name);

      const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      };

      return `Files in ${args.path}:\n\nDirectories (${dirs.length}):\n${dirs.map(d => `  📁 ${d}/`).join('\n')}\n\nFiles (${filesWithStats.length}):\n${filesWithStats.map(f => `  📄 ${f.name} (${formatSize(f.size)})`).join('\n')}`;
    } catch (error: any) {
      return `Error listing files: ${error.message}`;
    }
  },
};

// Get Folder Structure Tool
export const getFolderStructureTool: GeminiTool = {
  name: 'get_folder_structure',
  description: 'Get the folder structure of the project directory',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path relative to /app',
      },
      max_depth: {
        type: 'number',
        description: 'Maximum depth to traverse (default: 2)',
      },
    },
    required: ['path'],
  },
  execute: async (args: { path: string; max_depth?: number }, projectId: string, projectPath: string) => {
    const maxDepth = args.max_depth || 2;

    async function buildStructure(
      dirPath: string,
      currentDepth: number,
      prefix: string = ''
    ): Promise<string> {
      if (currentDepth > maxDepth) {
        return '';
      }

      let result = '';
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      const filteredItems = items.filter(
        (item) =>
          !item.name.startsWith('.') &&
          item.name !== 'node_modules' &&
          item.name !== 'dist' &&
          item.name !== 'build'
      );

      for (let i = 0; i < filteredItems.length; i++) {
        const item = filteredItems[i]!;
        const isLast = i === filteredItems.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const newPrefix = prefix + (isLast ? '    ' : '│   ');

        result += `${prefix}${connector}${item.name}\n`;

        if (item.isDirectory()) {
          const subPath = path.join(dirPath, item.name);
          result += await buildStructure(subPath, currentDepth + 1, newPrefix);
        }
      }

      return result;
    }

    try {
      const fullPath = path.join(projectPath, args.path);
      const structure = await buildStructure(fullPath, 0);
      return `Folder structure of ${args.path} (depth: ${maxDepth}):\n\`\`\`\n${structure}\n\`\`\``;
    } catch (error: any) {
      return `Error reading folder structure: ${error.message}`;
    }
  },
};

// Get Pod Logs Tool
export const getPodLogsTool: GeminiTool = {
  name: 'get_pod_logs',
  description: 'Get recent logs from the Vite dev server pod to check for errors',
  parameters: {
    type: 'object',
    properties: {
      seconds: {
        type: 'number',
        description: 'Number of seconds of logs to retrieve (default: 60)',
      },
    },
  },
  execute: async (args: { seconds?: number }, projectId: string, projectPath: string) => {
    try {
      const seconds = args.seconds || 60;
      const logs = await getPodLogs(projectId, seconds);
      return `Recent logs (last ${seconds}s):\n\`\`\`\n${logs}\n\`\`\``;
    } catch (error: any) {
      return `Error getting pod logs: ${error.message}`;
    }
  },
};

// Execute Command Tool
export const executeCommandTool: GeminiTool = {
  name: 'execute_command',
  description: 'Execute a shell command in the project directory',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
    },
    required: ['command'],
  },
  execute: async (args: { command: string }, projectId: string, projectPath: string) => {
    try {
      const { stdout, stderr } = await execPromise(args.command, { cwd: projectPath });
      return stdout || stderr || 'Command executed successfully (no output)';
    } catch (error: any) {
      return `Error executing command: ${error.message}\nStderr: ${error.stderr || ''}`;
    }
  },
};

// Export all tools
export const allTools: GeminiTool[] = [
  readFileTool,
  writeFileTool,
  listFilesTool,
  getFolderStructureTool,
  getPodLogsTool,
  executeCommandTool,
];

// Execute tool by name
export async function executeTool(
  toolName: string,
  args: any,
  projectId: string,
  projectPath: string
): Promise<string> {
  const tool = allTools.find((t) => t.name === toolName);
  if (!tool) {
    return `Error: Tool '${toolName}' not found`;
  }
  return await tool.execute(args, projectId, projectPath);
}
