// Where code can go, provider by provider (docs/design/home-redesign.html, the
// Privacy pane): one row each, with a badge in green (fine), amber (read the
// terms) or pink (careful). Shared by Settings → Privacy and the home page's
// "How it works" sheet.
import { PROVIDERS } from "@/lib/providers/catalogue";

export type Tone = "g" | "a" | "p";

export interface PrivacyRow {
  who: string;
  what: string;
  tone: Tone;
  say: string;
}

/** Speech to text on a key (Settings → Voice): the recorded question, never the code. In the app and on
 * WalkMyCode for Claude's page (Lite has no microphone). */
export const SPEECH_TO_TEXT_ROW: PrivacyRow = { who: "Speech to text (Groq, Deepgram, ElevenLabs)", what: "Your recorded question", tone: "a", say: "Only if you pick one" };

/** Speech to text on this computer (Settings → Voice → "On this computer (Parakeet)"): the audio is turned into text
 * by the WalkMyCode server here and goes nowhere. Getting the model is one download from GitHub. */
export const ON_DEVICE_SPEECH_ROW: PrivacyRow = { who: "Speech to text on this computer (Parakeet)", what: "Nothing leaves: your voice is heard here", tone: "g", say: "Private" };

/** The app: the providers a key can go to, a local model, and voice. */
export const APP_PRIVACY: PrivacyRow[] = [
  { who: PROVIDERS.anthropic.label, what: "Snippets you ask about", tone: "g", say: "Not used for training" },
  { who: PROVIDERS.openai.label, what: "Snippets you ask about", tone: "g", say: "Not stored (store: false)" },
  { who: PROVIDERS.xai.label, what: "Snippets you ask about", tone: "g", say: "Not stored (store: false)" },
  { who: PROVIDERS.gemini.label, what: "Snippets you ask about", tone: "a", say: "Free tier may train" },
  { who: PROVIDERS.groq.label, what: "Snippets you ask about", tone: "a", say: "See Groq's terms" },
  { who: PROVIDERS.deepseek.label, what: "Snippets, on servers in China", tone: "p", say: "May train" },
  { who: "Local model", what: "Nothing leaves", tone: "g", say: "Private" },
  { who: "Voice (Deepgram, ElevenLabs)", what: "Your voice and the narration", tone: "a", say: "Only when voice is on" },
  SPEECH_TO_TEXT_ROW,
  ON_DEVICE_SPEECH_ROW,
];

/** Answers from the viewer's Claude (WalkMyCode Lite, WalkMyCode for Claude). */
export const CLAUDE_PRIVACY: PrivacyRow[] = [
  { who: "Claude, inside Claude", what: "The lines you ask about", tone: "g", say: "On your own plan" },
  { who: "This browser", what: "Your folders, the map and the code", tone: "g", say: "Stays here" },
  { who: "Your Claude space", what: "The map and the list of files, never the code", tone: "a", say: "When Claude offers one" },
];

/** WalkMyCode's MCP page: the AI app connected to it (`who`: Claude, Antigravity, Cursor…) reads what it needs.
 * `standalone`: started from a terminal with no AI app, so only the provider picked in Settings answers. */
export function mcpPrivacy(who: string, standalone = false): PrivacyRow[] {
  if (standalone)
    return [
      { who: "The AI provider you pick in Settings", what: "The lines you ask about", tone: "a", say: "On your own key" },
      { who: "WalkMyCode on this computer", what: "Your folders, the map and the code", tone: "g", say: "Stays here" },
      SPEECH_TO_TEXT_ROW,
      ON_DEVICE_SPEECH_ROW,
    ];
  return [
    { who: `${who[0].toUpperCase()}${who.slice(1)}, the AI app you connected`, what: "The lines it reads to answer", tone: "g", say: "On your own plan" },
    { who: "WalkMyCode on this computer", what: "Your folders, the map and the code", tone: "g", say: "Stays here" },
    { who: "An AI provider you add a key for", what: "The lines you ask about, when the AI app isn't listening", tone: "a", say: "Only if you add one" },
    SPEECH_TO_TEXT_ROW,
    ON_DEVICE_SPEECH_ROW,
  ];
}

export const NEVER_READ = ".env files, key files and anything that looks like a secret.";
export const BUILT_BY_PARSER = "Every arrow on the map points at a real line of your code. The AI only explains; it never invents a link.";
export const YOUR_KEYS = "Saved in .walkmycode/keys.env on this computer, read only by the WalkMyCode server, and sent only to their own provider.";
