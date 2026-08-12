# Optimized Multi-Supplier Ticket Stitching

Stitches **Riya Marine** and **Travel Terminus** one-way segments into synthetic multi-leg A→…→Z itineraries with a **minimum 3-hour connection gap**, then returns a small Pareto shortlist (≈4–8).

This is the feature deferred in `DUAL_FLIGHT_SUPPLIER_PLAN.md` (“stitching A→X from Riya + X→B from TT”).

## Endpoint

`POST /crew-ticket/optimize-flights` (admin auth)

### Request body

Same shape as search-flights (`from`, `to`, `departureDate`, adults/cabin/currency, optional `project_id` / `crew_ids`), plus:

| Field | Default | Notes |
|---|---|---|
| `minConnectionHours` | `3` | Hard gap between arrival and next departure |
| `maxHops` | `2` | `2` = A→H→Z; `3` allows A→H1→H2→Z (capped) |
| `limit` | `8` | Max shortlist size (1–20) |
| `tripType` | `one-way` | **v1 = one-way only** |

### Response

```json
{
  "flights": [ /* OptimizedFlight[] */ ],
  "baseline": { "bestPrice": 420, "bestDurationMinutes": 185 },
  "hubs": ["AMD", "BOM", "BLR"],
  "pagination": { "page": 1, "limit": 5, "total": 5, "totalPages": 1 }
}
```

Each flight matches the search JSON shape, plus:

- `optimized: true`
- `optimizationKind`: `cheaper_faster` | `faster` | `cheaper` | `balanced`
- `supplier`: `mixed` | `riya` | `travelterminus`
- `legs[]` each may include `supplier`
- `connectionGaps[]`: `{ airport, duration, hours }`
- `baselineDelta`: `{ price, durationMinutes }`
- `ticketNumber`: random unused CRM serial (same allocator as search)

## Rules

1. **Connection gap:** `L2.dep >= L1.arr + minConnectionHours` (default 3h). Times compared as ISO local strings on segments.
2. **Hubs:** hybrid — dynamic hubs from A→Z offers + fixed gateways (`DEL, BOM, HYD, BLR, MAA, AMD, CCU, PNQ, GOI, COK, DXB, AUH, SIN, LHR, DOH`), exclude origin/destination, cap ≤ 6.
3. **Segments:** dual supplier per OD (Riya + TT), cache reused via `flightSearchCache`. Prefer non-stop top-K (≤5) per segment; inbound also searches `departureDate + 1`.
4. **Duration cap:** ≤ ~`baselineBestDuration * 1.6` with overnight allowance (+18–24h intl), absolute caps (~36h domestic / ~72h intl).
5. **Shortlist:** prefer options that beat baseline on at least one axis; if none pass the strict bar, fall back to best scored connections under the duration cap.
6. **Book:** `POST /crew-ticket/book` with multi-leg `flight`, `supplier: "mixed"`, `optimized: true`. One `CrewTicket`, one ticket number; superadmin still enters one booking reference (v1).

On the admin UI, **Optimized tickets** opens a dialog to set **Gap between tickets (hours)** (default 3, range 1–24) before running.

## Curl examples

### Optimize (after a normal search is recommended so cache is warm)

```bash
curl -s -X POST "$API/crew-ticket/optimize-flights" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tripType": "one-way",
    "from": { "Name": "Delhi NCR [DEL] - Indira Gandhi International Airport, India", "COUNTRY": "IN", "COUNTRYNAME": "India" },
    "to": { "Name": "Hyderabad [HYD] - Rajiv Gandhi International Airport, India", "COUNTRY": "IN", "COUNTRYNAME": "India" },
    "departureDate": "2026-09-15",
    "adults": 1,
    "cabinClass": "economy",
    "currency": "GBP",
    "minConnectionHours": 3,
    "maxHops": 2,
    "limit": 8
  }'
```

### Book an optimized card

Pass the flight object from the optimize response (including `legs` with per-leg `supplier`, `optimized`, `ticketNumber`):

```bash
curl -s -X POST "$API/crew-ticket/book" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "crew_ids": ["<crewObjectId>"],
    "flight": { "...optimized flight from response..." },
    "price": 380,
    "currency": "GBP",
    "adult": 1,
    "children": 0,
    "infants": 0,
    "travelDirection": "HOME_TO_RIG"
  }'
```

## UI

On **Tickets → Search Flights** (one-way only): after a successful search, **Optimized tickets** loads the shortlist. Cards show route chain, connection chips, kind badge, and MIXED side ribbon. Book uses the existing confirm dialog with per-leg MARINE/GENERAL labels. Superadmin shows **Optimized / Mixed**.

## Out of scope (v1)

- Live airline revalidation / live ticketing per segment
- Optimized round-trip / multi-city
- Guaranteed global optimum (heuristic shortlist only)

## Manual verification (automated smoke)

- **3h gap:** `stitchTwoHop` accepts 3h30m connection; rejects 2h connection.
- **IATA parse:** `extractIataCode('Delhi [DEL]')` → `DEL`.
- **Shortlist:** cheaper mixed stitches vs a direct baseline are retained.
- **Compile:** backend + frontend `tsc --noEmit` clean.
- **Wiring:** route `POST /optimize-flights`, UI CTA, docs present.

Live supplier checks (DEL→HYD, long-haul, book → superadmin) should be run against a running API with Riya/TT credentials.