# Pine Labs Cloud Integration — Developer Master Guide

**Device:** Pine Labs A910S (Plutus Smart, Android EDC)
**Integration type:** Cloud (RESTful JSON), server-to-server
**Applies to:** Smart Cafe Management System — Module 5 (Order, KOT Routing & Payment)

> **Source & disclaimer.** This guide is built from Pine Labs' Cloud Integration spec (UploadBilledTransaction / GetStatus / CancelTransaction / Force Cancel / Post Back URL). Exact endpoint **paths** for Upload and GetStatus are not fully spelled out in the spec we have (only the base pattern `.../API/CloudBasedIntegration/V1/...` is confirmed via the Force Cancel URL). **Confirm the exact paths, the production host, and your credentials with Pine Labs before go-live.** Field names/codes below are copied from the spec; treat them as authoritative for UAT and re-verify at onboarding.

---

## 1. The one idea that shapes everything

**In cloud integration, the A910S is ONLY the payment terminal. Your web app is NOT deployed on the device.**

The spec's own words: the goal is to "integrate a billing application on tablet / smartphone / any other device without using local connectivity." Your billing app (browser/tablet/phone) and the A910S are linked *only* through Pine Labs' cloud, using a **PTRID** (Plutus Transaction Reference ID) plus your `ClientId` / `StoreId`.

Consequences (do not design against these):

- Your ordering UI stays a normal web app. **No app certification/deployment onto the locked-down device is needed** for the ordering flow.
- All calls to Pine Labs happen **from your backend**, never the browser (your `SecurityToken` is a secret — see §4).
- The A910S needs only to be **registered to the cloud** and configured with the allowed payment modes.
- The link between "the bill in your system" and "the payment on the terminal" is the **PTRID** returned by Upload. Everything hangs off that value.

```
   Web app (waiter, any device)          A910S terminal (payment only)
            │                                      ▲
            │ order actions                        │ picks up open txn by ClientId
            ▼                                      │
   ┌──────────────────────────┐   Upload/GetStatus/Cancel   ┌──────────────┐
   │   YOUR BACKEND (truth)    │ ─────────────────────────► │ Pine Labs    │
   │  orders, PTRID mapping,   │ ◄───────────────────────── │ Cloud        │
   │  stock, dashboard         │      Post Back webhook      └──────────────┘
   └──────────────────────────┘
```

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **PTRID** (`PlutusTransactionReferenceID`) | Numeric id Pine Labs returns from Upload. The join key between your order and the payment. |
| **TransactionNumber** | **Your** unique id for the bill/transaction. You generate it. Reconciliation key. |
| **SequenceNumber** | 1 unless a single bill is split across multiple tenders (split tendering). |
| **MerchantID** | Allotted by Pine Labs. Identifies the merchant. Secret-ish. |
| **SecurityToken** | Allotted by Pine Labs. **Secret.** Auth credential for every call. |
| **StoreId** | Identifies a store. Used when one billing system talks to **multiple** terminals in a store. |
| **ClientId** | Identifies **one** terminal (POS/EDC). Used to route a txn to a specific A910S. |
| **RRN / ApprovalCode / TransactionLogId** | Bank/acquirer references returned on success; store them for reconciliation. |
| **Amount** | **Always in paisa, integer.** ₹250.00 → `25000`. |

---

## 3. Prerequisites (do these before writing integration code)

1. **Merchant onboarding with Pine Labs** for cloud integration. Obtain:
   - `MerchantID`
   - `SecurityToken`
   - `StoreId`
   - `ClientId` for each A910S terminal
2. **Register each A910S** to the cloud and configure the **payment modes** the cafe will accept (Card, Cash, UPI).
3. **UAT access**: base host `https://www.plutuscloudserviceuat.in:8201`, plus a **UAT test terminal / TID** so you can run transactions without real money.
4. **Confirm exact endpoint paths** for Upload and GetStatus (Force Cancel is `.../API/CloudBasedIntegration/V1/CancelTransactionForced`).
5. **Register a Post Back URL** (your webhook) with Pine Labs if you want pushed status updates (recommended — see §8).
6. Decide **ClientId vs StoreId** usage (see §11) based on how many terminals the cafe runs.

