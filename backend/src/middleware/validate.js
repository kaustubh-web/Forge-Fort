import { AppError } from "../utils/AppError.js";

export function validate(schema){
    return (req,res,next) =>{
        const result = schema.safeParse(req.body);
        if(!result.success){
            const details = result.error.issues.map((i)=>({
                field: i.path.join("."),
                message: i.message,
            }));
            return next(new AppError(400,"VALIDATION_ERROR","Invalid request details", details));
        }
        req.body = result.data;
        next();
    }
}

