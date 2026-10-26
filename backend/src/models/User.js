import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        email: {type: String, required: true, unique: true, lowercase: true,trim: true},
        passwordHash: {type: String, required: true, select: false },
    },
    {
        timestamps: { createdAt: true, updatedAt: false},
        toJSON:{
            transform: (doc,ret)=>{
                delete ret.passwordHash;
                delete ret.__v;
                return ret;

            },
         
        },
    },
);

export const User = mongoose.model("User",userSchema);