---

## 4. Security model (mandatory)

- **All Pine Labs calls originate from your backend.** The browser/terminal-facing web app must never hold `MerchantID` / `SecurityToken`.
- Store credentials in server-side secrets (env vars / secret manager), not in code or the repo.
- The Post Back URL must be **HTTPS**, and you should **validate** incoming callbacks (allowlist Pine Labs source if possible, and always re-verify with GetStatus before acting on money — treat the callback as a *trigger*, not as trusted final truth).
- Log every request/response (with card numbers already masked by Pine Labs as `************1234`) for audit and reconciliation.

---

## 5. The API surface

Base (UAT): `https://www.plutuscloudserviceuat.in:8201`
Path pattern (confirmed for force-cancel): `/API/CloudBasedIntegration/V1/<Operation>`
Method: `POST`, `Content-Type: application/json`

You will use four operations:

1. **UploadBilledTransaction** — create the payable transaction, get a PTRID.
2. **GetStatus** — fetch final transaction result by PTRID.
3. **CancelTransaction / CancelTransactionForced** — cancel an open/stuck transaction.
4. **Post Back URL** — Pine Labs pushes the result to your webhook (alternative to polling GetStatus).

---

### 5.1 UploadBilledTransaction

**Purpose:** push a bill to Pine Labs; receive a PTRID that the A910S will settle against.

**Key request fields** (full list in the spec; these are the ones you need for cafe Card/Cash/UPI):

| Field | Type | Notes | Req |
|---|---|---|---|
| `TransactionNumber` | AN | **Your** unique bill id (e.g. `ORDER-1042`). | M |
| `SequenceNumber` | N | `1` (higher only for split tender). | M |
| `AllowedPaymentMode` | AN | Pipe-joined codes, e.g. `1\|2\|10` = Card, Cash, UPI Sale. `0` = all enabled on terminal. | M |
| `Amount` | N | **Paisa**, integer. ₹250 → `25000`. | M |
| `MerchantID` | N | From Pine Labs. | M |
| `SecurityToken` | AN | From Pine Labs. **Secret.** | M |
| `StoreId` | N | From Pine Labs. | C (mandatory in practice) |
| `ClientId` | N | Target terminal. Mandatory for "zero-click" routing to a specific A910S. | O/C |
| `TotalInvoiceAmount` | N | Paisa. Usually equals `Amount` for a single tender. | O |
| `UserID` | AN | Cashier/waiter id. | C |
| `AutoCancelDurationInMinutes` | N | Auto-cancel the request if not completed (e.g. `5`). Use this. | O |
| `ForceCancelOnBack` | B | If true, pressing Back on terminal force-cancels the txn. | O |

**Payment mode codes you care about:** `1` Card · `2` Cash · `10` UPI Sale · `11` UPI Bharat QR. (Many others exist — EMI, wallets, Zomato/Swiggy, etc. — ignore for v1 unless the client asks.)

**Example request (cafe bill ₹250, allow Card/Cash/UPI):**

```json
{
  "TransactionNumber": "ORDER-1042",
  "SequenceNumber": 1,
  "AllowedPaymentMode": "1|2|10",
  "Amount": 25000,
  "TotalInvoiceAmount": 25000,
  "MerchantID": 1234,
  "SecurityToken": "70D7509C-0A90-4938-A7F9-DB99B9B841D9",
  "StoreId": 61607,
  "ClientId": 318462,
  "UserID": "WAITER_04",
  "AutoCancelDurationInMinutes": 5
}
```

**Response fields:** `ResponseCode` (**0 = success**, non-0 = failure), `ResponseMessage`, `PlutusTransactionReferenceID`, `AdditionalInfo`.

```json
{ "ResponseCode": 0, "ResponseMessage": "APPROVED", "PlutusTransactionReferenceID": 501 }
```

Declined example:

