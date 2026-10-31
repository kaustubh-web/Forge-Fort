import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createSecretSchema, updateSecretSchema } from "../schema/secret.js";
import * as secretController from "../controllers/secretController.js";

const router = Router();

// Secrets are always the caller's own: every query filters by req.user._id.
router.use(requireAuth);

router.get("/", secretController.list);
router.post("/", validate(createSecretSchema), secretController.create);
router.put("/:name", validate(updateSecretSchema), secretController.update);
router.delete("/:name", secretController.remove);

export default router;
