import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createHttpRequestHandler, httpRequest, parseRetryAfter } from "../../src/nodes/httpRequest.js";
import { createSafeFetch } from "../../src/net/safeFetch.js";
import { isPublicAddress } from "../../src/net/ipPolicy.js";
import { NodeError } from "../../src/engine/errors.js";
import { runWorkflow } from "../../src/engine/runWorkflow.js";
import { nodeRegistry } from "../../src/nodes/registry.js";
import { redactHeaders, REDACTED } from "../../src/utils/redact.js";
import { node, edge, workflow, trigger, output, condition } from "../engine/fixtures.js";

// A local server stands in for the public API. The client below treats "api.test" as a public
// host that resolves to 127.0.0.1 (see tests/net/safeFetch.test.js for the SSRF cases).
let server;
let port;
let flaky = 0; // how many more times /flaky answers 503

const testClient = createSafeFetch({
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    isAllowed: (ip) => ip === "127.0.0.1" || isPublicAddress(ip),
});
const execute = createHttpRequestHandler(testClient);
const call = (config) => execute({ config, signal: new AbortController().signal });
const base = () => `http://api.test:${port}`;
const rejection = (promise) => promise.then(() => { throw new Error("expected a rejection"); }, (e) => e);

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://x");
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            if (url.pathname === "/echo") {
                res.setHeader("content-type", "application/json");
                res.setHeader("set-cookie", "session=abc");
                return res.end(JSON.stringify({ method: req.method, query: url.search, headers: req.headers, body }));
            }
            if (url.pathname === "/text") return res.end("plain text");
            if (url.pathname === "/status") {
                res.statusCode = Number(url.searchParams.get("code"));
                if (url.searchParams.get("retryAfter")) res.setHeader("retry-after", url.searchParams.get("retryAfter"));
                return res.end(JSON.stringify({ error: "nope" }));
            }
            if (url.pathname === "/flaky") {
                if (flaky > 0) {
                    flaky -= 1;
                    res.statusCode = 503;
                    return res.end("busy");
                }
                res.setHeader("content-type", "application/json");
                return res.end(JSON.stringify({ status: "ok", count: 3 }));
            }
            res.statusCode = 404;
            res.end();
        });
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    port = server.address().port;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
});

describe("httpRequest handler", () => {
    it("sends method, query, headers and a JSON body, and parses a JSON response", async () => {
        const { output } = await call({
            method: "POST",
            url: `${base()}/echo`,
            query: [{ key: "q", value: "a b&c" }, { key: "", value: "ignored" }],
            headers: [{ key: "X-Trace", value: "t1" }],
            body: '{"name":"Ann"}',
        });
        expect(output.status).toBe(200);
        expect(output.body.method).toBe("POST");
        expect(output.body.query).toBe("?q=a+b%26c");
        expect(output.body.headers["x-trace"]).toBe("t1");
        expect(output.body.headers["content-type"]).toBe("application/json");
        expect(JSON.parse(output.body.body)).toEqual({ name: "Ann" });
    });

    it("sends an object body (a whole-body expression) as JSON", async () => {
        const { output } = await call({ method: "PUT", url: `${base()}/echo`, body: { n: 1 } });
        expect(output.body.body).toBe('{"n":1}');
    });

    it("keeps a non-JSON response as text", async () => {
        expect((await call({ url: `${base()}/text` })).output.body).toBe("plain text");
    });

    it("redacts sensitive response headers in the output", async () => {
        const { output } = await call({ url: `${base()}/echo` });
        expect(output.headers["set-cookie"]).toBe(REDACTED);
        expect(output.headers["content-type"]).toBe("application/json");
    });

    it.each([429, 502, 503, 504])("marks HTTP %i as retryable", async (code) => {
        const error = await rejection(call({ url: `${base()}/status?code=${code}` }));
        expect(error).toBeInstanceOf(NodeError);
        expect(error.retryable).toBe(true);
    });

    it.each([400, 401, 404, 500])("marks HTTP %i as not retryable, with a body snippet", async (code) => {
        const error = await rejection(call({ url: `${base()}/status?code=${code}` }));
        expect(error.retryable).toBe(false);
        expect(error.message).toBe(`HTTP ${code} from api.test:${port}: {"error":"nope"}`);
    });

    it("passes Retry-After to the engine", async () => {
        const error = await rejection(call({ url: `${base()}/status?code=429&retryAfter=2` }));
        expect(error.retryAfterMs).toBe(2000);
    });

    it.each([
        [{ url: "not a url" }, 'Invalid URL: "not a url"'],
        [{ url: `http://x.test/`, headers: [{ key: "Host", value: "evil" }] }, 'Header "Host" cannot be set'],
        [{ url: `http://x.test/`, method: "POST", body: "{bad" }, "Body is not valid JSON"],
        [{ url: `http://x.test/`, method: "GET", body: "{}" }, "GET requests cannot have a body"],
    ])("rejects bad config %#", async (config, message) => {
        const error = await rejection(call(config));
        expect(error.message).toContain(message);
        expect(error.retryable).toBe(false);
    });

    it("turns an SSRF block into a non-retryable NodeError (real client)", async () => {
        const error = await rejection(httpRequest.execute({ config: { url: "http://169.254.169.254/" }, signal: new AbortController().signal }));
        expect(error).toBeInstanceOf(NodeError);
        expect(error.message).toContain("Blocked");
        expect(error.retryable).toBe(false);
    });

    it("treats a refused connection as retryable", async () => {
        // Open and close a server to get a port that nothing listens on.
        const temp = http.createServer();
        await new Promise((done) => temp.listen(0, "127.0.0.1", done));
        const closedPort = temp.address().port;
        await new Promise((done) => temp.close(done));

        const error = await rejection(call({ url: `http://api.test:${closedPort}/` }));
        expect(error.retryable).toBe(true);
        expect(error.message).toContain("ECONNREFUSED");
    });
});

