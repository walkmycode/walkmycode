# Distributing WalkMyCode for Claude

*2 Oct 2026. How the free MCP version (docs/MCP.md) reaches people while the GitHub repo `walkmycode/walkmycode`
stays **private, permanently** (owner's decision). Nothing here has been published. Every step marked **Owner's yes**
is outward-facing and waits for the owner to say go. **verify** marks a fact to check against the vendor's current docs
on the day. Nothing here is legal advice: section 6 lists what to take to a lawyer.*

## 1. The idea
People get a **built product, never the source**. One build (`npm run build:mcp`, `npm run pack:mcpb`) makes every
download; each channel below just hands out the same files. Everything public lives somewhere other than the private
repo: a separate npm package, a separate public plugin repo or bucket, and a download page.

## 2. What ships
| Part | What it is | Made by |
|---|---|---|
| `server.mjs` | The MCP server and everything it imports, in one file (esbuild) | `npm run build:mcp` |
| `ui/` | The page the server serves: the `mcp` front-end target, a static Next.js export (already minified) | `npm run build:mcp-ui` |
| `web-tree-sitter.wasm`, `wasm/` | The parser runtime and the grammars | copied from `public/wasm` |
| `plugin/` | The Claude Code plugin with the server inside, plus the `/walkmycode` skill | `npm run build:mcp` |
| `walkmycode.mcpb` | The Claude Desktop extension (manifest 0.3) | `npm run pack:mcpb` |
| `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt` | The licence it ships under (section 6) and the notices of the open-source parts inside | to add |

What never ships: TypeScript sources, tests, docs, `mcp/src`, `src/`, source maps, `.env` files, the repo's git
history. `node-pty` (the terminal's native module) is not bundled; without it the terminal falls back to line mode, so
there is no native binary to sign per platform.

Changes to the build before the first release (each a small code change, not a publish):
- **Minify the server.** `mcp/build.mjs` bundles but does not minify today, so `server.mjs` is readable. Add
  `minify: true` for release builds, keep `legalComments: "eof"` so third-party licence comments stay. Be honest about
  what this buys: minified JavaScript can still be read with effort. It keeps casual copying out, not a determined
  person; the licence (section 6) is the real protection.
- **No source maps.** A release check fails if any `.map` file, `sourceMappingURL` comment or `src/` path is in the
  output.
- **One version number.** It lives in four places today: `package.json`, `mcp/mcpb/manifest.json`,
  `mcp/plugin/.claude-plugin/plugin.json` and `LANTERN_MCP_VERSION` in `mcp/src/server.ts`. The build should stamp
  one into the others, and a test should fail when they differ.
- **Licence fields.** The manifest and plugin.json say `AGPL-3.0-only`; they change with the section 6 decision.
- **A notices file.** Generate `THIRD-PARTY-NOTICES.txt` from the bundle's inputs (esbuild's metafile lists them) and
  the page's dependencies, with each licence text.

## 3. Channels
All four carry the same build and the same version.

1. **npm: `walkmycode-mcp`, run with npx.** The quickest install for Claude Code and other MCP clients:
   `claude mcp add -s user walkmycode -- npx -y walkmycode-mcp@latest` (on Windows: `-- cmd /c npx -y
   walkmycode-mcp@latest`). The package is a small `package.json` (with `bin`, a `files` allowlist and no
   dependencies, since everything is bundled) around `server.mjs` (with a shebang), `ui/` and the wasm.
   **`npm run pack:npm`** (mcp/pack-npm.mjs) stages it in `mcp/dist/npm/` and packs `mcp/dist/walkmycode-mcp-<v>.tgz`,
   never from the repo root, and stops if anything but those files would go (a source map or a `.ts` file, say).
   Checked on 14 Oct 2026: installed with npx from the packed file, it ran for a real Claude Code session, which
   mapped a project and answered a question on the page. Publishing is then `npm publish <the .tgz>`, signed in to
   npm with two-factor auth on. The name depends on the trademark check; **verify** it is
   free on npm on the day. Needs an npm account the owner creates. **Owner's yes.**
2. **Claude Desktop: the `.mcpb` download.** Double-click to install. Offered from the download page; later, if
   Anthropic's directory of Desktop extensions takes submissions, submit it there (**verify** the process).
   **Owner's yes.**
3. **Claude Code: plugin and marketplace.** A marketplace is a small repo or URL with a `marketplace.json` naming the
   plugin. Make a **separate public repo** (for example `walkmycode/claude-plugin`) holding only `marketplace.json` and
   the built `plugin/` folder: no source, its own short history. Users run `claude plugin marketplace add
   walkmycode/claude-plugin`, then `claude plugin install walkmycode@walkmycode`. **verify** whether a plugin can be
   sourced straight from the npm package instead, which would remove the second copy. Later, submit to Anthropic's
   plugin directory if there is one (**verify**). **Owner's yes** for creating the repo and each push to it.
4. **A download page and release bucket.** One public place for every file of every version:
   `walkmycode.com/download` (or a subdomain) over object storage (Cloudflare R2, or a folder served from the existing
   VPS). Layout: `/releases/<version>/walkmycode.mcpb`, `SHA256SUMS`, `SHA256SUMS.sig`, release notes; and
   `/releases/latest.json` (version, date, file links, checksums, the minimum supported version). This is separate from
   the private repo, so GitHub Releases on `walkmycode/walkmycode` are never used. **Owner's yes** for the domain, the
   bucket and each upload.

**Other MCP clients** (Cursor, VS Code…) use the npm route; their own model then answers.

## 4. Versions and updates
- **Semantic versions**: `0.x` while it settles; a bump in the minor number may change tools or the page; the bridge
  protocol already carries its own version and the page says plainly when server and page don't match.
- **How each channel updates**:
  - npx: `npx -y walkmycode-mcp` uses npm's cache and may keep an old copy; the install line should be
    `npx -y walkmycode-mcp@latest` so each launch checks. **verify** current npx caching.
  - Plugin: Claude Code refreshes marketplaces (`claude plugin marketplace update`, and automatically where it is
    switched on: **verify**). A new version is a push to the plugin repo.
  - `.mcpb`: an extension installed by hand does not update itself (**verify**); people download the new one.
- **An update notice in the page** (proposed, off by default until the owner decides): once a day the server fetches
  `latest.json` from the download page and, when it is newer, the page shows one quiet line, "WalkMyCode 0.3.0 is out:
  how to update", with the command or link for the channel it was installed from. It sends nothing but the request
  itself (no ID, no usage), and `WALKMYCODE_NO_UPDATE_CHECK=1` switches it off. It never downloads or installs
  anything by itself. Today the server makes no such call.

## 5. Integrity and signing
- **Checksums.** Every release publishes `SHA256SUMS` for every file (the `.mcpb`, the npm tarball, a zip of the
  plugin folder). The download page shows each hash next to its file and says how to check it
  (`certutil -hashfile file SHA256` on Windows, `shasum -a 256 file` on macOS and Linux).
- **Signed checksums.** Sign `SHA256SUMS` with one release key (minisign or GPG), its public key printed on the
  download page and in the plugin repo's README. The private key stays off the build machine's disk except while
  signing, with a backup the owner keeps offline.
- **The `.mcpb` itself.** The `@anthropic-ai/mcpb` tooling has `sign` and `verify` commands; **verify** whether
  Claude Desktop shows a signed extension differently and what certificate it expects before buying one.
- **npm.** Turn on two-factor auth for publishing. npm's provenance statements need a public source repo, so they are
  not available with a private one (**verify**); the signed checksums cover that gap.
- **Reproducible enough.** Releases are built from a tagged commit with `npm ci` on a clean checkout, so the same tag
  makes the same files.

## 6. The licence question (for a lawyer)
In plain words:
- The repo's `LICENSE` is the GNU AGPL-3.0. The AGPL says that **whoever receives the program under it may also get
  its source code**. Shipping the free version under the AGPL would therefore mean offering the source to every user,
  which clashes with keeping the repo private.
- A copyright holder can license their own work under more than one licence. As the **sole copyright holder**, the
  owner can ship the compiled free version under a **separate licence** (for example a free-to-use licence that
  doesn't allow redistribution, modification or reverse engineering), while the private repo keeps whatever licence
  the owner wants. This only holds for code the owner owns: the third-party parts inside the bundle keep their own
  licences, and their notices must ship with it.

What to decide, ideally with a lawyer who knows software licensing:
1. **The licence for the free download**: free-to-use proprietary terms (an end-user licence) or something else. The
   npm package's `license` field, the manifest, plugin.json and the download page all follow it.
2. **The repo's own licence.** If it stays private forever, does keeping `LICENSE` as AGPL serve any purpose, or
   should it say "all rights reserved"? the business plan still describes a self-hosted open-source version; that row
   needs rewriting either way.
3. **Sole ownership.** Confirm nobody else holds rights in the code: every commit is the owner's, no outside
   contributions without a contributor agreement, no code copied in from elsewhere. Ask too how code written with AI
   assistance is treated where the owner sells.
4. **Third-party components.** Everything bundled is believed MIT, Apache-2.0, ISC or similar;
   `elkjs` (EPL-2.0, through `mermaid`) and the MicroPython and sql.js builds in the page need a look, and the
   generated notices file must be complete.
5. **Terms of use and a privacy notice** for the download page, and the name (trademark search, the business plan)
   before anything goes up.

## 7. Telemetry and privacy
- **The stance: no telemetry in the free version.** The server binds `127.0.0.1` only (docs/MCP.md §6), reads the
  folders the user names, and sends code nowhere except to the user's own Claude (through their own client) and to a
  voice provider only when the user added that provider's key (ElevenLabs, Deepgram). Chrome's built-in speech
  recognition sends audio to Google; the page should say so where it is offered.
- No analytics, no crash reporting, no install ID. The only call home would be the update notice (section 4), and only
  once the owner turns it on; the privacy notice names it.
- If usage numbers are ever wanted, they are **opt-in**, shown in full before sending, and described in the privacy
  notice first. Usage measurement in the business plan is for the hosted app.

## 8. Support
Issues can't go on the private repo. Options for the owner to pick from:
- A **public support repo** (for example `walkmycode/support`) with issues and discussions only, no code, and a bug
  template asking for the version, OS, Node version, Claude client and what the page showed.
- An **email address** (`support@` on the product domain), with a short promise of how quickly it is read.
- Later, a community chat if people ask for it.
A "Copy details for a bug report" button in the page's Settings (version, OS, Node, client; never paths, code or keys)
would make reports useful; it is a small code change for later.

## 9. Release checklist
1. Bump the version once; the build stamps it everywhere; tests check they agree.
2. On a clean checkout of the tagged commit: `npm ci`, `npx tsc --noEmit -p .`, the MCP tests
   (`tests/mcp*.test.ts`, run per file), `npm run e2e:mcp`.
3. `npm run build:mcp` and `npm run pack:mcpb`; the release check finds no source maps or source paths, and the
   notices file is there.
4. Try it by hand on Windows and macOS: the plugin with `claude --plugin-dir mcp/dist/plugin`, the `.mcpb` in Claude
   Desktop, and the npm tarball with `npx` from the packed file.
5. Write the release notes (what changed, in plain English).
6. Make `SHA256SUMS` and sign it.
7. **Owner's yes**: upload the files, notes and checksums to the release bucket; update `latest.json` last.
8. **Owner's yes**: `npm publish` from the staging folder (two-factor).
9. **Owner's yes**: push the built plugin and the new `marketplace.json` to the public plugin repo.
10. **Owner's yes**: update the download page.
11. Install each channel fresh from its public source and open a project once, to be sure what people get works.
