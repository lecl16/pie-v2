# PIE — WebApp

Web dashboard for the Portable Isolated Environment system.

WebApp is the browser-based dashboard for the **Portable Isolated Environment
(PIE)** exam system. It is a [Next.js](https://nextjs.org) (App Router)
application used by teachers/admins to manage courses, exams and exam sessions,
and to monitor students in real time (screen-share and activity logs) during an
exam. All data is served by [`pie-api-main`](../pie-api-main), the system's
backend API.

The application lives in [`webapp/`](webapp); all commands below run there.

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

### In production

The dashboard runs as the `webapp` service of the API's Docker Compose
stack (`pie-api-main/docker-compose.yml`, built from `webapp/Dockerfile`).
The API's Caddy serves it over HTTPS on port 3000, with the deployment's
certificate. Teachers open:

```
https://<server>:3000
```

There is nothing to run here: `docker compose up -d --build` in
`pie-api-main` builds and starts it with the rest. Its settings come from
`pie-api-main/.env`:

- **`PIE_API_URL`** (for example `https://192.168.1.50:8000`): the API's
  address as the teachers' browsers reach it. `scripts/setup.sh` fills it
  with the machine's main address. It is compiled into the build, so after
  changing it, run `docker compose up -d --build` again.
- **The CA:** the browsers trust the deployment's CA (`ca.crt`, installed
  once). The dashboard's own server trusts it through the mounted
  `certs/ca.crt`.

The steps below are for development.

### Requirements (development)

- Node.js 18.18 or later, and npm
- A running [`pie-api-main`](../pie-api-main), and its CA certificate
  (`pie-api-main/certs/ca.crt`)

### Setup

```bash
cd webapp
npm install
```

Configure the API's address in `webapp/.env`. Use the address the
teachers' browsers will reach the server at (not `localhost`, unless the
dashboard is only used on the server machine itself):

```bash
NEXT_PUBLIC_API_URL=https://192.168.1.50:8000
```

`NEXT_PUBLIC_*` variables are compiled into the build: rebuild after changing
it.

The API serves HTTPS only, with a certificate signed by its deployment's own CA
(`pie-api-main/certs/ca.crt`, see `pie-api-main/README.md`). Two things must trust it:

- **Node** (server-side requests): `npm run dev` and `npm run start` set
  `NODE_EXTRA_CA_CERTS=../../pie-api-main/certs/ca.crt` (the API checked out next to
  this repo). If the CA is elsewhere, set the variable yourself and the scripts keep
  it: `NODE_EXTRA_CA_CERTS=/path/to/ca.crt npm run dev`. Without it, server-rendered
  pages fail quietly (e.g. "No courses found").
- **The browser** (client-side requests): import `ca.crt` as a trusted certificate
  authority in the browser's or the system's certificate settings.

### Run in development

```bash
npm run dev              # hot reload, http://localhost:3000
```

While the compose stack is running, its Caddy holds port 3000: use another
port for development, `npm run dev -- -p 3001`. The dev server sets no
`Secure` flag on the login cookie, so plain HTTP works there.

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
| `NEXT_PUBLIC_API_URL` | Base URL of the PIE-API (`https://<server>:8000`), used by both the browser and the Node server. Compiled in at build time. In production, set from `PIE_API_URL` in `pie-api-main/.env` |
| `NODE_EXTRA_CA_CERTS` | The CA the Node server trusts for the API. `/certs/ca.crt` in the container; defaults to `../../pie-api-main/certs/ca.crt` in `npm run dev` and `npm run start` |

## Authentication

Login (`POST /users/login` on the API) returns a JWT, which the client stores in
a `currentUser` cookie (`src/lib/auth.js`) alongside the user's profile. On every
navigation, `AuthProvider` (`src/components/auth-provider.js`) checks the cookie
and token expiry and redirects unauthenticated users to `/{locale}/login`,
the only public page. A timer
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
| `/course/[course_id]/[exam_id]/create_session` | Create a session: date, room, duration, allowed links, allowed students |
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

## Sessions: allowed links and students

- **Allowed links.** The exam app writes them to the exam OS's proxy
  whitelist when the student joins. An entry allows everything under it
  (`https://www.example.com/` allows the whole site); an entry with a query
  string allows only that page. New sessions start with
  `https://idp.ua.pt` (UA's login) and `https://elearning.ua.pt`
  (`DEFAULT_ALLOWED_LINKS` in `src/lib/utils.js`). The second one opens
  **all of elearning** during the exam; remove it and use the quiz's own link
  to limit the student to the quiz.
- **Allowed students** are matched by **email**. When the list is set, the
  examiner app only offers those students, and the API refuses anyone else.
  A student whose account email isn't on the list can't be assigned to a
  device.

## Known limitations

- **Production needs HTTPS.** Production builds mark the login cookie
  `Secure`, which browsers only keep on an `https://` page. Serve the
  dashboard through the compose stack's Caddy, as above, not with a bare
  `npm run start` over HTTP.
- There is no user-management page: create accounts as described in
  `pie-api-main/docs/deployment.md`.
- The `/auditor` route is a placeholder page with no implemented functionality
  yet.
