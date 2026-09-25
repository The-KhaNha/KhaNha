import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import * as authService from '../services/auth.service';
import type { BodyHandler } from '../types/http';
import { toUserDto } from '../utils/serializers';

export const register: BodyHandler<RegisterInput> = async (req, res) => {
  res.status(201).json(await authService.register(req.body));
};

export const login: BodyHandler<LoginInput> = async (req, res) => {
  res.json(await authService.login(req.body));
};

export const me: RequestHandler = async (req, res) => {
  const user = await authService.getUserById(currentUser(req).id);
  res.json({ user: toUserDto(user) });
};
