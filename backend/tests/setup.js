import {MongoMemoryServer} from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll,afterAll,afterEach } from "vitest";


let mongod;

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.AUTH_RATE_LIMIT = "1000";


beforeAll(async()=>{
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    await mongoose.connect(process.env.MONGODB_URI);
});

afterEach(async()=>{
    for(const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
});

afterAll(async()=>{
    await mongoose.disconnect();
    await mongod.stop();
});



