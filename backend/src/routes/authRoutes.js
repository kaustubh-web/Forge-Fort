import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { registerSchema,loginSchema } from "../schema/auth.js";
import * as authController from "../controllers/authController.js";

const router = Router();

router.post("/register",authLimiter,validate(registerSchema),authController.register);
router.post("/login",authLimiter,validate(loginSchema),authController.login);
router.get("/me",requireAuth,authController.me);

export default router;

