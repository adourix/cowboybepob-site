import { describe, expect, it } from 'vitest';
import { parseOrangeCashSms, parseWalletSms, parseVodafoneCashSms } from './vodafoneSms.js';

describe('wallet SMS real-world regression formats', () => {
  const receivedAt = new Date('2026-10-20T05:23:55.402Z');
  const orangeWallet = '01044577552';

  it('parses Vodafone format with "من رقم"', () => {
    const sms = `تم استلام مبلغ 2500 جنيه من رقم 01012208430 المسجل بإسم Alhussien R Kassem على رقم محفظتك 01044577552.
رصيدك الحالي: 2500.17 جنيه
تاريخ العملية: 12:46 26-10-14
رقم العملية: 024703283984`;

    const result = parseWalletSms(sms, { receivedAt, orangeWallet });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.carrier).toBe('VODAFONE');
    expect(result.amountMinor).toBe(250000);
    expect(result.senderWallet).toBe('01012208430');
    expect(result.senderName).toBe('Alhussien R Kassem');
    expect(result.receiverWallet).toBe('01044577552');
    expect(result.balanceMinor).toBe(250017);
    expect(result.reference).toBe('024703283984');
    expect(result.transactionTime).toBe('12:46');
    expect(result.transactionDate).toBe('2026-10-14');
  });

  it('parses Vodafone format without "رقم" before sender', () => {
    const sms = `تم استلام مبلغ 80.00 جنيه من 01275555667؛
المسجل بإسم ABDELRAHMAN IBRAHIM SHEHAB AYAD
على رقم محفظتك 01044577552 بتاريخ 02:09 26-10-20.
رصيدك الحالي: 2508.88 جنيه
رقم العملية: 024901397476`;

    const result = parseWalletSms(sms, { receivedAt, orangeWallet });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.carrier).toBe('VODAFONE');
    expect(result.amountMinor).toBe(8000);
    expect(result.senderWallet).toBe('01275555667');
    expect(result.senderName).toBe('ABDELRAHMAN IBRAHIM SHEHAB AYAD');
    expect(result.receiverWallet).toBe('01044577552');
    expect(result.balanceMinor).toBe(250888);
    expect(result.reference).toBe('024901397476');
  });

  it('parses Orange name-only format even when it starts like Vodafone', () => {
    const sms = `تم استلام مبلغ 5.00 جنيه من Abdelrahman I Ayad، رصيدك الحالي 25.20 جنية، رقم المعاملة 25000247388957.

عرض مايتفوتش!
وفّر 540 جنيه على اشتراك Yango Play واتفرج على اجمد الافلام والمسلسلات في مصر
خصم 65% على اشتراك 6 شهور بـ300 جنيه بدل 840 جنيه
ادفع دلوقتي باورنچ كاش
https://myo.orange.eg/YANGO

لأي استفسار كلم 7770
أو تواصل معانا على الواتساب: https://myo.orange.eg/O-whatsapp`;

    const result = parseWalletSms(sms, { receivedAt, orangeWallet });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.carrier).toBe('ORANGE');
    expect(result.amountMinor).toBe(500);
    expect(result.senderWallet).toBeNull();
    expect(result.senderName).toBe('Abdelrahman I Ayad');
    expect(result.receiverWallet).toBe(orangeWallet);
    expect(result.receiverFromConfig).toBe(true);
    expect(result.balanceMinor).toBe(2520);
    expect(result.reference).toBe('25000247388957');
  });

  it('parses Orange wallet-number format with international prefix', () => {
    const sms = `لقد استقبلت تحويل أموال بمبلغ 115.00 جنيه من 00201275555667
رصيد اورنچ كاش الجديد 115.49 جنيه رقم المعاملة 3072476204`;

    const result = parseWalletSms(sms, { receivedAt, orangeWallet });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.carrier).toBe('ORANGE');
    expect(result.amountMinor).toBe(11500);
    expect(result.senderWallet).toBe('01275555667');
    expect(result.senderName).toBeNull();
    expect(result.receiverWallet).toBe(orangeWallet);
    expect(result.balanceMinor).toBe(11549);
    expect(result.reference).toBe('3072476204');
  });

  it('direct Orange parser accepts the Vodafone-looking Orange campaign SMS', () => {
    const sms = `تم استلام مبلغ 5.00 جنيه من Abdelrahman I Ayad، رصيدك الحالي 25.20 جنية، رقم المعاملة 25000247388957. ادفع دلوقتي باورنچ كاش https://myo.orange.eg/YANGO`;
    const result = parseOrangeCashSms(sms, { receivedAt, ourWallet: orangeWallet });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.carrier).toBe('ORANGE');
    expect(result.amountMinor).toBe(500);
    expect(result.senderName).toBe('Abdelrahman I Ayad');
    expect(result.reference).toBe('25000247388957');
  });

  it('does not let an unrelated Vodafone message become Orange', () => {
    const sms = `تم استلام مبلغ 80.00 جنيه من 01275555667؛
المسجل بإسم ABDELRAHMAN IBRAHIM SHEHAB AYAD
على رقم محفظتك 01044577552 بتاريخ 02:09 26-10-20.
رصيدك الحالي: 2508.88 جنيه
رقم العملية: 024901397476
تقدر تتابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash`;

    const result = parseWalletSms(sms, { receivedAt, orangeWallet });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.carrier).toBe('VODAFONE');
  });
});
