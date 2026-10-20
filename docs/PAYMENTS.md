# Payments

Two flows, one common result (`PAID`). Orders only know `payment_method`, `payment_status`, `payment_id`;
everything provider-specific lives in `apps/api/src/payments/`.

| Order total | Methods |
|---|---|
| `< PAYMENT_GATEWAY_MIN_AMOUNT` (75 EGP) | Vodafone Cash only |
| `>= 75 EGP` | Vodafone Cash, Visa/Mastercard (Kashier), Apple Pay (Kashier) |

The rule is enforced by the API (`422 BELOW_GATEWAY_MINIMUM`); the UI only mirrors it.
Amounts are integer piasters everywhere. The amount always comes from the order row, never from the client.

## Vodafone Cash

```
AWAITING_TRANSFER ─(customer sends wallet + screenshot)→ PENDING_VERIFICATION
  ─(Android SMS matches amount + sender + receiver + time window)→ AUTO_VERIFIED
  ─(accountant confirms)→ PAID
AUTO_VERIFIED ─(no decision in ACCOUNTANT_REVIEW_HOURS)→ REVIEW_EXPIRED
AUTO_VERIFIED / PENDING_VERIFICATION ─(accountant rejects)→ REJECTED
AWAITING_TRANSFER ─(window passed)→ EXPIRED
```

* **AUTO_VERIFIED activates the service immediately** (business rule) for the review window. Orders containing
  a router are **not** activated or shipped until `PAID`.
* `REVIEW_EXPIRED` or `REJECTED` after activation suspends the order's services. A later confirmation resumes them.
* The screenshot is supporting evidence only. Confirming a payment that was not SMS-matched requires a written reason.
* Duplicate protection: identical SMS (hash), reused transaction reference, one open payment per order.
* SMS that arrive before the customer submits the form are kept `UNMATCHED` and matched when the form arrives.
* Unrelated SMS are refused without being stored. Unparseable Vodafone SMS are stored as `MANUAL_REVIEW`.

### Android device (SMS forwarder)

1. Admin → المدفوعات → أجهزة الرسائل → add a device (e.g. `android-wallet-01`). Copy the token (shown once).
2. On the phone that holds the receiving wallet, run an SMS forwarder that does:

```
POST https://cowboybebop.site/api/v1/payments/sms
Authorization: Bearer <device token>
Content-Type: application/json

{ "deviceId": "android-wallet-01", "message": "<full SMS text>", "receivedAt": "2026-10-16T18:47:00+03:00" }
```

Responses: `{accepted:true,status:"MATCHED"|"UNMATCHED"|"DUPLICATE"|"MANUAL_REVIEW"}`, `{duplicate:true}`,
`{ignored:true}` (not a Vodafone Cash receipt). `401` bad token, `403` device disabled. Rate limit 60/min.

Heartbeat every few minutes (shows "متصل" in the admin panel):

```
POST /api/v1/payments/devices/heartbeat   Authorization: Bearer <token>   {"deviceId":"android-wallet-01"}
```

Companion app requirements (not included in this repo): forward only SMS from the Vodafone Cash sender that
contain `تم استلام مبلغ`; queue locally and retry with backoff on network errors (re-sending is safe — the API
de-duplicates); never forward other SMS; keep the token in Android Keystore; no UI that reveals the token.

## Kashier (cards, Apple Pay)

```
CREATED → CHECKOUT_STARTED ─(signed webhook SUCCESS, amount+currency match)→ PAID
                           ─(FAILURE)→ FAILED   ─(void/reject)→ CANCELLED   ─(abandoned)→ EXPIRED
```

* Hosted Payment Page (`https://checkout.kashier.io`) — card data never touches our servers.
* Order hash: HMAC-SHA256 of `/?payment={mid}.{paymentId}.{amount}.{currency}` with the Payment API Key.
* Webhook: `POST /api/v1/payments/webhooks/kashier`, verified with the `x-kashier-signature` header
  (sorted `signatureKeys`, URL-encoded, HMAC-SHA256 with the Payment API Key). Duplicates are idempotent.
* The redirect back to `/customer/payments/return` is display-only; only the webhook can set `PAID`.
* **Apple Pay**: enable it on your Kashier merchant account. Kashier shows it on its checkout; the method actually
  used is read from the webhook and stored as `APPLE_PAY`.

### Go-live checklist

1. Fill the Kashier variables with **test** keys, `KASHIER_MODE=test`.
2. Pay a test order with a Kashier test card. In Admin → المدفوعات → open it: webhook should be `VERIFIED`.
   If you see `AMOUNT_MISMATCH`, set `KASHIER_WEBHOOK_AMOUNT_UNIT=minor` and retry.
3. Switch to live keys + `KASHIER_MODE=live`. Test and live keys are not interchangeable.

## Tests

```
npm test -w @cowboybepob/api                     # parser, matcher, Kashier signing (incl. official test vector)
API_URL=http://127.0.0.1:5002 DATABASE_URL=... node scripts/test-payments-e2e.mjs   # full flows against a running API
```
