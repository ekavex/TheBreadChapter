# Setup Guide - The Bread Chapter

Get the Smart Cafe System running on any machine in minutes. Docker handles the database, the build, and all dependencies - you only need Git and Docker.

---

## Prerequisites

| Tool | Min. version | Install |
|---|---|---|
| Docker + Docker Compose | v24+ | [docs.docker.com/get-docker](https://docs.docker.com/get-docker) |
| Git | any | [git-scm.com](https://git-scm.com) |
| openssl | any | Pre-installed on Linux/macOS |

> **Note** - Node.js is not required on the host. The app builds and runs entirely inside Docker.

---

## First-time Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-org/TheBreadChapter.git
cd TheBreadChapter
```

### 2. Create the environment file

```bash
cp .env.example .env
nano .env   # or use any text editor
```

Two fields you **must** set:

| Variable | How to get it |
|---|---|
| `POSTGRES_PASSWORD` | Choose any strong password |
| `AUTH_SESSION_SECRET` | Run `openssl rand -hex 32` and paste the output |

Everything else is optional with safe defaults.

### 3. Build and start

```bash
docker compose up -d --build
```

First run takes 3–5 minutes (builds the Next.js image, pulls Postgres). Subsequent starts take seconds.

### 4. Verify

```bash
docker compose ps
# Both "app" and "db" should show Status: running (healthy)
```

Then open **http://localhost:3000** (or `http://your-server-ip:3000` for VPS).

---

## Default Credentials

Three accounts are created automatically from the schema seed.

| Role | User ID | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Manager | `manager` | `manager123` |
| Staff | `staff` | `staff123` |

> **Production** - change passwords via the Admin panel at `/dashboard/admin` after first login. The seed also inserts demo cafe and menu data; clear it before going live.

---

## Day-to-Day Commands

| What | Command |
|---|---|
| Start (background) | `docker compose up -d` |
| Stop | `docker compose down` |
| App logs (live) | `docker compose logs app -f` |
| DB logs | `docker compose logs db -f` |
| Open DB console | `docker compose exec db psql -U breaduser -d breadchapter` |
| Rebuild after code change | `docker compose up -d --build` |
| Wipe all data (destructive) | `docker compose down -v` |

**Change the port** - set `APP_PORT=8080` in `.env`. The app will be at `http://localhost:8080`.

---

## Updating the App

Pull the latest code and rebuild the app container. The database volume is untouched.

```bash
git pull
docker compose up -d --build
```

> **Schema migrations** - if the DB schema changed, apply the new SQL manually via the DB console or add the file to `docker/schema.sql` before rebuilding. The init script only runs on an empty volume (first start).

---

## VPS / Nginx Reverse Proxy

To serve on a domain with SSL, put Nginx in front and proxy to `localhost:3000`.

### Nginx config

```nginx
server {
    server_name  yourdomain.com;
    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
    }
}
```

### SSL with Certbot

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d yourdomain.com
```

After getting the certificate, set `NEXT_PUBLIC_APP_URL=https://yourdomain.com` in `.env` and rebuild.

### Firewall

Open ports 80 and 443. Port 3000 does **not** need to be public - Nginx proxies to it internally.

```bash
ufw allow 80 && ufw allow 443
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `db` container not healthy | Run `docker compose logs db` - usually a wrong `POSTGRES_PASSWORD` or port 5432 conflict |
| App crashes on start | `docker compose logs app` - look for `DATABASE_URL` or missing env var errors |
| Build fails with TS error | Run `npm run build` locally first to catch errors before deploying |
| Port 3000 already in use | Set `APP_PORT=3001` in `.env` |
| Schema not applied on fresh start | Init script only runs on empty volume - run `docker compose down -v` then `up -d --build` |
| QR codes point to wrong URL | Set `NEXT_PUBLIC_APP_URL` to the public domain/IP in `.env` and rebuild |
