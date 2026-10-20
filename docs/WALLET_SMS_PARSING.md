# Wallet SMS Parsing & Payment Ingestion

## Overview

CowboyBepob receives wallet-payment SMS messages from registered devices and from the Admin manual-paste flow. The SMS parser converts provider-specific message text into a normalized payment event that can continue through the existing payment matching and review pipeline.

The parser is intentionally **data-first**: extracting the transaction correctly is more important than assigning a provider label. Vodafone Cash and Orange Cash are the currently supported real-world formats, but the implementation should remain extensible for future wallet providers.

## Goals

- Parse real Vodafone Cash and Orange Cash SMS formats reliably.
- Extract the transaction amount, sender, receiver, balance and reference whenever present.
- Accept sender names as well as wallet numbers.
- Normalize Egyptian wallet-number formats.
- Normalize Arabic and English digits.
- Tolerate Arabic and English punctuation and variable whitespace.
- Support both `رقم العملية` and `رقم المعاملة` as transaction references.
- Ignore marketing/campaign text appended to otherwise valid transaction SMS messages.
- Preserve the existing ingestion, matching, duplicate-protection, audit and manual-review flows.
- Never invent missing sender information.

## Non-Goals

The SMS parser must not:

- Replace the existing payment ingestion architecture.
- Replace the payment matching service.
- Delete or rewrite historical `payment_sms` records.
- Hardcode receiving-wallet numbers.
- Infer a sender wallet from a sender name.
- Reject an otherwise parseable payment solely because provider classification is ambiguous.

---

## Existing Payment Flow

```text
Android / MacroDroid / Admin Paste
              |
              v
      SMS ingestion endpoint
              |
              v
       payment SMS record
              |
              v
      wallet message parser
              |
              +----> normalized transaction
              |
              v
       payment matching
              |
       +------+------+
       |             |
       v             v
    matched       manual review
       |             |
       +------+------+ 
              |
              v
       existing payment flow
```

The parser is therefore a boundary component. It should normalize untrusted SMS text into the existing payment model without changing downstream business rules.

---

## Relevant Code

Primary parser:

```text
apps/api/src/payments/vodafoneSms.ts
```

Payment parser tests:

```text
apps/api/src/payments/payments.test.ts
```

Payment ingestion/matching service:

```text
apps/api/src/payments/service.ts
```

The parser is reached through the existing `parseWalletSms()` flow. Do not bypass this flow with provider-specific ingestion paths.

---

# Supported Transaction Formats

## 1. Vodafone Cash — Sender Number + Receiver Wallet

```text
تم استلام مبلغ 2500 جنيه من رقم 01012208430 المسجل بإسم Alhussien R Kassem على رقم محفظتك  01044577552.
رصيدك الحالي: 2500.17 جنيه
تاريخ العملية: 12:46 26-10-14
رقم العملية: 024703283984
تابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash
```

Expected normalized data:

| Field | Value |
|---|---|
| amountMinor | `250000` |
| senderWallet | `01012208430` |
| senderName | `Alhussien R Kassem` |
| receiverWallet | `01044577552` |
| transactionTime | `12:46` |
| transactionDate | `2026-10-14` |
| balanceMinor | `250017` |
| reference | `024703283984` |

---

## 2. Vodafone Cash — Sender Number Without `رقم`

```text
تم استلام مبلغ 80.00 جنيه من 01275555667؛
المسجل بإسم ABDELRAHMAN IBRAHIM SHEHAB AYAD
على رقم محفظتك 01044577552 بتاريخ 02:09 26-10-20.
رصيدك الحالي: 2508.88 جنيه
رقم العملية: 024901397476
 تقدر تتابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash
```

Expected normalized data:

| Field | Value |
|---|---|
| amountMinor | `8000` |
| senderWallet | `01275555667` |
| senderName | `ABDELRAHMAN IBRAHIM SHEHAB AYAD` |
| receiverWallet | `01044577552` |
| transactionTime | `02:09` |
| transactionDate | `2026-10-20` |
| balanceMinor | `250888` |
| reference | `024901397476` |

---

## 3. Orange Cash — Sender Name Only

```text
تم استلام مبلغ 5005.00 جنيه من Mohamed N Ewedah، رصيدك الحالي 5005.20 جنية، رقم المعاملة 25000222476561.

عرض مايتفوتش!
وفّر 540 جنيه على اشتراك Yango Play واتفرج على اجمد الافلام والمسلسلات في مصر
خصم 65% على اشتراك 6 شهور بـ300 جنيه بدل 840 جنيه
ادفع دلوقتي باورنچ كاش
https://myo.orange.eg/YANGO

لأي استفسار كلم 7770
أو تواصل معانا على الواتساب: https://myo.orange.eg/O-whatsapp
```

