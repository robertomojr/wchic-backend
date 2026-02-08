import { Router } from 'express';
import { config } from '../utils/config.js';
import { signAdminToken } from '../utils/auth.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (username !== config.admin.user || password !== config.admin.pass) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signAdminToken();
  return res.json({ token });
});
