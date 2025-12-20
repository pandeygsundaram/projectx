import { Router } from 'express';
import {
  createProject,
  createProjectStream,
  openProject,
  openProjectStream,
  stopProject,
  listProjects,
  getProject,
  deleteProject,
  getProjectFiles,
  getProjectFileContent,
  deployProject,
  deployProjectStream,
} from '../controllers/project.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// CRUD operations
router.get('/', listProjects);
// router.post('/', createProject); // DEPRECATED - use /stream instead
router.post('/stream', createProjectStream); // SSE streaming create
router.get('/:id', getProject);
router.delete('/:id', deleteProject);

// Pod lifecycle
// router.post('/:id/open', openProject); // DEPRECATED - use /open/stream instead
router.post('/:id/open/stream', openProjectStream); // SSE streaming open/resume
router.post('/:id/stop', stopProject);

// File operations
router.get('/:id/files', getProjectFiles); // Get file tree
router.get('/:id/file', getProjectFileContent); // Get file content with ?path=...

// Deployment operations
// router.post('/:id/deploy', deployProject); // DEPRECATED - use /deploy/stream instead
router.post('/:id/deploy/stream', deployProjectStream); // SSE streaming deploy

export default router;
