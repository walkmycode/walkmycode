# GitHub setup for WalkMyCode: what goes where

The owner does each step, or approves it before it's done.

## Organisation profile (github.com/organizations/walkmycode/settings/profile)

- **Profile picture:** `walkmycode-avatar-1000.png`
- **Display name:** WalkMyCode
- **Description** (160 characters max): `Find your way around the code you generated. A map of every page, route and table, guided tours and a voice that explains.`
- **URL:** leave blank until the domain (walkmycode.com) is registered.
- **Location:** optional, e.g. `United Kingdom`.

## Repo `walkmycode/walkmycode` (PRIVATE until launch)

- **Description:** `Walk through any codebase: a map, guided tours and a voice that explains. Beginner-first. MCP server for Claude.`
- **Topics:** `code-visualization` `codebase-tour` `onboarding` `mcp` `mcp-server` `claude` `developer-tools` `ai-explainer` `beginner-friendly` `code-map` `education`
- **Social preview:** Settings → General → Social preview → Edit → upload `walkmycode-social-preview.png`.
- **No template files:** don't tick README, .gitignore or licence. The code already has its own README and AGPL-3.0 LICENSE.

## README header (for the coordinating session to add at commit time)

```html
<p align="center">
  <img src="docs/brand/walkmycode-readme-banner.png" alt="WalkMyCode: find your way around the code you generated" width="100%">
</p>
```

## Org profile README (optional; only if the owner agrees it can be public now)

This needs a **public** repo `walkmycode/.github` with `profile/README.md`:

```markdown
<p align="center"><img src="https://raw.githubusercontent.com/walkmycode/.github/main/profile/banner.png" alt="WalkMyCode" width="100%"></p>

**Find your way around the code you generated.**

WalkMyCode opens any project and shows a map of every page, API route and table, with real file:line links. Trace a button all the way to the database, take a guided tour, or let the voice lecturer explain it.

Coming soon. Licence: AGPL-3.0.
```

Upload `walkmycode-readme-banner.png` there as `profile/banner.png`.
