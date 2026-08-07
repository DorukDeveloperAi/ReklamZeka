import { decisionRoomNotConfiguredResponse } from "@/server/decision-room-http";

export const dynamic = "force-dynamic";

// Fail closed until the application has a trusted authenticated principal and
// the production Drizzle read repository. Never substitute demo fixture data.
export function GET() {
  return decisionRoomNotConfiguredResponse();
}

export function PATCH() {
  return decisionRoomNotConfiguredResponse();
}
