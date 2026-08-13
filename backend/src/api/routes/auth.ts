import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../../application/commands/authenticateUser.js";
import { ValidationAppError } from "../../core/errors/index.js";
import { requireAuth } from "../dependencies/auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/api/auth/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationAppError(parsed.error.issues[0]?.message ?? "Invalid login payload.");
    }
    const result = await authenticate(parsed.data.username, parsed.data.password);
    res.status(200).json({ access_token: result.accessToken, token_type: result.tokenType });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/api/auth/me", requireAuth, (req, res) => {
  res.status(200).json(req.user);
});