```json
{ "ResponseCode": 1, "ResponseMessage": "INVALID SOURCE IMEI/DEVICE", "PlutusTransactionReferenceID": 0 }
```

**On success: persist the PTRID against the order immediately.** This is the only handle you have to check status or cancel later.

---

### 5.2 GetStatus

**Purpose:** after the customer pays on the A910S, fetch the final result.

**Request:**

```json
{
  "MerchantID": "1234",
  "SecurityToken": "70D7509C-0A90-4938-A7F9-DB99B9B841D9",
  "ClientID": "318462",
  "UserID": "WAITER_04",
  "StoreID": "61607",
  "PlutusTransactionReferenceID": 501,
  "TransactionNumber": "ORDER-1042"
}
```

**Response:** `ResponseCode`, `ResponseMessage` (`"TXN APPROVED"` on success), `PlutusTransactionReferenceID`, and **`TransactionData` — an array of `{Tag, Value}` pairs.**

```json
{
  "ResponseCode": 0,
  "ResponseMessage": "TXN APPROVED",
  "PlutusTransactionReferenceID": 20179066,
  "TransactionData": [
    { "Tag": "PaymentMode", "Value": "CARD" },
    { "Tag": "AmountInPaisa", "Value": "35100" },
    { "Tag": "RRN", "Value": "000792514130" },
    { "Tag": "ApprovalCode", "Value": "849035" },
    { "Tag": "Invoice Number", "Value": "46" },
    { "Tag": "Card Number", "Value": "************5664" },
    { "Tag": "Card Type", "Value": "VISA" },
    { "Tag": "Acquirer Name", "Value": "FEDERAL" },
    { "Tag": "Transaction Date", "Value": "26022020" },
    { "Tag": "Transaction Time", "Value": "135456" }
  ]
}
```

**CRITICAL parsing rule:** `TransactionData` **tags and their order vary by payment mode** (a UPI txn has `Customer VPA`, a card txn has `Card Number`/`Card Type`, EMI has tenure tags, etc.). **Always parse into a map by `Tag` — never by array index.** Example helper:

```js
function tagsToMap(transactionData = []) {
  const m = {};
  for (const { Tag, Value } of transactionData) m[Tag.trim()] = Value;
  return m;
}
// usage: const t = tagsToMap(resp.TransactionData);
//        t["PaymentMode"], t["RRN"], t["AmountInPaisa"], ...
```

**Pending handling:** if the customer hasn't finished paying, the transaction is still "open" and GetStatus won't return an approved result. **Poll** (see §7) until you get a terminal outcome (approved / declined / cancelled) or you hit your timeout.

---

### 5.3 CancelTransaction and Force Cancel

Use to cancel an **open** transaction (customer walked away, wrong amount, timeout).

**CancelTransaction** request: `MerchantID`, `SecurityToken`, `StoreID`, `ClientID` (C), `PlutusTransactionReferenceID`, `Amount` (paisa).

**Force Cancel** (`.../V1/CancelTransactionForced`) adds terminal-notification control:

```json
{
  "StoreId": 1217807,
  "ClientId": 318462,
  "MerchantID": "26838",
  "SecurityToken": "b08c5fde-f403-462d-890e-dea325caf763",
  "PlutusTransactionReferenceID": "335942",
  "Amount": "139900",
  "TakeToHomeScreen": true,
  "ConfirmationRequired": false
}
```

Response: `ResponseCode` 0 = success. Invalid PTRID returns non-0 (`"INVALID PLUTUS TXN REF ID"`).

**Cancellation rules (from spec — enforce in your state machine):**
- A sale can be cancelled **only until PIN entry**.
- If cancelled **after** PIN entry, the txn is **auto-reversed**.
- **UPI:** if the customer already paid via the UPI app but it's cancelled on the terminal, it **auto-reverses**.
- A **completed** txn cannot be cancelled.
- An **already-cancelled** txn cannot be cancelled again.

---

## 6. Post Back URL (webhook — recommended)

