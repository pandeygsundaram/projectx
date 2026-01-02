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
  startDevServer,
  waitForPodReady,
} from '../services/kubernetes';
import { uploadDeployment } from '../utils/r2Storage';
import { restoreProjectSnapshot, hasProjectSnapshots, createProjectSnapshot } from '../services/snapshot';

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

    // Check if there's a snapshot BEFORE creating pod
    const hasSnapshot = await hasProjectSnapshots(project.id);

    // Start the pod
    const previewUrl = await createProjectPod({
      projectId: project.id,
      template: project.gameType as '2d' | '3d',
      skipAutoSetup: hasSnapshot // Skip git clone if we have snapshot
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

    // If snapshot exists, restore it then start dev server
    if (hasSnapshot) {
      console.log(`📥 [START] Restoring project ${project.id} from snapshot...`);

      try {
        const restored = await restoreProjectSnapshot(project.id);
        if (restored) {
          console.log(`✅ [START] Project ${project.id} restored from snapshot`);

          // Start the dev server
          await startDevServer(project.id);

          console.log(`✅ [START] Dev server started for ${project.id}`);
        }
      } catch (snapshotError) {
        console.error(`⚠️  [START] Failed to restore snapshot for ${project.id}:`, snapshotError);
        // Continue without snapshot - pod will use fresh template
      }
    }

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

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 [OPEN PROJECT] Resume/Open request received');
  console.log('   User ID:', userId);
  console.log('   Project ID:', id);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Find the project
  console.log('🔍 [OPEN PROJECT] Looking up project in database...');
  const project = await prisma.project.findFirst({
    where: { id, userId, deletedAt: null },
  });

  if (!project) {
    console.log('❌ [OPEN PROJECT] Project not found');
    sendSSE(res, 'error', { error: 'Project not found' });
    return res.end();
  }

  console.log('✅ [OPEN PROJECT] Project found:');
  console.log('   Name:', project.name);
  console.log('   Status:', project.status);
  console.log('   Game Type:', project.gameType);
  console.log('   Last Activity:', project.lastActivityAt);

  // Check if already running
  if (['initializing', 'building', 'ready'].includes(project.status)) {
    console.log('⚠️  [OPEN PROJECT] Project is already running - skipping resume');
    sendSSE(res, 'stage', {
      stage: 'ready',
      message: 'Project is already running',
      previewUrl: getPreviewUrl(project.id),
      projectId: project.id,
    });
    return res.end();
  }

  // Check if user has another active pod
  console.log('🔍 [OPEN PROJECT] Checking for other active pods...');
  const activePod = await getUserActivePod(userId);
  if (activePod && activePod.id !== id) {
    console.log('❌ [OPEN PROJECT] User has another active pod:', activePod.id);
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
  console.log('✅ [OPEN PROJECT] No other active pods found');

  // Check if there's a snapshot BEFORE creating pod
  console.log('🔍 [OPEN PROJECT] Checking for snapshots...');
  const hasSnapshot = await hasProjectSnapshots(project.id);
  console.log(`${hasSnapshot ? '✅' : '⚠️ '} [OPEN PROJECT] Snapshot ${hasSnapshot ? 'FOUND' : 'NOT FOUND'}`);

  sendSSE(res, 'stage', { stage: 'deploying', message: hasSnapshot ? 'Starting pod for snapshot restore...' : 'Starting project...' });

  // Start the pod
  try {
    console.log('🚀 [OPEN PROJECT] Creating Kubernetes pod...');
    console.log(`   Skip Auto Setup: ${hasSnapshot ? 'YES (will restore from snapshot)' : 'NO (fresh git clone)'}`);

    // If snapshot exists, create pod without auto-setup so we can restore first
    await createProjectPod({
      projectId: project.id,
      template: project.gameType as '2d' | '3d',
      skipAutoSetup: hasSnapshot // Skip git clone if we have snapshot
    });
    console.log('✅ [OPEN PROJECT] Pod created successfully');

    console.log('💾 [OPEN PROJECT] Updating project status to "building"...');
    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'building',
        podName: project.id,
        serviceName: project.id,
        lastActivityAt: new Date(),
      },
    });
    console.log('✅ [OPEN PROJECT] Project status updated');

    // If snapshot exists, restore it then start dev server
    if (hasSnapshot) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📥 [SNAPSHOT RESTORE] Starting snapshot restoration process...');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Wait for pod to be ready before restoring
      sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Waiting for pod to be ready...' });
      const podReady = await waitForPodReady(project.id);

      if (!podReady) {
        console.error('❌ [SNAPSHOT RESTORE] Pod did not become ready in time');
        sendSSE(res, 'error', { error: 'Pod startup timeout' });
        return res.end();
      }

      sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Restoring from snapshot...' });

      try {
        const restored = await restoreProjectSnapshot(project.id);
        if (restored) {
          console.log('✅ [SNAPSHOT RESTORE] Snapshot restored successfully');
          sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Snapshot restored, starting dev server...' });

          console.log('🚀 [DEV SERVER] Starting Vite dev server...');
          // Start the dev server
          await startDevServer(project.id);

          console.log('✅ [DEV SERVER] Dev server started successfully');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }
      } catch (snapshotError) {
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ [SNAPSHOT RESTORE] Snapshot restoration FAILED');
        console.error('   Error:', snapshotError);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Snapshot restore failed, using default template...' });
        // Continue without snapshot
      }
    } else {
      console.log('⚠️  [OPEN PROJECT] No snapshot found - pod will use fresh template from git');
    }
  } catch (error) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ [OPEN PROJECT] Pod creation FAILED');
    console.error('   Error:', error);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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

