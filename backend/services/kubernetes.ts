import * as k8s from '@kubernetes/client-node';
import * as fs from 'fs';
import * as path from 'path';

const kc = new k8s.KubeConfig();

// loadFromDefault() checks in order:
// 1. KUBECONFIG env var (can be multiple files separated by :)
// 2. ~/.kube/config
// 3. In-cluster config (when running inside a pod)
kc.loadFromDefault();

console.log(`📦 K8s config loaded. Current context: ${kc.getCurrentContext()}`);
console.log(`   Cluster: ${kc.getCurrentCluster()?.server || 'unknown'}`);

const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const execApi = new k8s.Exec(kc);

const NAMESPACE = 'default';
const PREVIEW_DOMAIN = 'projects.samosa.wtf';
const DEFAULT_TEMPLATE_REPO = 'https://github.com/pandeygsundaram/game-template.git'; // Game template with React + Three.js
const PROJECT_DIR = '/app/react-templete'; // Directory inside pod where code is cloned

// K8s names must start with letter, so prefix project IDs
function toK8sName(projectId: string): string {
  return `proj-${projectId}`;
}

export interface PodConfig {
  projectId: string;
  gitRepo?: string;
  template: '2d' | '3d';
}

const TEMPLATE_DIR_MAP: Record<'2d' | '3d', string> = {
  '2d': 'mario',
  '3d': '3d-test-threejs', // or '3d-test-threejs'
};

export async function createProjectPod(config: PodConfig): Promise<string> {
  const { projectId, gitRepo = DEFAULT_TEMPLATE_REPO, template } = config;
  const templateDir = TEMPLATE_DIR_MAP[template];
  const k8sName = toK8sName(projectId);

  // Create Deployment
  const deployment: k8s.V1Deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: k8sName,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          project: k8sName,
        },
      },
      template: {
        metadata: {
          labels: {
            project: k8sName,
          },
        },
        spec: {
          containers: [
            {
              name: 'react-dev',
              image: 'node:22-alpine',
              ports: [{ containerPort: 5173 }],
              command: ['/bin/sh', '-c'],
              args: [
                `echo "📦 Installing git..." && \
                apk add --no-cache git && \
                echo "📥 Cloning repo..." && \
                git clone ${gitRepo} /app && \
                cd /app/react-templete && \
                echo "📦 Installing dependencies..." && \
                npm install && \
                echo "🚀 Starting dev server..." && \
                npm run dev -- --host 0.0.0.0 --port 5173`,
              ],
            },
          ],
        },
      },
    },
  };

  // Create Service
  const service: k8s.V1Service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: k8sName,
    },
    spec: {
      selector: {
        project: k8sName,
      },
      ports: [
        {
          port: 80,
          targetPort: 5173,
        },
      ],
    },
  };

  try {
    await appsApi.createNamespacedDeployment({ namespace: NAMESPACE, body: deployment });
    console.log(`✅ Deployment created: ${k8sName}`);
  } catch (error: any) {
    console.error(`❌ Failed to create deployment: ${k8sName}`);
    console.error(`   Status: ${error.response?.statusCode}`);
    console.error(`   Message: ${error.response?.body?.message || error.message}`);
    throw error;
  }

  try {
    await coreApi.createNamespacedService({ namespace: NAMESPACE, body: service });
    console.log(`✅ Service created: ${k8sName}`);
  } catch (error: any) {
    console.error(`❌ Failed to create service: ${k8sName}`);
    console.error(`   Status: ${error.response?.statusCode}`);
    console.error(`   Message: ${error.response?.body?.message || error.message}`);
    // Try to cleanup deployment
    try {
      await appsApi.deleteNamespacedDeployment({ name: k8sName, namespace: NAMESPACE });
    } catch {}
    throw error;
  }

  return `https://${k8sName}.${PREVIEW_DOMAIN}`;
}

export async function deleteProjectPod(projectId: string): Promise<void> {
  const k8sName = toK8sName(projectId);
  try {
    await appsApi.deleteNamespacedDeployment({ name: k8sName, namespace: NAMESPACE });
  } catch (e) {
    // Ignore if not found
  }

  try {
    await coreApi.deleteNamespacedService({ name: k8sName, namespace: NAMESPACE });
  } catch (e) {
    // Ignore if not found
  }
}

