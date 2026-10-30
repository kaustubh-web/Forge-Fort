import {Router} from "express";
import {requireAuth} from "../middleware/auth.js";
import * as executionController from "../controllers/executionController.js";

const router = Router();

router.use(requireAuth);

router.get("/:id",executionController.get);
router.post("/:id/cancel",executionController.cancel);

export default router;