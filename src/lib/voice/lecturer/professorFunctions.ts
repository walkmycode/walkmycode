// The professor's functions for a live talk in the Learn room (docs/VOICE.md §4d): what he can do to
// the lesson while he talks with the student. Like the lecturer's (functions.ts), they go to Deepgram
// without an endpoint, so every call comes back to the page (learn/lib/talk.ts runs them). Pure data:
// the server builds the Settings from it.
import type { LecturerFunction } from "./functions";

const board = { type: "integer" as const, description: "The board's number as the student sees it (1 is the first board)" };

export const PROFESSOR_FUNCTIONS: LecturerFunction[] = [
  {
    name: "next_board",
    description: "Move the lesson on to the next board. Use it when the student is ready to go on, says next, or after you have checked they understood this one.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "previous_board",
    description: "Go back one board, when the student wants to look at it again.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "go_to_board",
    description: "Show a board by its number, when the student asks about one or you want to point back to it.",
    parameters: { type: "object", properties: { board }, required: ["board"] },
  },
  {
    name: "read_board",
    description: "Read a board's own words and analogy (the one on screen when no number is given), so you can answer about it exactly. Nothing changes on screen.",
    parameters: { type: "object", properties: { board } },
  },
  {
    name: "open_example",
    description: "Open the board's runnable example beside the board (or an empty code scratchpad when it has none), so the student can run it and change it. Say what to try first.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "start_quiz",
    description: "Go to the lesson's quiz board, when the student wants to test themselves or you think they are ready.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "explain_back",
    description: "Go to the board where the student explains the idea back in their own words. Use it near the end: explaining it back is how they find out what they really know.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "draw_picture",
    description:
      "Draw on the board: the board's analogy redrawn as a picture to watch, the same steps as a UML sequence diagram, or a UML class, state or flow diagram added to the board. Use it whenever the student asks to see something, asks for a diagram, or asks you to draw or redraw. It appears on the board a few seconds later; talk them through it as it arrives.",
    parameters: {
      type: "object",
      properties: {
        what: { type: "string", description: "What to draw, in a sentence: the idea, the code or the analogy, and what it should show." },
        kind: { type: "string", description: "One of sequence, class, state, flow or scene. sequence: who passes what to whom, step by step; class, state or flow: a UML picture; scene: the everyday picture to watch, step by step." },
      },
      required: ["what"],
    },
  },
  {
    name: "save_note",
    description: "Save one short sentence to the student's notebook: something worth remembering that came up while you talked.",
    parameters: { type: "object", properties: { text: { type: "string", description: "The note, one or two plain sentences" } }, required: ["text"] },
  },
];

export const PROFESSOR_FUNCTION_NAMES = PROFESSOR_FUNCTIONS.map((f) => f.name);
