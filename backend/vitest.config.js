import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        setupFiles: ["./tests/setup.js"],
        fileParallelism: false,
        // API tests register users (bcrypt, 12 rounds: slow on purpose) and make several real HTTP
        // round trips. ~1.5 s normally, but a busy machine can triple that and hit the 5 s default.
        testTimeout: 15000,
        // Starting the in-memory MongoDB (tests/setup.js) can take a while on a cold or busy machine.
        hookTimeout: 60000,
    }
})