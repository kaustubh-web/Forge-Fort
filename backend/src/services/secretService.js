import { Secret } from "../models/Secret.js";
import { encrypt, decrypt } from "../utils/secretBox.js";
import { AppError } from "../utils/AppError.js";

const MAX_SECRETS = 50;
const notFound = () => new AppError(404, "NOT_FOUND", "Secret not found");

// The ciphertext is bound to "<owner>:<NAME>" (GCM associated data), see utils/secretBox.js.
const context = (ownerId, name) => `${ownerId}:${name}`;

// Names and dates only. Values are never returned by any route.
export function listSecrets(ownerId) {
    return Secret.find({ owner: ownerId }).select("name createdAt updatedAt").sort({ name: 1 });
}

export async function createSecret(ownerId, { name, value }) {
    if ((await Secret.countDocuments({ owner: ownerId })) >= MAX_SECRETS) {
        throw new AppError(400, "LIMIT_REACHED", `You can store at most ${MAX_SECRETS} secrets`);
    }
    try {
        return await Secret.create({ owner: ownerId, name, value: encrypt(value, context(ownerId, name)) });
    } catch (error) {
        // The unique index also catches two simultaneous creates of the same name.
        if (error.code === 11000) throw new AppError(409, "SECRET_EXISTS", `A secret named ${name} already exists`);
        throw error;
    }
}

// Replaces the value (rotation). The name cannot change: workflows refer to it.
export async function updateSecret(ownerId, name, value) {
    const secret = await Secret.findOne({ owner: ownerId, name });
    if (!secret) throw notFound();
    secret.value = encrypt(value, context(ownerId, name));
    return secret.save();
}

export async function deleteSecret(ownerId, name) {
    const { deletedCount } = await Secret.deleteOne({ owner: ownerId, name });
    if (deletedCount === 0) throw notFound();
}

// For a run: decrypt only the named secrets. Returns { values: { NAME: plaintext }, missing: [NAME] }.
// The plaintext stays in memory for that run and is never written anywhere.
export async function loadSecrets(ownerId, names) {
    if (names.length === 0) return { values: {}, missing: [] };
    const found = await Secret.find({ owner: ownerId, name: { $in: names } }).select("+value");
    const values = {};
    for (const secret of found) values[secret.name] = decrypt(secret.value, context(ownerId, secret.name));
    return { values, missing: names.filter((n) => !(n in values)) };
}