Instead of only polling, give Pine Labs a **Post Back URL** and they push the result to you in real time (best fit for "dashboard updates instantly").

**Important format detail:** the callback body is **`application/x-www-form-urlencoded`**, and the payload is a **comma-joined `key=value` string** (not standard JSON):

```
ResponseCode=0,ResponseMessage=APPROVED,PlutusTransactionReferenceID=701409,
TransactionNumber=ORDER-1042,BankTID=10130951,PaymenMode=CARD,Amount=25000,
ApprovalCode=00,RRN=000020,Invoice=4,BatchNumber=9014,
CardNumber=************2428,AcquirerName=ICICI,
TransactionDate=15042025,TransactionTime=123031,CardType=VISA,
TransactionLogId=4295508003,CurrencyType=INR
```

Parse it as comma-split then `=`-split (mind that `PaymenMode` is spelled exactly like that in the postback). **Then re-verify with GetStatus by PTRID before finalizing money.** Treat the webhook as a trigger, GetStatus as the source of truth.

**Strategy: use both.** Webhook for speed; a **reconciliation poll** (GetStatus) as a safety net for any order left in `AWAITING_PAYMENT` past a threshold.

---

## 7. End-to-end flow (mapped to the cafe)

```
1. Waiter builds order on web app  → backend creates Order (status: OPEN),
   generates TransactionNumber = ORDER-1042, computes Amount in paisa.

2. Backend → UploadBilledTransaction
   { TransactionNumber, Amount, AllowedPaymentMode:"1|2|10",
     StoreId, ClientId:<this table's terminal>, AutoCancelDurationInMinutes:5 }
   ← ResponseCode 0, PTRID 501
   Backend: save PTRID on order, status → AWAITING_PAYMENT.

3. A910S picks up the open transaction for that ClientId
   (waiter selects it / zero-click). Customer pays: Card / UPI QR / Cash.
   Terminal prints charge slip.

4. Result path:
   (a) Pine Labs → Post Back URL  → backend receives trigger, OR
   (b) backend polls GetStatus(PTRID) every few seconds until terminal outcome.

5. Backend confirms via GetStatus(PTRID):
   ResponseCode 0 & "TXN APPROVED"
     → parse TransactionData (PaymentMode, RRN, ApprovalCode, AmountInPaisa...)
     → Order.status = PAID; save Payment { mode, RRN, txnLogId, ptrid }
     → deduct ingredient stock per recipe (idempotent)
     → push dashboard update (today's sales/profit, pending orders, table free)
   else (declined / cancelled / timeout)
     → Order.status = PAYMENT_FAILED; table stays occupied; waiter may retry.
```

**What this settles about the original requirements:**
- The **UPI QR is generated by the A910S**, not your app — you just include mode `10`/`11` in `AllowedPaymentMode`.
- **Card, Cash, and UPI** are all handled by one Upload call via `1|2|10`.
- **KOT printing is separate** from this — food→kitchen, beverage→counter go to your own network/BT printers, driven by the backend when the order is confirmed (step 1), independent of Pine Labs.

---

## 8. Order + payment state machine

```
OPEN ──confirm order──► (KOT printed) ──generate bill──► BILLED
BILLED ──UploadBilledTransaction ok──► AWAITING_PAYMENT (PTRID saved)
AWAITING_PAYMENT ──GetStatus approved──► PAID ──► (stock deducted, dashboard, table freed)
AWAITING_PAYMENT ──declined/timeout──► PAYMENT_FAILED ──retry──► AWAITING_PAYMENT
AWAITING_PAYMENT ──CancelTransaction──► CANCELLED
```

Only the **PAID** transition performs stock deduction and revenue recognition, and it must be **idempotent** (guard on `Order.status != PAID`).

---

## 9. Data model additions

Extend the `Payment` entity (from the main handover) to hold Pine Labs references:

