// The model ids a server actually offers, for the picker: a local server's
// pulled models, or Groq's current list so retired ids can be flagged.
// Proxies GET {base_url}/models with a two-second timeout; [] on any failure
// (src/lib/providers/configRoutes.ts).
import { modelsHandler } from "@/lib/providers/configRoutes";
import { guarded } from "@/lib/providers/guard";

export const runtime = "nodejs";

export const GET = guarded(modelsHandler());
