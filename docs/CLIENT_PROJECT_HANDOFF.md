# Offshore CRM (Lynq) — Client Project Handoff

**Product:** Offshore CRM, branded **Lynq**  
**Industry:** Offshore marine / oil & gas crew operations  
**Date:** June 2026  
**Purpose:** Single reference document describing what exists in the **frontend** and **backend**, how they connect, what is real vs simulated, and what remains to be built.

---

## Executive Summary

Offshore CRM (Lynq) is a **production-oriented crew management web application** paired with a **Node.js REST API** (Marine Flight Backend). Together they cover the full offshore crew lifecycle: onboarding, project/rig assignment, travel booking, timesheets, payroll rates, contracts, and invoicing.

**Overall alignment: Strong.** After cross-reviewing both codebases, the earlier concern about a missing “helpdesk ticket system” is **resolved** — on both sides, **“Tickets” means flight/travel bookings**, not customer support.

The product appears **live on Vercel** (frontend + backend). A separate staging environment is not defined in either repository. A few features are **UI-only or simplified**, and **password recovery** is the main functional gap.

---

## System Architecture

```
┌─────────────────────────────────────┐
│   Lynq Frontend (React + Vite)    │
│   Admin │ Crew │ Superadmin portals │
└──────────────┬──────────────────────┘
               │  HTTPS + JWT Bearer
               ▼
┌─────────────────────────────────────┐
│   Marine Flight Backend (Express)   │
│   MongoDB │ Cloudinary │ Riya API   │
└─────────────────────────────────────┘
```

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, Vite 7, Tailwind v4, shadcn/ui, React Router v7 |
| **Backend** | Node.js, TypeScript, Express 5, Mongoose, JWT, Joi |
| **Database** | MongoDB |
| **Files / PDFs** | Cloudinary |
| **Flight search** | Riya Marine API (`marinecorp.riya.travel`) |
| **Email** | Nodemailer + MJML templates (Lynq branding) |
| **Deployment** | Vercel (both frontend and backend) |

### Known production URLs

| Service | URL | Status |
|---------|-----|--------|
| Backend API | `https://marine-flight-backend.vercel.app` | Live (`/health` OK) |
| Frontend | `https://off-shore-frontend.vercel.app` | Live |
| Custom domain | `subseacore.com` | Verify DNS/SSL with hosting provider |

---

## Three User Portals

| Portal | Users | Frontend path | Backend role |
|--------|-------|---------------|--------------|
| **Admin** | Company operations managers | `/login` → `/` | `admin` |
| **Crew** | Seafarers / offshore workers | `/panel/crew/login` → `/panel/crew/*` | `crew` |
| **Superadmin** | Platform owner | `/panel/superadmin/login` → `/panel/superadmin/*` | `superadmin` |

All portals use **JWT authentication** stored in browser `localStorage`. Protected routes require a valid token.

**Unified login:** `POST /auth/login` — backend detects role from email (superadmin → admin → crew).

---

## Module-by-Module Alignment

### 1. Travel / Flight “Tickets” (NOT Helpdesk)

| | Frontend | Backend |
|---|----------|---------|
| **What it is** | Flight search, book, approve, PDF download | Same — `CrewTicket` = airline travel |
| **Pages** | `AdminTicketsPage`, `CrewTicketsPage`, `SuperadminTicketsPage` | Routes under `/crew-ticket` |
| **Flow** | Search → book → pending → approve → PDF | `UNAPPROVED` → superadmin approves → `APPROVED` |
| **Integration** | Riya proxy via backend | `POST /crew-ticket/search-flights`, `/book`, `PATCH /:id/approve` |

**Verdict: Fully aligned.**  
There is **no customer support / helpdesk ticket system** on either side, and none is required for current scope.

**Note:** Sending ticket email to crew (`POST /crew-ticket/:id/send-ticket-email`) is **disabled** in backend routes. Email templates exist but this endpoint is commented out.

---

