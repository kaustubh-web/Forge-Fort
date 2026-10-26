import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import { User } from "../src/models/User.js";

const creds = { email: "Alice@Test.com", password: "password123" };

// Helper: register a user and return the response body data
async function registerUser(body = creds) {
  const res = await request(app).post("/api/auth/register").send(body);
  return res.body.data;
}

describe("POST /api/auth/register", () => {
  it("creates a user, lowercases the email, and never returns the hash", async () => {
    const res = await request(app).post("/api/auth/register").send(creds);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("alice@test.com");
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("rejects a duplicate email with 409", async () => {
    await registerUser();
    const res = await request(app).post("/api/auth/register").send(creds);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects an invalid email with 400 and details", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "password123" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].field).toBe("email");
  });

  it("rejects a short password with 400", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "bob@test.com", password: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("password");
  });

  it("stores the password hashed, not in plain text", async () => {
    const { user } = await registerUser();
    const stored = await User.findById(user._id).select("+passwordHash");

    expect(stored.passwordHash).not.toBe(creds.password);
    expect(await bcrypt.compare(creds.password, stored.passwordHash)).toBe(true);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with the correct password", async () => {
    await registerUser();
    const res = await request(app).post("/api/auth/login").send(creds);

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    await registerUser();
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: creds.email, password: "wrongwrong" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.com", password: "password123" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Identical errors so an attacker cannot tell which emails are registered
    expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for a garbage token", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer abc");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    const { user } = await registerUser();
    const expired = jwt.sign({ sub: user._id }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token signed with a different secret", async () => {
    const { user } = await registerUser();
    const forged = jwt.sign({ sub: user._id }, "some-other-secret-some-other-secret-1");
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("returns the current user with a valid token", async () => {
    const { token } = await registerUser();
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("alice@test.com");
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });
});
