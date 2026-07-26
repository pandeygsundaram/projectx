import prisma from '../config/database';
import { deleteProjectPod } from './kubernetes';
import { createProjectSnapshot } from './snapshot';

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

export async function cleanupInactivePods() {
  const cutoff = new Date(Date.now() - INACTIVITY_TIMEOUT_MS);

  const inactiveProjects = await prisma.project.findMany({
    where: {
      status: { in: ['initializing', 'building', 'ready'] },
      lastActivityAt: { lt: cutoff },
      deletedAt: null,
    },
  });

  for (const project of inactiveProjects) {
    console.log(`Auto-stopping inactive pod: ${project.id} (last activity: ${project.lastActivityAt})`);

    try {
      // Create snapshot before deleting the pod
      console.log(`Creating snapshot for ${project.id} before hibernation...`);
      try {
        await createProjectSnapshot(project.id);
        console.log(`Snapshot created for ${project.id}`);
      } catch (snapshotError) {
        console.error(`Failed to create snapshot for ${project.id}:`, snapshotError);
        // Continue with hibernation even if snapshot fails
      }

      // Delete the pod
      await deleteProjectPod(project.id);

      // Update project status
      await prisma.project.update({
        where: { id: project.id },
        data: {
          status: 'hibernated',
          podName: null,
          serviceName: null,
        },
      });
      console.log(`Pod ${project.id} stopped successfully`);
    } catch (error) {
      console.error(`Failed to stop pod ${project.id}:`, error);
    }
  }

  if (inactiveProjects.length > 0) {
    console.log(`Cleanup complete: ${inactiveProjects.length} pods stopped`);
  }
}

export function startCleanupScheduler() {
  console.log('Starting pod cleanup scheduler (1h inactivity timeout)');
  setInterval(cleanupInactivePods, CLEANUP_INTERVAL_MS);
  // Run once on startup
  cleanupInactivePods();
}
