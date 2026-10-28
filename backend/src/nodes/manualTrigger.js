import { z } from "zod";

// Manual Trigger: the single entry point of a workflow.
export const manualTrigger = {
    configSchema: z.object({}),
    requiredFields: () => [],
};
