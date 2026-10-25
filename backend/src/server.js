import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import app from "./app.js";


try{
    await connectDB();
    app.listen(env.PORT,()=>console.log(`API listening on PORT ${env.PORT}`));
}catch(err){
    console.error("Failed to start server",err.message);
    process.exit(1);
}