| Field | Source |
|---|---|
| `order_id` | your order |
| `transaction_number` | your unique id sent in Upload |
| `plutus_ptrid` | PTRID from Upload response |
| `status` | `initiated` / `approved` / `declined` / `cancelled` |
| `mode` | `TransactionData["PaymentMode"]` (CARD / UPI SALE / CASH) |
| `amount_paisa` | `TransactionData["AmountInPaisa"]` |
| `rrn` | `TransactionData["RRN"]` |
| `approval_code` | `TransactionData["ApprovalCode"]` |
| `txn_log_id` | `TransactionData["TransactionLogId"]` |
| `client_id` / `store_id` | terminal routing used |
| `raw_response` | full GetStatus JSON (audit) |

Index on `plutus_ptrid` and `transaction_number` for reconciliation.

---

## 10. The PaymentProvider abstraction

Keep every Pine Labs detail behind one interface so business logic (orders, stock, dashboard) never touches HTTP/paisa/tag-parsing directly. Ship `MockPaymentProvider` now; implement `PineLabsCloudProvider` when UAT credentials arrive.

```ts
interface PaymentResult {
  status: 'approved' | 'declined' | 'cancelled' | 'pending';
  ptrid?: string;
  mode?: string;          // CARD | UPI SALE | CASH
  amountPaisa?: number;
  rrn?: string;
  approvalCode?: string;
  txnLogId?: string;
  raw?: unknown;
}

interface PaymentProvider {
  // maps to UploadBilledTransaction → returns PTRID (status 'pending')
  charge(input: {
    transactionNumber: string;
    amountPaisa: number;
    allowedModes: string;   // e.g. "1|2|10"
    clientId: string;       // target terminal
    storeId: string;
    userId?: string;
  }): Promise<PaymentResult>;

  // maps to GetStatus(PTRID)
  status(ptrid: string, ctx: { clientId: string; storeId: string }): Promise<PaymentResult>;

  // maps to CancelTransactionForced
  cancel(ptrid: string, amountPaisa: number, ctx: { clientId: string; storeId: string }): Promise<PaymentResult>;
}
```

Webhook handler (`POST /webhooks/pinelabs`) parses the urlencoded CSV, finds the order by `TransactionNumber`/PTRID, then calls `provider.status(ptrid)` to confirm before finalizing.

---

## 11. Multi-terminal routing (ClientId vs StoreId)

- **One terminal:** `ClientId` = that A910S; include it in every Upload so the bill routes to it.
- **Multiple terminals in the store:** `StoreId` scopes the store; set `ClientId` per call to the specific terminal you want the payment to appear on (e.g. the terminal the waiter is carrying / the one near that section).
- **Model terminals as data**: a `terminals` table (`client_id`, label, section) so you can route a table's payment to the right device and add/replace terminals without code changes.

---

## 12. Money, idempotency, reconciliation (non-negotiables)

- **Paisa everywhere.** Convert once at the boundary; never send rupees or floats.
- **Unique `TransactionNumber` per attempt.** If you retry a failed Upload, decide: reuse (idempotent) or new number — and keep the PTRID mapping straight.
- **Idempotent finalization.** Guard stock deduction and revenue on `status != PAID`. A duplicate webhook + poll must not double-count.
- **Reconciliation job.** Nightly (or hourly): for any order in `AWAITING_PAYMENT` older than N minutes, call GetStatus; resolve to PAID/FAILED/CANCELLED. Store `RRN` + `TransactionLogId` for matching against Pine Labs settlement reports.
- **Timeouts.** Use `AutoCancelDurationInMinutes` on Upload so abandoned bills self-cancel on the terminal; mirror that timeout on your side.

---

## 13. Response codes to handle

| `ResponseCode` | Meaning | Action |
|---|---|---|
| `0` + `APPROVED` / `TXN APPROVED` | Success | Finalize order |
| `1` (e.g. `INVALID SOURCE IMEI/DEVICE`, `INVALID PLUTUS TXN REF ID`) | Failure / bad request | Do not finalize; surface error; check config |
| `1008` `TXN VOIDED` | Voided | Mark cancelled/reversed |
| non-0 "pending"-style (e.g. still open) | Not final yet | Keep polling until timeout |