// Restart/rebuild project pod with SSE streaming
export const restartProjectStream = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { id } = req.params;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 [RESTART PROJECT] Restart request received');
  console.log('   User ID:', userId);
  console.log('   Project ID:', id);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Find the project
    console.log('🔍 [RESTART PROJECT] Looking up project in database...');
    const project = await prisma.project.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!project) {
      console.log('❌ [RESTART PROJECT] Project not found');
      sendSSE(res, 'error', { error: 'Project not found' });
      return res.end();
    }

    console.log('✅ [RESTART PROJECT] Project found:');
    console.log('   Name:', project.name);
    console.log('   Status:', project.status);
    console.log('   Game Type:', project.gameType);

    // Step 1: If pod is running, save current state to R2 BEFORE stopping
    if (['initializing', 'building', 'ready'].includes(project.status)) {
      console.log('💾 [RESTART PROJECT] Pod is running - creating snapshot of current state...');
      sendSSE(res, 'stage', { stage: 'saving', message: 'Saving current project state to R2...' });

      try {
        // Wait for pod to be ready before creating snapshot
        const podReady = await waitForPodReady(project.id, 30000);

        if (podReady) {
          const snapshotId = await createProjectSnapshot(project.id);
          console.log(`✅ [RESTART PROJECT] Snapshot created: ${snapshotId}`);
          sendSSE(res, 'stage', { stage: 'saving', message: 'Project state saved to R2' });
        } else {
          console.log('⚠️  [RESTART PROJECT] Pod not ready, skipping snapshot creation');
        }
      } catch (snapshotError: any) {
        console.error('⚠️  [RESTART PROJECT] Failed to create snapshot:', snapshotError.message);
        // Continue with restart even if snapshot fails
      }
    } else {
      // Pod is dead (error, hibernated, deleted) - skip snapshot
      console.log(`⏭️  [RESTART PROJECT] Pod status is '${project.status}' - skipping snapshot creation`);
      sendSSE(res, 'stage', { stage: 'restarting', message: `Pod is ${project.status}, restoring from previous snapshot...` });
    }

    // Step 2: Stop the pod and wait for it to be fully deleted
    console.log('🛑 [RESTART PROJECT] Stopping existing pod...');
    sendSSE(res, 'stage', { stage: 'stopping', message: 'Stopping current pod...' });

    // Wait for deletion to complete to avoid 409 AlreadyExists error
    await deleteProjectPod(project.id, true);

    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'hibernated',
        podName: null,
        serviceName: null,
      },
    });
    console.log('✅ [RESTART PROJECT] Pod stopped and fully deleted');

    // Step 3: Check if there's a snapshot (should always be true now after saving)
    console.log('🔍 [RESTART PROJECT] Checking for snapshots...');
    const hasSnapshot = await hasProjectSnapshots(project.id);
    console.log(`${hasSnapshot ? '✅' : '⚠️ '} [RESTART PROJECT] Snapshot ${hasSnapshot ? 'FOUND' : 'NOT FOUND'}`);

    sendSSE(res, 'stage', { stage: 'restarting', message: hasSnapshot ? 'Restarting pod for snapshot restore...' : 'Restarting project...' });

    // Step 4: Create the pod again (always skip auto setup since we restore from R2)
    console.log('🚀 [RESTART PROJECT] Creating new Kubernetes pod...');
    console.log(`   Skip Auto Setup: YES (will restore from R2 snapshot)`);

    await createProjectPod({
      projectId: project.id,
      template: project.gameType as '2d' | '3d',
      skipAutoSetup: true // Always skip - we restore from R2
    });
    console.log('✅ [RESTART PROJECT] Pod created successfully');

    console.log('💾 [RESTART PROJECT] Updating project status to "building"...');
    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: 'building',
        podName: project.id,
        serviceName: project.id,
        lastActivityAt: new Date(),
      },
    });
    console.log('✅ [RESTART PROJECT] Project status updated');

    // Step 5: Restore from R2 snapshot and start dev server
    if (hasSnapshot) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📥 [R2 RESTORE] Restoring project from R2 snapshot...');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      // Wait for pod to be ready before restoring
      sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Waiting for pod to be ready...' });
      const podReady = await waitForPodReady(project.id);

      if (!podReady) {
        console.error('❌ [R2 RESTORE] Pod did not become ready in time');
        sendSSE(res, 'error', { error: 'Pod startup timeout' });
        return res.end();
      }

      sendSSE(res, 'stage', { stage: 'installing_deps', message: 'Restoring from R2 snapshot...' });

      try {
        const restored = await restoreProjectSnapshot(project.id);
        if (restored) {
          console.log('✅ [R2 RESTORE] Project restored from R2 successfully');
          sendSSE(res, 'stage', { stage: 'installing_deps', message: 'R2 snapshot restored, starting dev server...' });

          console.log('🚀 [DEV SERVER] Starting Vite dev server...');
          await startDevServer(project.id);

          console.log('✅ [DEV SERVER] Dev server started successfully');

          // Wait a bit for dev server to start
          console.log('⏳ [DEV SERVER] Waiting for dev server to be ready...');
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Update project status to ready
          await prisma.project.update({
            where: { id: project.id },
            data: { status: 'ready' },
          });
          console.log('✅ [RESTART PROJECT] Project status updated to READY');

          const previewUrl = getPreviewUrl(project.id);

          // Send ready event to frontend
          sendSSE(res, 'stage', {
            stage: 'ready',
            message: 'Project restarted successfully!',
            previewUrl,
            projectId: project.id,
          });

          console.log('✅ [RESTART PROJECT] Restart completed successfully');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

          res.end();
          return;
        }
      } catch (snapshotError) {
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ [R2 RESTORE] Snapshot restoration FAILED');
        console.error('   Error:', snapshotError);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        sendSSE(res, 'error', { error: 'Failed to restore from R2 snapshot' });
        return res.end();
      }
    } else {
      console.error('❌ [RESTART PROJECT] No snapshot found - cannot restart!');
      sendSSE(res, 'error', { error: 'No snapshot found to restore from' });
      return res.end();
    }

  } catch (error) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ [RESTART PROJECT] Restart FAILED');
    console.error('   Error:', error);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Try to update project status, but don't fail if it errors
    try {
      await prisma.project.update({
        where: { id },
        data: { status: 'error' },
      });
    } catch (dbError) {
      console.error('Failed to update project status:', dbError);
    }

    sendSSE(res, 'error', { error: 'Failed to restart project' });
    res.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected from restart stream');
  });
};

// Save current project state to R2 (manual snapshot)
export const saveProjectSnapshot = async (req: Request, res: Response) => {
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
        error: 'Project must be running to save snapshot',
      });
    }

    console.log('💾 [MANUAL SNAPSHOT] Creating snapshot for project:', id);

    // Create snapshot
    const snapshotId = await createProjectSnapshot(id);

    console.log('✅ [MANUAL SNAPSHOT] Snapshot created successfully:', snapshotId);

    res.status(200).json({
      message: 'Progress saved successfully',
      snapshotId,
    });
  } catch (error: any) {
    console.error('❌ [MANUAL SNAPSHOT] Failed to save snapshot:', error);
    res.status(500).json({
      error: 'Failed to save progress',
      details: error.message,
    });
  }
};