export async function getProjectPodStatus(projectId: string): Promise<string | null> {
  const k8sName = toK8sName(projectId);
  try {
    const deployment = await appsApi.readNamespacedDeployment({ name: k8sName, namespace: NAMESPACE });
    const status = deployment.status;

    if (status?.availableReplicas && status.availableReplicas > 0) {
      return 'ready';
    }
    if (status?.unavailableReplicas && status.unavailableReplicas > 0) {
      return 'starting';
    }
    return 'unknown';
  } catch {
    return null;
  }
}

export async function listUserDeployments(labelSelector?: string): Promise<string[]> {
  const deployments = await appsApi.listNamespacedDeployment({ namespace: NAMESPACE, labelSelector });
  return deployments.items.map((d) => d.metadata?.name).filter(Boolean) as string[];
}

export interface PodStatus {
  phase: string;
  containerState: string;
  ready: boolean;
}

export async function getPodStatus(projectId: string): Promise<PodStatus | null> {
  const k8sName = toK8sName(projectId);
  try {
    const pods = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `project=${k8sName}`,
    });

    if (pods.items.length === 0) return null;

    const pod = pods.items[0];
    const phase = pod.status?.phase || 'Unknown';
    const containerStatus = pod.status?.containerStatuses?.[0];

    let containerState = 'waiting';
    if (containerStatus?.state?.running) {
      containerState = 'running';
    } else if (containerStatus?.state?.waiting) {
      containerState = containerStatus.state.waiting.reason || 'waiting';
    } else if (containerStatus?.state?.terminated) {
      containerState = 'terminated';
    }

    return {
      phase,
      containerState,
      ready: containerStatus?.ready || false,
    };
  } catch {
    return null;
  }
}

export async function getPodLogs(projectId: string, sinceSeconds?: number): Promise<string> {
  const k8sName = toK8sName(projectId);
  try {
    const pods = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `project=${k8sName}`,
    });

    if (pods.items.length === 0) return '';

    const podName = pods.items[0].metadata?.name;
    if (!podName) return '';

    const logs = await coreApi.readNamespacedPodLog({
      name: podName,
      namespace: NAMESPACE,
      sinceSeconds: sinceSeconds || 60,
      tailLines: 50,
    });

    return logs || '';
  } catch {
    return '';
  }
}

export function getPreviewUrl(projectId: string): string {
  const k8sName = toK8sName(projectId);
  return `https://${k8sName}.${PREVIEW_DOMAIN}`;
}

// ========== FILE OPERATIONS ==========

/**
 * Execute a command in the pod and return stdout
 */
async function execCommandInPod(projectId: string, command: string[]): Promise<string> {
  const k8sName = toK8sName(projectId);

  // Get the pod name
  const res = await coreApi.listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector: `project=${k8sName}`,
  });

  if (res.items.length === 0) {
    throw new Error('Pod not found or not running');
  }

  const podName = res.items[0].metadata?.name;
  if (!podName) {
    throw new Error('Pod name not found');
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    execApi.exec(
      NAMESPACE,
      podName,
      'react-dev',
      command,
      process.stdout as any,
      process.stderr as any,
      process.stdin as any,
      false,
      (status: any) => {
        if (status.status === 'Success' || status.status === 'Failure') {
          resolve(stdout);
        } else {
          reject(new Error(stderr || 'Command execution failed'));
        }
      }
    ).then((conn: any) => {
      conn.on('message', (data: any) => {
        stdout += data.toString();
      });
      conn.on('error', (err: any) => {
        stderr += err.toString();
      });
    }).catch(reject);
  });
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

/**
 * Recursively read the project folder structure
 * Skips: node_modules, .git, .env files, etc.
 */
