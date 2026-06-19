# Marine Flight Backend

Node.js backend initialized with **TypeScript**, **Express**, and **nodemon**.

**Full project documentation:** [docs/PROJECT_DOCUMENTATION.md](docs/PROJECT_DOCUMENTATION.md)  
**Client brief (send to client):** [docs/CLIENT_BRIEF.md](docs/CLIENT_BRIEF.md)  
**Detailed alignment audit:** [docs/CLIENT_PROJECT_HANDOFF.md](docs/CLIENT_PROJECT_HANDOFF.md)

## Scripts

- `npm run dev` – start the development server with nodemon + ts-node.
- `npm run build` – compile TypeScript to JavaScript in `dist`.
- `npm start` – run the compiled server from `dist`.

## Getting Started

1. Install dependencies (already done if you ran the setup):

   ```bash
   npm install
   ```

2. Create local environment file:

   ```bash
   cp .env.example .env
   ```

   Minimum required value to boot the API:

   - `MONGO_URI` (MongoDB connection string)

3. Run in development mode:

   ```bash
   npm run dev
   ```

4. Seed demo data for local testing:

   ```bash
   npm run seed:demo -- --fresh
   ```

   Demo logins (password for all: `Demo@123`):

   | Role | Email |
   |------|-------|
   | Superadmin | `superadmin@demo.local` |
   | Admin | `admin@demo.local` |
   | Crew | `crew1@demo.local`, `crew2@demo.local`, `crew3@demo.local` |

   Login via `POST /auth/login` with `{ "email": "...", "password": "Demo@123" }`.

5. Build and run production build:

   ```bash
   npm run build
   npm start
   ```

## Local frontend integration

The API listens on `PORT` from `.env` (default **8000**). When running the Offshore frontend with `npm run dev`, set the Vite proxy target to this server:

```bash
# offShore-frontend/.env.development
VITE_API_PROXY_TARGET=http://localhost:8000
```

If the proxy points at the deployed Vercel URL before new routes are released, superadmin invoice calls will return **404** even though the local backend has them.

## Superadmin admin invoices

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/superadmin/admin-invoices` | List stored invoices (one per approved crew ticket) |
| `POST` | `/superadmin/admin-invoice/:ticketId/upload` | `multipart/form-data`, field `pdf`, optional `margin` |
| `POST` | `/superadmin/admin-invoice/:ticketId/send` | JSON `{ margin?, invoiceNumber? }` |
| `GET` | `/superadmin/admin-invoice/:ticketId/pdf` | Stream stored invoice PDF |

All require `Authorization: Bearer <superadmin_token>`.

### Admin panel bills

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/admin/admin-invoices` | Invoices (with PDF URLs) for projects owned by the logged-in admin |
| `GET` | `/admin/admin-invoice/:ticketId/pdf` | Stream invoice PDF for an owned ticket |

Requires `Authorization: Bearer <admin_token>`. Response: `{ "adminInvoices": [...] }` (includes `ticketId`, `projectId`, optional `passengerName` and `projectTitle` per row).