Expected normalized data:

| Field | Value |
|---|---|
| amountMinor | `500500` |
| senderWallet | `null` |
| senderName | `Mohamed N Ewedah` |
| receiverWallet | configured Orange receiving wallet |
| transactionTime | derived from existing `receivedAt` behavior |
| transactionDate | derived from existing `receivedAt` behavior |
| balanceMinor | `500520` |
| reference | `25000222476561` |

The parser must **not** fabricate a sender wallet from `Mohamed N Ewedah`.

---

## 4. Orange Cash — International Sender Number

```text
لقد استقبلت تحويل أموال بمبلغ 115.00 جنيه من 00201275555667
رصيد اورنچ كاش الجديد 115.49 جنيه رقم المعاملة 3072476204
```

Expected normalized data:

| Field | Value |
|---|---|
| amountMinor | `11500` |
| senderWallet | `01275555667` |
| senderName | `null` |
| receiverWallet | configured Orange receiving wallet |
| transactionTime | derived from existing `receivedAt` behavior |
| transactionDate | derived from existing `receivedAt` behavior |
| balanceMinor | `11549` |
| reference | `3072476204` |

`00201275555667` must normalize to `01275555667`.

---

# Parsing Principles

## 1. Data Extraction Comes Before Provider Classification

Do not use a brittle rule such as:

```text
"تم استلام مبلغ" == Vodafone
```

Orange can also send a message beginning with `تم استلام مبلغ`.

Provider-specific markers may help classification, but they must not prevent valid transaction extraction.

The preferred strategy is:

```text
1. Normalize text and digits.
2. Detect a wallet/payment receipt.
3. Extract amount.
4. Extract sender as wallet number OR name.
5. Extract receiver wallet when explicitly present.
6. Extract balance.
7. Extract transaction reference.
8. Extract transaction date/time when present.
9. Determine provider when reliable.
10. Apply configured receiving wallet where the message does not contain one.
11. Return the normalized transaction to the existing flow.
```

## 2. Sender Can Be a Number or a Name

Valid examples:

```text
من 01012208430
من رقم 01012208430
من 01275555667
من Mohamed N Ewedah
من Abdelrahman I Ayad
```

The parser must not require a phone number to consider the transaction valid.

## 3. Do Not Invent Data

If the SMS contains only a sender name:

```text
من Mohamed N Ewedah
```

then:

```text
senderName = "Mohamed N Ewedah"
senderWallet = null
```

Never manufacture a wallet number.

## 4. Punctuation Must Be Flexible

The parser should tolerate:

```text
،   Arabic comma
,   English comma
؛   Arabic semicolon
;   English semicolon
.   period
```

For example, both should work:

```text
من Abdelrahman I Ayad، رصيدك الحالي
من Abdelrahman I Ayad, رصيدك الحالي
```

## 5. Transaction Reference

Support both forms:

```text
رقم العملية
رقم المعاملة
```

The normalized field is:

```text
reference
```

## 6. Currency Wording

Accept both common variants:

```text
جنيه
جنية
```

## 7. Digit Normalization

The parser should normalize Arabic-Indic digits before extracting numeric values.

Wallet normalization should support, where applicable:

```text
01012208430
+201012208430
00201012208430
201012208430
```

and Arabic-digit equivalents.

## 8. Marketing Text

Wallet SMS messages may contain promotional content after the transaction.

Example:

```text
عرض مايتفوتش!
وفّر 540 جنيه على اشتراك Yango Play...
```

This text must not interfere with the transaction fields extracted before it.

---

# Receiving Wallet Configuration

Receiving wallets must come from the existing environment/configuration.

Do not hardcode production wallet numbers in parser code.

Relevant configuration includes:

```env
VODAFONE_CASH_RECEIVING_WALLET=...
ORANGE_CASH_RECEIVING_WALLET=...
```

The parser may use the configured Orange receiving wallet when an Orange SMS does not explicitly include the receiver wallet.

---

# Matching Behavior

Parsing and matching are separate responsibilities.

The parser produces normalized information such as:

```text
amountMinor
senderWallet
senderName
receiverWallet
transactionTime
transactionDate
balanceMinor
reference
carrier
```

The existing matching layer remains responsible for deciding whether the payment belongs to a customer/order/service.

A message with a sender name but no sender wallet can still be parsed successfully. Whether it can be automatically matched is a downstream business decision.

Do not weaken matching rules merely to make parsing succeed.

---

# Error Handling

A parser failure should describe the missing transaction component rather than incorrectly blaming a provider.

Existing failure states such as:

```text
SENDER_NOT_FOUND
```

should only be returned when the parser genuinely cannot identify a sender from the message.

