import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/utils/secretBox.js";

const flip = (stored, partIndex) => {
    const parts = stored.split(".");
    const bytes = Buffer.from(parts[partIndex], "base64url");
    bytes[0] ^= 1; // change one bit
    parts[partIndex] = bytes.toString("base64url");
    return parts.join(".");
};

describe("secretBox (AES-256-GCM)", () => {
    it("round-trips, and the stored form never contains the plaintext", () => {
        const stored = encrypt("ghp_superSecretToken123", "user1:GITHUB_TOKEN");
        expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(stored).not.toContain("superSecret");
        expect(decrypt(stored, "user1:GITHUB_TOKEN")).toBe("ghp_superSecretToken123");
    });

    it("uses a fresh IV every time, so equal values encrypt differently", () => {
        const a = encrypt("same", "u:X");
        const b = encrypt("same", "u:X");
        expect(a).not.toBe(b);
        expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
    });

    it("rejects any change to the ciphertext, the IV or the tag", () => {
        const stored = encrypt("value-1234", "u:KEY");
        for (const part of [1, 2, 3]) expect(() => decrypt(flip(stored, part), "u:KEY")).toThrow(/authenticate/);
    });

    it("only decrypts for the owner and name it was created for (AAD)", () => {
        const stored = encrypt("value-1234", "alice:API_KEY");
        expect(() => decrypt(stored, "bob:API_KEY")).toThrow(/authenticate/);
        expect(() => decrypt(stored, "alice:OTHER")).toThrow(/authenticate/);
    });

    it("refuses an unknown format", () => {
        expect(() => decrypt("plain text", "u:X")).toThrow("Unknown secret format");
    });

    it("handles unicode and empty-ish values", () => {
        expect(decrypt(encrypt("pässwörd ✓", "u:X"), "u:X")).toBe("pässwörd ✓");
        expect(decrypt(encrypt("", "u:X"), "u:X")).toBe("");
    });
});
