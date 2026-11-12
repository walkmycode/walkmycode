# Team Tasks

A small example app for WalkMyCode: teams keep projects, projects hold tasks,
and people comment on tasks.

- Pages live in `app/` (the dashboard, a project, a task, the sign-in page).
- The pages and forms call the API with `fetch` (the shapes they get back are in `lib/types.ts`).
- The API routes live in `app/api/` and call the logic in `lib/`.
- The data is in a Postgres database, described in `prisma/schema.prisma`.
- When someone is assigned a task, `lib/email.ts` sends them an email through Resend.

Run it with `npm install`, `npm run db:push` and `npm run dev`.
