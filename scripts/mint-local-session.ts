#!/usr/bin/env node

import { mintLocalSessionCapability } from "../src/security/local-session-capability";
import { registerLocalSessionBootstrap } from "../src/security/local-session-bootstrap-store";
import { localDecisionRoomConfig } from "../src/server/local-decision-room-runtime";

const config = localDecisionRoomConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
  REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
  REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
  REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
  REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
});

if (!config) {
  console.error("Yerel Decision Room session yapılandırması etkin değil.");
  process.exit(1);
}
const osUid = typeof process.getuid === "function" ? process.getuid() : -1;
if (osUid < 0) {
  console.error("Bu platformda güvenilir OS kullanıcı bağlaması kullanılamıyor.");
  process.exit(1);
}
const cli = process.argv.slice(2).includes("--cli");
const now = Math.floor(Date.now() / 1000);
const capability = mintLocalSessionCapability({
  kind: cli ? "session" : "bootstrap",
  workspaceId: config.workspaceId,
  workspaceRef: config.workspaceRef,
  userId: config.userId,
  readerRef: config.readerRef,
  osUid,
  issuedAt: now,
  expiresAt: now + (cli ? 28_800 : 90),
}, config.signingKey);

if (!cli) await registerLocalSessionBootstrap(capability.claims, capability.token);

console.log(cli
  ? "Aşağıdaki süreli Bearer capability yalnız bu OS kullanıcısında Decision Room read araçları içindir:"
  : "Aşağıdaki tek kullanımlık capability'yi 90 saniye içinde dashboard yerel oturum alanına yapıştırın:");
console.log(capability.token);
