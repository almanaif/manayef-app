// ===== orders.js — دورة حياة الطلب المشتركة: إعدادات العمولة، إنشاء الطلب (Checkout)، تتبع الطلب =====

import { addDoc, collection, db, doc, serverTimestamp, updateDoc } from './firebase.js';
import { SL, STEPS, STEP_ICONS, STEP_LABELS, esc, onListenersCleared, onSnapshot, showScreen, showToast } from './utils.js';
import { custNav, updateCartUI } from './customer.js';
import { addNotif } from './notifications.js';
import { initTrackMap } from './maps.js';

// ===== CHECKOUT =====
export async function goCheckout() {
  if (!window.cart.length) { showToast('السلة فارغة!','err'); return; }
  if (!window.CU) { showScreen('screen-entry'); return; }
  if (window.cart.length > 12) { showToast('الحد الأقصى 12 صنف مختلف في الطلب الواحد','err'); return; }
  try {
    const total = window.cart.reduce((a,c)=>a+c.price*c.qty,0);
    const comm = Math.round(total*window.commRate/100);
    const fee = Math.round(total*0.15);
    const firstItem = window.cart[0];
    const orderStoreId = firstItem?.merchantId || null;
    const orderStoreName = firstItem?.storeName || 'متجر';
    if (!orderStoreId) { showToast('حدث خطأ في تحديد المتجر','err'); return; }
    const ref = await addDoc(collection(db,'orders'), {
      customerId: window.CU.uid, customerName: window.CUD?.name||'عميل', customerPhone: window.CUD?.phone||'',
      storeId: orderStoreId, storeName: orderStoreName,
      items: window.cart.map(c=>({id:c.id,name:c.name,price:c.price,qty:c.qty})),
      total, commission:comm, driverFee:fee, status:'new', driverId:null, driverName:null,
      customerLat: window.userLat||null, customerLng: window.userLng||null,
      createdAt: serverTimestamp()
    });
    window.cart=[]; updateCartUI();
    showToast('✅ تم إرسال طلبك بنجاح!','ok');
    const newPts = (window.CUD?.points||0) + Math.floor(total/10);
    await updateDoc(doc(db,'users',window.CU.uid), {points:newPts});
    window.CUD = {...window.CUD, points:newPts};
    showScreen('screen-customer');
    custNav('orders', document.querySelectorAll('#screen-customer .nav-item')[1]);
    addNotif('✅ تم استقبال طلبك!','جاري البحث عن مندوب لطلبك','or');
    setTimeout(() => openTrack(ref.id), 1500);
  } catch(e) { showToast('حدث خطأ، حاول مرة أخرى','err'); console.log(e); }
}


// ===== ORDER TRACKING =====
export let trackUnsub = null;
export function openTrack(ordId) {
  showScreen('screen-track');
  if (trackUnsub) { try { trackUnsub(); } catch(e){} trackUnsub = null; }
  document.getElementById('track-order-id').textContent = '#' + ordId.slice(-6).toUpperCase();
  trackUnsub = onSnapshot(doc(db,'orders',ordId), snap => {
    if (!snap.exists()) return;
    const o = {...snap.data(), id:snap.id};
    window._currentTrackOrd = o;
    document.getElementById('track-driver').textContent = o.driverName || 'بانتظار المندوب...'; // textContent آمنة أصلاً ومش محتاجة esc()
    document.getElementById('track-eta').textContent = '15-25 دقيقة';
    document.getElementById('track-total').textContent = (o.total||0) + ' ج';
    // Timeline
    if (o.status === 'cancelled') {
      document.getElementById('track-timeline').innerHTML =
        `<div class="tt-item"><div class="tt-left"><div class="tt-dot" style="background:var(--danger);color:#fff">❌</div></div>
          <div class="tt-right"><strong style="color:var(--danger)">تم إلغاء الطلب</strong><small>يمكنك التواصل مع المتجر لمعرفة السبب</small></div></div>`;
    } else {
      const si = STEPS.indexOf(o.status||'new');
      let tHtml = '';
      STEPS.forEach((s,i) => {
        const done = i < si;
        const active = i === si;
        tHtml += `<div class="tt-item"><div class="tt-left"><div class="tt-dot ${done ? 'done' : ''} ${active ? 'active' : ''}">${STEP_ICONS[i]}</div>${i < STEPS.length - 1 ? `<div class="tt-line ${done ? 'done' : ''}"></div>` : ''}</div><div class="tt-right"><strong>${STEP_LABELS[i]}</strong><small>${SL[s]}</small>${active ? '<span class="tt-time">الحالة الحالية</span>' : ''}${done ? '<span class="tt-time" style="color:var(--ok)">✓ مكتمل</span>' : ''}</div></div>`;
      });
      document.getElementById('track-timeline').innerHTML = tHtml;
    }
    // Rating section
    document.getElementById('rating-section').style.display = o.status==='done'?'block':'none';
    // Init map
    initTrackMap(o);
  });
}


// ===== SETTINGS LISTENER (جديد - العمولة بقت مركزية بدل قيمة ثابتة في المتصفح) =====
export let settingsUnsub = null;
export function listenSettings() {
  if (settingsUnsub) return;
  settingsUnsub = onSnapshot(doc(db,'settings','commission'), snap => {
    if (snap.exists() && typeof snap.data().rate === 'number') window.commRate = snap.data().rate;
  }, () => {});
}


// ===== تصفير أعلام المتابعة عند تسجيل الخروج (بيتنفذ من utils.js عبر clearAllListeners) =====
export function registerOrdersResets() {
  onListenersCleared(() => {
  settingsUnsub = null; trackUnsub = null;
  });
}
