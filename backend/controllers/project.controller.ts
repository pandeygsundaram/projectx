import { Request, Response } from 'express';
import prisma from '../config/database';
import {
  createProjectPod,
  deleteProjectPod,
  getProjectPodStatus,
  getPodStatus,
  getPodLogs,
  getPreviewUrl,
  getProjectFileTree,
  readProjectFile,
  buildProject,
  copyBuiltFilesFromPod,
} from '../services/kubernetes';
import { uploadDeployment } from '../utils/r2Storage';
import { restoreProjectSnapshot, hasProjectSnapshots } from '../services/snapshot';

const PREVIEW_DOMAIN = 'projects.samosa.wtf';
const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2000; // 2 seconds

// Check if user has an active running pod
async function getUserActivePod(userId: string) {
  return prisma.project.findFirst({
    where: {
      userId,
      status: { in: ['initializing', 'building', 'ready'] },
      deletedAt: null,
    },
  });
}

// Create a new project
export const createProject = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, prompt , } = req.body;

    // Check if user already has an active pod
    const activePod = await getUserActivePod(userId);
    if (activePod) {
      return res.status(409).json({
        error: 'You already have an active project running',
        activeProject: {
          id: activePod.id,
          name: activePod.name,
          status: activePod.status,
          previewUrl: getPreviewUrl(activePod.id),
        },
      });
    }

    // Create project in database
    const project = await prisma.project.create({
      data: {
        userId,
        name: name || 'Untitled Project',
        status: 'initializing',
      },
    });

    try {
      // Create K8s deployment
      const previewUrl = await createProjectPod({
        projectId: project.id,
        template: project.gameType as '2d' | '3d',
      });

      // Update project with pod info
      await prisma.project.update({
        where: { id: project.id },
        data: {
          status: 'building',
          podName: project.id,
          serviceName: project.id,
        },
      });


      // now here take the user prompts and make sure they run nicely in the 
      // pod !!
      // and then the response is streamed from the frontend!





      res.status(201).json({
        project: {
          id: project.id,
          name: project.name,
          status: 'building',
          previewUrl,
        },
        message: 'Project created. Pod is starting up...',
      });
    } catch (k8sError) {
      // Rollback: mark project as error
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'error' },
      });
      throw k8sError;
    }
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
};

// Open an existing project
export const openProject = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    // Find the project
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if already running
    if (['initializing', 'building', 'ready'].includes(project.status)) {
      return res.status(200).json({
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          previewUrl: getPreviewUrl(project.id),
        },
        message: 'Project is already running',
      });
    }

    // Check if user has another active pod
    const activePod = await getUserActivePod(userId);
    if (activePod && activePod.id !== id) {
      return res.status(409).json({
        error: 'You already have another project running',
        activeProject: {
          id: activePod.id,
          name: activePod.name,
          status: activePod.status,
          previewUrl: getPreviewUrl(activePod.id),
        },
      });
    }

    // Start the pod
    // For now, we'll use the default template. Later, we'll pull from R2
    const previewUrl = await createProjectPod({
      projectId: project.id,
        template: project.gameType as '2d' | '3d',
    });

    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'building',
        podName: project.id,
        serviceName: project.id,
        lastActivityAt: new Date(),
      },
    });

    res.status(200).json({
      project: {
        id: project.id,
        name: project.name,
        status: 'building',
        previewUrl,
      },
      message: 'Project is starting up...',
    });
  } catch (error) {
    console.error('Open project error:', error);
    res.status(500).json({ error: 'Failed to open project' });
  }
};

// Stop a running project
export const stopProject = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Delete K8s resources
    await deleteProjectPod(project.id);

    // Update status
    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'hibernated',
        podName: null,
        serviceName: null,
      },
    });

    res.status(200).json({ message: 'Project stopped successfully' });
  } catch (error) {
    console.error('Stop project error:', error);
    res.status(500).json({ error: 'Failed to stop project' });
  }
};

