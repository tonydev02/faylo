import { createAuthSessionHandler } from "@/lib/auth/api-response";
import { getOwnerAccess } from "@/lib/auth/server";

export const GET = createAuthSessionHandler(getOwnerAccess);
