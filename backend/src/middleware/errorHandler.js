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

    // Other errors from the JSON body parser (express.json) are the client's fault too. It marks
    // them with a 4xx status and expose: true. Without this they fell through to the 500 below.
    if(err.type === "entity.too.large"){ // the limit is set on express.json in app.js
        return res.status(413).json({
            success: false,
            error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is larger than 512 KB", details: null },
        });
    }
    if(err.expose && err.status >= 400 && err.status < 500){
        return res.status(err.status).json({
            success: false,
            error: { code: "BAD_REQUEST_BODY", message: err.message, details: null },
        });
    }

    console.error(err);
    res.status(500).json({
        success: false,
        error: {code: "INTERNAL_ERROR", message: "Something went wrong", details:null }
    })
}