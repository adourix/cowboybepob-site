import { describe, expect, it } from 'vitest';
import { parseOrangeCashSms, parseVodafoneCashSms, parseWalletSms } from './vodafoneSms.js';

describe('real Vodafone Cash SMS formats', () => {
  it('parses Vodafone format with "من رقم" and "تاريخ العملية:"', () => {
    const sms = `تم استلام مبلغ 2500 جنيه من رقم 01012208430 المسجل بإسم Alhussien R Kassem على رقم محفظتك 01044577552.
رصيدك الحالي: 2500.17 جنيه
تاريخ العملية: 12:46 26-10-14
رقم العملية: 024703283984
تابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash`;
    const r = parseVodafoneCashSms(sms);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountMinor).toBe(250000);
    expect(r.senderWallet).toBe('01012208430');
    expect(r.senderName).toBe('Alhussien R Kassem');
    expect(r.receiverWallet).toBe('01044577552');
    expect(r.transactionTime).toBe('12:46');
    expect(r.transactionDate).toBe('2026-10-14');
    expect(r.balanceMinor).toBe(250017);
    expect(r.reference).toBe('024703283984');
  });

  it('keeps the existing Vodafone format working', () => {
    const sms = `تم استلام مبلغ 80.00 جنيه من 01275555667؛
المسجل بإسم ABDELRAHMAN IBRAHIM SHEHAB AYAD
على رقم محفظتك 01044577552 بتاريخ 02:09 26-10-20.
رصيدك الحالي: 2508.88 جنيه
رقم العملية: 024901397476
تقدر تتابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash`;
    const r = parseWalletSms(sms, { receivedAt: new Date('2026-10-20T00:00:00Z'), orangeWallet: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.carrier).toBe('VODAFONE');
    expect(r.amountMinor).toBe(8000);
    expect(r.senderWallet).toBe('01275555667');
    expect(r.receiverWallet).toBe('01044577552');
    expect(r.reference).toBe('024901397476');
  });
});

describe('real Orange Cash SMS formats', () => {
  const receivedAt = new Date('2026-10-20T12:30:00Z');
  const ourWallet = '01044577552';

  it('parses Orange format with sender name only', () => {
    const sms = `تم استلام مبلغ 5005.00 جنيه من Mohamed N Ewedah، رصيدك الحالي 5005.20 جنية، رقم المعاملة 25000222476561.
عرض مايتفوتش!
وفّر 540 جنيه على اشتراك Yango Play واتفرج على اجمد الافلام والمسلسلات في مصر
خصم 65% على اشتراك 6 شهور بـ300 جنيه بدل 840 جنيه
ادفع دلوقتي باورنچ كاش`;
    const r = parseOrangeCashSms(sms, { receivedAt, ourWallet });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.carrier).toBe('ORANGE');
    expect(r.amountMinor).toBe(500500);
    expect(r.senderWallet).toBeNull();
    expect(r.senderName).toBe('Mohamed N Ewedah');
    expect(r.receiverWallet).toBe(ourWallet);
    expect(r.balanceMinor).toBe(500520);
    expect(r.reference).toBe('25000222476561');
    expect(r.occurredAt.toISOString()).toBe(receivedAt.toISOString());
  });

  it('parses Orange format with international sender wallet', () => {
    const sms = 'لقد استقبلت تحويل أموال بمبلغ 115.00 جنيه من 00201275555667 رصيد اورنچ كاش الجديد 115.49 جنيه رقم المعاملة 3072476204';
    const r = parseWalletSms(sms, { receivedAt, orangeWallet: ourWallet });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.carrier).toBe('ORANGE');
    expect(r.amountMinor).toBe(11500);
    expect(r.senderWallet).toBe('01275555667');
    expect(r.senderName).toBeNull();
    expect(r.receiverWallet).toBe(ourWallet);
    expect(r.balanceMinor).toBe(11549);
    expect(r.reference).toBe('3072476204');
    expect(r.occurredAt.toISOString()).toBe(receivedAt.toISOString());
  });
});
