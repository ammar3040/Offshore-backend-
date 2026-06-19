# Marine Flight Backend — Full Project Documentation

This document describes **everything currently in the codebase**: what the project is for, how it is structured, who uses it, how data flows, and every major API area.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Structure](#3-repository-structure)
4. [How to Run Locally](#4-how-to-run-locally)
5. [Environment Variables](#5-environment-variables)
6. [User Roles & Authentication](#6-user-roles--authentication)
7. [Database Models](#7-database-models)
8. [API Reference by Topic](#8-api-reference-by-topic)
9. [Core Business Flows](#9-core-business-flows)
10. [Background Jobs & Integrations](#10-background-jobs--integrations)
11. [File Uploads & PDF Handling](#11-file-uploads--pdf-handling)
12. [Access Control Rules](#12-access-control-rules)
13. [Frontend Integration](#13-frontend-integration)
14. [Deployment](#14-deployment)
15. [Demo / Seed Data](#15-demo--seed-data)
16. [Known Limitations](#16-known-limitations)

---

## 1. Project Overview

**Marine Flight Backend** is a REST API for an **offshore / marine crew operations platform**. It supports companies that manage oil rigs and offshore projects and need to:

- Register and manage **crew members** (passports, visas, certificates)
- Create **projects** and assign crew to **oil rigs**
- **Search and book flights** for crew rotation
- Run a **superadmin approval** workflow on tickets
- Track **payroll**, **timesheets**, and **invoices**
- Send **emails** and store **PDFs** securely

This backend pairs with a separate frontend (Offshore frontend / Subsea Core), e.g.:

- `https://off-shore-frontend.vercel.app`
- `https://subseacore.com`
- Local Vite dev: `http://localhost:5173`

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js |
| Language | TypeScript |
| HTTP framework | Express 5 |
| Database | MongoDB via Mongoose |
| Auth | JWT (`jsonwebtoken`) + bcrypt passwords |
| Validation | Joi |
| File storage | Cloudinary |
| Email | Nodemailer + MJML templates |
| PDF generation | Puppeteer / `@sparticuz/chromium` (Vercel) |
| Flight search | Riya Marine (`marinecorp.riya.travel`) |
| Currency rates | Frankfurter API |
| Cron | `node-cron` |
| Dev server | nodemon + ts-node |
| Production deploy | Vercel serverless (`api/index.ts`) |

---

## 3. Repository Structure

```
marine-flight-backend/
├── api/
│   └── index.ts              # Vercel serverless entry (re-exports Express app)
├── docs/
│   ├── PROJECT_DOCUMENTATION.md   # This file
│   └── frontend-ticket-approval-flow.md
├── scripts/
│   └── seed-demo-data.ts     # Local demo data seeder
├── src/
│   ├── index.ts              # Local server entry (PORT, DB, cron)
│   ├── app.ts                # Express app, CORS, routes, error handler
│   ├── dbconnection.ts       # MongoDB connect + index setup
│   ├── config/               # Cloudinary config
│   ├── controllers/          # Route handlers (business logic)
│   ├── jobs/                 # Cron workers (timesheet auto-present)
│   ├── lib/                  # Shared utilities (currency, airports, access)
│   ├── middleware/           # auth, validate, upload, cloudinary
│   ├── models/               # Mongoose schemas + query helpers
│   ├── routes/               # Express routers per domain
│   ├── services/             # email, PDF, cancellation debt
│   ├── templates/emails/     # MJML email templates
│   ├── types/                # Type declarations
│   ├── utils/                # JWT helpers
│   └── validations/          # Joi schemas per route
├── .env.example
├── package.json
├── tsconfig.json
└── vercel.json
```

---

## 4. How to Run Locally

### Prerequisites

- Node.js (LTS recommended)
- MongoDB running locally or a remote `MONGO_URI`

### Steps

```bash
npm install
cp .env.example .env
# Edit .env — at minimum set MONGO_URI

npm run dev          # Development (nodemon + ts-node)
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled build

npm run seed:demo -- --fresh   # Wipe DB and insert demo data
```

Default local API URL: **http://localhost:8000** (when `PORT=8000` in `.env`).

Health check:

```http
GET /health
→ { "status": "ok" }
```

---

## 5. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGO_URI` | **Yes** | MongoDB connection string |
| `PORT` | No | Server port (default `3000` in code; README uses `8000`) |
| `JWT_SECRET` | No* | JWT signing secret (*has dev fallback — set in production) |
| `JWT_EXPIRES_IN` | No | Token expiry (default `7d`) |
| `CORS_ORIGINS` | No | Extra allowed origins, comma-separated |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | Email sending |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | No* | Uploads/PDFs (*required for file features) |
| `RIYA_USERNAME`, `RIYA_PASSWORD` | No* | Riya flight/airport search (*required for live flight search) |
| `ADMIN_BASE_CURRENCY` | No | Pricing base currency (default `GBP`) |
| `ADMIN_FLAT_MARKUP`, `ADMIN_PERCENTAGE_MARKUP` | No | Env-based pricing defaults |
| `ADMIN_FLAT_CASHBACK`, `ADMIN_AIRLINE_INCENTIVES` | No | Cashback / airline incentives |
| `PUPPETEER_EXECUTABLE_PATH` | No | Custom Chrome path for PDF generation |
| `VERCEL` | Auto | Set on Vercel; skips local `listen()` |

---

## 6. User Roles & Authentication

### Roles

| Role | Description |
|------|-------------|
| **superadmin** | Platform owner — approves tickets, manages admins, markup, invoices, analytics |
| **admin** | Company/project manager — crew, projects, rigs, bookings, payroll |
| **crew** | Offshore worker — profile, invites, tickets, timesheets, availability |

### Login endpoints

| Endpoint | Notes |
|----------|-------|
| `POST /auth/login` | Unified login — tries superadmin → admin → crew by email |
| `POST /superadmin/login` | Superadmin-only login |
| `POST /admin/login` | Admin-only login |
| `POST /crew/login` | Crew-only login |

### Request auth

Protected routes expect:

```http
Authorization: Bearer <accessToken>
```

JWT payload shape:

```ts
{
  userId: string;
  email: string;
  role: "crew" | "admin" | "superadmin";
}
```

### Auth middleware (in `src/middleware/auth.ts`)

| Middleware | Allows |
|------------|--------|
| `authenticateCrew` | crew only |
| `authenticateAdmin` | admin only |
| `authenticateSuperAdmin` | superadmin only |
| `authenticateAdminOrSuperAdmin` | admin or superadmin |
| `authenticateAdminOrCrew` | admin, superadmin, or crew |

---

## 7. Database Models

MongoDB collections and main fields:

### SuperAdmin
- Profile: name, email, phone, hashed password
- Platform pricing: `markup`, `markupPercentage`, `cashback`, `cancellationCharges`

### Admin
- Profile: name, email, phone, hashed password
- Billing: `balance`, `cancellationOutstanding`, `cancellationSlotsRemaining`

### Crew
- Personal info, address, contact
- `createdBy` → owning admin
- `passport`, `identity`, `crew_certificate[]` (document URLs)
- Industry IDs: `norwegian_d_number`, `dawinci_number`, `vantage_number`, etc.

### Rig
- `name`, `address`, `description`, `createdBy` (admin)

### Project
- `title`, `description`, `duration` (start/end), `span`, `status` (`active` | `onhold` | `finished`)
- `createdBy` (admin), `participants[]` (crew), optional `rig_id`

### CrewInvite
- Links `crew_id` + `project_id`
- `acceptanceStatus`: `pending` | `accepted` | `rejected`
- Contract fields: `contract_title`, `contract_body`, `contract_signed_at`, `contract_end_date`

### CrewTicket
- Flight booking record per crew (or admin-only booking without crew)
- Airports `from` / `to`, cabin class, passengers, trip type
- **Lifecycle:** `status` = `UNAPPROVED` | `APPROVED`
- `bookingReference`, `approvedAt`, `approvedBy` (superadmin)
- Billing: `price`, `markup`, `balance`, `cashback`
- `flightSnapshot` — full itinerary from search/book
- `pdf` — private Cloudinary URL (never returned raw to clients)

### AdminInvoice
- One per approved crew ticket (`ticketId` unique)
- `invoiceNumber`, `margin`, `total`, `pdf`, `status` (`DRAFT` | `GENERATED` | `SENT`)

### Payroll
- Per crew + project: `rate_type` (`per_hour` | `per_day` | `per_project`), `pay_amount`

### Timesheet
- Per crew + project: `entries[]` with `date` + `status` (`PRESENT` | `LEAVE` | `ABSENT`)

### CrewAvailability
- Crew date ranges when available (`from`, `to`)

### FlightTicket
- Legacy/search criteria storage (trip type, airports, dates, cabin, etc.)

---

## 8. API Reference by Topic

Base URL: `/` (all routes mounted at root).

### 8.1 Health & Root

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Welcome message |
| GET | `/health` | No | `{ status: "ok" }` |

---

### 8.2 Authentication (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Unified login for all roles |

---

### 8.3 Superadmin (`/superadmin`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/superadmin/login` | No | Superadmin login |
| GET | `/superadmin/analytics` | Superadmin | Dashboard stats |
| GET | `/superadmin/admins` | Superadmin | List all admins |
| POST | `/superadmin/admins` | Superadmin | Create new admin |
| PUT | `/superadmin/markup` | Superadmin | Update flat markup / cashback / cancellation charges |
| PUT | `/superadmin/markup_percentage` | Superadmin | Update percentage markup |
| GET | `/superadmin/admin-invoices` | Superadmin | List all admin invoices |
| GET | `/superadmin/admin-invoice/:ticketId/pdf` | Superadmin | Stream invoice PDF |
| POST | `/superadmin/admin-invoice/:ticketId/upload` | Superadmin | Upload invoice PDF (multipart `pdf`) |
| POST | `/superadmin/admin-invoice/:ticketId/send` | Superadmin | Send invoice email to admin |

---

### 8.4 Admin (`/admin`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/admin/login` | No | Admin login |
| GET | `/admin/me` | Admin | Current admin profile |
| GET | `/admin/admin-invoices` | Admin | Invoices for admin's projects |
| GET | `/admin/admin-invoice/:ticketId/pdf` | Admin | Stream invoice PDF (owned tickets only) |

---

### 8.5 Crew (`/crew`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/crew` | Admin/Superadmin | List crew (admin sees own crew) |
| GET | `/crew/:crew_id` | Admin/Superadmin | Crew detail |
| GET | `/crew/project/:project_id/available` | Admin/Superadmin | Crew available for project dates |
| GET | `/crew/me` | Crew | Own profile |
| POST | `/crew/login` | No | Crew login |
| PATCH | `/crew/reset-password` | Crew | Change password |
| POST | `/crew` | Admin | Create crew (multipart — documents to Cloudinary) |
| PATCH | `/crew/:crew_id` | Admin/Superadmin | Update crew |
| DELETE | `/crew/:crew_id/project/:project_id` | Admin/Superadmin | Unassign crew from project |
| DELETE | `/crew/:crew_id/ticket/:ticket_id` | Superadmin | Delete crew ticket |
| DELETE | `/crew/:crew_id` | Admin/Superadmin | Delete crew (409 if still assigned) |

---

### 8.6 Projects (`/project`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/project` | Admin/Superadmin | List projects |
| GET | `/project/:id` | Admin/Superadmin | Project detail |
| GET | `/project/:id/crew` | Admin/Superadmin | Crew on project |
| POST | `/project` | Admin | Create project |
| PATCH | `/project/:id` | Admin | Update project |
| DELETE | `/project/:id` | Admin | Delete project |

---

### 8.7 Oil Rigs (`/rig`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rig` | Admin/Superadmin | List rigs |
| GET | `/rig/:id` | Admin/Superadmin | Rig detail |
| POST | `/rig` | Admin | Create rig |
| PATCH | `/rig/:id` | Admin | Update rig |
| DELETE | `/rig/:id` | Admin | Delete rig |

---

### 8.8 Crew Invites (`/crew-invite`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/crew-invite/me/pending` | Crew | Pending project invites |
| GET | `/crew-invite/me/enrolled` | Crew | Accepted/enrolled projects |
| POST | `/crew-invite/project/:project_id` | Admin | Invite crew to project |
| PATCH | `/crew-invite/project/:project_id/accept` | Crew | Accept invite + sign contract |

---

### 8.9 Contracts (`/contracts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/contracts/signed` | Admin/Superadmin | List signed contracts |

---

### 8.9 Crew Availability (`/crew-availability`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/crew-availability` | Admin/Crew | List availability (crew = self; admin needs `crew_id` query) |
| POST | `/crew-availability` | Crew | Add availability window |
| PATCH | `/crew-availability/:availability_id` | Crew | Update window |
| DELETE | `/crew-availability/:availability_id` | Crew | Delete window |

---

### 8.10 Payroll (`/payroll`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/payroll` | Admin/Superadmin | List payroll records |
| POST | `/payroll` | Admin | Create/update payroll (upsert per crew+project) |
| DELETE | `/payroll/:id` | Admin | Delete payroll record |

---

### 8.11 Timesheets (`/timesheet`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/timesheet/me` | Crew | All my timesheets |
| GET | `/timesheet/me/project/:project_id` | Crew | My timesheet for one project |
| PATCH | `/timesheet/me/project/:project_id/entry` | Crew | Set day status (LEAVE/ABSENT) |
| GET | `/timesheet/:id` | Admin/Superadmin | Timesheet by ID |
| GET | `/timesheet/project/:project_id/all` | Admin/Superadmin | All timesheets for project |

> **Note:** A daily cron job auto-marks **PRESENT** for crew on active projects (00:05 UTC).

---

### 8.12 Crew Tickets & Flights (`/crew-ticket`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/crew-ticket` | Admin/Superadmin | List tickets |
| GET | `/crew-ticket/crew/:id` | Admin/Crew | Tickets for one crew member |
| GET | `/crew-ticket/:id` | Admin/Crew | Ticket detail |
| GET | `/crew-ticket/:id/pdf` | Admin/Crew | Download/stream ticket PDF |
| POST | `/crew-ticket` | Admin | Create ticket manually |
| POST | `/crew-ticket/search-flights` | Admin | Search flights (Riya + pricing) |
| POST | `/crew-ticket/book` | Admin | Book selected flight → creates UNAPPROVED tickets |
| PATCH | `/crew-ticket/:id/approve` | Superadmin | Approve ticket + booking reference |
| POST | `/crew-ticket/:id/upload-ticket` | Admin/Superadmin | Upload ticket PDF |
| PATCH | `/crew-ticket/:id` | Admin/Superadmin | Update ticket fields |
| POST | `/crew-ticket/:id/cancel` | Admin | Cancel ticket (accrues cancellation debt) |
| DELETE | `/crew-ticket/:id` | Admin | Delete/cancel ticket |
| GET | `/crew-ticket/airports/search` | No* | Airport search via Riya |

---

### 8.13 Airports (`/airports`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/airports/search` | No | Airport search (Riya proxy) |

---

## 9. Core Business Flows

### 9.1 Crew onboarding

```
Admin creates crew (POST /crew)
  → Documents uploaded to Cloudinary
  → Welcome email sent (SMTP)
  → Crew can login (POST /auth/login or /crew/login)
```

### 9.2 Project assignment

```
Admin creates project (POST /project)
Admin invites crew (POST /crew-invite/project/:id)
Crew accepts (PATCH /crew-invite/project/:id/accept)
  → Contract signed
  → Crew added to project participants
  → Timesheet created for crew+project
```

### 9.3 Flight booking & approval

```
Admin searches flights (POST /crew-ticket/search-flights)
Admin books (POST /crew-ticket/book)
  → CrewTicket(s) created with status UNAPPROVED
  → Markup added to admin balance
  → Cancellation debt installment applied (if any)
  → Email sent to superadmin for review

Superadmin approves (PATCH /crew-ticket/:id/approve)
  → status = APPROVED
  → bookingReference saved
  → PDF generated/stored

Admin/Crew downloads PDF (GET /crew-ticket/:id/pdf)
```

See also: `docs/frontend-ticket-approval-flow.md` for frontend integration details.

### 9.4 Ticket cancellation & debt

When an admin cancels/deletes a ticket:

1. Superadmin's `cancellationCharges` config is converted to GBP
2. Fee is added to admin's `cancellationOutstanding`
3. `cancellationSlotsRemaining` increments
4. On future bookings, debt is recovered in installments via search/book surcharges

Logic lives in `src/services/cancellation-debt.ts`.

### 9.5 Invoicing

```
Ticket approved
  → Superadmin uploads/sends invoice (POST /superadmin/admin-invoice/...)
Admin views bills (GET /admin/admin-invoices)
Admin downloads PDF (GET /admin/admin-invoice/:ticketId/pdf)
```

### 9.6 Timesheet attendance

- Cron (`src/jobs/timesheetWorker.ts`) runs daily at **00:05 UTC**
- Marks **PRESENT** for crew on projects whose calendar duration includes today
- Crew can manually set **LEAVE** or **ABSENT** via PATCH endpoint

---

## 10. Background Jobs & Integrations

### Cron: Timesheet worker
- **Schedule:** `5 0 * * *` (daily 00:05 UTC)
- **Action:** `markTodayPresentForAllTimesheets()`

### Riya Marine (flights & airports)
- **Base URL:** `https://marinecorp.riya.travel`
- **Credentials:** `RIYA_USERNAME`, `RIYA_PASSWORD`
- Used for airport search and flight search/book flow
- Implementation: `src/lib/riya-airports.ts`, `crewTicket.controller.ts`

### Currency (Frankfurter API)
- Converts fares between currencies for search/display
- Cached 1 hour
- Implementation: `src/lib/currency.ts`

### Email (Nodemailer)
- Templates: `src/templates/emails/` (MJML → HTML)
- Onboarding email, flight ticket approval emails, invoice emails
- Requires SMTP env vars

---

## 11. File Uploads & PDF Handling

### Cloudinary
- Crew documents (passport, ID, certificates)
- Crew ticket PDFs
- Admin invoice PDFs
- Middleware: `src/middleware/cloudinaryUpload.ts`, `src/middleware/upload.ts`

### PDF generation
- Service: `src/services/ticketPdf.ts`
- Uses Puppeteer locally; `@sparticuz/chromium` on Vercel
- PDFs are **private** — clients must use authenticated backend stream endpoints, not raw Cloudinary URLs

### Secure PDF endpoints
- `GET /crew-ticket/:id/pdf`
- `GET /admin/admin-invoice/:ticketId/pdf`
- `GET /superadmin/admin-invoice/:ticketId/pdf`

---

## 12. Access Control Rules

Implemented in `src/lib/resource-access.ts`:

| Resource | Admin access | Superadmin access |
|----------|--------------|-------------------|
| Project | Own projects only (`createdBy`) | All |
| Rig | Own rigs only | All |
| Crew | Own crew only (`createdBy`) | All |
| Crew ticket | Tickets on own projects or `createdBy` admin | All |
| Payroll | Own records (`createdBy`) | All |

Crew can only access their own profile, tickets, invites, timesheets, and availability.

---

## 13. Frontend Integration

### Local development

```bash
# offShore-frontend/.env.development
VITE_API_PROXY_TARGET=http://localhost:8000
```

### CORS allowed origins (built-in)
- `https://off-shore-frontend.vercel.app`
- `http://localhost:5173`
- `https://subseacore.com`
- `https://www.subseacore.com`
- Plus any in `CORS_ORIGINS` env var

### Typical frontend flows
1. Login → store `accessToken` + `role`
2. Admin dashboard → projects, crew, rigs
3. Flight search UI → `POST /crew-ticket/search-flights`
4. Book → show "Pending approval" for `UNAPPROVED` tickets
5. Superadmin panel → approve with booking reference
6. Download PDF via authenticated fetch (not `window.open(cloudinaryUrl)`)

---

## 14. Deployment

### Vercel
- Entry: `api/index.ts` re-exports Express `app`
- `vercel.json` rewrites all routes to `/api`
- Serverless function: 1024 MB memory, 60s max duration
- Chromium bundled for PDF on serverless

### Local vs Vercel
- Local: `src/index.ts` calls `app.listen()` when `VERCEL` is unset
- Vercel: DB connects per-request via middleware in `app.ts`

---

## 15. Demo / Seed Data

Seed script: `scripts/seed-demo-data.ts`

```bash
npm run seed:demo -- --fresh
```

### Demo credentials (password for all: `Demo@123`)

| Role | Email |
|------|-------|
| Superadmin | `superadmin@demo.local` |
| Admin | `admin@demo.local` |
| Crew | `crew1@demo.local`, `crew2@demo.local`, `crew3@demo.local` |

### What gets seeded
- 1 superadmin, 1 admin, 3 crew
- 2 rigs, 2 projects (active + on hold)
- 3 invites (2 accepted, 1 pending)
- 2 payroll records, 3 timesheets
- 2 crew tickets (1 unapproved, 1 approved with ref `DEMO8X42`)
- 1 admin invoice

### Quick test

```http
POST /auth/login
Content-Type: application/json

{
  "email": "admin@demo.local",
  "password": "Demo@123"
}
```

---

## 16. Known Limitations

| Area | Notes |
|------|-------|
| Flight search | Requires valid `RIYA_USERNAME` / `RIYA_PASSWORD` |
| Email | Requires SMTP configuration; fails silently or errors if missing |
| Cloudinary | Document upload and PDF storage need Cloudinary credentials |
| `POST /crew-ticket/:id/send-ticket-email` | Currently commented out in routes |
| Scripts folder | `seed:superadmin` script referenced in package.json but may not exist; use `seed:demo` instead |
| MongoDB | Required at startup — server won't boot without `MONGO_URI` |
| Currency API | Requires network access to `api.frankfurter.app` for live rates |

---

## Quick Reference: NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `npm run dev` | Start dev server with hot reload |
| `build` | `npm run build` | Compile TypeScript |
| `start` | `npm start` | Run production build |
| `seed:demo` | `npm run seed:demo -- --fresh` | Seed demo database |
| `install:chrome` | `npm run install:chrome` | Install Puppeteer Chrome for PDFs |

---

*Last updated from codebase scan — Marine Flight Backend v1.0.0*
