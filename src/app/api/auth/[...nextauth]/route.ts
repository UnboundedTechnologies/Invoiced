import { handlers } from "../../../../../auth";

export const { GET, POST } = handlers;

// Force Node runtime for Argon2id native binding
export const runtime = "nodejs";
