# Logging - finding out what went wrong

Everything that happens is logged into one Postgres table, `app_logs`, so a
problem can be traced across the server, the Android phones and the browsers.
Query `app_logs_view`: it adds cafe-local time (`ist_time`) and the order
number (`order_number`, e.g. ORD-0042). Rows are deleted after **14 days**.

## Getting a psql prompt

```bash
# production (on the server)
docker compose exec db psql -U breaduser breadchapter
```

## What gets logged

| `source`  | Where from | What |
|-----------|------------|------|
| `server`  | every `logger.info/warn/error` call (`src/lib/logger.ts`) and anything printed with `console.error` - including Next.js' own unhandled errors | payments, KOT/bill queueing, print-bridge claims/reclaims, crashes in API routes |
| `device`  | Android app 1.1.2+ (`AppLogManager`), uploaded every 30s by `LogUploader`; kept on the phone while offline | app start (version, Android, battery-optimisation, Bluetooth, bridge settings), every print job (start / done / partial / failed / printer unreachable), Bluetooth connect and write problems, Pine Labs payments, page-load failures in the app, settings changes, crashes |
| `browser` | `src/components/ErrorReporter.tsx` in the POS and dashboard (also inside the app's WebView) | JS errors, unhandled promise rejections, every `/api` call that failed (5xx with the server's error message, 4xx refusals such as "Order is already BILLED", network failures). Includes the signed-in user and whether it ran inside the Android app |

Columns: `logged_at` (when it happened), `source`, `level` (`debug`/`info`/
`warn`/`error`), `event` (short code, e.g. `print.partial`), `message`,
`order_id`, `device_id`, `app_version`, `request_id` (server), `data` (JSON:
stack traces, HTTP status, page, user, phone model...).

**Never logged:** passwords, the print-bridge token, the Pine Labs app id,
card numbers / VPAs (see `scrubSecrets` in `src/lib/observability/logStore.ts`
and `src/lib/observability/redact.ts`).

## Useful queries

Everything about one order, in order:

```sql
SELECT ist_time, source, level, event, message, device_id
FROM app_logs_view WHERE order_number = 'ORD-0042' ORDER BY ist_time;
```

Problems in the last 2 hours:

```sql
SELECT ist_time, source, event, message, order_number, device_id
FROM app_logs_view
WHERE level IN ('warn', 'error') AND ist_time > (now() AT TIME ZONE 'Asia/Kolkata') - interval '2 hours'
ORDER BY ist_time DESC;
```

Printing trouble (bridge phone) today:

```sql
SELECT ist_time, level, event, message, order_number
FROM app_logs_view
WHERE source = 'device' AND (event LIKE 'print.%' OR event LIKE 'bridge.%' OR message ILIKE '%printer%')
  AND ist_time::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY ist_time;
```

One phone's timeline (the device id is shown at the top of the app's log
screen):

```sql
SELECT ist_time, level, event, message FROM app_logs_view
WHERE device_id = 'android-1a2b3c4d' ORDER BY ist_time DESC LIMIT 200;
```

Which phones are running which app version, and their latest start-up line:

```sql
SELECT DISTINCT ON (device_id) device_id, app_version, ist_time, message
FROM app_logs_view WHERE event = 'app.start' ORDER BY device_id, ist_time DESC;
```

Failed API calls from the POS/dashboard, most frequent first:

```sql
SELECT message, count(*), max(ist_time) AS last_seen
FROM app_logs_view WHERE source = 'browser' AND event IN ('api.error', 'api.rejected', 'api.network_error')
GROUP BY message ORDER BY count(*) DESC LIMIT 30;
```

Crashes:

```sql
SELECT ist_time, source, device_id, message, data->>'stack' AS stack
FROM app_logs_view WHERE event IN ('app.crash', 'console.error', 'browser.error') ORDER BY ist_time DESC;
```

## Adding logs

- **Server:** `logger.info|warn|error('area.what_happened', { orderId, ...fields })`.
  Pass `orderId` whenever there is one - it's what links the line to the
  order. Writing to the table is buffered and can never fail the request.
- **Android:** `AppLogManager.info|warn|error("area.event", "message", orderId)`.
  Use `debug(...)` for high-frequency noise: it shows on the phone's log
  screen but is neither saved nor uploaded.
- **Browser:** nothing to do - errors and failed `/api` calls are captured
  automatically.
