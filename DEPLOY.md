# Deploy Prediction Bot to VPS

## Prerequisites

- A VPS running Ubuntu 22.04+ (or Debian 12+)
- A domain name with DNS access
- SSH access to the VPS

## 1. Install Docker on VPS

```bash
ssh user@your-vps-ip

sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER

# Log out and back in for group change to take effect
exit
ssh user@your-vps-ip

# Verify
docker --version
docker compose version
```

## 2. Point Domain to VPS

Go to your DNS provider and create an **A record**:

| Type | Name | Value         |
|------|------|---------------|
| A    | @    | YOUR_VPS_IP   |

Wait a few minutes for DNS propagation.

## 3. Upload Code to VPS

**Option A: Git (recommended)**

On your local machine:
```bash
cd c:\phuvinh\prediction-bot
git init
git add -A
git commit -m "initial commit"
git remote add origin git@github.com:YOUR_USER/prediction-bot.git
git push -u origin main
```

On VPS:
```bash
git clone git@github.com:YOUR_USER/prediction-bot.git
cd prediction-bot
```

**Option B: rsync**
```bash
rsync -avz --exclude node_modules --exclude .git \
  c:\phuvinh\prediction-bot/ user@your-vps-ip:~/prediction-bot/
```

## 4. Configure Environment

On the VPS, edit `.env.production`:

```bash
cd ~/prediction-bot
nano .env.production
```

Fill in your real values:
- `POSTGRES_PASSWORD` - use a strong password
- `OPENROUTER_API_KEY` - your OpenRouter API key
- `TAAPI_API_KEY` - your TAAPI API key
- `POLY_PROXY` - proxy string (if needed)
- `PRIVATE_KEY` - leave empty for now (only needed for placing real bets)

Set file permissions:
```bash
chmod 600 .env.production
```

## 5. Build and Start

```bash
docker compose up -d --build
```

This will:
1. Build the backend image (Node.js + Prisma)
2. Build the frontend image (React build + Nginx)
3. Start PostgreSQL, wait for it to be healthy
4. Start the backend connected to PostgreSQL
5. Start Nginx serving frontend + proxying API

## 6. Run Database Migration

```bash
docker compose exec backend npx prisma db push
```

## 7. Verify

- Open `http://your-domain` in browser - you should see the frontend
- Test API: `curl http://your-domain/api/predictions`

## Useful Commands

```bash
# View logs
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend

# Restart services
docker compose restart

# Stop everything
docker compose down

# Rebuild and restart (after code changes)
docker compose up -d --build

# Check service status
docker compose ps

# Access database
docker compose exec postgres psql -U prediction prediction_bot
```

## Updating

After pushing new code to the VPS:

```bash
cd ~/prediction-bot
git pull
docker compose up -d --build
docker compose exec backend npx prisma db push  # only if schema changed
```

## Troubleshooting

**Backend can't connect to database:**
```bash
docker compose logs postgres    # check if postgres is running
docker compose restart backend  # restart backend
```

**Frontend shows blank page:**
```bash
docker compose logs frontend    # check nginx logs
docker compose exec frontend cat /etc/nginx/conf.d/default.conf  # verify config
```

**Prediction fails (network/API errors):**
```bash
docker compose logs backend     # check backend logs for API errors
# If using proxy, verify POLY_PROXY in .env.production
```
