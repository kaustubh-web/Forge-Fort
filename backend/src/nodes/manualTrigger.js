import { z } from "zod";

// Manual Trigger: the single entry point of a workflow.
// Its output is the JSON input from the Run dialog, so later nodes can use {{nodes.<id>.output.x}}
// (or the shortcut {{input.x}}).
export const manualTrigger = {
    configSchema: z.object({}),
    requiredFields: () => [],
    execute: ({ input }) => ({ output: input ?? {} }),
};
