import { Router } from 'express';
import { chatWithProject } from '../controllers/chat.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Chat with AI assistant for a project
router.post('/', chatWithProject);

export default router;
