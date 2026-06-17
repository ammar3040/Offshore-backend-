import { optionalPaginationQuerySchema } from "./pagination.validation";

/** GET /superadmin/admin-invoices — optional pagination */
export const listAdminInvoicesQuerySchema = optionalPaginationQuerySchema;