export async function getProjectFileTree(projectId: string): Promise<FileTreeNode[]> {
  try {
    // Use find command to recursively list all files, excluding certain directories
    const command = [
      'sh',
      '-c',
      `cd ${PROJECT_DIR} && find . -type f -o -type d | grep -v -E '(node_modules|\.git|\.env|dist|build|coverage|\.next)' | sort`
    ];

    const output = await execCommandInPod(projectId, command);

    if (!output.trim()) {
      return [];
    }

    const lines = output.trim().split('\n');
    const tree: Map<string, FileTreeNode> = new Map();
    const root: FileTreeNode[] = [];

    for (const line of lines) {
      if (!line || line === '.') continue;

      // Remove leading ./
      const cleanPath = line.replace(/^\.\//, '');
      const parts = cleanPath.split('/');
      const name = parts[parts.length - 1];

      // Determine if it's a file or directory (files usually have extensions)
      const isFile = name.includes('.');

      const node: FileTreeNode = {
        name,
        path: cleanPath,
        type: isFile ? 'file' : 'directory',
        children: isFile ? undefined : [],
      };

      tree.set(cleanPath, node);

      // Build the tree structure
      if (parts.length === 1) {
        // Root level
        root.push(node);
      } else {
        // Find parent and add as child
        const parentPath = parts.slice(0, -1).join('/');
        const parent = tree.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(node);
        }
      }
    }

    return root;
  } catch (error: any) {
    console.error('Failed to read project file tree:', error.message);
    throw new Error(`Failed to read project files: ${error.message}`);
  }
}

/**
 * Read a specific file's content from the pod
 */
export async function readProjectFile(projectId: string, filePath: string): Promise<string> {
  try {
    const fullPath = `${PROJECT_DIR}/${filePath}`;
    const content = await execCommandInPod(projectId, ['cat', fullPath]);
    return content;
  } catch (error: any) {
    console.error(`Failed to read file ${filePath}:`, error.message);
    throw new Error(`Failed to read file: ${error.message}`);
  }
}

/**
 * Write content to a file in the pod
 */
export async function writeProjectFile(projectId: string, filePath: string, content: string): Promise<void> {
  try {
    const fullPath = `${PROJECT_DIR}/${filePath}`;
    // Create parent directory if needed
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await execCommandInPod(projectId, ['mkdir', '-p', dirPath]);

    // Write file using cat with heredoc
    const escapedContent = content.replace(/'/g, "'\\''");
    await execCommandInPod(projectId, ['sh', '-c', `cat > '${fullPath}' << 'EOF'\n${escapedContent}\nEOF`]);
  } catch (error: any) {
    console.error(`Failed to write file ${filePath}:`, error.message);
    throw new Error(`Failed to write file: ${error.message}`);
  }
}

/**
 * Execute a command in the pod (exported for agent tools)
 */
export async function executeInPod(projectId: string, command: string): Promise<string> {
  return execCommandInPod(projectId, ['sh', '-c', command]);
}

// ========== DEPLOYMENT OPERATIONS ==========

/**
 * Build the project inside the pod
 * Runs npm run build synchronously and waits for completion
 */
export async function buildProject(projectId: string): Promise<string> {
  const k8sName = toK8sName(projectId);

  try {
    console.log(`🔨 Building project ${k8sName}...`);

    // Get the pod name
    const res = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `project=${k8sName}`,
    });

    if (res.items.length === 0) {
      throw new Error('Pod not found or not running');
    }

    const podName = res.items[0].metadata?.name;
    if (!podName) {
      throw new Error('Pod name not found');
    }

    // Run build command synchronously and save to log
    const command = ['sh', '-c', `cd ${PROJECT_DIR} && npm run build 2>&1 | tee /tmp/build.log`];

    const buildOutput = await new Promise<string>((resolve, reject) => {
      let output = '';

      execApi.exec(
        NAMESPACE,
        podName,
        'react-dev',
        command,
        process.stdout as any,
        process.stderr as any,
        null as any,
        false,
        (status: any) => {
          console.log(`📊 Build command completed with status:`, status.status);

          if (status.status === 'Success') {
            console.log(`✅ Build completed for ${k8sName}`);
            resolve(output);
          } else {
            console.error(`❌ Build failed for ${k8sName}`);
            reject(new Error(output || 'Build command failed'));
          }
        }
      ).then((conn: any) => {
        conn.on('data', (data: Buffer) => {
          const chunk = data.toString();
          output += chunk;
          // Log in real-time
          console.log('Build:', chunk.trim());
        });

        conn.on('error', (err: Error) => {
          console.error('Build error:', err);
        });
      }).catch(reject);
    });

    // Check if build was successful
    if (buildOutput.includes('✓ built in') || buildOutput.includes('built in')) {
      console.log(`✅ Build successful for ${k8sName}`);
      return buildOutput;
    }

    // If we reach here, build might have failed
    if (buildOutput.toLowerCase().includes('error') || buildOutput.toLowerCase().includes('failed')) {
      throw new Error(`Build failed:\n${buildOutput}`);
    }

    return buildOutput;
  } catch (error: any) {
    console.error(`Failed to build project ${k8sName}:`, error.message);
    throw new Error(`Failed to build project: ${error.message}`);
  }
}

