# Frontend Sync: Crew Ticket Approval Flow

This document describes the frontend changes needed to match the updated backend crew ticket flow.

## Flow Summary

1. Admin books a flight for one or more crew members.
2. Backend creates crew tickets with `status: "UNAPPROVED"`.
3. Backend emails the ticket, flight, crew, and project details to `vishwajeetbharadiya12@gmail.com`.
4. Superadmin reviews the ticket, adds a booking reference, and approves it.
5. Backend marks the ticket `APPROVED` with the booking reference.
6. Admin views/downloads the PDF through the authenticated backend endpoint `GET /crew-ticket/:id/pdf`.

## Ticket Fields

Ticket responses from `GET /crew-ticket`, `GET /crew-ticket/:id`, booking, and approval now include these approval fields:

```ts
type CrewTicketStatus = "UNAPPROVED" | "APPROVED";

type CrewTicket = {
  id: string;
  status: CrewTicketStatus;
  bookingReference?: string;
  approvedAt?: string;
  approvedBy?: string;
  pdf?: string;
  // existing fields remain unchanged
};
```

Frontend should treat missing `status` on old records as `UNAPPROVED` for display compatibility.

## Admin Booking UI

Endpoint remains:

```http
POST /crew-ticket/book
Authorization: Bearer <admin_token>
```

The existing request payload can stay the same. The response message now indicates tickets were sent for approval.

Expected response shape:

```ts
{
  message: string;
  crewTickets: CrewTicket[];
  flightId: string;
}
```

After booking:

- Show a success state like “Ticket booked and sent for approval.”
- Render new tickets as `UNAPPROVED`.
- Disable or hide “Download ticket” until `ticket.status === "APPROVED"`.
- Keep any billing display behavior unchanged because backend still applies billing at booking time.

## Admin Ticket List And Detail

Existing endpoints:

```http
GET /crew-ticket
GET /crew-ticket/:id
Authorization: Bearer <admin_token>
```

Recommended UI mapping:

- `UNAPPROVED`: show “Pending Approval” badge.
- `APPROVED`: show “Approved” badge.
- `bookingReference`: display when present, especially on detail pages.
- Do **not** open `ticket.pdf` directly if it is a Cloudinary URL — public PDF delivery may be blocked on the Cloudinary account.

## View / Download Approved Ticket PDF

Use the authenticated backend endpoint instead of opening a stored Cloudinary URL:

```http
GET /crew-ticket/:id/pdf
Authorization: Bearer <admin_or_superadmin_or_crew_token>
```

This returns `Content-Type: application/pdf` and streams a valid PDF generated from the approved ticket data.

Suggested action rules:

```ts
const canViewTicket = ticket.status === "APPROVED" && Boolean(ticket.bookingReference);
const canDownloadTicket = ticket.status === "APPROVED" && Boolean(ticket.bookingReference);
```

Frontend download/view example:

```ts
async function openApprovedTicketPdf(ticketId: string, token: string) {
  const res = await fetch(`${API_BASE}/crew-ticket/${ticketId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Could not load ticket PDF");
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
}
```

For download instead of inline view, use `Content-Disposition` from the response or create an anchor with `download`.

## Superadmin Approval UI

Add an approval action for unapproved tickets.

Endpoint:

```http
PATCH /crew-ticket/:id/approve
Authorization: Bearer <superadmin_token>
Content-Type: application/json
```

Request body:

```json
{
  "bookingReference": "8XT6HB"
}
```

Success response:

```ts
{
  message: "Crew ticket approved successfully.";
  crewTicket: CrewTicket;
  pdfDownloadUrl: `/crew-ticket/${string}/pdf`;
}
```

Frontend behavior:

- Show this action only for superadmin users.
- Show it only when `ticket.status !== "APPROVED"`.
- Require a non-empty booking reference before submit.
- Show a loading state because approval may take a moment.
- Replace the local ticket row/detail with the returned `crewTicket`.
- After success, display `APPROVED`, `bookingReference`, and enable PDF actions via `pdfDownloadUrl` or `GET /crew-ticket/:id/pdf`.

## Error Handling

Handle these approval responses:

- `400`: invalid or missing `bookingReference`.
- `401`: missing or expired token.
- `403`: user is not superadmin.
- `404`: ticket or crew no longer exists.
- `409`: ticket is already approved.
- `500`: server failure.

Recommended messages:

- `400`: “Enter a booking reference.”
- `403`: “Only superadmins can approve tickets.” / “Ticket PDF is available only after approval.”
- `409`: “This ticket has already been approved.”
- `500`: “Could not approve the ticket. Please try again.” / “Could not load ticket PDF.”

## Suggested UI States

Ticket status badge:

```ts
function getTicketStatusLabel(status?: string) {
  if (status === "APPROVED") return "Approved";
  return "Pending Approval";
}
```

Ticket action visibility:

```ts
const isApproved = ticket.status === "APPROVED";
const showApproveButton = currentUser.role === "superadmin" && !isApproved;
const showPdfActions = isApproved && Boolean(ticket.bookingReference);
```

## Frontend Checklist

- Add `status`, `bookingReference`, `approvedAt`, `approvedBy`, and `pdf` to ticket types.
- Update admin ticket list/detail to show approval status.
- Update post-booking messaging to say the ticket is pending approval.
- Add superadmin booking reference input and approval submit action.
- Add loading and error states for `PATCH /crew-ticket/:id/approve`.
- Use `GET /crew-ticket/:id/pdf` for view/download after approval.
- Hide or disable PDF actions until the ticket is approved and has a booking reference.
