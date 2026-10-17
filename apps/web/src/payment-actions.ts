const PAYMENT_ACTIONS_CLASS='cb-payment-actions';

function csrfToken(){
  return document.cookie.split('; ').find(x=>x.startsWith('cb_csrf='))?.split('=')[1]||'';
}

async function request(path:string,method:'POST',body?:unknown){
  const headers=new Headers();
  if(body!==undefined) headers.set('content-type','application/json');
  const csrf=csrfToken();
  if(csrf) headers.set('x-csrf-token',decodeURIComponent(csrf));
  const payload=body===undefined?undefined:JSON.stringify(body);
  let r=await fetch(path,{method,headers,credentials:'include',cache:'no-store',body:payload});
  let data=await r.json().catch(()=>({}));
  if(!r.ok&&r.status===403&&data.error==='CSRF validation failed'){
    const sync=await fetch('/api/v1/auth/me',{credentials:'include',cache:'no-store'});
    const sd=await sync.json().catch(()=>({}));
    if(sync.ok&&sd.csrf){
      document.cookie=`cb_csrf=${encodeURIComponent(sd.csrf)}; Path=/; SameSite=Lax`;
      headers.set('x-csrf-token',sd.csrf);
      r=await fetch(path,{method,headers,credentials:'include',cache:'no-store',body:payload});
      data=await r.json().catch(()=>({}));
    }
  }
  if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);
  return data;
}

function addStyles(){
  if(document.getElementById('cb-payment-actions-style')) return;
  const style=document.createElement('style');
  style.id='cb-payment-actions-style';
  style.textContent=`
    .cb-payment-actions{display:flex;gap:8px;align-items:center;justify-content:center;white-space:nowrap}
    .cb-payment-actions button{border:0;border-radius:8px;padding:7px 11px;font:inherit;font-size:12px;cursor:pointer}
    .cb-payment-confirm{background:#0f766e;color:#fff}
    .cb-payment-reject{background:#b91c1c;color:#fff}
    .cb-payment-actions button:disabled{opacity:.55;cursor:wait}
  `;
  document.head.appendChild(style);
}

function normalizeStatus(value:string){return value.trim().toLowerCase();}

function enhancePayments(){
  if(window.location.pathname!=='/admin/payments') return;
  const table=document.querySelector<HTMLTableElement>('.table-panel table');
  if(!table) return;
  addStyles();
  const head=table.querySelector('thead tr');
  if(head&&!head.querySelector('[data-payment-actions-head]')){
    const th=document.createElement('th');
    th.dataset.paymentActionsHead='1';
    th.textContent='إجراءات';
    head.appendChild(th);
  }
  table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(row=>{
    if(row.dataset.paymentActionsReady==='1') return;
    const cells=row.querySelectorAll('td');
    if(cells.length<6) return;
    const paymentId=(cells[0]?.textContent||'').trim();
    const status=normalizeStatus(cells[5]?.textContent||'');
    if(!paymentId||paymentId==='—') return;
    row.dataset.paymentActionsReady='1';
    const td=document.createElement('td');
    const box=document.createElement('div');
    box.className=PAYMENT_ACTIONS_CLASS;
    td.appendChild(box);
    row.appendChild(td);

    const actionable=status==='pending'||status==='initiated'||status==='معلّق'||status==='مبدئي';
    if(!actionable){
      box.textContent=status==='succeeded'||status==='ناجح'?'تم التأكيد':status==='failed'||status==='فشل'?'مرفوض':'—';
      return;
    }

    const confirmButton=document.createElement('button');
    confirmButton.type='button';
    confirmButton.className='cb-payment-confirm';
    confirmButton.textContent='تأكيد الدفع';

    const rejectButton=document.createElement('button');
    rejectButton.type='button';
    rejectButton.className='cb-payment-reject';
    rejectButton.textContent='رفض';

    confirmButton.onclick=async()=>{
      const orderCode=(cells[1]?.textContent||'').trim();
      const amount=(cells[3]?.textContent||'').trim();
      if(!window.confirm(`تأكيد استلام دفعة الطلب ${orderCode} بمبلغ ${amount}؟`)) return;
      confirmButton.disabled=true;
      rejectButton.disabled=true;
      try{
        await request(`/api/v1/admin/payments/${encodeURIComponent(paymentId)}/confirm`,'POST');
        window.location.reload();
      }catch(e:any){
        alert(e.message||'تعذر تأكيد الدفع');
        confirmButton.disabled=false;
        rejectButton.disabled=false;
      }
    };

    rejectButton.onclick=async()=>{
      const reason=window.prompt('سبب رفض الدفع:','لم يتم العثور على التحويل أو المبلغ غير صحيح');
      if(reason===null) return;
      confirmButton.disabled=true;
      rejectButton.disabled=true;
      try{
        await request(`/api/v1/admin/payments/${encodeURIComponent(paymentId)}/reject`,'POST',{reason});
        window.location.reload();
      }catch(e:any){
        alert(e.message||'تعذر رفض الدفع');
        confirmButton.disabled=false;
        rejectButton.disabled=false;
      }
    };

    box.append(confirmButton,rejectButton);
  });
}

const observer=new MutationObserver(()=>enhancePayments());
observer.observe(document.body,{childList:true,subtree:true});
setTimeout(enhancePayments,250);
setInterval(enhancePayments,1000);
