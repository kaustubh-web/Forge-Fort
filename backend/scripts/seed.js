// Add the three SPEC example workflows (section 12) to an existing account.
//
//   npm run seed -- you@example.com
//
// Uses backend/.env (MONGODB_URI). Safe to run again: a workflow with the same name for that user
// is updated, not duplicated. The account must already exist (register in the app first), so the
// script never creates users or passwords.
import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { User } from "../src/models/User.js";
import { Workflow } from "../src/models/Workflow.js";
import { workflowSchema } from "../src/schema/workflow.js";

const EXAMPLES = ["ai-summarize.json", "http-condition.json", "http-ai.json"];

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
    console.error("Usage: npm run seed -- <email of an existing account>");
    process.exit(1);
}

await connectDB();
try {
    const user = await User.findOne({ email });
    if (!user) throw new Error(`No account for ${email}. Register in the app first.`);

    for (const file of EXAMPLES) {
        const raw = JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), "utf8"));
        // Same validation as POST /api/workflows. "input" is not part of a workflow (Zod strips
        // it), so it is printed below for the Run dialog instead.
        const workflow = workflowSchema.parse(raw);
        const saved = await Workflow.findOneAndUpdate(
            { owner: user._id, name: workflow.name },
            { ...workflow, owner: user._id },
            { upsert: true, returnDocument: "after", runValidators: true }
        );
        console.log(`  ${saved._id}  ${saved.name}`);
        console.log(`      run input: ${JSON.stringify(raw.input ?? {})}`);
    }
    console.log(`Seeded ${EXAMPLES.length} workflows for ${email}.`);
} catch (error) {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
