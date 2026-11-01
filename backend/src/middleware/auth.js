import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import { JWT_ALGORITHM } from "../services/authServices.js";





export async function requireAuth(req,res,next){
    const header = req.headers.authorization || "";
    const [scheme,token] = header.split(" ");
    if(scheme !== "Bearer" || !token){
        throw new AppError(401,"UNAUTHORIZED","Missing or malform authorization");
    }

    let payload;
    try {
        // Pin the algorithm: never let the token header choose how it is verified.
        payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    } catch (error) {
        throw new AppError(401,"UNAUTHORIZED","Invalid or expired token");
    }

    // A validly signed token can still carry a malformed id (for example after a secret leak or
    // a future token format). findById would throw a CastError and answer 500; this stays a 401.
    if(!mongoose.isValidObjectId(payload.sub)) throw new AppError(401,"UNAUTHORIZED","Invalid or expired token");
    const user = await User.findById(payload.sub);
    if(!user) throw new AppError(401,"UNAUTHORIZED","User no longer exists");

    req.user = user;
    next();


}