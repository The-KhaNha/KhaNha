import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type { RegisterInput } from '../schemas/auth.schema';
import * as authService from '../services/auth.service';
import type { BodyHandler } from '../types/http';
import { toUserDto } from '../utils/serializers';

export const register: BodyHandler<RegisterInput> = async (req, res) => {
  res.status(201).json({ user: toUserDto(await authService.register(req.body)) });
};

export const me: RequestHandler = async (req, res) => {
  const profile = await authService.getProfile(currentUser(req).id);
  res.json({ user: toUserDto(profile) });
};