A valid Orange SMS with a sender name must never produce `SENDER_NOT_FOUND` merely because there is no sender phone number.

Likewise, provider ambiguity should not automatically become a parse failure.

---

# Regression Test Requirements

Every supported real-world format must have a regression test using the exact SMS body.

Tests must verify actual values, not only:

```ts
expect(result.ok).toBe(true)
```

Each test should verify the fields relevant to that message:

- amount
- sender wallet
- sender name
- receiver wallet
- transaction date/time
- balance
- reference
- carrier/provider when exposed by the parser

Additional edge-case tests should cover:

- `من رقم <wallet>`
- `من <wallet>`
- `من <name>`
- Arabic punctuation
- English punctuation
- `رقم العملية`
- `رقم المعاملة`
- `جنيه`
- `جنية`
- Arabic-Indic digits
- `00201...` wallet numbers
- marketing text after the transaction
- Orange messages beginning with `تم استلام مبلغ`

---

# Validation Before Deployment

Run from the repository root:

```bash
npm test
npm run typecheck
npm run build
```

The parser must be tested against all four real SMS samples before deployment.

Also run:

```bash
git diff --check
git status
```

Only payment/SMS-related changes should be included in a parser-fix commit.

---

# Production Deployment

The project uses native Node.js/systemd deployment.

After a parser fix has been pushed to `main`:

```bash
cd ~/projects/cowboybepob

git pull --ff-only

npm install
npm test
npm run typecheck
npm run build

sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
```

Verify:

```bash
sudo systemctl status cowboybepob-api --no-pager
sudo systemctl status cowboybepob-worker --no-pager

curl -i http://127.0.0.1:5002/health
```

Inspect logs when debugging SMS ingestion:

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
```

For live parser debugging:

```bash
sudo journalctl -u cowboybepob-api -f
```

Never run:

```bash
sudo npm install
sudo npm run build
```

Do not wipe the database or delete historical `payment_sms` rows when deploying parser fixes.

---

# Debugging Checklist

If the Admin UI shows:

```text
SENDER_NOT_FOUND
```

follow this order:

### 1. Confirm the deployed commit

```bash
cd ~/projects/cowboybepob
git rev-parse HEAD
git log -1 --oneline
```

### 2. Confirm the built parser contains the expected implementation

```bash
grep -R "SENDER_NOT_FOUND" -n apps/api/dist 2>/dev/null | head -20
```

### 3. Confirm the SMS actually reached the API

```bash
sudo journalctl -u cowboybepob-api --since "20 minutes ago" --no-pager | \
grep -E "SMS_RECEIVED|SMS_PARSE_FAILED|SMS_PARSED|SMS_MATCH"
```

### 4. Inspect the actual stored SMS

Use the `payment_sms` record identified by the log `smsId` and inspect `raw_message`.

The text stored in `raw_message` is authoritative for debugging. Do not assume it is identical to the text shown elsewhere in the UI.

### 5. Reproduce against the built parser

Use the exact `raw_message` with the compiled parser under:

```text
apps/api/dist/payments/vodafoneSms.js
```

If the exact message succeeds in a direct parser test but fails through ingestion, debug the ingestion/dispatcher path rather than changing parsing regexes blindly.

---

# Design Rules for Future Providers

When adding another wallet provider:

1. Keep provider-specific parsing isolated.
2. Reuse the existing normalization helpers.
3. Do not duplicate ingestion or matching flows.
4. Add exact real-world SMS fixtures.
5. Add positive and negative tests.
6. Do not require provider identification before extracting common transaction fields.
7. Never fabricate sender/receiver information.
8. Keep configured receiving wallets outside parser source code.
9. Preserve `payment_sms` and audit behavior.
10. Test the complete ingestion path when provider classification changes.

The long-term abstraction should remain:

```text
raw SMS
  ↓
normalization
  ↓
transaction extraction
  ↓
optional provider classification
  ↓
existing payment matching
```

This keeps the payment system extensible without coupling the core payment flow to a single SMS wording or provider.

---

# Current Supported Providers

| Provider | Sender | Receiver | Reference | Date/Time | Marketing Text |
|---|---|---|---|---|---|
| Vodafone Cash | wallet | explicit wallet | `رقم العملية` | usually present | ignored safely |
| Orange Cash | wallet or name | configured wallet when absent | `رقم المعاملة` | may be absent | ignored safely |

Provider detection is useful metadata. It is not the primary success criterion for parsing.

---

# Operational Principle

**Correct transaction extraction is the priority. Provider labeling is secondary.**

A valid wallet transaction should continue through the existing payment pipeline whenever the parser can safely extract the required transaction data, even when the exact provider wording is slightly different from the known fixtures.
