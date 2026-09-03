# PIE - WebApp

## Web dashboard for the Portable Isolated Environment system

WebApp is the browser-based dashboard for the **Portable Isolated Environment
(PIE)** exam system. It is a [Next.js](https://nextjs.org) (App Router)
application used by teachers/admins to manage courses, exams and exam sessions,
and to monitor students in real time (screen-share and activity logs) during an
exam. All data is served by [`pie-api-main`](../pie-api-main), the system's
backend API.

The actual application lives in [`webapp/`](webapp); this file documents the
project as a whole, while [`webapp/README.md`](webapp/README.md) keeps the
default `create-next-app` quick-start notes.

## Architecture

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 15 (App Router) | Routing, SSR, layouts |
| UI | Tailwind CSS, shadcn/ui, Radix UI, lucide-react | Component library and styling |
| Forms & validation | react-hook-form, zod | Course/exam/session/user forms |
| Charts | recharts | Analytics dashboard (logs summary, time series) |
| Notifications | sonner | Toast notifications |
| Internationalization | next-intl | English/Portuguese UI, locale-prefixed routes |
| Auth | Custom JWT-in-cookie (`src/lib/auth.js`) | Session with the PIE-API |

The app is a thin client over the PIE-API: it holds no business logic of its own
beyond form validation and presentation — courses, exams, sessions, users, logs
and analytics are all fetched from/written to the API described in
[`pie-api-main`](../pie-api-main).

## Getting started

### Requirements

- Node.js 18+ and npm (or yarn/pnpm/bun)
- A running instance of [`pie-api-main`](../pie-api-main) (see its README)

### Setup

```bash
cd webapp
npm install
```

Configure the API endpoint in `webapp/.env`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Run in development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — it redirects to
`/en/login` by default (see `next.config.mjs`).

### Other scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js dev server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

## Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the PIE-API instance this dashboard talks to (client- and server-side requests) |

## Authentication

Login (`POST /users/login` on the API) returns a JWT, which the client stores in
a `currentUser` cookie (`src/lib/auth.js`) alongside the user's profile. On every
navigation, `AuthProvider` (`src/components/auth-provider.js`) checks the cookie
and token expiry and redirects unauthenticated users to `/{locale}/login`;
`login`, `register` and `forgot-password` are the only public paths. A timer
refreshes the token shortly before it expires and clears the session if refresh
fails. Route-level access levels (admin / teacher / student) are enforced by the
API itself — see [`pie-api-main`](../pie-api-main)'s authentication section.

## Internationalization

Routes are locale-prefixed (`/en/...`, `/pt/...`) via `next-intl`
(`src/i18n/routing.js`, `src/middleware.js`), with English as the default
locale and automatic browser-locale detection. Translation strings live in
`src/locales/{en,pt}/common.json`. The middleware also attaches a set of
security response headers (`X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, and HSTS in production) to every
request.

## App structure

Pages live under `src/app/[locale]/`, following the course → exam → session →
student hierarchy exposed by the API:

| Route | Description |
|---|---|
| `/login` | Authentication |
| `/` (admin/teacher home) | Course listing |
| `/create_course` | Create a course |
| `/course/[course_id]` | Course detail / exam listing |
| `/course/[course_id]/edit_course` | Edit a course |
| `/course/[course_id]/create_exam` | Create an exam |
| `/course/[course_id]/[exam_id]` | Exam detail / session listing |
| `/course/[course_id]/[exam_id]/edit_exam` | Edit an exam |
| `/course/[course_id]/[exam_id]/create_session` | Create a session |
| `/course/[course_id]/[exam_id]/[session_id]` | Session detail: join code, roster, submissions |
| `/course/[course_id]/[exam_id]/[session_id]/edit_session` | Edit a session |
| `/course/[course_id]/[exam_id]/[session_id]/[user_nmec]` | Live monitoring of one student: screen-share, log stream, and time-extension controls |
| `/admin` | Analytics dashboard: log volume charts, time series, and course/exam log hierarchy |
| `/auditor` | Auditor view (placeholder) |

## API layer

`src/api/` centralizes all communication with the PIE-API:

- `client.js` / `serverClient.js` — fetch wrappers for client- and server-side
  requests, both configured from `NEXT_PUBLIC_API_URL`.
- `endpoints.js` — a single source of truth for API route paths (courses,
  exams, sessions, users, session-users), keeping path construction (e.g.
  `/course/{id}/{examId}`) out of individual components.
- `services/` — one module per resource (`courseService`, `examService`,
  `sessionService`, `userService`, `loginService`, `serverService`) wrapping
  the corresponding endpoints with typed request/response handling.

## Real-time monitoring

The per-student monitoring page (`.../[session_id]/[user_nmec]`) combines two
components that connect directly to the PIE-API's real-time endpoints:

- `components/screenshare.js` — receives a student's live screen via WebRTC,
  signaling through the API's `/screenshare` WebSocket endpoints.
- `components/logviewer.js` — tails that student's activity log stream over
  Server-Sent Events (`/logs/session/{id}/user/{nmec}/stream`).

The admin analytics dashboard (`components/analytics/*`) queries the API's
`/analytics` endpoints to render log-volume charts, time series, and a
drill-down course/exam log hierarchy.

## Known limitations

- The `/auditor` route is a placeholder page with no implemented functionality
  yet.
