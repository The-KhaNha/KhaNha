import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { registerSchema } from '../schemas/auth.schema';

export const authRouter = Router();

// Signing in and out happens in the browser with supabase-js; the API only creates accounts and reads profiles.
authRouter.post('/register', validate(registerSchema), auth.register);
authRouter.get('/me', requireAuth, auth.me);
