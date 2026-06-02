# Marine Flight Backend

Node.js backend initialized with **TypeScript**, **Express**, and **nodemon**.

## Scripts

- `npm run dev` – start the development server with nodemon + ts-node.
- `npm run build` – compile TypeScript to JavaScript in `dist`.
- `npm start` – run the compiled server from `dist`.

## Getting Started

1. Install dependencies (already done if you ran the setup):

   ```bash
   npm install
   ```

2. Run in development mode:

   ```bash
   npm run dev
   ```

3. Build and run production build:

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
| `GET` | `/superadmin/admin-invoices` | List stored invoices |
| `POST` | `/superadmin/admin-invoice/:projectId/upload` | `multipart/form-data`, field `pdf`, optional `margin` |
| `POST` | `/superadmin/admin-invoice/:projectId/send` | JSON `{ margin?, invoiceNumber? }` |

All require `Authorization: Bearer <superadmin_token>`.

### Admin panel bills

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/admin/admin-invoices` | Invoices (with PDF URLs) for projects owned by the logged-in admin |

Requires `Authorization: Bearer <admin_token>`. Response: `{ "adminInvoices": [...] }` (includes optional `projectTitle` per row).

