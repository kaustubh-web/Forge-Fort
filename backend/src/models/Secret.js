import mongoose from "mongoose";

// A user's named secret (API key, token). `value` is the AES-256-GCM ciphertext from
// utils/secretBox.js, never plaintext. It is excluded from queries unless asked for
// (select: false) and stripped from JSON, so no route can return it by accident.
const secretSchema = new mongoose.Schema(
    {
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        name: { type: String, required: true },
        value: { type: String, required: true, select: false },
    },
    {
        timestamps: true,
        toJSON: {
            transform: (doc, ret) => {
                delete ret.value;
                delete ret.__v;
                return ret;
            },
        },
    }
);

// One NAME per user. Also the index every lookup uses.
secretSchema.index({ owner: 1, name: 1 }, { unique: true });

export const Secret = mongoose.model("Secret", secretSchema);
