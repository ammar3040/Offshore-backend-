# Lynq (Offshore CRM) — Client Brief

**Product:** Crew management platform for offshore marine / oil & gas  
**Stack:** React frontend + Node.js API + MongoDB  
**Audit:** June 2026 — reviewed frontend and backend codebases

### Live URLs (Vercel — confirmed reachable)

| Service | URL |
|---------|-----|
| **Frontend (Admin login)** | https://off-shore-frontend.vercel.app/login |
| **Frontend (Crew login)** | https://off-shore-frontend.vercel.app/panel/crew/login |
| **Frontend (Superadmin login)** | https://off-shore-frontend.vercel.app/panel/superadmin/login |
| **Backend API** | https://marine-flight-backend.vercel.app/ |

The backend responds live (`/health` returns OK). To **test flows and find issues on production**, please share login credentials for Admin, Crew, and/or Superadmin accounts on the live environment.

---

## 1. What This Product Does

Lynq helps companies manage offshore crew end-to-end:

- Register crew (passports, certificates, documents)
- Assign crew to **projects** and **oil rigs**
- **Book and approve flights** for crew rotation
- Track **timesheets**, **payroll rates**, and **contracts**
- Bill admin companies via **invoicing**

Three separate portals:

| Portal | Who | Login |
|--------|-----|-------|
| **Admin** | Operations managers | `/login` |
| **Crew** | Offshore workers | `/panel/crew/login` |
| **Superadmin** | Platform owner | `/panel/superadmin/login` |

---

## 2. Overall Status

| Area | Status |
|------|--------|
| Frontend UI | **Ready** — 20+ pages, dark mode, mobile-friendly |
| Backend API | **Ready** — full REST API on Vercel |
| Frontend ↔ Backend alignment | **Strong** — core modules connected |
| Production deployment | **Live** on Vercel |
| Staging environment | **Not set up** |
| Automated tests | **None** on either side |

**Bottom line:** The product is **functional and live**. It is not a prototype — real CRUD, real flight booking flow, real invoicing. A few items are simplified or UI-only (see below).

---

## 3. What Works Today (Verified)

| Module | What it does |
|--------|----------------|
| **Login** | All 3 roles via `POST /auth/login` + JWT |
| **Crew** | Full profiles, documents (Cloudinary), list with status badges |
| **Projects** | Create, assign crew, dates, status (active / on hold / finished) |
| **Rigs** | Create and link rigs to projects |
| **Invites & contracts** | Invite crew → accept → signed contract on file |
| **Availability** | Crew sets available date ranges |
| **Timesheets** | Crew marks Present / Absent / Leave per project day |
| **Payroll** | Set pay rate per crew per project (hour / day / project) |
| **Travel tickets** | Search flights → book → superadmin approves → PDF download |
| **Invoicing** | Superadmin generates/sends bills; admin views and downloads |
| **Timeline** | Calendar + Gantt built in frontend from live API data |
| **Superadmin** | Analytics, create admins, set markup/pricing |

### Important clarification: “Tickets” = Flights

On **both** frontend and backend, **Tickets means flight/travel bookings** — not a customer support helpdesk. There is no helpdesk module and none is needed for current scope.

**Flight flow:**
```
Admin searches & books → UNAPPROVED → Superadmin adds booking ref & approves → APPROVED → PDF available
```

---

## 4. What Is Simplified or UI-Only

These work in the UI but are **not full backend features**:

| Item | Reality |
|------|---------|
| **Rig type, region, status** (FPSO, North Sea, Operational) | Shown on rig list only — parsed from description or mocked in React. Detail page shows real API fields only. |
| **Timeline / Gantt** | Built client-side from crew + projects + rigs + tickets. No separate timeline API (not needed). |
| **Payroll** | Rate configuration only — no pay runs, pay periods, or payslip export. |
| **Timesheets** | Crew self-service only — no admin review/approval step. |
| **Crew status badges** | Driven by backend `signal` field (GREEN / RED / ORANGE), not a stored status column. |
| **Self-registration** | Disabled by design — superadmin creates admin accounts. |
| **Refresh tokens** | Not implemented — single JWT (~7 days). |

