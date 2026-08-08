import {
  createLocalSessionBootstrapHandler,
  localSessionBootstrapNotConfiguredResponse,
} from "@/server/local-session-bootstrap-http";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function handler() {
  try {
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
    return config ? createLocalSessionBootstrapHandler({ config }) : null;
  } catch {
    return null;
  }
}

export function POST(request?: Request) {
  const configured = handler();
  return configured && request ? configured(request) : localSessionBootstrapNotConfiguredResponse();
}
