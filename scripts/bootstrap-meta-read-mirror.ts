import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { bootstrapMetaReadMirror } from "../src/server/meta-read-bootstrap";
process.loadEnvFile(".env.local");
const workspaceId=process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID; const actorId=process.env.REKLAMZEKA_LOCAL_USER_ID;
if(!workspaceId||!actorId||process.env.META_TOKEN_SECURITY_STATUS!=="rotated")throw new Error("read-only bootstrap preflight rejected");
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
try { const result=await bootstrapMetaReadMirror({database:drizzle(pool,{schema}),workspaceId,actorId,connectionId:"6d695103-4dc0-44ba-8a1b-67702449c4a1"}); console.log(JSON.stringify(result)); } finally { await pool.end(); }