// Get all projects for user
export const listProjects = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const projects = await prisma.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        template: true,
        createdAt: true,
        lastActivityAt: true,
      },
    });

    const projectsWithUrls = projects.map((p) => ({
      ...p,
      previewUrl: ['initializing', 'building', 'ready'].includes(p.status)
        ? getPreviewUrl(p.id)
        : null,
    }));

    res.status(200).json(projectsWithUrls);
  } catch (error) {
    console.error('List projects error:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
};

// Get single project
export const getProject = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check pod status if running
    let podStatus = null;
    if (project.podName) {
      podStatus = await getProjectPodStatus(project.id);
    }

    res.status(200).json({
      ...project,
      podStatus,
      previewUrl: ['initializing', 'building', 'ready'].includes(project.status)
        ? getPreviewUrl(project.id)
        : null,
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
};

// Delete project
export const deleteProject = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Delete K8s resources if running
    await deleteProjectPod(project.id);

    // Soft delete
    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        podName: null,
        serviceName: null,
      },
    });

    res.status(200).json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
};

// SSE helper
function sendSSE(res: Response, event: string, data: object) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Shared polling logic for pod readiness
async function pollPodUntilReady(
  projectId: string,
  res: Response,
  previewUrl: string,
  timeoutMs: number = STREAM_TIMEOUT_MS
): Promise<void> {
  let lastStage = 'deploying';
  let seenLogs = '';
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const pollInterval = setInterval(async () => {
      // Timeout check
      if (Date.now() - startTime > timeoutMs) {
        sendSSE(res, 'error', { error: 'Timeout waiting for pod to be ready' });
        clearInterval(pollInterval);
        reject(new Error('Timeout'));
        return;
      }

      try {
        const podStatus = await getPodStatus(projectId);

        if (!podStatus) {
          if (lastStage !== 'scheduling') {
            lastStage = 'scheduling';
            sendSSE(res, 'stage', { stage: 'scheduling', message: 'Waiting for pod to be scheduled...' });
          }
          return;
        }

        // Check container state
        if (podStatus.containerState === 'ContainerCreating' && lastStage !== 'pulling_image') {
          lastStage = 'pulling_image';
          sendSSE(res, 'stage', { stage: 'pulling_image', message: 'Pulling container image...' });
          return;
        }

        // Container is running, check logs
        if (podStatus.phase === 'Running') {
          const logs = await getPodLogs(projectId, 120);

          if (logs !== seenLogs) {
            seenLogs = logs;
            const detectedStage = detectStageFromLogs(logs);

            if (detectedStage && detectedStage !== lastStage) {
              lastStage = detectedStage;

              if (detectedStage === 'ready') {
                await prisma.project.update({
                  where: { id: projectId },
                  data: { status: 'ready' },
                });

                sendSSE(res, 'stage', {
                  stage: 'ready',
                  message: 'Project is ready!',
                  previewUrl,
                  projectId,
                });

                clearInterval(pollInterval);
                resolve();
                return;
              }

              const messages: Record<string, string> = {
                starting: 'Container starting...',
                cloning_repo: 'Cloning repository...',
                installing_deps: 'Installing dependencies...',
              };

              sendSSE(res, 'stage', {
                stage: detectedStage,
                message: messages[detectedStage] || 'Processing...',
              });
            }
          }
        }
      } catch (error) {
        console.error('Poll error:', error);
      }
    }, POLL_INTERVAL_MS);
  });
}

// Detect stage from logs
function detectStageFromLogs(logs: string): string | null {
  if (logs.includes('Starting dev server') || logs.includes('VITE') || logs.includes('Local:')) {
    return 'ready';
  }
  if (logs.includes('npm install') || logs.includes('Installing dependencies')) {
    return 'installing_deps';
  }
  if (logs.includes('Cloning repo') || logs.includes('git clone')) {
    return 'cloning_repo';
  }
  if (logs.includes('Installing git')) {
    return 'starting';
  }
  return null;
}

