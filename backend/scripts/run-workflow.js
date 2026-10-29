// Run a workflow JSON file through the real engine, without the API or the database.
//
//   npm run engine:run -- examples/diamond.json
//   npm run engine:run -- examples/diamond.json examples/diamond-error-input.json
//   npm run engine:run -- examples/diamond.json '{"status":500}'
//
// The second argument (a JSON file or JSON text) replaces the example's built-in "input".
// Set DEBUG_ENGINE=true to also see the order, edge states and decisions.
import { readFileSync, existsSync } from "node:fs";
import { runWorkflow } from "../src/engine/runWorkflow.js";

const [file, inputArg] = process.argv.slice(2);
if (!file) {
    console.error("Usage: npm run engine:run -- <workflow.json> [input.json | 'json text']");
    process.exit(1);
}

const readJson = (text, what) => {
    try {
        return JSON.parse(text);
    } catch (error) {
        console.error(`${what} is not valid JSON: ${error.message}`);
        process.exit(1);
    }
};

const workflow = readJson(readFileSync(file, "utf8"), file);
let input = workflow.input ?? {};
if (inputArg) input = readJson(existsSync(inputArg) ? readFileSync(inputArg, "utf8") : inputArg, "Input");

// Ctrl+C cancels the run the same way POST /cancel will: abort the signal, let the engine finish
// cleanly and print the partial result. A second Ctrl+C exits at once.
const controller = new AbortController();
process.once("SIGINT", () => {
    console.log("\nCancelling... (press Ctrl+C again to force quit)");
    controller.abort();
    process.once("SIGINT", () => process.exit(130));
});

try {
    const result = await runWorkflow({ workflow, input, signal: controller.signal });

    console.log(`\n${workflow.name}: ${result.status.toUpperCase()} in ${result.durationMs} ms\n`);
    result.nodes.forEach((r, i) => {
        const detail = r.skipReason ?? r.error ?? (r.branch ? `branch: ${r.branch}` : "");
        const time = r.durationMs === null ? "" : `${r.durationMs} ms`;
        console.log(`${String(i + 1).padStart(2)}. ${r.nodeId.padEnd(16)} ${r.status.padEnd(8)} ${time.padEnd(6)} ${detail}`);
    });
    if (result.logs.length) {
        console.log("\nLog:");
        for (const line of result.logs) console.log(`  [${line.nodeId}] ${line.message}`);
    }
    console.log("\nOutputs:");
    console.log(JSON.stringify(result.outputs, null, 2));
    process.exitCode = result.status === "completed" ? 0 : 1;
} catch (error) {
    // Validation errors: print every issue, like the API will return them.
    console.error(`\n${error.message}`);
    for (const issue of error.details ?? []) console.error(`  - ${issue.nodeId ?? issue.field ?? ""}: ${issue.message}`);
    process.exitCode = 1;
}