describe("parseRetryAfter", () => {
    it("reads seconds and dates", () => {
        expect(parseRetryAfter("5")).toBe(5000);
        expect(parseRetryAfter(new Date(Date.now() + 3000).toUTCString())).toBeGreaterThan(1000);
        expect(parseRetryAfter("soon")).toBeNull();
        expect(parseRetryAfter(undefined)).toBeNull();
    });
});

describe("redactHeaders", () => {
    it("hides credentials and keeps the rest", () => {
        expect(redactHeaders({ Authorization: "Bearer x", "X-Api-Key": "k", "x-auth-token": "t", accept: "*/*" })).toEqual({
            Authorization: REDACTED,
            "X-Api-Key": REDACTED,
            "x-auth-token": REDACTED,
            accept: "*/*",
        });
    });
});

// The real engine with the HTTP node pointed at the local server.
describe("HTTP node inside a workflow", () => {
    const original = nodeRegistry.httpRequest.execute;
    beforeEach(() => {
        nodeRegistry.httpRequest.execute = execute;
    });
    afterEach(() => {
        nodeRegistry.httpRequest.execute = original;
    });

    it("retries 503 twice, then the Condition reads the parsed body", async () => {
        flaky = 2;
        const wf = workflow(
            [
                trigger(),
                node("http", "httpRequest", { url: `${base()}/flaky`, retry: { maxAttempts: 3, backoffMs: 1 } }),
                condition("ok", "{{nodes.http.output.body.status}}", "equals", "ok"),
                output("yes", "Count: {{nodes.http.output.body.count}}"),
                output("no", "Not ok"),
            ],
            [edge("trigger", "http"), edge("http", "ok"), edge("ok", "yes", "true"), edge("ok", "no", "false")]
        );
        const result = await runWorkflow({ workflow: wf });
        const http = result.nodes.find((r) => r.nodeId === "http");

        expect(result.status).toBe("completed");
        expect(http.attempts).toBe(3);
        expect(http.attemptLog.map((a) => a.error)).toEqual([`HTTP 503 from api.test:${port}: busy`, `HTTP 503 from api.test:${port}: busy`]);
        expect(result.outputs.yes.message).toBe("Count: 3");
        expect(result.nodes.find((r) => r.nodeId === "no").skipReason).toBe("Condition 'ok' took the true branch");
    });

    it("fails without sending a request when an expression in the URL is empty", async () => {
        let requests = 0;
        const count = () => requests++;
        server.on("request", count);
        const wf = workflow(
            [trigger(), node("http", "httpRequest", { url: `${base()}/posts/{{input.postId}}` }), output("out", "done")],
            [edge("trigger", "http"), edge("http", "out")]
        );
        const result = await runWorkflow({ workflow: wf, input: { todoId: 1 } });
        server.off("request", count);

        expect(result.status).toBe("failed");
        expect(result.error.message).toBe("URL expression {{input.postId}} is empty. Check the Run input");
        expect(result.nodes.find((r) => r.nodeId === "http").attempts).toBe(1); // not retried
        expect(requests).toBe(0);
    });

    it("names the earlier node when its output is the empty part", async () => {
        const wf = workflow(
            [trigger(), node("http", "httpRequest", { url: `${base()}/x?id={{nodes.trigger.output.id}}` })],
            [edge("trigger", "http")]
        );
        const result = await runWorkflow({ workflow: wf, input: {} });
        expect(result.error.message).toBe("URL expression {{nodes.trigger.output.id}} is empty. Check the earlier node's output");
    });
});