// Create project with SSE streaming
export const createProjectStream = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { name, prompt, gameType = '3d' } = req.body;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Check if user already has an active pod
  const activePod = await getUserActivePod(userId);
  if (activePod) {
    sendSSE(res, 'error', {
      error: 'You already have an active project running',
      activeProject: {
        id: activePod.id,
        name: activePod.name,
        previewUrl: getPreviewUrl(activePod.id),
      },
    });
    return res.end();
  }

  sendSSE(res, 'stage', { stage: 'creating_project', message: 'Creating project...' });

  let project;
  try {
    project = await prisma.project.create({
      data: {
        userId,
        name: name || 'Untitled Project',
        status: 'initializing',
        gameType: gameType || '3d',
      },
    });
  } catch (error) {
    sendSSE(res, 'error', { error: 'Failed to create project in database' });
    return res.end();
  }

  sendSSE(res, 'stage', { stage: 'deploying', message: 'Creating deployment...' });

  try {
    await createProjectPod({ projectId: project.id ,   template: project.gameType as '2d' | '3d',});

    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'building',
        podName: project.id,
        serviceName: project.id,
      },
    });
  } catch (error) {
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'error' },
    });
    sendSSE(res, 'error', { error: 'Failed to create Kubernetes deployment' });
    return res.end();
  }

  const previewUrl = getPreviewUrl(project.id);

  // Use shared polling logic
  try {
    await pollPodUntilReady(project.id, res, previewUrl);
    res.end();
  } catch (error) {
    // Error already sent via SSE
    res.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    // Polling will be cleaned up by Promise rejection
  });
};

// Open existing project with SSE streaming (for resume)
export const openProjectStream = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { id } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Find the project
  const project = await prisma.project.findFirst({
    where: { id, userId, deletedAt: null },
  });

  if (!project) {
    sendSSE(res, 'error', { error: 'Project not found' });
    return res.end();
  }

  // Check if already running
  if (['initializing', 'building', 'ready'].includes(project.status)) {
    sendSSE(res, 'stage', {
      stage: 'ready',
      message: 'Project is already running',
      previewUrl: getPreviewUrl(project.id),
      projectId: project.id,
    });
    return res.end();
  }

  // Check if user has another active pod
  const activePod = await getUserActivePod(userId);
  if (activePod && activePod.id !== id) {
    sendSSE(res, 'error', {
      error: 'You already have another project running',
      activeProject: {
        id: activePod.id,
        name: activePod.name,
        previewUrl: getPreviewUrl(activePod.id),
      },
    });
    return res.end();
  }

  sendSSE(res, 'stage', { stage: 'deploying', message: 'Starting project...' });

  // Start the pod
  try {
    await createProjectPod({ projectId: project.id ,   template: project.gameType as '2d' | '3d',});

    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'building',
        podName: project.id,
        serviceName: project.id,
        lastActivityAt: new Date(),
      },
    });

    // Check if there's a snapshot to restore
    const hasSnapshot = await hasProjectSnapshots(project.id);
    if (hasSnapshot) {
      sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Restoring from snapshot...' });
      console.log(`📥 [RESUME] Restoring project ${project.id} from snapshot...`);

      try {
        const restored = await restoreProjectSnapshot(project.id);
        if (restored) {
          console.log(`✅ [RESUME] Project ${project.id} restored from snapshot`);
          sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Snapshot restored, starting project...' });
        }
      } catch (snapshotError) {
        console.error(`⚠️  [RESUME] Failed to restore snapshot for ${project.id}:`, snapshotError);
        sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Snapshot restore failed, using default template...' });
        // Continue without snapshot
      }
    }
  } catch (error) {
    await prisma.project.update({
      where: { id: project.id },
      data: { status: 'error' },
    });
    sendSSE(res, 'error', { error: 'Failed to start Kubernetes deployment' });
    return res.end();
  }

  const previewUrl = getPreviewUrl(project.id);

  // Use shared polling logic
  try {
    await pollPodUntilReady(project.id, res, previewUrl);
    res.end();
  } catch (error) {
    // Error already sent via SSE
    res.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    // Polling will be cleaned up by Promise rejection
  });
};

// Get project file tree
export const getProjectFiles = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if project is running
    if (!['building', 'ready'].includes(project.status)) {
      return res.status(400).json({ error: 'Project is not running' });
    }

    const fileTree = await getProjectFileTree(project.id);
    res.status(200).json(fileTree);
  } catch (error) {
    console.error('Get project files error:', error);
    res.status(500).json({ error: 'Failed to get project files' });
  }
};

