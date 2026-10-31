import crypto from "node:crypto";
import { env } from "../config/env.js";

// Encryption at rest for user secrets (decision note: docs/decisions/secrets.md).
//
// AES-256-GCM: authenticated encryption, so a changed ciphertext, IV or tag makes decrypt()
// throw instead of returning garbage. The key is SECRETS_KEY (32 random bytes, hex), used
// directly. Each value gets a fresh 12-byte IV (the recommended GCM length) that is stored
// next to it; an IV must never repeat under one key, and random 96-bit IVs make that
// practically impossible at our scale.
//
// `context` is authenticated but not encrypted (GCM "additional data"). We pass "<ownerId>:<NAME>",
// so a ciphertext only decrypts as the secret it was created for: copying it to another user's
// record, or renaming it in the database, makes decryption fail.

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1"; // lets a future key rotation tell old values from new ones
const IV_BYTES = 12;

const key = () => Buffer.from(env.SECRETS_KEY, "hex");

// -> "v1.<iv>.<tag>.<ciphertext>" (base64url parts)
export function encrypt(plaintext, context) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag(); // 16 bytes
    return [VERSION, iv, tag, ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function decrypt(stored, context) {
    const [version, iv, tag, ciphertext] = String(stored).split(".");
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unknown secret format");
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    // final() throws "Unsupported state or unable to authenticate data" if anything was changed.
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
