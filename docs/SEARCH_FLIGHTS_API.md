# Search Flights & Booking — API Reference

Base URL (local): `http://localhost:8000`  
Auth header: `Authorization: Bearer <ADMIN_JWT>`

These are the APIs used on the **Search Flights / book ticket** flow (`AdminTicketsPage`).

---

## Quick map (UI → API)

| UI action | Method | Endpoint |
|---|---|---|
| Type From / To | `GET` | `/airports/search` |
| Open Project dropdown | `GET` | `/project` |
| Open Crew (all) | `GET` | `/crew` |
| Open Crew (by project) | `GET` | `/project/:id/crew` |
| Availability check | `GET` | `/crew-availability/bulk` |
| Search flights | `POST` | `/crew-ticket/search-flights` |
| Book Now | `POST` | `/crew-ticket/book` |
| List booked tickets | `GET` | `/crew-ticket` |
| Ticket detail | `GET` | `/crew-ticket/:id` |
| Rigs (ticket UI) | `GET` | `/rig` |

There is **no separate “product search” API**. Flight inventory comes only from `POST /crew-ticket/search-flights` (backend calls **Riya Marine** + **Travel Terminus**).

---

## 1. Airport From / To search

**Usage:** Type in From/To fields → airport dropdown  
**Endpoint:** `GET /airports/search?query=DEL`  
**Auth:** Optional (token recommended)

Also available: `GET /crew-ticket/airports/search?query=Delhi` (same handler).

```bash
curl 'http://localhost:8000/airports/search?query=Delhi' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

---

## 2. Project list

**Usage:** Project dropdown on Search Flights  
**Endpoint:** `GET /project`  
**Auth:** Admin / Superadmin

```bash
curl 'http://localhost:8000/project' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

---

## 3. Crew list

**Usage:** Crew multi-select when loading general crew  
**Endpoint:** `GET /crew`  
**Auth:** Admin / Superadmin

Optional query filters: `projectId`, `availabilityStart`, `availabilityEnd`, `type`, `status`, etc.

```bash
curl 'http://localhost:8000/crew' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

---

## 4. Crew enrolled in project

**Usage:** After picking a project → crew list for that project  
**Endpoint:** `GET /project/:projectId/crew`  
**Auth:** Admin / Superadmin

```bash
curl 'http://localhost:8000/project/6a5a1077bd88a3861acbf64f/crew' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

---

## 5. Crew availability (bulk)

**Usage:** Before search / before book → conflict check on travel dates  
**Endpoint:** `GET /crew-availability/bulk?crew_ids=id1,id2`  
**Auth:** Admin

```bash
curl 'http://localhost:8000/crew-availability/bulk?crew_ids=6a042e034f8926bc740c1de9' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

---

## 6. Flight search (main)

**Usage:** Click **Search flights** → merged Riya + Travel Terminus results, each with random unused `ticketNumber`  
**Endpoint:** `POST /crew-ticket/search-flights`  
**Auth:** Admin

**Upstream (server-side only, not called from browser):**
- Riya Marine flight search
- Travel Terminus `search-stream`

```bash
curl 'http://localhost:8000/crew-ticket/search-flights' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "tripType":"one-way",
    "from":{
      "Name":"Delhi NCR [DEL] - Indira Gandhi International Airport, India",
      "Code":"DEL",
      "COUNTRY":"IN",
      "COUNTRYNAME":"India"
    },
    "to":{
      "Name":"Mumbai [BOM] - Chhatrapati Shivaji Maharaj International Airport, India",
      "Code":"BOM",
      "COUNTRY":"IN",
      "COUNTRYNAME":"India"
    },
    "departureDate":"2026-08-21",
    "adults":1,
    "children":0,
    "infants":0,
    "cabinClass":"economy",
    "currency":"GBP",
    "page":1,
    "sortBy":"duration",
    "sortOrder":"asc",
    "project_id":"6a5a1077bd88a3861acbf64f",
    "crew_ids":["6a042e034f8926bc740c1de9"]
  }'
```

**Response notes:**
- `flights[].ticketNumber` — random unused CRM serial (e.g. `"5036"`)
- `flights[].supplier` — `"riya"` or `"travelterminus"`
- `pagination` — `{ page, limit, total, totalPages }`

---

## 7. Book selected flight

**Usage:** **Book Now** → creates crew ticket(s), persists search `ticketNumber` when free  
**Endpoint:** `POST /crew-ticket/book`  
**Auth:** Admin

```bash
curl 'http://localhost:8000/crew-ticket/book' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "project_id":"6a5a1077bd88a3861acbf64f",
    "crew_ids":["6a042e034f8926bc740c1de9"],
    "flight":{
      "id":"<flight-id-from-search>",
      "ticketNumber":"5036",
      "supplier":"riya",
      "legs":[],
      "fares":[]
    },
    "price":820,
    "cashback":0,
    "currency":"GBP",
    "adult":1,
    "children":0,
    "infants":0,
    "travelDirection":"HOME_TO_RIG"
  }'
```

**Notes:**
- Send full `legs` / `fares` from the search result (not empty arrays in real use).
- Booked `ticketNumber` is unique and never reused.
- If the preferred number is already taken, backend allocates another unused random number.

---

## Related ticket-page APIs

### List booked tickets

```bash
curl 'http://localhost:8000/crew-ticket' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

### Ticket detail

```bash
curl 'http://localhost:8000/crew-ticket/<TICKET_ID>' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

### Rigs

```bash
curl 'http://localhost:8000/rig' \
  -H 'Authorization: Bearer <ADMIN_JWT>' \
  -H 'Accept: application/json'
```

---

## Auth

Admin login (to obtain `<ADMIN_JWT>`):

```bash
curl 'http://localhost:8000/admin/login' \
  -H 'Content-Type: application/json' \
  --data-raw '{"email":"marine-admin@yopmail.com","password":"<PASSWORD>"}'
```

Use the returned token as `Bearer <ADMIN_JWT>` on the calls above.