// Get specific file content
export const getProjectFileContent = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if project is running
    if (!['building', 'ready'].includes(project.status)) {
      return res.status(400).json({ error: 'Project is not running' });
    }

    const content = await readProjectFile(project.id, filePath);
    res.status(200).json({ path: filePath, content });
  } catch (error) {
    console.error('Get file content error:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
};

// Deploy project (build and upload to R2)
export const deployProject = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if project is running
    if (!['building', 'ready'].includes(project.status)) {
      return res.status(400).json({
        error: 'Project must be running to deploy',
      });
    }

    // Update build status to 'building'
    await prisma.project.update({
      where: { id: project.id },
      data: { buildStatus: 'building' },
    });

    try {
      // Step 1: Build the project in the pod
      console.log(`🔨 Starting build for project ${project.id}...`);
      await buildProject(project.id);

      // Step 2: Copy built files from pod to server
      console.log(`📦 Copying built files for project ${project.id}...`);
      const files = await copyBuiltFilesFromPod(project.id);

      if (files.length === 0) {
        throw new Error('No files found in build output');
      }

      // Step 3: Upload to R2
      console.log(`🚀 Uploading deployment for project ${project.id}...`);
      const deploymentResult = await uploadDeployment(project.id, files);

      // Step 4: Update project with deployment info
      await prisma.project.update({
        where: { id: project.id },
        data: {
          deploymentUrl: deploymentResult.deploymentUrl,
          deployedAt: new Date(),
          buildStatus: 'success',
        },
      });

      res.status(200).json({
        message: 'Deployment successful',
        deploymentUrl: deploymentResult.deploymentUrl,
        filesUploaded: deploymentResult.filesUploaded,
      });
    } catch (error: any) {
      // Update build status to 'failed'
      await prisma.project.update({
        where: { id: project.id },
        data: { buildStatus: 'failed' },
      });

      console.error('Deployment error:', error);
      throw error;
    }
  } catch (error: any) {
    console.error('Deploy project error:', error);
    res.status(500).json({
      error: 'Failed to deploy project',
      details: error.message,
    });
  }
};

// Deploy project with SSE streaming
export const deployProjectStream = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { id } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      sendSSE(res, 'error', { error: 'Project not found' });
      return res.end();
    }

    // Check if project is running
    if (!['building', 'ready'].includes(project.status)) {
      sendSSE(res, 'error', {
        error: 'Project must be running to deploy',
      });
      return res.end();
    }

    // Update build status
    await prisma.project.update({
      where: { id: project.id },
      data: { buildStatus: 'building' },
    });

    sendSSE(res, 'stage', {
      stage: 'building',
      message: 'Building project...',
    });

    try {
      // Step 1: Build
      await buildProject(project.id);
      sendSSE(res, 'stage', {
        stage: 'build_complete',
        message: 'Build completed successfully',
      });

      // Step 2: Copy files
      sendSSE(res, 'stage', {
        stage: 'copying',
        message: 'Copying built files...',
      });
      const files = await copyBuiltFilesFromPod(project.id);

      if (files.length === 0) {
        throw new Error('No files found in build output');
      }

      sendSSE(res, 'stage', {
        stage: 'files_copied',
        message: `Copied ${files.length} files`,
      });

      // Step 3: Upload to R2
      sendSSE(res, 'stage', {
        stage: 'uploading',
        message: 'Uploading to R2...',
      });
      const deploymentResult = await uploadDeployment(project.id, files);

      // Step 4: Update project
      await prisma.project.update({
        where: { id: project.id },
        data: {
          deploymentUrl: deploymentResult.deploymentUrl,
          deployedAt: new Date(),
          buildStatus: 'success',
        },
      });

      sendSSE(res, 'complete', {
        message: 'Deployment successful',
        deploymentUrl: deploymentResult.deploymentUrl,
        filesUploaded: deploymentResult.filesUploaded,
      });

      res.end();
    } catch (error: any) {
      // Update build status
      await prisma.project.update({
        where: { id: project.id },
        data: { buildStatus: 'failed' },
      });

      sendSSE(res, 'error', {
        error: 'Deployment failed',
        details: error.message,
      });
      res.end();
    }
  } catch (error) {
    sendSSE(res, 'error', { error: 'Failed to deploy project' });
    res.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected from deployment stream');
  });
};
