import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";


const BCRYPT_ROUNDS = 12;

const DUMMY_HASH= bcrypt.hashSync("not-a-real-password",BCRYPT_ROUNDS);


export function signToken(user){
    return jwt.sign({ sub: user.id}, env.JWT_SECRET, {expiresIn: env.JWT_EXPIRES_IN});
}

export async function register({ email, password }){
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
        const user = await User.create({ email, passwordHash});
        return { user, token: signToken(user)};
    } catch (error) {
        if(error.code===11000){
            throw new AppError(409,"EMAIL_TAKEN","An account with this email already exists")
        }
        throw error;
    }
}

export async function login({ email, password }){
    const user = await User.findOne({ email }).select("+passwordHash");
    const ok = await bcrypt.compare(password, user ? user.passwordHash: DUMMY_HASH);

    if(!user || !ok){
        throw new AppError(401, "INVALID_CREDENTIALS","Invalid email or password");

    }

    return { user, token: signToken(user)};


}

