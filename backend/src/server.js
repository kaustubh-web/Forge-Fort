import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { markInterruptedExecutions } from "./services/executionService.js";
import app from "./app.js";


try{
    await connectDB();
    const interrupted = await markInterruptedExecutions();
    if(interrupted) console.log(`Marked ${interrupted} interrupted execution(s) as failed (server restarted)`)
    app.listen(env.PORT,()=>console.log(`API listening on PORT ${env.PORT}`));
}catch(err){
    console.error("Failed to start server",err.message);
    process.exit(1);
}

