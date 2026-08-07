# Dual Flight Supplier — Implementation Plan

**Goal:** Search Riya Marine + TravelTerminus together on the backend. Frontend search UI stays unchanged. Superadmin tickets show which supplier the booking came from.

**Scope for this ship:** Dual **search** + merge/rank + `supplier` on ticket + Superadmin badge. Booking stays local (manual PNR). No live TravelTerminus Book/wallet yet.

---

## Current system (Riya only)

| Piece | Today |
|-------|--------|
| Search | `POST /crew-ticket/search-flights` → `caching.corp.riya.travel` |
| Shape | `flights[]` with `legs[].itinerary[]`, `fares[]`, `stops`, markup applied |
| Connections | Already returned as multi-segment legs (A→C→B) |
| Round-trip | Two OW Riya calls, index-paired |
| Book | Local `CrewTicket` + superadmin enters `bookingReference` — **no live Riya ticket API** |
| Supplier field | **None** |

Key files: `crewTicket.controller.ts` (search/transform), `crewTicket.model.ts`, `AdminTicketsPage.tsx` (search UI), `SuperadminTicketsPage.tsx` (approve list).

---

## TravelTerminus (stage verified)

| Item | Value |
|------|--------|
| Stage URL | `https://api-stage.travelterminus.com` |
| Docs | `https://supplier-api.travelterminus.com` |
| Auth | `POST /api/auth/generate-token` → JWT, header `access-token`, 24h |
| Search | `GET /api/flights/search-stream` (SSE) |
| Offer shape | `route[]` with `flightSegments[0][]` (connections), `fare[0].totalFare`, `totalDuration` |
| Later book flow | Search → Branded Fare → Revalidate → Book (wallet) — **Phase 2** |

Credentials live only in backend `.env` (`TRAVELTERMINUS_*`). Never expose to frontend.

---

## Example (user intent)

User searches **A → B**.

1. Backend calls **Riya** and **TravelTerminus** in parallel for A→B.
2. Each may return:
   - Direct A→B
   - Connecting A→C→B (or more hubs) already inside one offer
3. All offers normalized to the **existing** flight JSON shape, tagged `supplier: "riya" | "travelterminus"`.
4. Rank (default): **shorter duration first**, then **lower price**. Optional user `sortBy` still works.
5. Admin search UI lists them as today — **no new supplier UI on search**.
6. On book, `supplier` is stored on `CrewTicket`.
7. Superadmin card shows badge **Riya Marine** or **Travel Terminus**.

**Not in this ship:** stitching A→X from Riya + X→B from TT into one synthetic ticket (needs hub graph). Both APIs already return connecting itineraries; we merge those catalogs.

---

## Architecture

```
POST /crew-ticket/search-flights
  → Promise.all([ searchRiya(...), searchTravelTerminus(...) ])
  → tag supplier + applyAdminLogic (markup) to both
  → merge + default rank (duration, price)
  → same response { flights, pagination }
```

```
POST /crew-ticket/book
  → persist supplier on CrewTicket (+ flightSnapshot.supplier)
```

```
SuperadminTicketsPage
  → badge from ticket.supplier only
```

---

## File changes

### Backend (new)

- `src/services/flight-suppliers/travelTerminus.service.ts` — token cache, SSE search, normalize → Riya-compatible flight objects
- `src/services/flight-suppliers/mergeFlights.ts` — merge + dedupe helpers + duration/price rank

### Backend (edit)

- `crewTicket.controller.ts` — parallel TT search; tag Riya results; default sort duration→price
- `crewTicket.model.ts` — `supplier?: "riya" | "travelterminus"`
- `lib/flight-snapshot.ts` — copy supplier into snapshot
- `.env` / `.env.example` — `TRAVELTERMINUS_BASE_URL`, `TRAVELTERMINUS_API_KEY`, `TRAVELTERMINUS_SECRET_KEY`

### Frontend (minimal)

- `api/flightSearch.ts` — pass `flight.supplier` on book (no search UI)
- `types/flight.ts` — optional `supplier`
- `api/ticket.ts` — `CrewTicketApi.supplier`
- `SuperadminTicketsPage.tsx` + CSS — supplier badge only

---

## Ranking rules

1. If client sends `sortBy`, use existing sort (marine boost for Riya marine fares kept).
2. If no `sortBy`: duration ascending, then price ascending.
3. Failed supplier does not fail the whole search — log and return the other.

---

## Phase 2 (later)

- Live TT Book (branded → revalidate → book + wallet check)
- Cross-supplier hub stitch
- Supplier filter on admin search (only if product asks)

---

## Acceptance

- [x] Search returns mixed Riya + TT offers with same JSON shape
- [x] Faster/cheaper offers surface first when unsorted
- [x] Admin search page unchanged visually
- [x] Booked ticket stores `supplier`
- [x] Superadmin list/detail shows Riya Marine / Travel Terminus
- [x] Empty TT credentials → Riya-only (graceful)

## Implemented (this ship)

| Area | Status |
|------|--------|
| Plan doc | `docs/DUAL_FLIGHT_SUPPLIER_PLAN.md` |
| TT auth + SSE search | `src/services/flight-suppliers/travelTerminus.service.ts` |
| Merge / rank | `src/services/flight-suppliers/mergeFlights.ts` |
| Dual search wire | `crewTicket.controller.ts` `searchFlightsController` |
| Persist supplier | `crewTicket.model.ts` + book + snapshot |
| Superadmin badge | `SuperadminTicketsPage` only |
| Env | `TRAVELTERMINUS_*` in `.env` / `.env.example` |