### 2. Authentication & Accounts

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Login (3 roles) | Complete | `POST /auth/login` + role-specific logins | **Aligned** |
| JWT access token | Stored in localStorage | Issued on login (default 7 days) | **Aligned** |
| Route guards | `ProtectedRoute`, `ProtectedSuperadminRoute` | Middleware per role | **Aligned** |
| Self-registration | No signup UI; helper exists but unused | **No register API** | **Aligned** (signup intentionally disabled) |
| Refresh tokens | Env key defined; **no logic implemented** | **No refresh endpoint** | **Aligned** (single token only) |
| Forgot password (login pages) | Dead link (`href="#"`) on all login pages | **No** `POST /crew/forgot-password` or admin equivalent | **Gap** |
| Forgot password (crew settings) | `CrewSettingsPage` calls `POST /crew/forgot-password` | **Endpoint does not exist** (will 404) | **Gap** — UI ahead of backend |
| Password reset (logged in) | Crew settings → `PATCH /crew/reset-password` | `PATCH /crew/reset-password` (crew only) | **Aligned** |

**Verdict:** Login works end-to-end. **Password recovery is the main auth gap** on both sides.

---

### 3. Crew Management

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Crew list / CRUD | Complete with search, filters, pagination | `GET/POST/PATCH/DELETE /crew` | **Aligned** |
| Passport, identity, certs | Full forms + file upload | Mongoose schema + Cloudinary | **Aligned** |
| Document uploads | Multipart to API | `crewUpload` → Cloudinary middleware | **Aligned** |
| Welcome email | On create | `sendCrewWelcomeEmail` (needs SMTP) | **Aligned** (needs env config) |
| Crew “status” badges | Available, On project, Sign-off due | Computed `signal` on `GET /crew` | **Aligned** |

**Crew status — how it actually works:**

Backend does **not** store a `status` column. It computes a **`signal`** field when listing crew:

| Signal | Meaning (backend logic) | Frontend badge mapping |
|--------|-------------------------|------------------------|
| `GREEN` | No active in-window project | Available |
| `RED` | On active project (> 7 days until end) | On project / Deployed |
| `ORANGE` | Active project ending within 7 days | Sign-off due |

Frontend utility `src/utils/crewAvailability.ts` → `availabilityFromCrewSignal()` maps these to UI labels. **YELLOW** is handled in frontend mapping (`YELLOW | ORANGE` → “ending soon”); backend returns only `GREEN`, `ORANGE`, `RED`.

---

### 4. Projects & Crew Assignment

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Create / edit projects | Complete | `POST/PATCH/DELETE /project` | **Aligned** |
| Assign crew | Via invites + participants | `POST /crew-invite/project/:id` | **Aligned** |
| Project status | active / on hold / finished | `ProjectStatus` enum | **Aligned** |
| Rig link | Per project | `rig_id` on project model | **Aligned** |
| Client name / progress % | May show in UI | Not in API schema | **Partial** (UI-only if present) |

---

### 5. Oil Rigs (Fleet)

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Name, location, description | Yes | `name`, `address`, `description` | **Aligned** |
| Rig type (FPSO, DSV, etc.) | Shown in UI | **Not in database** | **Simulated on frontend** |
| Rig region (North Sea, etc.) | Shown in UI | **Not in database** | **Parsed from description or mocked** |
| Rig status (Operational, etc.) | Shown in UI | **Not in database** | **Derived from `createdAt`/`updatedAt` in React** |

**Verdict: Partial.** Core rig CRUD is real. Extra fleet metadata is **client-side presentation** until backend schema is extended.

---

### 6. Timeline & Rotation Scheduling

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Calendar / Gantt view | Built — crew rotations, sign-on/off, flights | **No `/timeline` API** | **By design** |
| Data source | `Promise.all` — crew, projects, rigs, tickets | Individual CRUD endpoints | **Frontend aggregates client-side** |

**Verdict: Aligned.** Timeline is a **frontend-computed view** over existing APIs. No backend timeline endpoint is required for current behavior.

---

