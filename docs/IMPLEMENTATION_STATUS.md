# حالة التنفيذ

## منفذ في الدفعة الأولى
- هيكل monorepo للـ web والـ API.
- واجهة RTL عربية متجاوبة، لوحة إدارة وبوابة عميل أولية.
- صفحات العملاء والخدمات والراوترات والخوادم والكتالوج والطلبات والمدفوعات والمهام والتدقيق.
- Fastify API مع health check ومسارات قراءة أولية.
- PostgreSQL schema مبدئية وDocker Compose.

## غير مكتمل بعد — لا تستخدم للإنتاج
- المصادقة والجلسات وCSRF وTOTP.
- تطبيق RBAC على كل endpoint.
- توصيل صفحات الويب بالـ API الحقيقي واستبدال بيانات العرض الوهمية.
- migrations versioned بدل init SQL فقط.
- repositories وtransactions لكل الدومينات.
- الدفع والتحقق من webhooks.
- worker مع claim ذري للمهام وretry/backoff.
- تكامل Marzban وTailscale وOpenWrt gateway.
- إدارة الأسرار والتدقيق الكامل والاختبارات وCI.

## الخطوة التالية
تنفيذ نظام المصادقة والصلاحيات ثم repositories بـ PostgreSQL للقراءة والكتابة وربط الواجهات بهذه المسارات.
