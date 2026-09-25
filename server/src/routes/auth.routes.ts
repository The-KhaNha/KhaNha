import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema } from '../schemas/auth.schema';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), auth.register);
authRouter.post('/login', validate(loginSchema), auth.login);
authRouter.get('/me', requireAuth, auth.me);