### 7. Crew Invites & Contracts

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Invite crew to project | Admin UI | `POST /crew-invite/project/:id` | **Aligned** |
| Crew accept / reject | Crew portal | `PATCH /crew-invite/project/:id/accept` | **Aligned** |
| Signed contracts list | Admin view | `GET /contracts/signed` | **Aligned** |
| Contract body / title | On invite | Stored on `CrewInvite` model | **Aligned** |

---

### 8. Crew Availability

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Crew sets date ranges | Calendar UI | `POST/PATCH/DELETE /crew-availability` | **Aligned** |
| Admin views availability | Admin UI | `GET /crew-availability?crew_id=` | **Aligned** |

---

### 9. Timesheets

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Crew marks Present / Absent / Leave | Calendar UI | `PATCH /timesheet/me/project/:id/entry` | **Aligned** |
| Auto-fill Present | — | Cron daily 00:05 UTC | **Backend only** |
| Admin review / lock / approve | Not implemented | Not implemented | **Gap** (if formal approval needed) |

**Important production note:** The timesheet cron runs in `src/index.ts` on a **long-running Node process**. On **Vercel serverless**, this cron may **not run** unless a separate worker or Vercel Cron job is configured.

---

### 10. Payroll

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Set pay rate per crew per project | Rates page | `POST /payroll` (upsert) | **Aligned** |
| Rate types | per hour / day / project | `PayrollRateType` enum | **Aligned** |
| Payroll runs / pay periods | Not in UI | Not in API | **Out of scope** (simplified model) |
| Export / statements | Not built | Not built | **Future enhancement** |

**Verdict: Aligned** for current simplified scope — rate configuration only, not full payroll processing.

---

### 11. Invoicing & Bills

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Admin bills page | Complete | `GET /admin/admin-invoices` | **Aligned** |
| Superadmin invoicing | Complete | `GET/POST /superadmin/admin-invoice/*` | **Aligned** |
| PDF upload / send | UI actions | Multipart upload + email send | **Aligned** (needs Cloudinary + SMTP) |
| PDF download | Authenticated fetch | Stream endpoints (private Cloudinary) | **Aligned** |
| Client-side PDF (html2pdf) | Frontend capability | Backend also generates PDFs (Puppeteer) | **Both exist** |

---

### 12. Superadmin Platform Management

| Feature | Frontend | Backend | Verdict |
|---------|----------|---------|---------|
| Analytics dashboard | Charts / stats | `GET /superadmin/analytics` | **Aligned** |
| Create admin accounts | UI | `POST /superadmin/admins` | **Aligned** |
| Markup / pricing | Settings UI | `PUT /superadmin/markup`, `/markup_percentage` | **Aligned** |
| Disable admin | Not confirmed | Not in API | **Gap** (if needed) |

---

## Backend Features Not Highlighted in Frontend Docs

These exist in the backend and power live operations:

| Feature | Description |
|---------|-------------|
| **Flight approval workflow** | Book → `UNAPPROVED` → superadmin adds booking ref → `APPROVED` |
| **Cancellation debt** | Cancelling a flight ticket accrues fee debt; recovered on future bookings |
| **Markup & cashback** | Superadmin configures platform pricing applied on search/book |
| **Multi-currency** | Frankfurter API converts fares (GBP base) |
| **Secure PDF streaming** | PDFs never exposed via public Cloudinary URLs |
| **Demo seed script** | `npm run seed:demo` for local testing |

---

## Master Alignment Checklist

| Module | Frontend | Backend | Verdict |
|--------|----------|---------|---------|
| Authentication (login) | Complete | Complete | **Aligned** |
| Self-registration | Absent (by design) | Absent | **Aligned** |
| Refresh tokens | Not implemented | Not implemented | **Aligned** |
| Forgot password | Login: dead links; Crew Settings UI calls missing API | Missing API | **Gap** |
| Crew management | Complete | Complete | **Aligned** |
| Crew status (signal) | Mapped in UI | Computed on API response | **Aligned** |
| Projects | Complete | Complete | **Aligned** |
| Rigs (core) | Complete | Complete | **Aligned** |
| Rig type / region / status | Simulated in UI | Not in DB | **Partial** |
| Travel / flight tickets | Complete | Complete | **Aligned** |
| Support helpdesk | Absent | Absent | **Aligned** (not in scope) |
| Timeline / Gantt | Client-side aggregation | No API needed | **Aligned** |
| Invites & contracts | Complete | Complete | **Aligned** |
| Availability | Complete | Complete | **Aligned** |
| Timesheets | Complete | Complete | **Aligned** (no admin approval) |
| Timesheet auto-cron | N/A | Local server only | **Production risk** |
| Payroll rates | Complete | Complete | **Aligned** (simplified) |
| Payroll runs / export | Absent | Absent | **Out of scope** |
| Invoicing | Complete | Complete | **Aligned** |
| Superadmin analytics | Complete | Complete | **Aligned** |
| Automated tests | None | None | **Gap** |

