import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";





export async function requireAuth(req,res,next){
    const header = req.headers.authorization || "";
    const [scheme,token] = header.split(" ");
    if(scheme !== "Bearer" || !token){
        throw new AppError(401,"UNAUTHORIZED","Missing or malform authorization");
    }

    let payload;
    try {
        payload = jwt.verify(token, env.JWT_SECRET);
    } catch (error) {
        throw new AppError(401,"UNAUTHORIZED","Invalid or expired token");
    }

    const user = await User.findById(payload.sub);
    if(!user) throw new AppError(401,"UNAUTHORIZED","User no longer exists");

    req.user = user;
    next();


}