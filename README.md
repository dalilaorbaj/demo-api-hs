# HubSpot CRM Dashboard — demo-api-hs

A full-stack web application for visualizing and analyzing HubSpot CRM data. Built as a demo for tracking sales team activity, pipeline health, and CRM adoption.

## Features

- **Basics** — searchable/sortable tables for contacts, deals, tasks, and activity feed (calls, emails, meetings, notes)
- **Dashboard** — KPI cards, funnel chart, task breakdown, contacts timeline, and stale deals alert
- **By seller** — per-rep filter with individual KPIs, deal and task tables
- **Pipeline board** — Kanban view by pipeline and stage, with deal counts and total value per column
- **Adoption** — team adoption scoring across 6 dimensions (activity, creation, pipeline moves, consistency, recency, task completion), radar charts per seller, ranking table, weekly evolution chart

## Architecture

```
Browser (React + Recharts)
        ↕ /api/*
Express server (Node.js, port 3001)
  ├── File-based cache (.cache/)
  ├── Rate limiter (Bottleneck — ~4.5 req/s)
  └── HubSpot Private App API
```

The backend proxies all HubSpot API calls so the token never reaches the browser. Responses are cached on disk with configurable TTLs (1 h for static data, 5 min for CRM lists).

## Requirements

- Node.js 18+
- A [HubSpot Private App](https://developers.hubspot.com/docs/api/private-apps) token with read access to Contacts, Deals, Tasks, and Engagements

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env
# Edit .env and set your HS_TOKEN

# 3. Start dev mode (backend + frontend with hot reload)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend (port 3001) + Vite dev server (port 5173) concurrently |
| `npm run build` | Build frontend to `dist/` |
| `npm start` | Start backend only (serves the built `dist/` if present) |

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HS_TOKEN` | Yes | — | HubSpot Private App token |
| `PORT` | No | `3001` | Backend port |

## Cache & rate limiting

The server caches HubSpot responses in `.cache/` (gitignored). Cache TTLs:
- Static data (pipelines, owners, properties): **1 hour**
- CRM lists (contacts, deals, tasks, activities): **5 minutes**

To force a fresh fetch from the UI, use the **Refresh** button in the top bar, which shows per-request timing and cache stats.

Rate limiting is handled by Bottleneck: max 2 concurrent requests, 220 ms minimum between calls (≈ 4.5 req/s, well within HubSpot's 100 req/10 s limit).

## Adoption scoring

Each seller gets a score from 0–100 across 6 weighted dimensions:

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| Activity | 25 % | Calls, emails, meetings, notes logged in the last 10 weeks |
| Creation | 20 % | Contacts and deals created |
| Pipeline moves | 15 % | Manual stage changes in HubSpot UI |
| Consistency | 20 % | Number of distinct weeks with at least one CRM event |
| Recency | 10 % | Days since the last CRM event (fresher = higher) |
| Tasks | 10 % | Task completion rate |

Sellers listed in `EXCLUDED_SELLERS` (admins, managers) are excluded from the scoring table.

## Tech stack

- **Frontend**: React 18, TypeScript, Vite, TanStack Query (React Query), Recharts
- **Backend**: Node.js, Express, Bottleneck, dotenv
- **Cache**: Custom file-based cache with SHA-1 keying

## License

MIT