---

## 5. Gaps (What Is Missing)

| Gap | Impact | Priority |
|-----|--------|----------|
| **Forgot password** | Login links are dead; crew settings form calls an API that does not exist yet | **High** |
| **Timesheet auto-fill cron** | Backend marks Present daily — may not run on Vercel serverless without a cron job | **High** |
| **Production secrets** | Flight search (Riya), email (SMTP), file storage (Cloudinary) need Vercel env vars | **High** |
| **Ticket email to crew** | Backend endpoint disabled (commented out) | Medium |
| **Rig extended fields** | Type/region/status not in database | Medium (if client wants real data) |
| **Disable admin account** | Superadmin cannot suspend a company yet | Low |
| **Staging environment** | Only production Vercel today | Low |
| **Automated tests** | No test suite | Low |

---

## 6. Production Requirements

For everything to work live, these must be configured on Vercel:

| Service | Used for |
|---------|----------|
| MongoDB (`MONGO_URI`) | All data |
| JWT secret | Authentication |
| Riya credentials | Flight search & booking |
| Cloudinary | Documents & PDFs |
| SMTP | Welcome emails, approvals, invoices |

Without Riya → flight search fails. Without Cloudinary → uploads fail. Without SMTP → emails do not send. **Data and login still work.**

---

## 7. Recommended Next Steps

**Phase 1 — Must do**
1. Add forgot-password API + login forms (all roles)
2. Confirm all Vercel environment variables are set
3. Set up Vercel Cron (or worker) for daily timesheet auto-PRESENT

**Phase 2 — Should do**
4. Re-enable crew ticket email on backend (frontend already has the button)
5. Add rig `type`, `region`, `status` to database if client wants real fleet data
6. Verify `subseacore.com` custom domain (if used)

**Phase 3 — Future (out of current scope)**
7. Payroll runs & export  
8. Timesheet admin approval  
9. Staging environment  
10. Automated tests  

---

## 8. Module Checklist (At a Glance)

| Module | Frontend | Backend | Status |
|--------|----------|---------|--------|
| Login | ✅ | ✅ | **Done** |
| Crew management | ✅ | ✅ | **Done** |
| Projects & rigs | ✅ | ✅ | **Done** |
| Invites & contracts | ✅ | ✅ | **Done** |
| Availability | ✅ | ✅ | **Done** |
| Timesheets | ✅ | ✅ | **Done** (no admin approval) |
| Payroll rates | ✅ | ✅ | **Done** (simplified) |
| Flight tickets | ✅ | ✅ | **Done** |
| Invoicing | ✅ | ✅ | **Done** |
| Timeline | ✅ | N/A (client-side) | **Done** |
| Forgot password | ❌ | ❌ | **Gap** |
| Helpdesk tickets | N/A | N/A | **Not in scope** |
| Payroll runs | ❌ | ❌ | **Future** |

---

## 9. Summary for Stakeholders

> **Lynq** is a live offshore crew management platform with Admin, Crew, and Superadmin portals. The React frontend and Node.js backend are **well aligned** — crew, projects, rigs, contracts, availability, timesheets, payroll rates, flight booking with approval, and invoicing all work through a shared API. **“Tickets” means flight bookings**, not helpdesk. Some rig metadata and the timeline view are **frontend-enhanced**. The main missing piece is **password recovery**. Production reliability depends on **environment configuration** and a **cron job** for timesheets.

**Note:** Code review and alignment checks were done against both repositories. Behaviour was also checked locally using sample/dummy data. **Live production testing** (full end-to-end on Vercel) requires credentials from the client — see Live URLs above.

---

*Full technical reference (internal): `docs/PROJECT_DOCUMENTATION.md` · Detailed audit: `docs/CLIENT_PROJECT_HANDOFF.md`*