(Confirm the full code list with Pine Labs; treat anything not `0`/known-success as non-final or failed.)

---

## 14. Testing plan (UAT)

1. **Config check:** Upload with UAT creds → expect `ResponseCode 0` + PTRID. A `1 INVALID SOURCE IMEI/DEVICE` means terminal/creds not registered correctly.
2. **Card happy path:** Upload → pay on UAT terminal → GetStatus approved → assert order PAID, stock deducted once, dashboard updated.
3. **UPI happy path:** `AllowedPaymentMode:"10"` → QR shows on terminal → pay → approved. Assert `PaymentMode = UPI SALE`, `Customer VPA` captured.
4. **Cash:** mode `2` → recorded, approved.
5. **Decline / no-action:** let it time out (`AutoCancelDurationInMinutes`) → assert PAYMENT_FAILED, table not freed.
6. **Cancel before PIN:** CancelTransaction → assert cancelled.
7. **UPI reverse:** pay then cancel on terminal → assert auto-reversal handled.
8. **Idempotency:** fire webhook twice + a poll → assert single stock deduction and single revenue entry.
9. **Webhook parsing:** feed the sample urlencoded CSV → assert correct field extraction (esp. `PaymenMode` spelling).
10. **Multi-terminal:** route two bills to two `ClientId`s → assert each appears on the right terminal.

---

## 15. Implementation phases (build order)

1. **Mock provider + full order/KOT/bill/dashboard flow** — build and ship end-to-end against `MockPaymentProvider`. No Pine Labs dependency.
2. **In parallel:** complete Pine Labs onboarding, get UAT creds + test terminal, confirm endpoint paths, register Post Back URL.
3. **`PineLabsCloudProvider.charge()`** = UploadBilledTransaction; persist PTRID; order → AWAITING_PAYMENT.
4. **`status()`** = GetStatus + tag-map parsing; finalization (idempotent) + dashboard push.
5. **Webhook** `/webhooks/pinelabs` (urlencoded CSV) → verify via GetStatus → finalize.
6. **`cancel()`** + cancellation rules + timeout auto-cancel.
7. **Reconciliation job** + settlement matching (RRN / TransactionLogId).
8. **UAT test matrix (§14)** → sign-off → switch host/creds to production.

---

## 16. Open items to confirm with Pine Labs

- [ ] Exact endpoint **paths** for UploadBilledTransaction and GetStatus (and **production host**).
- [ ] Final `MerchantID`, `SecurityToken`, `StoreId`, and `ClientId` per A910S.
- [ ] Which payment modes are enabled on the terminal for this merchant (Card / Cash / UPI).
- [ ] Post Back URL support + exact callback format/fields for your account (and any signature/auth on it).
- [ ] Full `ResponseCode` list and their meanings (incl. pending/open states).
- [ ] Whether "zero-click" auto-routing to a `ClientId` is enabled, or the cashier must select the open txn on the terminal.
- [ ] Settlement/reconciliation report access for daily matching.
- [ ] Number of A910S terminals in the cafe (drives ClientId/StoreId routing).

---

## 17. Quick reference

| Need | Call | Key in | Key out |
|---|---|---|---|
| Create payable bill | UploadBilledTransaction | `TransactionNumber`, `Amount` (paisa), `AllowedPaymentMode`, `ClientId`, `StoreId` | `PlutusTransactionReferenceID` |
| Check result | GetStatus | `PlutusTransactionReferenceID` | `ResponseCode`, `TransactionData[]` (parse by Tag) |
| Cancel open txn | CancelTransactionForced | `PlutusTransactionReferenceID`, `Amount` | `ResponseCode` |
| Get pushed result | Post Back URL (webhook) | (Pine Labs → you) | urlencoded CSV; re-verify via GetStatus |

- **Success = `ResponseCode: 0`.**
- **Amounts = paisa, integers.**
- **Parse `TransactionData` by `Tag`, never by index.**
- **All calls from backend; `SecurityToken` never client-side.**
- **PTRID is the join key; store it the moment Upload returns.**