export interface ProjectFile {
  path: string; // Relative path from dist folder
  content: Buffer;
  mimeType: string;
}

/**
 * Copy built files from pod to server using kubectl cp (via bash)
 * Returns array of files with their content and metadata
 */
export async function copyBuiltFilesFromPod(projectId: string): Promise<ProjectFile[]> {
  const k8sName = toK8sName(projectId);

  try {
    console.log(`📦 Copying built files from ${k8sName}...`);

    // Get the pod name
    const res = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `project=${k8sName}`,
    });

    if (res.items.length === 0) {
      throw new Error('Pod not found or not running');
    }

    const podName = res.items[0].metadata?.name;
    if (!podName) {
      throw new Error('Pod name not found');
    }

    // Create temp directory for this project
    const tmpDir = `/tmp/deploy-${projectId}`;

    // Clean up if exists
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    console.log(`📂 Created temp directory: ${tmpDir}`);

    // Use kubectl cp via exec command (more reliable than k8s API)
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);

    const cpCommand = `kubectl cp ${NAMESPACE}/${podName}:${PROJECT_DIR}/dist ${tmpDir}/dist -c react-dev`;
    console.log(`🔄 Running: ${cpCommand}`);

    try {
      const { stdout, stderr } = await execPromise(cpCommand);
      if (stderr && !stderr.includes('tar:')) {
        console.warn('kubectl cp stderr:', stderr);
      }
      if (stdout) {
        console.log('kubectl cp stdout:', stdout);
      }
    } catch (error: any) {
      console.error('kubectl cp error:', error.message);
      throw new Error(`Failed to copy files: ${error.message}`);
    }

    const distDir = path.join(tmpDir, 'dist');
    console.log(`✅ Copied dist folder to ${distDir}`);

    // Verify dist directory exists
    if (!fs.existsSync(distDir)) {
      throw new Error(`Dist directory not found after copy: ${distDir}`);
    }

    // Read all files from the temp directory
    const projectFiles: ProjectFile[] = [];

    function readDirRecursive(dir: string, baseDir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          readDirRecursive(fullPath, baseDir);
        } else if (entry.isFile()) {
          const content = fs.readFileSync(fullPath);
          const relativePath = path.relative(baseDir, fullPath);
          const mimeType = getMimeType(relativePath);

          projectFiles.push({
            path: relativePath,
            content,
            mimeType,
          });
        }
      }
    }

    readDirRecursive(distDir, distDir);

    console.log(`✅ Read ${projectFiles.length} files from temp directory`);

    // Fix paths for R2 deployment
    const deploymentPath = `/deployments/${projectId}/dist`;

    // Fix index.html
    const indexFile = projectFiles.find(f => f.path === 'index.html');
    if (indexFile) {
      let html = indexFile.content.toString('utf-8');
      html = html.replace(/(\s(?:src|href))="\/([^"]+)"/g, `$1="${deploymentPath}/$2"`);
      indexFile.content = Buffer.from(html, 'utf-8');
      console.log(`✅ Rewrote paths in index.html`);
    }

    // Fix JS files (they contain hardcoded asset paths)
    const jsFiles = projectFiles.filter(f => f.path.endsWith('.js'));
    for (const jsFile of jsFiles) {
      let js = jsFile.content.toString('utf-8');
      // Replace all absolute paths starting with /
      js = js.replace(/"\/assets\//g, `"${deploymentPath}/assets/`);
      js = js.replace(/"\/vite\.svg"/g, `"${deploymentPath}/vite.svg"`);
      jsFile.content = Buffer.from(js, 'utf-8');
      console.log(`✅ Rewrote paths in ${jsFile.path}`);
    }

    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned up temp directory`);

    return projectFiles;
  } catch (error: any) {
    console.error(`Failed to copy files from ${k8sName}:`, error.message);
    throw new Error(`Failed to copy built files: ${error.message}`);
  }
}

/**
 * Get MIME type based on file extension
 */
function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'eot': 'application/vnd.ms-fontobject',
    'txt': 'text/plain',
    'xml': 'application/xml',
    'webp': 'image/webp',
    'map': 'application/json', // Source maps
  };

  return mimeTypes[ext || ''] || 'application/octet-stream';
}
