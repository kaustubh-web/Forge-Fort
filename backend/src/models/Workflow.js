import mongoose from "mongoose";

// nodes and edges are validated by Zod (schema/workflow.js) before they get here,
// so Mongoose just stores them as-is (Mixed) instead of mirroring every config shape.
const workflowSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        description: { type: String, default: "" },
        nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
        edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    },
    {
        timestamps: true,
        // By default Mongoose drops empty objects when saving, which would turn a node's
        // `config: {}` into "no config at all". Keep them so what we load equals what we saved.
        minimize: false,
        toJSON: {
            transform: (doc, ret) => {
                delete ret.__v;
                return ret;
            },
        },
    }
);

export const Workflow = mongoose.model("Workflow", workflowSchema);
