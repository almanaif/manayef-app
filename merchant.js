// ===== merchant.js — شاشات التاجر: الطلبات والمنتجات =====

import { addDoc, collection, db, deleteDoc, doc, limit, orderBy, query, runTransaction, serverTimestamp, updateDoc, where } from './firebase.js';
import { SC, SL, closeModal, esc, onListenersCleared, onSnapshot, showToast } from './utils.js';
import { logAudit, openEditProd } from './admin.js';

// ===== MERCHANT FUNCTIONS =====
export function loadMerchantData() {
  const ud = window.CUD;
  if (ud) document.getElementById('merch-name').textContent = ud.storeName||ud.name||'متجرك';
  loadMerchantOrders();
  loadMerchantProds();
}

export let merchantOrdersUnsub = null;
export function loadMerchantOrders() {
  if (!window.CU) return;
  if (merchantOrdersUnsub) return;
  const q = query(collection(db,'orders'), where('storeId','==',window.CU.uid), orderBy('createdAt','desc'), limit(20));
  merchantOrdersUnsub = onSnapshot(q, snap => {
    const today = new Date().toDateString(); let tOrd=0, tRev=0;
    if (snap.empty) { document.getElementById('merch-ords-list').innerHTML='<div class="empty-state"><div class="ei">📦</div><p>لا توجد طلبات بعد</p></div>'; return; }
    let html='';
    snap.forEach(d => {
      const o={...d.data(),id:d.id};
      const dt=o.createdAt?.toDate?o.createdAt.toDate():new Date();
      if(dt.toDateString()===today){tOrd++;tRev+=o.total||0;}
      html+=`<div class="merch-ord-card">
        <div class="merch-ord-top"><span style="font-size:11px;font-weight:700;color:var(--mu)">#${d.id.slice(-6).toUpperCase()}</span><span class="${SC[o.status]||'sb sb-new'}">${SL[o.status]||'جديد'}</span></div>
        <div style="font-size:12px;color:var(--mu)">👤 ${esc(o.customerName)||'عميل'} • ${o.total||0} ج</div>
        <div style="font-size:11px;margin-top:4px">${(o.items||[]).map(i=>`${esc(i.name)} x${i.qty}`).join('، ')}</div>
        <div class="merch-ord-acts">
          ${o.status==='new'?`<button class="mo-btn mo-acc" onclick="updOrdStatus2('${d.id}','accepted')">✅ قبول</button><button class="mo-btn mo-rej" onclick="updOrdStatus2('${d.id}','cancelled')">❌ رفض</button>`:''}
          ${o.status==='accepted'?`<button class="mo-btn mo-ready" onclick="updOrdStatus2('${d.id}','preparing')">👨‍🍳 بدأت التحضير</button>`:''}
          ${o.status==='preparing'?`<button class="mo-btn mo-ready" onclick="updOrdStatus2('${d.id}','ready')">📦 جاهز</button>`:''}
        </div>
      </div>`;
    });
    document.getElementById('merch-ords-list').innerHTML=html;
    document.getElementById('m-today-ords').textContent=tOrd;
    document.getElementById('m-today-rev').textContent=tRev+' ج';
  });
}

export async function updOrdStatus2(id,status) {
  try { await updateDoc(doc(db,'orders',id),{status,updatedAt:serverTimestamp()}); showToast('✅ تم تحديث حالة الطلب','ok'); }
  catch(e){ showToast('حدث خطأ','err'); }
}

export let merchantProdsUnsub = null;
export function loadMerchantProds() {
  if(!window.CU)return;
  if(merchantProdsUnsub)return;
  const q=query(collection(db,'products'),where('merchantId','==',window.CU.uid));
  merchantProdsUnsub=onSnapshot(q,snap=>{
    document.getElementById('m-prods').textContent=snap.size;
    if(snap.empty){document.getElementById('merch-prods-list').innerHTML='<div class="empty-state"><div class="ei">📦</div><p>لا توجد منتجات</p><small>اضغط "إضافة منتج"</small></div>';return;}
    let html='';
    snap.forEach(d=>{
      const p={...d.data(),id:d.id};
      html+=`<div style="background:#fff;border-radius:var(--r);padding:12px;margin-bottom:8px;box-shadow:var(--sh);border:1px solid var(--border);display:flex;gap:10px;align-items:center">
        <div style="width:48px;height:48px;border-radius:10px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">${p.icon||'📦'}</div>
        <div style="flex:1"><strong style="font-size:13px;font-weight:800;display:block">${esc(p.name)}</strong><small style="color:var(--mu);font-size:11px">${esc(p.unit)}${p.stock!=null?' • الكمية: '+p.stock:''}</small>
          <div style="font-size:14px;font-weight:900;color:var(--p);margin-top:3px">${p.price} ج</div>
          <div style="display:flex;gap:5px;margin-top:6px">
            <button class="mb2 mb-view" onclick='openEditProd(${JSON.stringify(p).replace(/</g,"\\u003c")})'>✏️ تعديل</button>
            <button class="mb2 mb-rej" onclick="delProd('${d.id}')">🗑️ حذف</button>
            <span style="font-size:10px;font-weight:700;color:${p.available!==false?'var(--ok)':'var(--danger)'}">${p.available!==false?'✅ متاح':'❌ غير متاح'}</span>
          </div>
        </div>
      </div>`;
    });
    document.getElementById('merch-prods-list').innerHTML=html;
  });
}

export function openAddProd(){document.getElementById('add-prod-modal').classList.add('open');}
export async function saveProd(){
  const name=document.getElementById('ap-name').value.trim();
  const cat=document.getElementById('ap-cat').value;
  const unit=document.getElementById('ap-unit').value.trim();
  const price=parseFloat(document.getElementById('ap-price').value)||0;
  const icon=document.getElementById('ap-icon').value||'📦';
  if(!name||!price){showToast('يرجى تعبئة الاسم والسعر','err');return;}
  const merchantId = window.adminTargetStore || window.CU?.uid;
  if(!merchantId)return;
  try{
    const storeName = window.adminTargetStore
      ? (document.getElementById('sm-name')?.value || 'متجر')
      : (window.CUD?.storeName||window.CUD?.name||'متجر');
    await addDoc(collection(db,'products'),{merchantId,storeName,name,cat,unit,price,icon,available:true,createdAt:serverTimestamp()});
    closeModal('add-prod-modal');
    ['ap-name','ap-price','ap-unit','ap-icon'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    if(window.adminTargetStore) logAudit('إضافة منتج (أدمن)', name+' — '+storeName);
    showToast('✅ تم إضافة المنتج','ok');
  }catch(e){showToast('حدث خطأ','err');}
}
export async function delProd(id){
  try{await deleteDoc(doc(db,'products',id));showToast('✅ تم حذف المنتج','ok');}catch(e){showToast('حدث خطأ','err');}
}

// --- رقم طلب تسلسلي: D1001, D1002, D1003... باستخدام عداد مركزي في Firestore ---
export async function getNextRequestId(counterName, prefix){
  const counterRef = doc(db,'counters',counterName);
  const seq = await runTransaction(db, async (t) => {
    const snap = await t.get(counterRef);
    const current = snap.exists() ? snap.data().seq : 1000;
    const next = current + 1;
    if (snap.exists()) t.update(counterRef, { seq: next });
    else t.set(counterRef, { seq: next });
    return next;
  });
  return prefix + seq;
}



// ===== تصفير أعلام المتابعة عند تسجيل الخروج (بيتنفذ من utils.js عبر clearAllListeners) =====
onListenersCleared(() => {
  merchantOrdersUnsub = null; merchantProdsUnsub = null;
});
