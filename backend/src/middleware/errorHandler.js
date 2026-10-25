import { AppError } from "../utils/AppError.js";

export function errorHandler(err,req,res,next){
    if(err instanceof AppError){
        return res.status(err.statusCode).json({
            success: false,
            error: {code: err.code, message: err.message, details: err.details },

        });
    }

    if(err.type === "entity.parse.failed"){
        return res.status(400).json({
            success: false,
            error: { code: "INVALID_JSON", message: "Request body is not valid JSON", details: null },
        })
    }

    console.error(err);
    res.status(500).json({
        success: false,
        error: {code: "INTERNAL_ERROR", message: "Something went wrong", details:null }
    })
}