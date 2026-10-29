import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import { createSafeFetch, safeFetch as realSafeFetch, SafeFetchError } from "../../src/net/safeFetch.js";
import { isPublicAddress } from "../../src/net/ipPolicy.js";

// A real HTTP server on 127.0.0.1. Production policy blocks loopback, so most tests use a client
// whose policy is "the real policy, plus exactly 127.0.0.1", and a fake DNS where
// public.test -> 127.0.0.1 (pretend public) and internal.test -> 10.0.0.5 (private).
let server;
let port;
let hits = [];

const fakeDns = {
    "public.test": ["127.0.0.1"],
    "internal.test": ["10.0.0.5"],
    "mixed.test": ["127.0.0.1", "10.0.0.5"],
};
const resolve = async (hostname) => {
    const ips = fakeDns[hostname];
    if (!ips) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return ips.map((address) => ({ address, family: 4 }));
};
const testClient = createSafeFetch({ resolve, isAllowed: (ip) => ip === "127.0.0.1" || isPublicAddress(ip) });
const base = () => `http://public.test:${port}`;

beforeAll(async () => {
    server = http.createServer((req, res) => {
        hits.push(req.url);
        const url = new URL(req.url, "http://x");
        if (url.pathname === "/json") {
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({ ok: true }));
        }
        if (url.pathname === "/echo") {
            res.setHeader("content-type", "application/json");
            let body = "";
            req.on("data", (c) => (body += c));
            return req.on("end", () => res.end(JSON.stringify({ method: req.method, headers: req.headers, body })));
        }
        if (url.pathname === "/redirect") {
            res.writeHead(Number(url.searchParams.get("status") ?? 302), { location: url.searchParams.get("to") });
            return res.end();
        }
        if (url.pathname === "/chain") {
            const n = Number(url.searchParams.get("n"));
            res.writeHead(302, { location: n > 0 ? `/chain?n=${n - 1}` : "/json" });
            return res.end();
        }
        if (url.pathname === "/big") {
            const body = Buffer.alloc(2000, "a");
            if (url.searchParams.get("length") !== "no") res.setHeader("content-length", body.length);
            return res.end(body);
        }
        if (url.pathname === "/slow") return; // never answers
        res.statusCode = 404;
        res.end("not found");
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    port = server.address().port;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
});

beforeEach(() => {
    hits = [];
});

const rejection = (promise) => promise.then(() => { throw new Error("expected a rejection"); }, (e) => e);

describe("safeFetch: allowed requests", () => {
    it("fetches through the guarded lookup and returns status, headers and body text", async () => {
        const res = await testClient(`${base()}/json`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("application/json");
        expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it("follows a redirect to an allowed host", async () => {
        const res = await testClient(`${base()}/redirect?to=/json`);
        expect(res.status).toBe(200);
        expect(res.url).toBe(`${base()}/json`);
    });

    it("turns a POST into a GET without a body after a 303", async () => {
        const res = await testClient(`${base()}/redirect?status=303&to=/echo`, { method: "POST", body: "x" });
        expect(JSON.parse(res.body).method).toBe("GET");
    });

    it("drops credentials when a redirect changes origin", async () => {
        const to = encodeURIComponent(`http://127.0.0.1:${port}/echo`);
        const res = await testClient(`${base()}/redirect?to=${to}`, {
            headers: { Authorization: "Bearer secret", "X-Keep": "yes" },
        });
        const { headers } = JSON.parse(res.body);
        expect(headers.authorization).toBeUndefined();
        expect(headers["x-keep"]).toBe("yes");
    });
});

describe("safeFetch: SSRF protection", () => {
    it("blocks loopback with the real policy, before any request reaches the server", async () => {
        const error = await rejection(realSafeFetch(`http://127.0.0.1:${port}/json`));
        expect(error).toBeInstanceOf(SafeFetchError);
        expect(error.code).toBe("BLOCKED");
        expect(hits).toEqual([]);
    });

    it("blocks localhost (resolved by real DNS) with the real policy", async () => {
        const error = await rejection(realSafeFetch(`http://localhost:${port}/json`));
        expect(error.code).toBe("BLOCKED");
        expect(hits).toEqual([]);
    });

    it.each([
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://2130706433/",
        "http://0x7f.1/",
        "http://10.0.0.1/",
    ])("blocks the IP literal %s", async (url) => {
        const error = await rejection(realSafeFetch(url));
        expect(error.code).toBe("BLOCKED");
    });

    it("blocks a hostname that resolves to a private address", async () => {
        const error = await rejection(testClient(`http://internal.test:${port}/json`));
        expect(error.code).toBe("BLOCKED");
        expect(error.message).toContain("10.0.0.5");
    });

    it("blocks a hostname if any of its addresses is private", async () => {
        const error = await rejection(testClient(`http://mixed.test:${port}/json`));
        expect(error.code).toBe("BLOCKED");
        expect(hits).toEqual([]);
    });

    it("blocks a redirect to a private hostname", async () => {
        const to = encodeURIComponent(`http://internal.test:${port}/json`);
        const error = await rejection(testClient(`${base()}/redirect?to=${to}`));
        expect(error.code).toBe("BLOCKED");
        expect(hits).toEqual([`/redirect?to=${to}`]); // the first hop ran, the second never did
    });

    it("blocks a redirect to the cloud metadata address", async () => {
        const to = encodeURIComponent("http://169.254.169.254/latest/meta-data");
        const error = await rejection(testClient(`${base()}/redirect?to=${to}`));
        expect(error.code).toBe("BLOCKED");
    });

    it.each(["file:///etc/passwd", "ftp://public.test/x", "gopher://public.test/"])("rejects the scheme in %s", async (url) => {
        const error = await rejection(testClient(url));
        expect(error.code).toBe("BAD_URL");
    });

    it("rejects a redirect to a non-http scheme", async () => {
        const error = await rejection(testClient(`${base()}/redirect?to=${encodeURIComponent("file:///etc/passwd")}`));
        expect(error.code).toBe("BAD_URL");
    });

    it("rejects an invalid URL", async () => {
        const error = await rejection(testClient("not a url"));
        expect(error.code).toBe("BAD_URL");
    });
});

describe("safeFetch: limits", () => {
    it("allows exactly maxRedirects redirects and refuses one more", async () => {
        expect((await testClient(`${base()}/chain?n=4`, { maxRedirects: 5 })).status).toBe(200); // 5 hops
        const error = await rejection(testClient(`${base()}/chain?n=5`, { maxRedirects: 5 })); // 6 hops
        expect(error.code).toBe("TOO_MANY_REDIRECTS");
    });

    it("refuses a body larger than maxBytes using Content-Length", async () => {
        const error = await rejection(testClient(`${base()}/big`, { maxBytes: 1000 }));
        expect(error.code).toBe("TOO_LARGE");
    });

    it("refuses a body larger than maxBytes without Content-Length, by counting bytes", async () => {
        const error = await rejection(testClient(`${base()}/big?length=no`, { maxBytes: 1000 }));
        expect(error.code).toBe("TOO_LARGE");
        expect((await testClient(`${base()}/big?length=no`, { maxBytes: 5000 })).body).toHaveLength(2000);
    });

    it("stops a request when the signal aborts", async () => {
        const controller = new AbortController();
        const pending = testClient(`${base()}/slow`, { signal: controller.signal });
        setTimeout(() => controller.abort(new Error("stop")), 50);
        const error = await rejection(pending);
        expect(error.message).toBe("stop");
    });
});
