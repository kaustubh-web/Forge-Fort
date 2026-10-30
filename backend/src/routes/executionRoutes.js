import {Router} from "express";
import {requireAuth} from "../middleware/auth.js";
import * as executionController from "../controllers/executionController.js";
import { streamExecution } from "../controllers/streamController.js";

const router = Router();

router.use(requireAuth);

router.get("/:id",executionController.get);
router.post("/:id/cancel",executionController.cancel);
// Server-Sent Events: snapshot first, then live engine events (controllers/streamController.js).
router.get("/:id/stream", streamExecution);

export default router;