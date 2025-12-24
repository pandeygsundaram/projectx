import { Router } from 'express';
import { chatWithProject, getProjectConversations } from '../controllers/chat.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get conversation history for a project
router.get('/:projectId', getProjectConversations);

// Chat with AI assistant for a project
router.post('/', chatWithProject);

export default router;
