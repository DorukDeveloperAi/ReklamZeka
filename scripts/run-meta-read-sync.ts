import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { createDrizzleProductionMetaReadSyncService } from "../src/server/meta-read-sync-runtime";
process.loadEnvFile(".env.local");
const workspaceId=process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID;
if(!workspaceId||process.env.META_TOKEN_SECURITY_STATUS!=="rotated")throw new Error("read-only sync preflight rejected");
const pool=new Pool({connectionString:process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,max:2});
try { const database=drizzle(pool,{schema}); const today=new Date(); const start=new Date(today.valueOf()-7*86400_000); const service=createDrizzleProductionMetaReadSyncService({database,scopeResolver:{resolve:async()=>({workspaceId,connectionId:"6d695103-4dc0-44ba-8a1b-67702449c4a1"})},environment:process.env}); const result=await service.run({parentRunId:`meta.read.initial.${today.toISOString().slice(0,10).replaceAll("-","")}`,dateStart:start.toISOString().slice(0,10),dateStop:today.toISOString().slice(0,10),dateSliceDays:7,initialPageSize:100,requestTimeoutMs:5_000,maxAttempts:1}); console.log(JSON.stringify(result)); } finally {await pool.end();}
