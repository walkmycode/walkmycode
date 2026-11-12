// Deepgram's agent Settings for the saved lecturer model, built on the server
// so the browser never writes the fields that set cost or destination.
import { guarded } from "@/lib/providers/guard";
import { settingsHandler } from "@/lib/voice/routes";

export const runtime = "nodejs";

export const GET = guarded(settingsHandler());
