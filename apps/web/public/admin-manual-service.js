(() => {
  const API = '';
  const state = { opened: false, customers: [], categories: [], plans: [], routers: [] };

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const csrf = () => document.cookie.split('; ').find(x => x.startsWith('cb_csrf='))?.split('=')[1] || '';

  async function api(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('content-type', 'application/json');
    const token = csrf();
    if (token && init.method && init.method !== 'GET') headers.set('x-csrf-token', token);
    const response = await fetch(API + path, { ...init, headers, credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function isServicesPage() {
    return window.location.pathname === '/admin/services';
  }

  function closeModal() {
    state.opened = false;
    document.getElementById('manual-service-modal')?.remove();
  }

  function field(label, control) {
    return `<label class="field"><span>${label}</span>${control}</label>`;
  }

  function renderModal() {
    const categories = state.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)} — ${esc(String(c.protocol || '').toUpperCase())}</option>`).join('');
    const plans = state.plans.map(p => `<option value="${esc(p.id)}" data-category="${esc(p.category_id)}">${esc(p.category_name || '')} — ${esc(p.name)} (${esc(p.duration_days)} يوم)</option>`).join('');
    const customers = state.customers.map(c => `<option value="${esc(c.id)}">${esc(c.full_name)} — ${esc(c.public_code)}</option>`).join('');
    const routers = state.routers.map(r => `<option value="${esc(r.id)}">${esc(r.public_code || r.serial_number || r.id)} — ${esc(r.model || 'Router')}${r.customer_name ? ` — ${esc(r.customer_name)}` : ' — غير مرتبط'}</option>`).join('');

    const backdrop = document.createElement('div');
    backdrop.id = 'manual-service-modal';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="إضافة خدمة يدويًا">
        <div class="modal-head">
          <h2>إضافة خدمة يدويًا</h2>
          <button class="icon-btn" type="button" data-close aria-label="إغلاق">×</button>
        </div>
        <form id="manual-service-form">
          ${field('العميل', `<select id="ms-customer" required><option value="">اختر العميل</option>${customers}</select>`)}
          ${field('الباقة', `<select id="ms-plan"><option value="">بدون اشتراك / اختر فئة فقط</option>${plans}</select>`)}
          ${field('الفئة', `<select id="ms-category" required><option value="">اختر الفئة</option>${categories}</select>`)}
          ${field('الراوتر (اختياري)', `<select id="ms-router"><option value="">بدون راوتر</option>${routers}</select>`)}
          ${field('اسم الخدمة (اختياري)', `<input id="ms-label" placeholder="مثال: خدمة منزلية يدوية" />`)}
          ${field('رابط VLESS / VMess', `<textarea id="ms-link" required dir="ltr" rows="4" placeholder="vless://... أو vmess://..."></textarea>`)}
          <p class="muted">الخدمة ستُنشأ بحالة ACTIVE و<strong>MANUAL</strong>. لو اخترت باقة، سيتم إنشاء الاشتراك ومدته وحصته تلقائيًا.</p>
          <div id="ms-error" class="alert error" style="display:none"></div>
          <button class="btn btn-signal btn-full" id="ms-submit" type="submit">إنشاء الخدمة</button>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const plan = backdrop.querySelector('#ms-plan');
    const category = backdrop.querySelector('#ms-category');
    plan.addEventListener('change', () => {
      const selected = plan.selectedOptions[0];
      const categoryId = selected?.dataset.category || '';
      category.value = categoryId;
      category.disabled = Boolean(categoryId);
    });
    backdrop.querySelector('[data-close]').addEventListener('click', closeModal);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', onEscape, { once: true });

    backdrop.querySelector('#manual-service-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = backdrop.querySelector('#ms-submit');
      const error = backdrop.querySelector('#ms-error');
      submit.disabled = true;
      submit.textContent = 'جارٍ إنشاء الخدمة…';
      error.style.display = 'none';
      try {
        const planId = plan.value || null;
        const categoryId = category.value || null;
        await api('/api/v1/admin/services/manual', {
          method: 'POST',
          body: JSON.stringify({
            customerId: backdrop.querySelector('#ms-customer').value,
            planId,
            categoryId,
            routerId: backdrop.querySelector('#ms-router').value || null,
            label: backdrop.querySelector('#ms-label').value.trim(),
            link: backdrop.querySelector('#ms-link').value.trim()
          })
        });
        closeModal();
        window.location.reload();
      } catch (err) {
        error.textContent = err?.message || 'تعذر إنشاء الخدمة.';
        error.style.display = 'block';
        submit.disabled = false;
        submit.textContent = 'إنشاء الخدمة';
      }
    });
  }

  function onEscape(event) {
    if (event.key === 'Escape') closeModal();
  }

  async function openModal() {
    if (state.opened) return;
    state.opened = true;
    try {
      const [customers, catalog, routers] = await Promise.all([
        api('/api/v1/admin/customers'),
        api('/api/v1/admin/catalog'),
        api('/api/v1/admin/routers')
      ]);
      state.customers = Array.isArray(customers) ? customers : [];
      state.categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
      state.plans = Array.isArray(catalog?.plans) ? catalog.plans : [];
      state.routers = Array.isArray(routers) ? routers : [];
      renderModal();
    } catch (err) {
      state.opened = false;
      window.alert(err?.message || 'تعذر تحميل بيانات نموذج الخدمة.');
    }
  }

  function ensureButton() {
    if (!isServicesPage()) return;
    const scene = document.querySelector('.scene');
    if (!scene || scene.querySelector('[data-manual-service]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-signal scene-action';
    button.dataset.manualService = '1';
    button.innerHTML = '<span aria-hidden="true">+</span> إضافة خدمة';
    button.addEventListener('click', openModal);
    scene.appendChild(button);
  }

  function boot() {
    ensureButton();
    const observer = new MutationObserver(ensureButton);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', () => setTimeout(ensureButton, 50));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