---

## Production & Environment Requirements

For full functionality in production, these must be configured on Vercel (or hosting):

| Variable / Service | Required for |
|------------------|--------------|
| `MONGO_URI` | All data |
| `JWT_SECRET` | Authentication |
| `RIYA_USERNAME`, `RIYA_PASSWORD` | Flight search & booking |
| `CLOUDINARY_*` | Document upload, ticket/invoice PDFs |
| `SMTP_*` | Welcome emails, approval emails, invoice emails |
| Deploy sync | Latest backend routes must be deployed before frontend uses new endpoints |

---

## Identified Gaps & Recommended Next Steps

### Priority 1 — Functional gaps

1. **Forgot password** — Add backend reset flow (email token) + frontend forms for all roles.
2. **Timesheet cron on production** — Set up Vercel Cron or a dedicated worker so auto-PRESENT runs in production.
3. **Environment secrets** — Confirm Riya, Cloudinary, SMTP, MongoDB are set on production Vercel.

### Priority 2 — Polish & data model

4. **Rig extended fields** — Add `type`, `region`, `status` to backend if client wants real data instead of UI simulation.
5. **Re-enable ticket email to crew** — Backend route exists but is commented out.
6. **Disable admin account** — If superadmin needs to suspend companies.

### Priority 3 — Future enhancements (not in current scope)

7. Payroll runs / pay periods / export  
8. Timesheet admin approval workflow  
9. Refresh token flow (only if sessions need to be shorter than 7 days)  
10. Automated API + E2E tests  
11. Dedicated staging environment  

---

## Demo Credentials (Local Development)

After running `npm run seed:demo -- --fresh` on the backend:

| Role | Email | Password |
|------|-------|----------|
| Superadmin | `superadmin@demo.local` | `Demo@123` |
| Admin | `admin@demo.local` | `Demo@123` |
| Crew | `crew1@demo.local`, `crew2@demo.local`, `crew3@demo.local` | `Demo@123` |

Login: `POST /auth/login` with JSON `{ "email", "password" }`.

---

## One-Paragraph Summary for Stakeholders

> **Lynq (Offshore CRM)** is a live, role-based platform for offshore crew operations. The React frontend and Node.js backend are **well aligned**: crew management, projects, rigs, invites, contracts, availability, timesheets, payroll rates, flight booking with superadmin approval, and invoicing all work through a shared REST API. **“Tickets” means travel/flight bookings on both sides** — there is no helpdesk module. Some UI elements (rig type/region/status, timeline Gantt) are **frontend-enhanced** using existing API data. **Password recovery** is the main missing feature. Production depends on correct Vercel environment configuration (MongoDB, Riya, Cloudinary, SMTP) and ensuring the timesheet cron runs outside serverless if auto-attendance is required.

---

## Reference Documents

| Document | Location |
|----------|----------|
| Backend full API & architecture | `docs/PROJECT_DOCUMENTATION.md` |
| Flight ticket approval (frontend sync) | `docs/frontend-ticket-approval-flow.md` |
| This client handoff | `docs/CLIENT_PROJECT_HANDOFF.md` |

---

*Prepared from verified review of:*
- *Frontend: `offShore-frontend-main` (React/Vite — Lynq)*
- *Backend: `marine-flight-backend` (Express/MongoDB)*

*Audit date: June 2026. Minor doc corrections applied after full frontend folder analysis.*
