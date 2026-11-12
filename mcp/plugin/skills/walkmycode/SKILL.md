---
name: walkmycode
description: Open WalkMyCode on this project, a live map of the code in the user's browser, and explain the code there while WalkMyCode lights it up and reads it aloud. Use when the user asks to open WalkMyCode, to see a map of the codebase, or to be shown around or toured through the code.
argument-hint: "[folder]"
allowed-tools: mcp__plugin_walkmycode_walkmycode__walkmycode_open, mcp__plugin_walkmycode_walkmycode__next_request, mcp__plugin_walkmycode_walkmycode__answer, mcp__plugin_walkmycode_walkmycode__narrate, mcp__plugin_walkmycode_walkmycode__focus_node, mcp__plugin_walkmycode_walkmycode__open_file, mcp__plugin_walkmycode_walkmycode__highlight_lines, mcp__plugin_walkmycode_walkmycode__trace_path, mcp__plugin_walkmycode_walkmycode__start_tour, mcp__plugin_walkmycode_walkmycode__tour_step, mcp__plugin_walkmycode_walkmycode__show_view, mcp__plugin_walkmycode_walkmycode__query_map, mcp__plugin_walkmycode_walkmycode__read_file, mcp__plugin_walkmycode_walkmycode__search, mcp__plugin_walkmycode_walkmycode__list_files, mcp__plugin_walkmycode_walkmycode__walkmycode_new_project
---

# WalkMyCode

Open WalkMyCode, then stay with the user on its page until they are done.

1. **Open it.** Call `walkmycode_open` with `path` set to `$ARGUMENTS` when the user named a folder, else to the absolute path of the current working directory (the project's root). If the browser did not open, give the user the page's URL from the result, as a link.
2. **Say one line**: the map is open, and they can press Explain, Trace it or Tour on any card, type a question on the page, or hold Space and ask out loud.
3. **Loop.** Call `next_request()`. On `{"kind":"none"}` call it again at once and say nothing. For a request, follow WalkMyCode's own instructions: read the code first (`query_map`, `read_file`, `search`), `narrate` a sentence or two at a time as you go, show what you mean (`focus_node`, `highlight_lines`, `trace_path`, `start_tour`), then `answer` with every claim cited as `path:line`. Then call `next_request()` again.
4. **Stop** when `next_request` says to stop, or when the user asks. When they say "continue", call `next_request()` again.

Keep the loop going between requests without asking the user anything: their clicks and questions on the page are the conversation.
