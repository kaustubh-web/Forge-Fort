import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { workflowSchema } from "../schema/workflow.js";
import { executeSchema } from "../schema/execution.js";
import * as workflowController from "../controllers/workflowController.js";
import * as executionController from "../controllers/executionController.js";

const router = Router();

// Every workflow route needs a logged-in user.
router.use(requireAuth);

router.post("/", validate(workflowSchema), workflowController.create);
router.get("/", workflowController.list);
router.get("/:id", workflowController.get);
router.put("/:id", validate(workflowSchema), workflowController.update);
router.delete("/:id", workflowController.remove);
router.post("/:id/duplicate", workflowController.duplicate);
router.post("/:id/execute",validate(executeSchema),executionController.execute);
router.get("/:id/executions",executionController.listForWorkflow);

export default router;
