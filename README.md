# Chainlink Runtime Environment (CRE) x Prediction Bot – Polymarket Up/Down BTC/ETH/SOL 

An **AI-powered prediction bot demo** for **UP/DOWN BTC/ETH/SOL** markets on **Polymarket**, built with:

- **Express + PostgreSQL + Prisma** backend
- **Vite + React + Tailwind + TanStack Query** frontend
- A decision agent for **UP/DOWN** powered by **TAAPI (technical indicators)** + **OpenRouter LLM**
- Off-chain settlement via **Polymarket Gamma API**, with the option to **place real orders via CLOB**.

---

## Table of Contents

- [Prediction Bot – Polymarket Up/Down BTC/ETH/SOL](#chainlink-runtime-environment-cre-x-prediction-bot--polymarket-updown-btcethsol)
  - [Table of Contents](#table-of-contents)
  - [1. What does this project do?](#1-what-does-this-project-do)
  - [2. Repository structure](#2-repository-structure)
  - [3. How it works](#3-how-it-works)
    - [3.1. High-level architecture](#31-high-level-architecture)
    - [3.2. Main flows](#32-main-flows)
  - [4. Prerequisites](#4-prerequisites)
  - [5. Quick Start](#5-quick-start)
    - [Option 1: Run locally (fastest dev)](#option-1-run-locally-fastest-dev)
    - [Option 2: Deploy to VPS with Docker](#option-2-deploy-to-vps-with-docker)
  - [6. Environment variables](#6-environment-variables)
  - [7. Core APIs](#7-core-apis)
  - [8. Security considerations](#8-security-considerations)
  - [9. About & Resources](#9-about--resources)
---

## 1. What does this project do?

`prediction-bot` is an **AI-powered prediction bot system** focused on predict **UP/DOWN BTC/ETH/SOL** markets on Polymarket. It enables:

1. **Users to connect their wallets** user can use their metamask to connect to website
2. **Users to request predictions** (e.g. BTC) from the frontend.
3. The backend to call a **PolymarketUpDownAgent**:
   - Fetches market data from **TAAPI** (short-term / long-term indicators).
   - Fetches the corresponding UP/DOWN market from **Polymarket Gamma API**.
   - Sends a snapshot + context to **OpenRouter LLM** and receives a decision **UP / DOWN / NO\_BET** with reasoning.
4. Results are stored in **PostgreSQL** (via Prisma) and displayed on the frontend.
5. Users can **place virtual bets** based on predictions, using an **internal balance in the DB**.
6. A cron job runs periodically (every 60s) and calls **Polymarket Gamma API** to check **whether markets have closed** and **which side won (UP or DOWN)**, then:
   - Updates bet status (`WON/LOST`) + PnL.
   - Credits user balances if they won.

**In short:** This is a prediction bot using **AI + TAAPI + Polymarket** to suggest UP/DOWN directions and simulate a virtual betting system with off-chain settlement.

---

## 2. Repository structure

The repository is split into three main parts (directory names may be simplified in the actual project):

```bash
.
├── backend/                 # Express API, business logic, Prisma
│   ├── polymarket/          # Polymarket Gamma, CLOB, TAAPI integration, ...
│   ├── services/            # Settlement service, cron jobs
│   ├── lib/                 # Serializers, user stats, helpers
│   └── server.ts            # Main entry point for API + cron
├── frontend/                # Vite + React + Tailwind + TanStack Query UI
│   └── src/
│       ├── components/      # PredictionForm, Portfolio, ...
│       └── context/         # AuthContext, frontend JWT wiring
├── docs/
│   └── prediction-bot-architecture-workflow-mermaid.md
│                           # Mermaid diagrams: architecture & workflows
├── DEPLOY.md               # Deployment guide for VPS + Docker
├── .env.example            # Environment template for local/dev
└── package.json            # Backend scripts and shared dependencies
```

For detailed architecture and flows, see:

- [`docs/prediction-bot-architecture-workflow-mermaid.md`](docs/prediction-bot-architecture-workflow-mermaid.md)

---

## 3. How it works

### 3.1. High-level architecture

The overall architecture is documented with mermaid diagrams in:

- [`docs/prediction-bot-architecture-workflow-mermaid.md`](docs/prediction-bot-architecture-workflow-mermaid.md) – section **1. System Architecture**

In summary:

- **User / Frontend layer**
  - `Vite + React` with Tailwind and TanStack Query.
  - UI for:
    - Wallet login (connect wallet → sign message).
    - Sending prediction requests (BTC/ETH/SOL).
    - Managing **virtual bets** and portfolio (balance, PnL).
- **Backend (Express)**
  - Core routes:
    - `/api/auth/nonce` & `/api/auth/verify` – wallet-based login with JWT.
    - `/api/predict?symbol=...` – calls `PolymarketUpDownAgent` for recommendations.
    - `/api/virtual-bet` & `/api/virtual-bets` – manage virtual bets.
    - `/api/place-bet` – (optional) place real orders on Polymarket CLOB.
    - `/api/user/profile` – return user info and balance.
  - Settlement cron:
    - `node-cron` runs every 60s to settle bets in `PENDING` state.
- **Polymarket Up/Down Agent**
  - `getCurrentMarketData` – calls **TAAPI** for multi-timeframe technical indicators.
  - `decideUpDown` – sends snapshot + context to **OpenRouter LLM**, receives JSON with:
    - `decision` (UP / DOWN / NO_BET)
    - `reasoning`
  - Integrates **Polymarket Gamma API** to map to real markets and outcomes.
- **External services**
  - **Polymarket Gamma API** – find markets by slug (e.g. `btc-updown-15m-{timestamp}`), read UP/DOWN prices and market status (closed or not).
  - **Polymarket CLOB** – access order book, prices, and place actual orders.
  - **TAAPI** – provides indicators for market data.
  - **OpenRouter LLM** – LLM used to generate reasoning and decisions.
- **Data layer (PostgreSQL + Prisma)**
  - Tables `User`, `Prediction`, `VirtualBet` as described in **6. Data Model (Prisma)** in the docs.
- **Settlement Cron**
  - Reads all `VirtualBet` records in `PENDING` status.
  - Groups them by `marketSlug`, checks if markets are closed.
  - Determines the **winning side** (UP or DOWN) based on outcome prices.
  - Updates bet status + PnL and updates user balances accordingly.

### 3.2. Main flows

Flows are described in detail in [`docs/prediction-bot-architecture-workflow-mermaid.md`](docs/prediction-bot-architecture-workflow-mermaid.md) with sequence diagrams:

- **Flow: Predict (fetch UP/DOWN prediction)** 
  - Frontend calls `GET /api/predict?symbol=BTC` (with Bearer JWT).
  - Backend calls the agent:
    - Fetches data from TAAPI and Polymarket Gamma.
    - Calls OpenRouter LLM → `{ reasoning, decision }`.
  - Writes a `Prediction` row and returns data to the frontend.

- **Flow: Virtual Bet**
  - Frontend sends `POST /api/virtual-bet` with `{ predictionId, direction, amount }`.
  - Backend checks balance, computes `potentialPayout`, creates a `VirtualBet`, and debits balance in a transaction.

- **Flow: Settlement (cron)** 
  - `node-cron` triggers `settlePendingBets` every 60s.
  - Calls Gamma, determines whether the market is closed and which side won.
  - Updates all related bets, computes PnL, and credits winners’ balances.

---

## 4. Prerequisites

To run this project you’ll need:

- **Node.js** v20+
- **npm** or **pnpm**
- **PostgreSQL** (local instance or via Docker)
- Accounts & API keys for:
  - **OpenRouter** (LLM)
  - **TAAPI** (technical indicators)
  - (Optional) Proxy / RPC endpoints for Polymarket access, if required

If you follow the Docker-based deployment guide, your VPS should run:

- Ubuntu 22.04+ or Debian 12+
- Docker + Docker Compose v2 (see [`DEPLOY.md`](DEPLOY.md))

---

## 5. Quick Start

### Option 1: Run locally (fastest dev)

**1. Clone the repo & install backend dependencies**

```bash
git clone https://github.com/<your-username>/prediction-bot.git
cd prediction-bot

# Install backend dependencies
npm install
```

**2. Install frontend dependencies**

```bash
cd frontend
npm install
cd ..
```

**3. Prepare PostgreSQL**

- If you already have a local PostgreSQL instance → create a `prediction_bot` DB (or any name you like) and configure the connection string in `.env`.
- Or run PostgreSQL via Docker (example):

```bash
docker run --name prediction-postgres -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=prediction_bot -p 5432:5432 -d postgres:16
```

**4. Create backend `.env`**

- Create `.env` in the repo root (or copy from `.env.example` if present) and fill:
  - PostgreSQL connection information (`DATABASE_URL` / ...).
  - `OPENROUTER_API_KEY`, `TAAPI_API_KEY`, `POLY_PROXY`, etc.

**5. Run migrations / sync schema with Prisma**

```bash
npx prisma db push
```

**6. Start the backend**

```bash
npm start
```

This is equivalent to:

- `npx tsx backend/server.ts`

**7. Start the frontend**

```bash
cd frontend
npm run dev
```

The frontend runs at `http://localhost:5173` by default (or whichever port Vite prints), and the backend on the port configured in `backend/server.ts` (e.g. `http://localhost:3000`).

### Option 2: Deploy to VPS with Docker

For production-style deployment (VPS + domain + HTTPS), see:

- [`DEPLOY.md`](DEPLOY.md) – **Deploy Prediction Bot to VPS**

It covers:

- Installing Docker & Docker Compose on the VPS.
- Pointing your domain to the VPS (A record).
- Uploading code (git / rsync).
- Configuring `.env.production`.
- Building & starting via `docker compose up -d --build`.
- Running `npx prisma db push` inside the backend container.

---

## 6. Environment variables

Exact names differ by `.env` file, but commonly include:

- **Database**
  - `DATABASE_URL` – PostgreSQL connection string (used by Prisma).
- **AI & Market data**
  - `OPENROUTER_API_KEY` – OpenRouter API key.
  - `TAAPI_API_KEY` – TAAPI API key.
- **Polymarket / Network**
  - `POLY_PROXY` – proxy string (if you need to go through a proxy).
  - (Optional) other config variables for Gamma/CLOB integration.
- **Auth / JWT**
  - `JWT_SECRET` – secret used to sign JWTs.

See also:

- `.env.example` (if present)
+- `.env.production` as described in [`DEPLOY.md`](DEPLOY.md)

---

## 7. Core APIs

The exact endpoints may change as the code evolves, but conceptually:

- **Auth**
  - `GET /api/auth/nonce?address=0x...`
  - `POST /api/auth/verify`
- **Prediction**
  - `GET /api/predict?symbol=BTC`
  - `GET /api/predictions` – prediction history for the current user.
- **Virtual Bets**
  - `POST /api/virtual-bet`
  - `GET /api/virtual-bets`
- **User**
  - `GET /api/user/profile`
- **Real Polymarket Bet (optional)**
  - `POST /api/place-bet`

Implementation details live under `backend/`; check the code there for the exact request/response shapes.

---

## 8. Security considerations

**⚠️ Important notes:**

1. **Demo, not production-ready:** This project has not been audited; do not use it with significant real funds.
2. **Do not commit secrets:** Ensure `.env`, `.env.production` and similar files are excluded from git.
3. **Use testnet/small amounts only:** If you enable real trading on Polymarket, only test with small positions.
4. **Protect sensitive endpoints:** Restrict or protect routes that can have financial impact (e.g. `place-bet`) with appropriate auth/roles.
5. **Monitoring:** Watch backend & cron logs and rate-limit outbound calls to TAAPI, OpenRouter, Gamma, and CLOB where appropriate.

---

## 9. About & Resources

- **Project:** `prediction-bot` – AI-powered prediction bot for Polymarket UP/DOWN markets.
- **Architecture details:** see [`docs/prediction-bot-architecture-workflow-mermaid.md`](docs/prediction-bot-architecture-workflow-mermaid.md).
- **Deployment guide:** see [`DEPLOY.md`](DEPLOY.md).

---



