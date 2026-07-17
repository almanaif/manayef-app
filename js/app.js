// ===== Manayef GO - Main Application Logic =====
// Imported from firebase.js module

import { db, auth, gProvider, collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, onSnapshot as _onSnapshotRaw, query, where, orderBy, serverTimestamp, limit, deleteDoc, runTransaction, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, sendPasswordResetEmail, isSignInWithEmailLink, signInWithEmailLink, sendSignInLinkToEmail, CLOUDINARY_CLOUD, CLOUDINARY_PRESET, STORE_LOC, DEFAULT_LOC } from './firebase.js';

// ===== LISTENER REGISTRY (تنظيف onSnapshot تلقائيًا عند تسجيل الخروج) =====
// أي كود في الملف بينده onSnapshot(...) بيتسجل هنا تلقائيًا من غير ما نلمس كل مكان مستخدم فيه.
// ده بيحل مشكلتين: تسريب الذاكرة (listeners بتفضل شغالة بعد تسجيل الخروج)، وتسريب بيانات
// مستخدم لمستخدم تاني بيسجل دخول بعده على نفس الجهاز من غير ما الصفحة تتعمل لها reload.
const _listeners = [];
function onSnapshot(...args) {
  const unsub = _onSnapshotRaw(...args);
  _listeners.push(unsub);
  return unsub;
}
function clearAllListeners() {
  _listeners.forEach(u => { try { u(); } catch (e) { Logger.error(e); } });
  _listeners.length = 0;
  // إعادة ضبط أعلام "already started" عشان تعمل subscribe جديد نظيف للمستخدم اللي هيسجل دخول بعد كده
  if (typeof productsUnsub !== 'undefined') productsUnsub = null;
  if (typeof couponsUnsub !== 'undefined') couponsUnsub = null;
  if (typeof bannersUnsub !== 'undefined') bannersUnsub = null;
  if (typeof categoriesUnsub !== 'undefined') categoriesUnsub = null;
  if (typeof notifListenerStarted !== 'undefined') notifListenerStarted = false;
  if (typeof settingsUnsub !== 'undefined') settingsUnsub = null;
  if (typeof storesUnsub !== 'undefined') storesUnsub = null;
  if (typeof ordersUnsub !== 'undefined') ordersUnsub = null;
  if (typeof productsByStoreUnsub !== 'undefined') productsByStoreUnsub = null;
  if (typeof trackUnsub !== 'undefined') trackUnsub = null;
  if (typeof trackDriverUnsub !== 'undefined') trackDriverUnsub = null;
  if (typeof newOrdersUnsub !== 'undefined') newOrdersUnsub = null;
  if (typeof driverOrdersUnsub !== 'undefined') driverOrdersUnsub = null;
  if (typeof merchantOrdersUnsub !== 'undefined') merchantOrdersUnsub = null;
  if (typeof merchantProdsUnsub !== 'undefined') merchantProdsUnsub = null;
  if (typeof adminOrdersUnsub !== 'undefined') adminOrdersUnsub = null;
  if (typeof adminUsersUnsub !== 'undefined') adminUsersUnsub = null;
  if (typeof auditLogUnsub !== 'undefined') auditLogUnsub = null;
  if (typeof smProdsUnsub !== 'undefined') smProdsUnsub = null;
}

// ===== ORDER STATUS CONSTANTS =====
const SL = {new:'جديد',accepted:'تم القبول',preparing:'جاري التحضير',ready:'جاهز',delivering:'في الطريق',done:'تم التسليم',cancelled:'ملغي'};
const SC = {new:'sb sb-new',accepted:'sb sb-accepted',preparing:'sb sb-preparing',ready:'sb sb-ready',delivering:'sb sb-delivering',done:'sb sb-done',cancelled:'sb sb-cancelled'};
const STEPS = ['new','accepted','preparing','ready','delivering','done'];
const STEP_ICONS = ['🆕','✅','👨‍🍳','📦','🛵','✅'];
const STEP_LABELS = ['جديد','تم القبول','جاري التحضير','جاهز للاستلام','في الطريق','تم التسليم'];

// ===== LOGGER (بديل موحد لـ console.log) =====
const DEV_MODE = false; // خليها true وقت التطوير فقط
const Logger = {
  info: (...a) => { if (DEV_MODE) console.log('[INFO]', ...a); },
  warn: (...a) => { if (DEV_MODE) console.warn('[WARN]', ...a); },
  error: (...a) => { console.error('[ERROR]', ...a); } // الأخطاء تتسجل دايمًا
};

// ===== DEBOUNCE =====
function debounce(fn, wait = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ===== OFFLINE HANDLING =====
function initOfflineHandling() {
  window.addEventListener('offline', () => showToast('⚠️ لا يوجد اتصال بالإنترنت', 'err'));
  window.addEventListener('online', () => showToast('✅ تم استعادة الاتصال', 'ok'));
}

// ===== XSS PROTECTION =====
// أي نص جاي من قاعدة البيانات (اسم منتج، اسم متجر، اسم مستخدم...) لازم يعدي من هنا
// قبل ما يتحط جوه innerHTML، عشان محدش يقدر يحط <script> أو onerror داخل اسمه ويشغّل كود عند غيره.
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
// نسخة خاصة بالنصوص اللي بتتحط جوه onclick="...('نص')" لأن السياق هنا HTML attribute
// وجوّاه كود JS في نفس الوقت، فلازم نأمّن الاتنين مع بعض.
function escJs(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== PRODUCTS LOADER (from Firestore) =====
let PRODS = [];
let productsUnsub = null;
function loadProducts() {
  if (productsUnsub) return;
  const q = query(collection(db,'products'), where('available','==',true));
  productsUnsub = onSnapshot(q, snap => {
    PRODS = snap.docs.map(d => {
      const p = d.data();
      return { id:d.id, name:p.name, unit:p.unit, price:p.price, icon:p.icon||'🛒', cat:p.cat||'other',
               available:p.available!==false, merchantId:p.merchantId, storeName:p.storeName||'متجر' };
    });
    const activeBtn = document.querySelector('#screen-store .pc-btn.active');
    const activeCat = activeBtn ? (activeBtn.dataset.cat || 'all') : 'all';
    if (document.getElementById('screen-store')?.classList.contains('active')) renderProds(activeCat);
  }, err => { showToast('تعذر تحميل المنتجات','err'); });
}

// ===== COUPONS LOADER =====
let couponsUnsub = null;
function loadCoupons() {
  if (couponsUnsub) return;
  const q = query(collection(db,'coupons'), orderBy('order','asc'));
  couponsUnsub = onSnapshot(q, snap => {
    const now = new Date();
    const items = [];
    snap.forEach(d => {
      const c = d.data();
      if (c.active === false) return;
      if (c.expiryDate && new Date(c.expiryDate) < now) return;
      items.push({id:d.id, ...c});
    });
    const sec = document.getElementById('off-sec');
    const scroll = document.getElementById('off-scroll');
    if (!items.length) { if (sec) sec.style.display='none'; return; }
    if (sec) sec.style.display='block';
    if (scroll) scroll.innerHTML = items.map(c =>
      `<div class="off-card"><div class="off-badge">${esc(c.badge)}</div><div class="off-icon">${esc(c.icon)||'🎟️'}</div><h4>${esc(c.title)}</h4><p>${esc(c.description)}</p><div class="off-code">${esc(c.code)}</div></div>`
    ).join('');
  });
}

// ===== BANNERS LOADER =====
let bannersUnsub = null;
function loadBanners() {
  if (bannersUnsub) return;
  const q = query(collection(db,'banners'), orderBy('order','asc'));
  bannersUnsub = onSnapshot(q, snap => {
    const now = new Date();
    const items = [];
    snap.forEach(d => {
      const b = d.data();
      if (b.active === false) return;
      if (b.startDate && new Date(b.startDate) > now) return;
      if (b.endDate && new Date(b.endDate) < now) return;
      items.push({id:d.id, ...b});
    });
    const sec = document.getElementById('banner-sec');
    const scroll = document.getElementById('banner-scroll');
    if (!items.length) { if (sec) sec.style.display='none'; return; }
    if (sec) sec.style.display='block';
    if (scroll) scroll.innerHTML = items.map(b => {
      const bg = b.imageUrl ? `background-image:url('${esc(b.imageUrl)}');background-size:cover;background-position:center` : `background:linear-gradient(135deg,#FF6B00,#FF4500)`;
      return `<div class="bcard" style="${bg}" onclick="${b.storeId?`openStore('${esc(b.storeId)}')`:''}"><div class="bc"><span class="btag">${esc(b.tag)}</span><h3>${esc(b.title)}</h3><p>${esc(b.description)}</p></div></div>`;
    }).join('');
  });
}

// ===== CATEGORIES LOADER =====
let CATS = {};
let categoriesUnsub = null;
function loadCategories() {
  if (categoriesUnsub) return;
  const q = query(collection(db,'categories'), orderBy('order','asc'));
  categoriesUnsub = onSnapshot(q, snap => {
    CATS = {};
    const items = [];
    snap.forEach(d => { const c = d.data(); CATS[d.id] = esc(`${c.icon||''} ${c.label||''}`.trim()); items.push({id:d.id, ...c}); });
    const pcScroll = document.getElementById('pc-scroll');
    if (pcScroll) {
      pcScroll.innerHTML = `<button class="pc-btn active" onclick="filterProds('all',this)">الكل</button>` +
        items.map(c => `<button class="pc-btn" onclick="filterProds('${c.id}',this)">${esc(c.icon)} ${esc(c.label)}</button>`).join('');
    }
    const apCat = document.getElementById('ap-cat');
    if (apCat) apCat.innerHTML = items.map(c => `<option value="${c.id}">${esc(c.icon)} ${esc(c.label)}</option>`).join('') || '<option value="other">📦 عام</option>';
  });
}

// ===== STORES LOADER (from Firestore - NO DUMMY DATA) =====
// جديد: كان بيقرا من /users فين role=='merchant' وده كان بيسرّب بيانات التاجر الخاصة
// (docs/ownerPhone/email) لأي حد مسجل دخول. دلوقتي بيقرا من /stores اللي فيها بس
// البيانات العامة الآمنة للعرض.
let storesUnsub = null;
function loadStores() {
  if (!window.CU) return;
  if (storesUnsub) return;
  const q = query(collection(db,'stores'), where('status','==','active'));
  storesUnsub = onSnapshot(q, snap => {
    const list = document.getElementById('stores-list');
    if (snap.empty) {
      list.innerHTML = '<div class="empty-state" style="padding:32px 20px;color:#6B7280"><div style="font-size:44px;margin-bottom:12px">🏪</div><p style="font-size:13px;font-weight:600">لا توجد متاجر متاحة حالياً</p><small style="font-size:11px;margin-top:4px;display:block">سيتم إضافة متاجر قريباً</small></div>';
      return;
    }
    let html = '';
    snap.forEach(d => {
      const m = d.data();
      const catMap = {'بقالة':'super','مطعم':'food','صيدلية':'pharma','متجر':'shop','حلويات':'food','خدمات':'shop'};
      const cat = catMap[m.category] || 'super';
      const sName = m.storeName || m.name || 'متجر';
      const sPhone = m.storePhone || m.phone || '';
      html += `<div class="store-card" data-cat="${cat}">
        <div class="store-img" style="background:linear-gradient(135deg,#1A1A2E,#0F3460)"><span style="font-size:58px">🏪</span><div class="s-open s-on">مفتوح</div></div>
        <div class="store-body">
          <h3>${esc(sName)}</h3>
          <div class="store-meta"><span>📦 توصيل متاح</span><span>🛵 رسوم التوصيل متاحة</span></div>
          <div class="store-tags"><span class="store-tag">${esc(m.category)||'بقالة'}</span></div>
          <div class="store-acts">
            <button class="sa-btn sa-call" onclick="event.stopPropagation();callStore('${escJs(sPhone)}')">📞 اتصال</button>
            <button class="sa-btn sa-wa" onclick="event.stopPropagation();openWA('${escJs(sPhone)}','${escJs(sName)}')">💬 واتساب</button>
            <button class="sa-btn sa-order" onclick="showScreen('screen-store');loadProductsByStore('${d.id}','${escJs(sName)}','${escJs(sPhone)}')">🛒 اطلب</button>
          </div>
        </div>
      </div>`;
    });
    list.innerHTML = html;
  });
}

// ===== LOAD PRODUCTS BY STORE =====
let productsByStoreUnsub = null;
function loadProductsByStore(storeId, storeName, storePhone) {
  window.currentStoreName = storeName || 'متجر';
  window.currentStorePhone = storePhone || '';
  const nameEl = document.getElementById('store-detail-name');
  if (nameEl) nameEl.textContent = window.currentStoreName;
  if (productsByStoreUnsub) { try { productsByStoreUnsub(); } catch(e){} productsByStoreUnsub = null; }
  const q = query(collection(db,'products'), where('merchantId','==',storeId), where('available','==',true));
  productsByStoreUnsub = onSnapshot(q, snap => {
    PRODS = snap.docs.map(d => {
      const p = d.data();
      return { id:d.id, name:p.name, unit:p.unit, price:p.price, icon:p.icon||'🛒', cat:p.cat||'other',
               available:p.available!==false, merchantId:p.merchantId||storeId, storeName: storeName||'متجر' };
    });
    renderProds('all');
  });
}

// ===== RENDER PRODUCTS =====
function renderProds(cat) {
  const prods = cat==='all'?PRODS:PRODS.filter(p=>p.cat===cat);
  const grouped = {};
  prods.forEach(p => { if(!grouped[p.cat]) grouped[p.cat]=[]; grouped[p.cat].push(p); });
  let html = '';
  Object.keys(grouped).forEach(c => {
    html += `<div class="prod-sec-t pst" data-sec="${c}">${CATS[c]||c}</div><div class="prods-grid pst" data-sec="${c}">`;
    grouped[c].forEach(p => {
      const inCart = window.cart.find(x=>x.id===p.id);
      const qty = inCart?.qty||0;
      html += `<div class="prod-card"><div class="prod-img">${esc(p.icon)}</div><div class="prod-body"><h4>${esc(p.name)}</h4><div class="prod-unit">${esc(p.unit)}</div><div class="prod-foot"><span class="prod-price">${p.price} ج</span>
        ${p.available ? qty>0
          ? `<div class="qty-ctrl"><button class="qty-btn" onclick="chgQty('${p.id}',-1)">−</button><span class="qty-num" id="qty-${p.id}">${qty}</span><button class="qty-btn" onclick="chgQty('${p.id}',1)">+</button></div>`
          : `<button class="prod-add" onclick="addCart('${p.id}')">+</button>`
          : '<span class="prod-unavail">غير متاح</span>'}
      </div></div></div>`;
    });
    html += '</div>';
  });
  document.getElementById('prods-section').innerHTML = html;
}

// ===== SEARCH =====
const doSearch = debounce(function (val) {
  const res = document.getElementById('search-results');
  if (!val.trim()) { res.style.display='none'; res.innerHTML=''; return; }
  const v = val.toLowerCase();
  const matches = PRODS.filter(p => p.name.toLowerCase().includes(v) || (p.unit||'').toLowerCase().includes(v));
  const storeMatches = []; // will be populated from stores list
  res.style.display = 'block';
  if (!matches.length) { res.innerHTML='<div class="empty-state" style="padding:16px"><p>لا توجد نتائج</p></div>'; return; }
  res.innerHTML = matches.slice(0,8).map(p =>
    `<div class="res-item" onclick="showScreen('screen-store');renderProds('all')">
      <div class="res-ic">${esc(p.icon)}</div>
      <div class="res-info"><strong>${esc(p.name)}</strong><small>${esc(p.unit)} • ${esc(p.storeName)}</small></div>
      <span class="res-price">${p.price} ج</span>
    </div>`
  ).join('');
}, 250);

// ===== FILTER CATEGORIES =====
function filterCat(cat, el) {
  document.querySelectorAll('.cat-item').forEach(i=>i.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.store-card').forEach(c => {
    c.style.display = (cat==='all'||c.dataset.cat===cat) ? 'block' : 'none';
  });
}

// ===== CART =====
function addCart(id) {
  const p = PRODS.find(x=>x.id===id); if(!p) return;
  const ex = window.cart.find(x=>x.id===id);
  if (ex) ex.qty++; else window.cart.push({...p,qty:1});
  updateCartUI(); renderProds('all');
  showToast('✅ أضيف للسلة','ok');
}
function chgQty(id,d) {
  const item = window.cart.find(x=>x.id===id); if(!item) return;
  item.qty += d;
  if (item.qty <= 0) window.cart = window.cart.filter(x=>x.id!==id);
  updateCartUI(); renderProds('all');
}
function removeCartItem(id) {
  window.cart = window.cart.filter(x=>x.id!==id);
  updateCartUI(); renderProds('all');
}
function renderCartScreen() {
  const list = document.getElementById('cart-items-list');
  const lbl = document.getElementById('cart-item-count-lbl');
  const barTotal = document.getElementById('cart-total-full');
  const bar = document.getElementById('cart-bar-screen');
  if (!list) return;
  const count = window.cart.reduce((a,c)=>a+c.qty,0);
  const total = window.cart.reduce((a,c)=>a+c.price*c.qty,0);
  if (lbl) lbl.textContent = count ? count+' عنصر' : 'السلة فارغة';
  if (barTotal) barTotal.textContent = total+' ج';
  if (bar) bar.style.display = count>0 ? 'block' : 'none';
  if (!window.cart.length) {
    list.innerHTML = '<div class="empty-state"><div class="ei">🛒</div><p>السلة فارغة</p><small>أضف منتجات من أي متجر</small></div>';
    return;
  }
  list.innerHTML = window.cart.map(c => `
    <div style="background:#fff;border-radius:var(--r);padding:12px;margin-bottom:10px;box-shadow:var(--sh);border:1px solid var(--border);display:flex;align-items:center;gap:10px">
      <div style="font-size:30px">${esc(c.icon)||'🛒'}</div>
      <div style="flex:1;min-width:0">
        <h4 style="font-size:13px;font-weight:800;margin-bottom:2px">${esc(c.name)}</h4>
        <div style="font-size:11px;color:var(--mu)">${esc(c.storeName)||''}</div>
        <div style="font-size:13px;font-weight:900;color:var(--p);margin-top:4px">${c.price} ج</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        <div class="qty-ctrl"><button class="qty-btn" onclick="chgQty('${c.id}',-1)">−</button><span class="qty-num">${c.qty}</span><button class="qty-btn" onclick="chgQty('${c.id}',1)">+</button></div>
        <button onclick="removeCartItem('${c.id}')" style="background:none;border:none;color:var(--danger);font-size:11px;cursor:pointer">🗑️ حذف</button>
      </div>
    </div>`).join('');
}
function updateCartUI() {
  const count = window.cart.reduce((a,c)=>a+c.qty,0);
  const total = window.cart.reduce((a,c)=>a+c.price*c.qty,0);
  document.getElementById('cart-b').textContent = count;
  const cs = document.getElementById('cart-count-s'); if(cs) cs.textContent=count;
  const ts = document.getElementById('cart-total-s'); if(ts) ts.textContent=total+' ج';
  const bar = document.getElementById('cart-bar-store'); if(bar) bar.style.display=count>0?'block':'none';
  if (document.getElementById('screen-cart')?.classList.contains('active')) renderCartScreen();
}
function openCart() {
  const active = document.querySelector('.screen.active');
  if (active && active.id !== 'screen-cart') window.cartReturnScreen = active.id;
  showScreen('screen-cart');
  renderCartScreen();
}

// ===== CHECKOUT =====
async function goCheckout() {
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

// ===== NOTIFICATIONS =====
function addNotif(title, body, type='gn') {
  const list = document.getElementById('notif-list');
  const n = document.getElementById('notif-c');
  const count = parseInt(n.textContent)||0;
  n.textContent = count+1;
  list.insertAdjacentHTML('afterbegin', `<div class="ni"><div class="ni-dot ${esc(type)}"></div><div class="ni-info"><p>${esc(title)}</p><small>${esc(body)}</small></div></div>`);
}

let notifListenerStarted = false;
function startNotifListener() {
  if (notifListenerStarted || !window.CU) return;
  notifListenerStarted = true;
  const q = query(collection(db,'notifications'), where('userId','==',window.CU.uid));
  onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const d = change.doc.data();
        addNotif(d.title||'إشعار جديد', d.body||'', d.type||'gn');
      }
    });
  });
}

// ===== CUSTOMER FUNCTIONS =====
function loadCustomerData() {
  if (!window.CUD) return;
  const ud = window.CUD;
  document.getElementById('cust-name').textContent = ud.name || '--';
  document.getElementById('cust-email').textContent = ud.email || '--';
  const pts = ud.points || 0;
  ['user-pts','pts-big','pts-prof','pts-menu'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=pts; });
  if (ud.photoURL) {
    ['cust-av'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=`<img src="${esc(ud.photoURL)}" alt="avatar">`; });
  }
  loadOrders();
  loadStores();
}

let ordersUnsub = null;
function loadOrders() {
  if (!window.CU) return;
  if (ordersUnsub) return;
  try {
    const q = query(collection(db,'orders'), where('customerId','==',window.CU.uid), orderBy('createdAt','desc'), limit(10));
    ordersUnsub = onSnapshot(q, snap => {
      const list = document.getElementById('orders-list');
      if (snap.empty) { list.innerHTML = '<div class="empty-state"><div class="ei">📦</div><p>لا توجد طلبات</p><small>اطلب من أي متجر</small></div>'; return; }
      let html = '';
      snap.forEach(d => {
        const o = {...d.data(), id:d.id};
        const si = STEPS.indexOf(o.status||'new');
        html += `<div class="order-track-card" style="background:#fff;border-radius:var(--r);padding:14px;margin-bottom:10px;box-shadow:var(--sh);border:1px solid var(--border);cursor:pointer" onclick="openTrack('${d.id}')">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <span style="font-size:11px;font-weight:700;color:var(--mu)">#${d.id.slice(-6).toUpperCase()}</span>
            <span class="${SC[o.status]||'sb sb-new'}">${SL[o.status]||'جديد'}</span>
          </div>
          <div style="display:flex;gap:4px;margin-bottom:8px;overflow-x:auto">
            ${STEPS.map((s,i) => {
              const cls = i<si?'done':i===si?'active':'';
              return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:38px"><div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid ${i<=si?i<si?'var(--ok)':'var(--p)':'var(--border)'};background:${i<si?'var(--ok)':i===si?'var(--p)':'#fff'};color:${i<=si?'#fff':'var(--mu)'}">${STEP_ICONS[i]}</div><div style="font-size:8px;color:${i===si?'var(--p)':'var(--mu)'};text-align:center;margin-top:2px;white-space:nowrap;font-weight:${i===si?800:600}">${STEP_LABELS[i]}</div></div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid var(--border);font-size:12px">
            <span style="color:var(--mu)">🏪 ${esc(o.storeName)||'--'}</span>
            <span style="font-size:14px;font-weight:900;color:var(--p)">${o.total||0} ج</span>
          </div>
        </div>`;
      });
      list.innerHTML = html;
    });
  } catch(e) { console.log(e); }
}

function custNav(tab, el) {
  document.querySelectorAll('#screen-customer .nav-item').forEach(n=>n.classList.remove('active'));
  if(el) el.classList.add('active');
  document.getElementById('tab-home').style.display = tab==='home'?'block':'none';
  document.getElementById('tab-orders').style.display = tab==='orders'?'block':'none';
  document.getElementById('tab-rewards').style.display = tab==='rewards'?'block':'none';
  document.getElementById('tab-profile').style.display = tab==='profile'?'block':'none';
}

// ===== ORDER TRACKING =====
let trackUnsub = null;
function openTrack(ordId) {
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

// ===== MAPS =====
let trackDriverUnsub = null;
function initTrackMap(ordData) {
  if (window.trackMap) { window.trackMap.remove(); window.trackMap = null; }
  window.driverMarker = null; window.customerMarker = null; // كانت بتفضل مشيرة لماركرز على خريطة اتشالت
  if (typeof L === 'undefined') return;
  window.trackMap = L.map('tracking-map', {zoomControl:false, attributionControl:false}).setView(STORE_LOC, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.trackMap);
  const storeIcon = L.divIcon({html:'<div style="font-size:24px;line-height:1">🏪</div>',className:'',iconSize:[30,30]});
  L.marker(STORE_LOC, {icon:storeIcon}).addTo(window.trackMap);
  if (window.userLat) {
    const custIcon = L.divIcon({html:'<div style="font-size:24px;line-height:1">📍</div>',className:'',iconSize:[30,30]});
    window.customerMarker = L.marker([window.userLat, window.userLng], {icon:custIcon}).addTo(window.trackMap);
  }
  if (trackDriverUnsub) { try { trackDriverUnsub(); } catch(e){} trackDriverUnsub = null; }
  if (ordData?.driverId) {
    trackDriverUnsub = onSnapshot(doc(db,'users',ordData.driverId), snap => {
      const d = snap.data();
      if (d?.lat && d?.lng) {
        if (!window.driverMarker) {
          const drvIcon = L.divIcon({html:'<div style="font-size:24px;line-height:1">🛵</div>',className:'',iconSize:[30,30]});
          window.driverMarker = L.marker([d.lat, d.lng], {icon:drvIcon}).addTo(window.trackMap);
        } else {
          window.driverMarker.setLatLng([d.lat, d.lng]);
        }
      }
    });
  }
}

function toggleDriverMap() {
  const sec = document.getElementById('drv-map-sec');
  const show = sec.style.display === 'none';
  sec.style.display = show ? 'block' : 'none';
  if (show && !window.drvMap && typeof L !== 'undefined') {
    setTimeout(() => {
      window.drvMap = L.map('driver-map', {zoomControl:false,attributionControl:false}).setView(DEFAULT_LOC, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.drvMap);
    }, 100);
  }
}

function initAdminMap(drivers=[]) {
  if (window.admMap) { window.admMap.remove(); window.admMap = null; }
  if (typeof L === 'undefined') return;
  setTimeout(() => {
    window.admMap = L.map('admin-map', {zoomControl:true,attributionControl:false}).setView(DEFAULT_LOC, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.admMap);
    drivers.forEach(d => {
      if (d.lat && d.lng) {
        const di = L.divIcon({html:`<div style="font-size:18px;background:#FF6B00;border-radius:50%;padding:3px;border:2px solid #fff;width:28px;height:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)">🛵</div>`,className:'',iconSize:[28,28]});
        L.marker([d.lat, d.lng], {icon:di}).addTo(window.admMap);
      }
    });
  }, 150);
}

// ===== RATING =====
function selectRatingTarget(target) {
  window.ratingTarget = target;
  document.querySelectorAll('.rt-card').forEach(c=>c.classList.remove('active'));
  document.getElementById('rt-'+target).classList.add('active');
}
function setStar(n) {
  window.ratingStars = n;
  document.querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('active',i<n));
}
async function submitRating() {
  if (!window.CU || !window._currentTrackOrd) return;
  const o = window._currentTrackOrd;
  try {
    await addDoc(collection(db,'ratings'), {
      orderId: o.id, targetId: window.ratingTarget==='store'?o.storeId:o.driverId,
      targetType: window.ratingTarget, stars: window.ratingStars,
      comment: document.getElementById('rating-comment').value||'',
      customerId: window.CU.uid, createdAt: serverTimestamp()
    });
    showToast('✅ شكراً لتقييمك!','ok');
    document.getElementById('rating-section').style.display='none';
  } catch(e) { showToast('حدث خطأ','err'); }
}

// ===== AUTH FUNCTIONS =====
function hideLoading() {
  const ld = document.getElementById('loading');
  ld.classList.add('hide');
  setTimeout(() => ld.style.display = 'none', 500);
}

function switchTab(t) {
  document.querySelectorAll('.auth-tab').forEach((b,i) => b.classList.toggle('active',(t==='login'&&i===0)||(t==='register'&&i===1)));
  document.getElementById('auth-login').style.display = t==='login'?'block':'none';
  document.getElementById('auth-register').style.display = t==='register'?'block':'none';
  document.getElementById('err-msg').style.display = 'none';
  updateEntryLabel(t);
}

const ENTRY_LABELS = {customer:{icon:'👤',name:'عميل'},driver:{icon:'🛵',name:'مندوب'},merchant:{icon:'🏪',name:'تاجر'},admin:{icon:'⚙️',name:'إدارة'}};
function updateEntryLabel(tab) {
  const cfg = ENTRY_LABELS[window.selectedType] || ENTRY_LABELS.customer;
  document.getElementById('entry-type-icon').textContent = cfg.icon;
  document.getElementById('entry-type-label').textContent = tab === 'register' ? `حساب ${cfg.name} جديد` : `دخول كـ${cfg.name}`;
}

function pickEntryType(type) {
  window.selectedType = type;
  ['customer','merchant','driver','admin'].forEach(t => {
    const el = document.getElementById('reg-'+t+'-fields');
    if (el) el.style.display = t === type ? 'block' : 'none';
  });
  switchTab('register');
  showScreen('screen-auth');
}

async function showEmailOTP() {
  const emailInput = document.getElementById('lmail');
  const email = emailInput?.value?.trim() || '';
  const finalEmail = email || prompt('أدخل بريدك الإلكتروني:');
  if (!finalEmail) return;
  try {
    await sendSignInLinkToEmail(auth, finalEmail, {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    });
    window.localStorage?.setItem('emailForSignIn', finalEmail);
    document.getElementById('otp-email').textContent = finalEmail;
    showScreen('screen-otp');
    showToast('✅ تم إرسال رابط التحقق على بريدك','ok');
  } catch(e) { showToast('حدث خطأ: '+e.message,'err'); }
}

async function loginGoogle() {
  try {
    showToast('جاري تسجيل الدخول بـ Google...','inf');
    await signInWithRedirect(auth, gProvider);
  } catch(e) {
    if (e.code === 'auth/unauthorized-domain') showToast('الدومين غير مصرح في Firebase','err');
    else showToast('خطأ في تسجيل الدخول بـ Google','err');
  }
}

async function doLogin() {
  const email = document.getElementById('lmail').value.trim();
  const pass = document.getElementById('lpass').value;
  if (!email || !pass) { showErr('يرجى تعبئة جميع الحقول'); return; }
  setLoad('login-btn','lsp',true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    showToast('أهلاً بك! 👋','ok');
  } catch(e) {
    let msg = 'خطأ في تسجيل الدخول';
    if (e.code?.includes('user-not-found') || e.code?.includes('wrong-password') || e.code?.includes('invalid-credential')) msg = 'البريد أو كلمة المرور غير صحيحة';
    showErr(msg);
  } finally { setLoad('login-btn','lsp',false); }
}

async function doRegister() {
  const role = window.selectedType || 'customer';
  let email='', pass='', data={};
  if (role === 'customer') {
    const name = document.getElementById('rname')?.value?.trim();
    email = document.getElementById('rmail')?.value?.trim();
    const phone = document.getElementById('rphone')?.value?.trim();
    const address = document.getElementById('raddress')?.value?.trim();
    pass = document.getElementById('rpass')?.value;
    if (!name||!email||!pass) { showErr('يرجى تعبئة الاسم والبريد وكلمة المرور'); return; }
    data = { name, email, phone, address, role, points:0, status:'active', createdAt:serverTimestamp() };
  } else if (role === 'merchant') {
    const storeName = document.getElementById('r-store-name')?.value?.trim();
    const ownerName = document.getElementById('r-owner-name')?.value?.trim();
    const storePhone = document.getElementById('r-store-phone')?.value?.trim();
    const ownerPhone = document.getElementById('r-owner-phone')?.value?.trim();
    const storeAddr = document.getElementById('r-store-addr')?.value?.trim();
    email = document.getElementById('r-store-mail')?.value?.trim();
    pass = document.getElementById('r-store-pass')?.value;
    if (!storeName||!email||!pass) { showErr('يرجى تعبئة اسم المتجر والبريد وكلمة المرور'); return; }
    data = { name:ownerName, storeName, storePhone, ownerPhone, address:storeAddr, email, role, points:0, status:'pending', docs:window.uploadedDocs||{}, createdAt:serverTimestamp() };  } else if (role === 'driver') {
    const fullName = document.getElementById('r-drv-name')?.value?.trim();
    const phone = document.getElementById('r-drv-phone')?.value?.trim();
    const address = document.getElementById('r-drv-addr')?.value?.trim();
    email = document.getElementById('r-drv-mail')?.value?.trim();
    pass = document.getElementById('r-drv-pass')?.value;
    if (!fullName||!email||!pass) { showErr('يرجى تعبئة الاسم والبريد وكلمة المرور'); return; }
    data = { name:fullName, phone, address, email, role, points:0, status:'pending', docs:window.uploadedDocs||{}, createdAt:serverTimestamp() };
  }
  if (pass.length < 6) { showErr('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
  setLoad('reg-btn','rsp',true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db,'users',cred.user.uid), data);
    if (role === 'merchant') {
      // مستند عام آمن للعرض فقط (بدون docs/ownerPhone/email الخاصة بالتاجر)
      await setDoc(doc(db,'stores',cred.user.uid), {
        storeName: data.storeName, storePhone: data.storePhone,
        category: data.category || 'متجر', status: 'pending', createdAt: serverTimestamp()
      });
    }
    window.CUD = data;
    syncToHubSpot(data);
    showToast('تم إنشاء حسابك! 🎉','ok');
    if (role === 'driver') showScreen('screen-driver-register');
    else if (role === 'merchant') { showScreen('screen-merchant'); loadMerchantData(); }
    else { showScreen('screen-customer'); loadCustomerData(); }
  } catch(e) {
    let msg = 'حدث خطأ';
    if (e.code === 'auth/email-already-in-use') msg = 'البريد مسجل بالفعل، سجّل دخول';
    showErr(msg);
  } finally { setLoad('reg-btn','rsp',false); }
}

async function doLogout() {
  if (window._gpsWatch) navigator.geolocation.clearWatch(window._gpsWatch);
  if (window._gpsInterval) clearInterval(window._gpsInterval);
  _lastGpsWrite = 0; _lastGpsLat = null; _lastGpsLng = null;
  clearAllListeners(); // يقفل كل الـ onSnapshot listeners المفتوحة (طلبات، منتجات، إشعارات...)
  try { await signOut(auth); } catch(e) {}
  showScreen('screen-entry');
}

async function showForgot() {
  const email = document.getElementById('lmail').value.trim();
  if (!email) { showErr('أدخل بريدك الإلكتروني أولاً'); return; }
  try { await sendPasswordResetEmail(auth, email); showToast('تم إرسال رابط الاستعادة ✅','ok'); } catch(e) { showToast('حدث خطأ','err'); }
}

async function selectRole(role) {
  if (!window.CU) return;
  const user = window.CU;
  const data = {
    name: user.displayName || 'مستخدم',
    email: user.email,
    phone: '',
    role,
    points: 0,
    photoURL: user.photoURL || '',
    status: role === 'driver' ? 'pending' : 'active',
    createdAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db,'users',user.uid), data);
    window.CUD = data;
    syncToHubSpot(data);
    if (role === 'driver') showScreen('screen-driver-register');
    else routeUser();
  } catch(e) { showToast('حدث خطأ، حاول مرة أخرى','err'); }
}

// ===== SETTINGS LISTENER (جديد - العمولة بقت مركزية بدل قيمة ثابتة في المتصفح) =====
let settingsUnsub = null;
function listenSettings() {
  if (settingsUnsub) return;
  settingsUnsub = onSnapshot(doc(db,'settings','commission'), snap => {
    if (snap.exists() && typeof snap.data().rate === 'number') window.commRate = snap.data().rate;
  }, () => {});
}

// ===== ROUTING =====
function routeUser() {
  const role = window.CUD?.role;
  startNotifListener();
  loadCategories();
  loadBanners();
  loadCoupons();
  listenSettings();
  if (role === 'admin') { showScreen('screen-admin'); loadAdminData(); }
  else if (role === 'driver') {
    if (window.CUD?.status === 'pending') showScreen('screen-driver-register');
    else { showScreen('screen-driver'); loadDriverData(); startGPS(); }
  }
  else if (role === 'merchant') { showScreen('screen-merchant'); loadMerchantData(); }
  else { showScreen('screen-customer'); loadCustomerData(); getLocation(); loadProducts(); loadBanners(); }
}

// ===== GPS / LOCATION =====
function getLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const {latitude:lat, longitude:lng} = pos.coords;
    window.userLat = lat; window.userLng = lng;
    showToast('📍 تم تحديد موقعك','ok');
    if (window.CU && window.CUD?.role === 'customer') {
      updateDoc(doc(db,'users',window.CU.uid), {lat, lng}).catch(()=>{});
    }
  }, ()=>{});
}

// جديد: تحديث الموقع كان بيكتب على Firestore مع كل نبضة GPS (ممكن كل ثانية أو أقل).
// دلوقتي بنكتب بس كل 10 ثواني على الأقل، أو لو المندوب اتحرك أكتر من 30 متر.
function _distMeters(lat1,lng1,lat2,lng2){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
let _lastGpsWrite = 0, _lastGpsLat = null, _lastGpsLng = null;
function startGPS() {
  if (!navigator.geolocation || !window.CU) return;
  window._gpsWatch = navigator.geolocation.watchPosition(pos => {
    const {latitude:lat, longitude:lng} = pos.coords;
    window.driverLat = lat; window.driverLng = lng;
    if (window.drvMap && window.driverMarker && typeof L !== 'undefined') {
      window.driverMarker.setLatLng([lat, lng]);
    }
    const now = Date.now();
    const movedFar = _lastGpsLat===null || _distMeters(_lastGpsLat,_lastGpsLng,lat,lng) >= 30;
    if (now - _lastGpsWrite < 10000 && !movedFar) return;
    _lastGpsWrite = now; _lastGpsLat = lat; _lastGpsLng = lng;
    updateDoc(doc(db,'users',window.CU.uid), {lat, lng, lastSeen: serverTimestamp()}).catch(()=>{});
  }, ()=>{}, {enableHighAccuracy:true, maximumAge:10000, timeout:15000});
}

// ===== SECURE CLOUDINARY UPLOAD =====
// بدل ما نستخدم upload_preset مفتوح (أي حد يقدر يرفع بيه من برة التطبيق)،
// بنجيب توقيع (signature) صالح لمدة دقايق من الـ Worker قبل كل رفعة، والتوقيع ده مربوط
// بالتوقيت فبيبقى صالح لفترة قصيرة بس، فمينفعش حد يستخدمه غير من جوه التطبيق وقت الرفع.
const CLOUDINARY_SIGN_URL = 'https://manayef-cloudinary-sign.mohamedselim3121998.workers.dev';
async function secureCloudinaryUpload(file) {
  const signRes = await fetch(CLOUDINARY_SIGN_URL);
  if (!signRes.ok) throw new Error('sign failed');
  const { timestamp, signature, apiKey, cloudName, folder } = await signRes.json();
  const fd = new FormData();
  fd.append('file', file);
  fd.append('api_key', apiKey);
  fd.append('timestamp', timestamp);
  fd.append('signature', signature);
  fd.append('folder', folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method:'POST', body:fd });
  const result = await res.json();
  if (!result.secure_url) throw new Error('upload failed');
  return result.secure_url;
}

// ===== HUBSPOT SYNC =====
function syncToHubSpot(data) {
  fetch('https://manayef-hubspot-bridge.mohamedselim3121998.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      village: data.address || data.village || '',
      role: data.role || ''
    })
  }).catch(() => {});
}

// ===== DRIVER FUNCTIONS =====
function loadDriverData() {
  const ud = window.CUD;
  if (ud) {
    document.getElementById('drv-name').textContent = `أهلاً، ${ud.name||''} 👋`;
    document.getElementById('drv-prof-name').textContent = ud.name||'--';
    document.getElementById('drv-prof-sub').textContent = ud.email||'--';
    if (ud.photoURL) {
      const av = document.getElementById('drv-av');
      if (av) av.innerHTML = `<img src="${esc(ud.photoURL)}" alt="">`;
    }
    const rn = document.getElementById('drv-rating-num');
    if (rn) rn.textContent = (ud.rating!=null ? ud.rating : 5.0).toFixed(1);
  }
  loadDriverOrders();
  buildChart();
  listenNewOrders();
}

let newOrdersUnsub = null;
function listenNewOrders() {
  if (!window.CU) return;
  if (newOrdersUnsub) return;
  const q = query(collection(db,'orders'), where('status','in',['new','accepted','preparing','ready']), where('driverId','==',null));
  newOrdersUnsub = onSnapshot(q, snap => {
    if (!snap.empty && window.onlineStatus) {
      const ord = snap.docs[0]; const o = ord.data();
      document.getElementById('new-ord-banner').style.display='flex';
      document.getElementById('new-ord-txt').textContent = `${o.storeName||'متجر'} → ${o.customerName||'عميل'}\nالأجر: ${o.driverFee||0} ج`; // textContent آمنة
      window._pendingOrdId = ord.id;
      window._pendingOrdTotal = o.total||0;
      window._pendingOrdFee = o.driverFee||0;
    } else {
      document.getElementById('new-ord-banner').style.display='none';
    }
  });
}

let driverOrdersUnsub = null;
function loadDriverOrders() {
  if (!window.CU) return;
  if (driverOrdersUnsub) return;
  const q = query(collection(db,'orders'), where('driverId','==',window.CU.uid), orderBy('createdAt','desc'), limit(20));
  driverOrdersUnsub = onSnapshot(q, snap => {
    const list = document.getElementById('drv-ords-list');
    const today = new Date().toDateString();
    let tOrd=0, tEarn=0, wOrd=0, wEarn=0;
    const now = new Date();
    if (snap.empty) { list.innerHTML='<div class="empty-state"><div class="ei">📭</div><p>لا توجد طلبات</p></div>'; return; }
    let html = '';
    snap.forEach(d => {
      const o = {...d.data(),id:d.id};
      const dt = o.createdAt?.toDate?o.createdAt.toDate():new Date();
      if (dt.toDateString()===today) { tOrd++; tEarn+=o.driverFee||0; }
      if ((now-dt)/(1000*60*60*24)<=7) { wOrd++; wEarn+=o.driverFee||0; }
      html += `<div class="ord-card">
        <div class="ord-top"><span class="ord-id">#${d.id.slice(-6).toUpperCase()}</span><span class="${SC[o.status]||'sb sb-new'}">${SL[o.status]||'جديد'}</span></div>
        <div class="ord-route"><div class="ord-pt"><div class="ol">الاستلام</div><div class="ov">${esc(o.storeName)||'--'}</div></div><span class="ord-arr">←</span><div class="ord-pt"><div class="ol">التوصيل</div><div class="ov">${esc(o.customerName)||'العميل'}</div></div></div>
        <div class="ord-foot"><div class="ord-earn">${o.driverFee||0} ج <small>أجر التوصيل</small></div>
          <div style="display:flex;gap:5px">
            ${o.status==='ready'?`<button class="mb2 mb-acc" onclick="updOrdStatus('${d.id}','delivering')">استلمت ✓</button>`:''}
            ${o.status==='delivering'?`<button class="mb2 mb-acc" onclick="updOrdStatus('${d.id}','done')">سلّمت ✓</button>`:''}
            ${(o.status==='new'||o.status==='accepted'||o.status==='preparing')?`<span style="font-size:11px;color:var(--mu);font-weight:600">⏳ بانتظار تجهيز التاجر</span>`:''}
            ${o.status==='cancelled'?`<span style="font-size:11px;color:var(--danger);font-weight:700">❌ الطلب ملغي من التاجر</span>`:''}
          </div>
        </div>
      </div>`;
    });
    list.innerHTML = html;
    document.getElementById('drv-t-ords').textContent = tOrd;
    document.getElementById('drv-t-earn').textContent = tEarn+' ج';
    document.getElementById('drv-w-ords').textContent = wOrd;
    document.getElementById('drv-w-earn').textContent = wEarn+' ج';
    document.getElementById('drv-wallet').textContent = wEarn+' ج';
    document.getElementById('drv-wallet2').textContent = wEarn+' ج';
    document.getElementById('drv-total-ords').textContent = snap.size;
    document.getElementById('drv-month-earn').textContent = wEarn+' ج';
  });
}

async function acceptOrd() {
  if (!window._pendingOrdId || !window.CU) return;
  try {
    // جديد: استخدمنا Transaction عشان نتأكد إن المندوب مش مربوط بطلب تاني حاليًا
    // (activeOrderId فاضي) قبل ما نعيّنه على الطلب ده - بيمنع قبول أكتر من طلب في نفس الوقت.
    const orderRef = doc(db,'orders',window._pendingOrdId);
    const userRef = doc(db,'users',window.CU.uid);
    await runTransaction(db, async (t) => {
      const uSnap = await t.get(userRef);
      if (uSnap.data()?.activeOrderId) throw new Error('busy');
      const oSnap = await t.get(orderRef);
      if (oSnap.data()?.driverId) throw new Error('taken');
      t.update(orderRef, {
        driverId: window.CU.uid,
        driverName: window.CUD?.name||'',
        acceptedAt: serverTimestamp()
      });
      t.update(userRef, { activeOrderId: window._pendingOrdId });
    });
    document.getElementById('new-ord-banner').style.display='none';
    showToast('✅ تم قبول الطلب! توجه للمتجر','ok');
  } catch(e) {
    if (e?.message === 'busy') showToast('عندك طلب شغال بالفعل، خلّصه الأول','err');
    else if (e?.message === 'taken') showToast('الطلب اتقبل من مندوب تاني','err');
    else showToast('حدث خطأ','err');
  }
}

async function updOrdStatus(id, status) {
  try {
    await updateDoc(doc(db,'orders',id), {status, updatedAt:serverTimestamp()});
    // جديد: لما المندوب يخلّص الطلب، نفضّي activeOrderId عشان يقدر ياخد طلب جديد
    if (status === 'done' && window.CU) {
      await updateDoc(doc(db,'users',window.CU.uid), {activeOrderId: null}).catch(()=>{});
    }
    const msgs = {preparing:'👨‍🍳 بدأت التحضير',ready:'📦 الطلب جاهز',delivering:'🛵 في الطريق للعميل',done:'✅ تم التسليم بنجاح!'};
    showToast(msgs[status]||'تم التحديث','ok');
  } catch(e) { showToast('حدث خطأ','err'); }
}

function toggleOnline(el) {
  window.onlineStatus = !window.onlineStatus;
  document.getElementById('tog-dot').className='tog-dot '+(window.onlineStatus?'on':'off');
  document.getElementById('tog-lbl').textContent = window.onlineStatus?'متاح':'غير متاح';
  showToast(window.onlineStatus?'🟢 أنت متاح الآن':'⚫ أنت غير متاح',window.onlineStatus?'ok':'');
  if (!window.onlineStatus) document.getElementById('new-ord-banner').style.display='none';
}

function drvNav(tab,el) {
  document.querySelectorAll('#screen-driver .nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('drv-home-tab').style.display=tab==='home'?'block':'none';
  document.getElementById('drv-stats-tab').style.display=tab==='stats'?'block':'none';
  document.getElementById('drv-profile-tab').style.display=tab==='profile'?'block':'none';
  document.getElementById('drv-extra').style.display=tab==='home'?'grid':'none';
}

function buildChart() {
  const days=['سب','أح','اث','ثل','أر','خم','جم'];
  const vals=[0,0,0,0,0,0,0];
  const mx=Math.max(...vals)||1;
  document.getElementById('earn-bars').innerHTML=days.map((d,i)=>`<div class="cb-wrap"><div class="cb" style="height:${Math.max((vals[i]/mx*100),4)}%"></div><span class="cb-day">${d}</span></div>`).join('');
}

// ===== MERCHANT FUNCTIONS =====
function loadMerchantData() {
  const ud = window.CUD;
  if (ud) document.getElementById('merch-name').textContent = ud.storeName||ud.name||'متجرك';
  loadMerchantOrders();
  loadMerchantProds();
}

let merchantOrdersUnsub = null;
function loadMerchantOrders() {
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

async function updOrdStatus2(id,status) {
  try { await updateDoc(doc(db,'orders',id),{status,updatedAt:serverTimestamp()}); showToast('✅ تم تحديث حالة الطلب','ok'); }
  catch(e){ showToast('حدث خطأ','err'); }
}

let merchantProdsUnsub = null;
function loadMerchantProds() {
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

function openAddProd(){document.getElementById('add-prod-modal').classList.add('open');}
async function saveProd(){
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
async function delProd(id){
  try{await deleteDoc(doc(db,'products',id));showToast('✅ تم حذف المنتج','ok');}catch(e){showToast('حدث خطأ','err');}
}

// --- رقم طلب تسلسلي: D1001, D1002, D1003... باستخدام عداد مركزي في Firestore ---
async function getNextRequestId(counterName, prefix){
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


// ===== DRIVER REGISTRATION WIZARD =====
window.dregStep = window.dregStep || 1;
window.driverLoc = window.driverLoc || null;
window.uploadedDocs = {};

// --- Draft autosave: لو المندوب قفل الصفحة، بياناته متحفوظة محليًا ومترجعله تاني ---
const DREG_DRAFT_KEY = 'manayef_drv_draft';
function dregSaveDraft(){
  try{
    const ids=['d-name','d-phone','d-dob','d-nid','d-emerg','d-addr','d-vtype','d-vmodel','d-vcolor','d-plate'];
    const data={}; ids.forEach(id=>{const el=document.getElementById(id); if(el) data[id]=el.value;});
    data.hasExp = window.driverHasExp!==false;
    localStorage.setItem(DREG_DRAFT_KEY, JSON.stringify(data));
  }catch(e){}
  dregUpdateProgress();
}
function dregLoadDraft(){
  try{
    const raw=localStorage.getItem(DREG_DRAFT_KEY); if(!raw) return;
    const data=JSON.parse(raw);
    Object.keys(data).forEach(id=>{const el=document.getElementById(id); if(el && id!=='hasExp') el.value=data[id];});
    if(data.hasExp===false) dregSetExp(false);
  }catch(e){}
}
function dregClearDraft(){ try{localStorage.removeItem(DREG_DRAFT_KEY);}catch(e){} }

function dregSetExp(val){
  window.driverHasExp = val;
  document.getElementById('exp-yes').classList.toggle('active', val);
  document.getElementById('exp-no').classList.toggle('active', !val);
  dregSaveDraft();
}

// --- تنقل بين الخطوات ---
function dregShowFieldErr(id, msg){
  const inp=document.getElementById(id), err=document.getElementById('err-'+id);
  if(inp) inp.classList.add('err');
  if(err){ err.textContent=msg; err.style.display='block'; }
}
function dregClearFieldErr(id){
  const inp=document.getElementById(id), err=document.getElementById('err-'+id);
  if(inp) inp.classList.remove('err');
  if(err){ err.style.display='none'; }
}
function dregValidateStep1(){
  let ok=true;
  ['d-name','d-phone','d-dob','d-nid','d-emerg','d-addr','d-vtype'].forEach(dregClearFieldErr);
  const name=document.getElementById('d-name').value.trim();
  if(name.length<3){dregShowFieldErr('d-name','الاسم لازم يكون 3 أحرف على الأقل');ok=false;}
  const phone=document.getElementById('d-phone').value.trim();
  if(!/^01[0125][0-9]{8}$/.test(phone)){dregShowFieldErr('d-phone','رقم هاتف مصري غير صحيح (01xxxxxxxxx)');ok=false;}
  const addr=document.getElementById('d-addr').value.trim();
  if(!addr){dregShowFieldErr('d-addr','العنوان مطلوب');ok=false;}
  const dob=document.getElementById('d-dob').value;
  if(!dob){dregShowFieldErr('d-dob','تاريخ الميلاد مطلوب');ok=false;}
  const nid=document.getElementById('d-nid').value.trim();
  if(!/^[0-9]{14}$/.test(nid)){dregShowFieldErr('d-nid','الرقم القومي 14 رقم');ok=false;}
  const emerg=document.getElementById('d-emerg').value.trim();
  if(!/^01[0125][0-9]{8}$/.test(emerg)){dregShowFieldErr('d-emerg','رقم هاتف مصري غير صحيح');ok=false;}
  const vtype=document.getElementById('d-vtype').value;
  if(!vtype){dregShowFieldErr('d-vtype','اختر نوع المركبة');ok=false;}
  return ok;
}
function dregValidateStep2(){
  const required=['d-id1','d-id2','d-photo','d-license'];
  const missing=required.filter(id=>!(window.uploadedDocs&&window.uploadedDocs[id]));
  const err=document.getElementById('err-docs');
  if(missing.length){ err.textContent='لازم ترفع كل المستندات الأربعة'; err.style.display='block'; return false; }
  err.style.display='none'; return true;
}
function dregValidateStep3(){
  if(!window.agreedTerms){
    document.getElementById('err-agree').textContent='لازم توافق على البنود والشروط';
    document.getElementById('err-agree').style.display='block';
    return false;
  }
  document.getElementById('err-agree').style.display='none';
  return true;
}
function dregGoto(step){
  document.querySelectorAll('.dreg-step-pane').forEach(p=>p.classList.remove('active'));
  const pane=document.getElementById('dreg-step-'+step);
  if(pane) pane.classList.add('active');
  window.dregStep=step;
  [1,2,3,4].forEach(i=>{
    const d=document.getElementById('dds-'+i);
    if(!d)return;
    d.classList.toggle('done', i<step);
    d.classList.toggle('active', i===step);
  });
  if(step===3) dregRenderReview();
  dregUpdateProgress();
  window.scrollTo(0,0);
}
function dregNext(){
  if(window.dregStep===1 && !dregValidateStep1()) return;
  if(window.dregStep===2 && !dregValidateStep2()) return;
  dregGoto(window.dregStep+1);
}
function dregBack(){
  if(window.dregStep<=1){ showScreen('screen-entry'); return; }
  dregGoto(window.dregStep-1);
}
function dregUpdateProgress(){
  const ids=['d-name','d-phone','d-dob','d-nid','d-emerg','d-addr','d-vtype'];
  let filled=0; ids.forEach(id=>{const el=document.getElementById(id); if(el&&el.value.trim())filled++;});
  const docsCount=Object.keys(window.uploadedDocs||{}).length;
  const total=ids.length+4+1;
  let done=filled+Math.min(docsCount,4)+(window.agreedTerms?1:0);
  const pct=Math.round(done/total*100);
  const el=document.getElementById('dreg-pct');
  if(el) el.textContent=`اكتمال التسجيل: ${pct}%`;
}
function dregRenderReview(){
  const vtypeLabels={motorcycle:'موتوسيكل',tuktuk:'توك توك',bicycle:'عجلة',car:'عربية'};
  const rows=[
    ['الاسم', document.getElementById('d-name').value],
    ['الهاتف', document.getElementById('d-phone').value],
    ['تاريخ الميلاد', document.getElementById('d-dob').value],
    ['الرقم القومي', document.getElementById('d-nid').value],
    ['رقم الطوارئ', document.getElementById('d-emerg').value],
    ['العنوان', document.getElementById('d-addr').value],
    ['نوع المركبة', vtypeLabels[document.getElementById('d-vtype').value]||'--'],
    ['موديل المركبة', document.getElementById('d-vmodel').value||'--'],
    ['لون المركبة', document.getElementById('d-vcolor').value||'--'],
    ['رقم اللوحة', document.getElementById('d-plate').value||'--'],
    ['خبرة سابقة', window.driverHasExp!==false?'نعم':'لأ'],
    ['الموقع', window.driverLoc?'✅ محدد':'غير محدد'],
  ];
  document.getElementById('dreg-review').innerHTML = rows.map(r=>`<div class="review-row"><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('');
}

// --- تحديد الموقع بخريطة ---
async function dregGetLocation(){
  if(!navigator.geolocation){ showToast('المتصفح مايدعمش تحديد الموقع','err'); return; }
  const btn=document.getElementById('loc-btn');
  btn.textContent='⏳ جارٍ تحديد موقعك...';
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude,longitude}=pos.coords;
    window.driverLoc={lat:latitude,lng:longitude};
    btn.textContent='✅ تم تحديد موقعك';
    btn.classList.add('got');
    const wrap=document.getElementById('loc-map-wrap');
    wrap.style.display='block';
    setTimeout(()=>{
      if(window._locMap){ window._locMap.remove(); }
      window._locMap = L.map('loc-map',{zoomControl:false,attributionControl:false}).setView([latitude,longitude],16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window._locMap);
      L.marker([latitude,longitude]).addTo(window._locMap);
    },100);
    dregSaveDraft();
  }, err=>{
    btn.textContent='📍 تحديد موقعي الحالي';
    showToast('مقدرناش نحدد موقعك، اتأكد إن إذن الموقع مفعّل','err');
  }, {enableHighAccuracy:true, timeout:10000});
}

// --- مودال الشروط الكاملة ---
const TERMS_FULL_TEXT = `1. المندوب مسؤول عن استلام وتسليم الطلبات في الوقت المحدد (خلال 30 دقيقة من وقت القبول تقريبًا).
2. رسوم التوصيل تُحسب 15% من قيمة الطلب ويتحملها العميل، ويحصل عليها المندوب كاملة عند التسليم.
3. المنصة غير مسؤولة عن أي تلف أو فقد للبضائع بعد استلامها من المتجر وحتى التسليم للعميل.
4. يجب على المندوب الالتزام بقواعد المرور والسلامة العامة أثناء التوصيل.
5. لا يجوز فتح أو التلاعب بمحتويات الطلب قبل تسليمه للعميل.
6. يحق للإدارة إيقاف حساب أي مندوب في حالة وجود شكاوى متكررة أو مخالفة للبنود.
7. بيانات المندوب الشخصية (الاسم، الهاتف، المستندات) تُستخدم فقط لأغراض التحقق والتواصل داخل التطبيق ولا تُشارك مع أي جهة خارجية.
8. المندوب حر في اختيار أوقات عمله، ولا يوجد التزام بعدد ساعات معين.`;
function openTermsModal(){
  document.getElementById('terms-full-txt').textContent = TERMS_FULL_TEXT;
  document.getElementById('terms-modal').classList.add('show');
}
function closeTermsModal(){ document.getElementById('terms-modal').classList.remove('show'); }
function agreeTermsModal(){
  closeTermsModal();
  if(!window.agreedTerms) toggleAgree();
}

// --- ضغط الصورة قبل الرفع (تقليل الحجم مع الحفاظ على جودة مقبولة) ---
function compressImage(file, maxDim=1280, quality=0.75){
  return new Promise((resolve,reject)=>{
    if(!file.type.startsWith('image/')){ resolve(file); return; }
    const img=new Image();
    const reader=new FileReader();
    reader.onload=e=>{ img.src=e.target.result; };
    reader.onerror=reject;
    img.onload=()=>{
      let {width,height}=img;
      if(width>maxDim||height>maxDim){
        if(width>height){ height=Math.round(height*maxDim/width); width=maxDim; }
        else { width=Math.round(width*maxDim/height); height=maxDim; }
      }
      const canvas=document.createElement('canvas');
      canvas.width=width; canvas.height=height;
      canvas.getContext('2d').drawImage(img,0,0,width,height);
      canvas.toBlob(blob=>{
        if(!blob){ resolve(file); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/,'')+'.jpg', {type:'image/jpeg'}));
      }, 'image/jpeg', quality);
    };
    img.onerror=()=>resolve(file);
    reader.readAsDataURL(file);
  });
}

// --- رفع مستند: ضغط -> رفع آمن -> معاينة مع تغيير/حذف/تكبير ---
async function uploadDoc(id, label){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='image/*';
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file) return;
    if(!file.type.startsWith('image/')){ showToast('لازم ترفع صورة بس (JPG أو PNG)','err'); return; }
    const maxSizeMB=8;
    if(file.size>maxSizeMB*1024*1024){ showToast(`حجم الصورة كبير جدًا (الحد الأقصى ${maxSizeMB} ميجا)`,'err'); return; }
    const wrap=document.getElementById(id+'-wrap');
    wrap.innerHTML=`<div class="upload-box" id="${id}"><div class="u-ic">⏳</div><p style="font-size:12px">جارٍ ضغط ورفع الصورة...</p></div>`;
    try{
      const compressed = await compressImage(file);
      const url = await secureCloudinaryUpload(compressed);
      window.uploadedDocs[id]=url;
      dregRenderDocPreview(id,label,url);
      showToast(`✅ تم رفع ${label}`,'ok');
      dregUpdateProgress();
    }catch(e){
      wrap.innerHTML=`<div class="upload-box" onclick="uploadDoc('${id}','${escJs(label)}')" id="${id}"><div class="u-ic">📷</div><p style="font-size:12px;color:#E11">فشل الرفع، اضغط للمحاولة تاني</p></div>`;
      showToast('فشل رفع الصورة، حاول تاني','err');
    }
  };
  inp.click();
}
function dregRenderDocPreview(id,label,url){
  const wrap=document.getElementById(id+'-wrap');
  wrap.innerHTML = `<div class="doc-preview">
    <img src="${esc(url)}" alt="${esc(label)}">
    <div class="doc-preview-acts">
      <button onclick="zoomDoc('${escJs(url)}')">🔍 تكبير</button>
      <button onclick="uploadDoc('${escJs(id)}','${escJs(label)}')">🔄 تغيير</button>
      <button onclick="removeUploadedDoc('${escJs(id)}','${escJs(label)}')">🗑️ حذف</button>
    </div>
  </div>
  <p style="text-align:center;font-size:11px;color:var(--ok);font-weight:800;margin-bottom:8px">✅ ${esc(label)}</p>`;
}
function removeUploadedDoc(id,label){
  delete window.uploadedDocs[id];
  const wrap=document.getElementById(id+'-wrap');
  wrap.innerHTML=`<div class="upload-box" onclick="uploadDoc('${escJs(id)}','${escJs(label)}')" id="${id}"><span class="doc-help" onclick="event.stopPropagation();showToast('لازم تكون الصورة واضحة وكل البيانات ظاهرة')">؟</span><div class="u-ic">📷</div><p>${esc(label)}</p></div>`;
  dregUpdateProgress();
}
function zoomDoc(url){
  document.getElementById('zoom-img').src=url;
  document.getElementById('zoom-ov').classList.add('show');
}
function closeZoom(){ document.getElementById('zoom-ov').classList.remove('show'); }

function toggleAgree(el){
  window.agreedTerms=!window.agreedTerms;
  const b=document.getElementById('agree-box');
  b.style.background=window.agreedTerms?'var(--ok)':'#fff';
  b.style.borderColor=window.agreedTerms?'var(--ok)':'var(--border)';
  b.innerHTML=window.agreedTerms?'<span style="color:#fff;font-size:12px">✓</span>':'';
  dregUpdateProgress();
}

async function submitDrvReg(){
  if(!dregValidateStep3()) return;
  if(!window.CU){ showToast('حصل خطأ، سجل دخول تاني','err'); return; }
  setLoad('dreg-btn','dreg-sp',true);
  document.getElementById('dreg-btn').disabled=true;
  try{
    const requestId = await getNextRequestId('driverRequests','D');
    const payload={
      fullName: document.getElementById('d-name').value.trim(),
      phone: document.getElementById('d-phone').value.trim(),
      dob: document.getElementById('d-dob').value,
      nationalId: document.getElementById('d-nid').value.trim(),
      emergencyPhone: document.getElementById('d-emerg').value.trim(),
      address: document.getElementById('d-addr').value.trim(),
      vehicleType: document.getElementById('d-vtype').value,
      vehicleModel: document.getElementById('d-vmodel').value.trim(),
      vehicleColor: document.getElementById('d-vcolor').value.trim(),
      plateNumber: document.getElementById('d-plate').value.trim(),
      hasExperience: window.driverHasExp!==false,
      location: window.driverLoc||null,
      status:'pending', docsSubmitted:true, docs:window.uploadedDocs||{}, requestId,
      updatedAt: serverTimestamp()
    };
    await updateDoc(doc(db,'users',window.CU.uid), payload);
    dregClearDraft();
    document.getElementById('dreg-form').style.display='none';
    document.querySelector('.dreg-hdr').style.display='none';
    document.getElementById('dreg-pending').style.display='block';
    document.getElementById('dreg-reqid').textContent = requestId;
    showToast('✅ تم إرسال طلبك!','ok');
  }catch(e){ showToast('حدث خطأ، حاول تاني','err'); }
  finally{ setLoad('dreg-btn','dreg-sp',false); document.getElementById('dreg-btn').disabled=false; }
}

// عند فتح شاشة التسجيل، رجّع أي بيانات محفوظة واعرض الخطوة الأولى
function dregInit(){
  if(window.CUD?.status==='rejected'){
    document.getElementById('dreg-form').style.display='none';
    document.querySelector('.dreg-hdr').style.display='none';
    document.getElementById('dreg-pending').style.display='none';
    document.getElementById('dreg-rejected').style.display='block';
    document.getElementById('dreg-rej-reason').textContent = window.CUD?.rejectReason || 'تواصل مع الدعم لمعرفة التفاصيل';
    return;
  }
  document.getElementById('dreg-rejected').style.display='none';
  if(window.CUD?.status==='pending' && window.CUD?.docsSubmitted){
    document.getElementById('dreg-form').style.display='none';
    document.querySelector('.dreg-hdr').style.display='none';
    document.getElementById('dreg-pending').style.display='block';
    document.getElementById('dreg-reqid').textContent = window.CUD?.requestId || '--';
    return;
  }
  window.dregStep=1; window.uploadedDocs={}; window.agreedTerms=false; window.driverLoc=null; window.driverHasExp=true;
  document.getElementById('dreg-form').style.display='block';
  document.querySelector('.dreg-hdr').style.display='block';
  document.getElementById('dreg-pending').style.display='none';
  dregGoto(1);
  dregLoadDraft();
  dregUpdateProgress();
}
function dregRestart(){
  document.getElementById('dreg-rejected').style.display='none';
  document.querySelector('.dreg-hdr').style.display='block';
  document.getElementById('dreg-form').style.display='block';
  window.dregStep=1; window.uploadedDocs={}; window.agreedTerms=false; window.driverLoc=null; window.driverHasExp=true;
  dregGoto(1);
}

// ===== ADMIN FUNCTIONS =====
let adminOrdersUnsub = null, adminUsersUnsub = null;
async function loadAdminData() {
  if (adminOrdersUnsub) return;
  adminOrdersUnsub = onSnapshot(collection(db,'orders'), snap => {
    const today=new Date().toDateString();let tO=0,tR=0,allR=0,allC=0;
    snap.forEach(d=>{const o=d.data();const dt=o.createdAt?.toDate?o.createdAt.toDate():new Date();allR+=o.total||0;allC+=o.commission||0;if(dt.toDateString()===today){tO++;tR+=o.total||0;}});
    document.getElementById('adm-t-ords').textContent=tO;
    document.getElementById('adm-t-rev').textContent=tR+' ج';
    document.getElementById('adm-total-rev').textContent=allR+' ج';
    document.getElementById('adm-total-comm').textContent=allC+' ج';
    document.getElementById('adm-comm-t').textContent=Math.round(tR*window.commRate/100)+' ج';
    document.getElementById('adm-drv-pay').textContent=Math.round(allR*0.15)+' ج';
    document.getElementById('adm-avg-ord').textContent=(snap.size?Math.round(allR/snap.size):0)+' ج';
    const recs=[];snap.forEach(d=>recs.push({...d.data(),id:d.id}));
    recs.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    let html='';
    recs.slice(0,5).forEach(o=>{
      html+=`<div style="padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;font-weight:700">#${o.id.slice(-6).toUpperCase()}</span><span class="${SC[o.status]||'sb sb-new'}">${SL[o.status]||'--'}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--mu)">🏪 ${esc(o.storeName)||'--'} • ${esc(o.customerName)||'عميل'}</span><span><strong>${o.total||0} ج</strong></span></div>
        <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap">
          ${STEPS.filter(s=>s!==o.status).map(s=>`<button class="mb2 mb-view" onclick="admUpdOrd('${o.id}','${s}')" style="font-size:9px">${SL[s]}</button>`).join('')}
        </div>
      </div>`;
    });
    document.getElementById('adm-recent-ords').innerHTML=html||'<div class="empty-state" style="padding:14px"><p style="font-size:12px">لا توجد طلبات</p></div>';
    document.getElementById('adm-all-ords').innerHTML=recs.length?recs.map(o=>`<div class="drv-row2" data-status="${o.status||'new'}" style="padding:9px 0;border-bottom:1px solid var(--border);display:block">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;font-weight:700">#${o.id.slice(-6).toUpperCase()}</span><span class="${SC[o.status]||'sb sb-new'}">${SL[o.status]||'--'}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--mu)">🏪 ${esc(o.storeName)||'--'}</span><span>${o.total||0} ج <span style="color:var(--p)">(${o.commission||0} ج)</span></span></div>
    </div>`).join(''):'<div class="empty-state" style="padding:14px"><p style="font-size:12px">لا توجد طلبات</p></div>';
    const allOrds=document.getElementById('adm-t-allords'); if(allOrds) allOrds.textContent=snap.size;
    const doneOrds=document.getElementById('adm-t-doneords'); if(doneOrds) doneOrds.textContent=recs.filter(o=>o.status==='done').length;
    const cancOrds=document.getElementById('adm-t-cancords'); if(cancOrds) cancOrds.textContent=recs.filter(o=>o.status==='cancelled').length;
    const allRev2=document.getElementById('adm-t-allrev'); if(allRev2) allRev2.textContent=allR+' ج';
  });

  if (adminUsersUnsub) return;
  adminUsersUnsub = onSnapshot(collection(db,'users'), snap=>{
    let cust=0,drvs=0,pendDrvs=[];const allDrvs=[];const allStores=[];
    snap.forEach(d=>{const u={...d.data(),id:d.id};if(u.role==='customer')cust++;if(u.role==='driver'){drvs++;if(u.status==='pending')pendDrvs.push(u);allDrvs.push(u);}if(u.role==='merchant')allStores.push(u);});
    document.getElementById('adm-t-users').textContent=cust;
    document.getElementById('adm-act-drvs').textContent=allDrvs.filter(u=>u.status==='active').length;
    document.getElementById('adm-users-c').textContent=cust;
    document.getElementById('adm-drvs-c').textContent=drvs;
    const tDrvs=document.getElementById('adm-t-drvs'); if(tDrvs) tDrvs.textContent=drvs;
    const tMerch=document.getElementById('adm-t-merch'); if(tMerch) tMerch.textContent=allStores.length;
    let pd='';
    pendDrvs.forEach(u=>{pd+=`<div class="drv-row2"><div class="drv-av2">👤</div><div class="drv-info2"><strong>${esc(u.fullName||u.name)||'--'}</strong><small>📱 ${esc(u.phone)||'--'}</small><br><span class="p-badge">⏳ بانتظار الموافقة</span></div><div class="drv-row2-acts"><button class="mb2 mb-view" onclick="openDrvModal('${u.id}')">تفاصيل</button></div></div>`;});
    document.getElementById('adm-pend-drvs').innerHTML=pd||'<div class="empty-state" style="padding:14px"><p style="font-size:12px">لا يوجد مناديب معلّقون</p></div>';
    const pendC=document.getElementById('adm-pend-c'); if(pendC) pendC.textContent=pendDrvs.length;
    const storesC=document.getElementById('adm-stores-c'); if(storesC) storesC.textContent=allStores.length;
    const pendStores=allStores.filter(m=>m.status==='pending').length;
    const notifC=document.getElementById('adm-notif-c'); if(notifC) notifC.textContent=pendDrvs.length+pendStores;
    let dl='';
    allDrvs.forEach(u=>{dl+=`<div class="drv-row2" data-st="${u.status||'active'}"><div class="drv-av2">👤</div><div class="drv-info2"><strong>${esc(u.fullName||u.name)||'--'}</strong><small>📱 ${esc(u.phone)||'--'} | ${u.status==='pending'?'⏳ انتظار':'✅ نشط'}</small></div><div class="drv-row2-acts">${u.status==='pending'?`<button class="mb2 mb-acc" onclick="admAccDrv('${u.id}')">قبول</button><button class="mb2 mb-rej" onclick="admRejDrv('${u.id}')">رفض</button>`:`<button class="mb2 mb-view" onclick="openDrvModal('${u.id}')">ملفه</button>`}</div></div>`;});
    document.getElementById('adm-drvs-list').innerHTML=dl||'<div class="empty-state" style="padding:14px"><p style="font-size:12px">لا يوجد مناديب</p></div>';
    let ul='';
    snap.forEach(d=>{const u=d.data();if(u.role!=='customer')return;ul+=`<div class="drv-row2"><div class="drv-av2" style="font-size:16px">👤</div><div class="drv-info2"><strong>${esc(u.name)||'--'}</strong><small>📱 ${esc(u.phone||u.email)||'--'} | ${u.points||0} نقطة</small></div></div>`;});
    document.getElementById('adm-users-list').innerHTML=ul||'<div class="empty-state" style="padding:14px"><p style="font-size:12px">لا يوجد عملاء</p></div>';
    renderAdminStoresList(allStores);
    if (window.admMap) initAdminMap(allDrvs);
  });
}

// ===== AUDIT LOG =====
async function logAudit(action, details){
  try{
    await addDoc(collection(db,'auditLog'),{
      adminId: window.CU?.uid||null,
      adminName: window.CUD?.name||window.CU?.email||'أدمن',
      action, details: details||'',
      createdAt: serverTimestamp()
    });
  }catch(e){}
}
let auditLogUnsub = null;
function loadAuditLog(){
  if (auditLogUnsub) return;
  const q=query(collection(db,'auditLog'),orderBy('createdAt','desc'),limit(80));
  auditLogUnsub=onSnapshot(q,snap=>{
    let html='';
    snap.forEach(d=>{
      const a=d.data();
      const dt=a.createdAt?.toDate?a.createdAt.toDate():null;
      const timeStr=dt?dt.toLocaleString('ar-EG',{dateStyle:'short',timeStyle:'short'}):'--';
      html+=`<div style="padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px"><strong style="font-size:12px">${esc(a.action)}</strong><small style="color:var(--mu);font-size:10px">${timeStr}</small></div>
        <div style="font-size:11px;color:var(--mu)">👤 ${esc(a.adminName)||'أدمن'}${a.details?' — '+esc(a.details):''}</div>
      </div>`;
    });
    document.getElementById('adm-audit-list').innerHTML=html||'<div class="empty-state" style="padding:14px"><p style="font-size:12px">لا يوجد سجل عمليات بعد</p></div>';
  });
}

// ===== ADMIN LOGOUT =====
function admLogoutConfirm(){
  if(confirm('هل تريد تسجيل الخروج من لوحة الإدارة؟')) doLogout();
}

// ===== REJECTION REASON MODAL (يُستخدم لرفض المندوب أو المتجر) =====
window._reasonCallback = null;
function openReasonModal(title, presets, callback){
  document.getElementById('reason-modal-title').textContent = title;
  document.getElementById('reason-text').value='';
  const pr=document.getElementById('reason-presets');
  pr.innerHTML = (presets||[]).map(p=>`<button class="fc2" type="button" onclick="document.getElementById('reason-text').value='${escJs(p)}'">${esc(p)}</button>`).join('');
  window._reasonCallback = callback;
  document.getElementById('reason-modal').classList.add('open');
}
function closeReasonModal(){
  document.getElementById('reason-modal').classList.remove('open');
  window._reasonCallback = null;
}
function confirmReasonModal(){
  const reason = document.getElementById('reason-text').value.trim();
  if(!reason){ showToast('اكتب سبب الرفض','err'); return; }
  const cb = window._reasonCallback;
  closeReasonModal();
  if(cb) cb(reason);
}

async function admUpdOrd(id,status){try{await updateDoc(doc(db,'orders',id),{status,updatedAt:serverTimestamp()});showToast('✅ تم تحديث الطلب','ok');}catch(e){showToast('حدث خطأ','err');}}
async function admAccDrv(uid){try{await updateDoc(doc(db,'users',uid),{status:'active',approvedAt:serverTimestamp()});await addDoc(collection(db,'notifications'),{userId:uid,title:'🎉 تم قبول حسابك',body:'تم اعتماد حسابك كمندوب توصيل، تقدر تبدأ تستقبل الطلبات الآن.',type:'or',read:false,createdAt:serverTimestamp()});logAudit('قبول مندوب');showToast('✅ تم قبول المندوب','ok');closeModal('drv-modal');}catch(e){showToast('حدث خطأ','err');}}
function admRejDrv(uid){
  openReasonModal('سبب رفض المندوب', ['صورة البطاقة غير واضحة','الرخصة منتهية','البيانات غير مطابقة'], async(reason)=>{
    try{
      await updateDoc(doc(db,'users',uid),{status:'rejected',rejectReason:reason,rejectedAt:serverTimestamp()});
      await addDoc(collection(db,'notifications'),{userId:uid,title:'❌ لم تتم الموافقة على حسابك',body:'للأسف لم يتم قبول طلبك كمندوب. السبب: '+reason,type:'gn',read:false,createdAt:serverTimestamp()});
      logAudit('رفض مندوب', reason);
      showToast('❌ تم رفض المندوب','err');
      closeModal('drv-modal');
    }catch(e){showToast('حدث خطأ','err');}
  });
}
async function admAccStore(id){try{await updateDoc(doc(db,'users',id),{status:'active',approvedAt:serverTimestamp()});await updateDoc(doc(db,'stores',id),{status:'active'}).catch(()=>{});await addDoc(collection(db,'notifications'),{userId:id,title:'🎉 تم قبول متجرك',body:'تم اعتماد متجرك على منصة Manayef GO، تقدر تضيف منتجاتك وتستقبل الطلبات الآن.',type:'or',read:false,createdAt:serverTimestamp()});logAudit('قبول متجر');showToast('✅ تم قبول المتجر','ok');}catch(e){showToast('حدث خطأ','err');}}
function admRejStore(id){
  openReasonModal('سبب رفض المتجر', ['المستندات غير واضحة','بيانات المتجر غير مكتملة','نشاط غير مسموح به'], async(reason)=>{
    try{
      await updateDoc(doc(db,'users',id),{status:'rejected',rejectReason:reason,rejectedAt:serverTimestamp()});
      await updateDoc(doc(db,'stores',id),{status:'rejected'}).catch(()=>{});
      await addDoc(collection(db,'notifications'),{userId:id,title:'❌ لم تتم الموافقة على متجرك',body:'للأسف لم يتم قبول طلب انضمام متجرك. السبب: '+reason,type:'gn',read:false,createdAt:serverTimestamp()});
      logAudit('رفض متجر', reason);
      showToast('❌ تم رفض المتجر','err');
    }catch(e){showToast('حدث خطأ','err');}
  });
}
async function openDrvModal(uid){
  try{
    const d=await getDoc(doc(db,'users',uid));const u=d.data()||{};
    const docs=u.docs||{};
    const docLabels={'d-id1':'رقم قومي أمامي','d-id2':'رقم قومي خلفي','d-photo':'صورة شخصية','d-license':'رخصة موتوسيكل'};
    const docsHtml = Object.keys(docLabels).map(k=>{
      const url=docs[k];
      return url
        ? `<div class="doc-prev" style="padding:0;overflow:hidden;cursor:pointer" onclick="zoomDoc('${escJs(url)}')"><img src="${esc(url)}" style="width:100%;height:80px;object-fit:cover;display:block"><small style="display:block;padding:3px;font-size:9px">🔍 ${docLabels[k]}</small></div>`
        : `<div class="doc-prev">🚫<br><small style="font-size:9px">${docLabels[k]} (لم يُرفع)</small></div>`;
    }).join('');
    const createdStr = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString('ar-EG') : '--';
    document.getElementById('drv-modal-content').innerHTML=`
      <div class="info-row"><span class="il">الاسم</span><span class="iv">${esc(u.fullName||u.name)||'--'}</span></div>
      <div class="info-row"><span class="il">الهاتف</span><span class="iv">${esc(u.phone)||'--'}</span></div>
      <div class="info-row"><span class="il">العنوان</span><span class="iv">${esc(u.address)||'--'}</span></div>
      <div class="info-row"><span class="il">تاريخ التسجيل</span><span class="iv">${createdStr}</span></div>
      <div class="info-row"><span class="il">الحالة</span><span class="iv">${u.status==='pending'?'⏳ بانتظار الموافقة':u.status==='active'?'✅ نشط':'❌ مرفوض'}</span></div>
      ${u.status==='rejected'&&u.rejectReason?`<div class="info-row"><span class="il">سبب الرفض</span><span class="iv" style="color:var(--danger)">${esc(u.rejectReason)}</span></div>`:''}
      <div style="margin:10px 0"><div style="font-size:11px;font-weight:700;color:var(--mu);margin-bottom:6px">📄 المستندات (اضغط للتكبير):</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${docsHtml}</div></div>`;
    const accBtn=document.getElementById('acc-btn'), rejBtn=document.getElementById('rej-btn');
    accBtn.style.display = u.status==='pending'?'block':'none';
    rejBtn.style.display = u.status==='pending'?'block':'none';
    accBtn.onclick=()=>admAccDrv(uid);
    rejBtn.onclick=()=>admRejDrv(uid);
    document.getElementById('drv-modal').classList.add('open');
  }catch(e){showToast('خطأ في تحميل البيانات','err');}
}

// ===== ADMIN: STORE MANAGEMENT SCREEN (بيانات المتجر + المنتجات) =====
window.smCurrentStore = null;
async function renderAdminStoresList(allStores){
  if(!allStores.length){ document.getElementById('adm-stores-list').innerHTML='<div class="empty-state" style="padding:14px"><p style="font-size:12px">لا يوجد تجار</p></div>'; return; }
  const rows = await Promise.all(allStores.map(async m=>{
    const mName = esc(m.storeName || m.name || '--');
    let prodC=0, ordC=0, ratingC=0, ratingAvg=0;
    try{
      const [pSnap,oSnap,rSnap] = await Promise.all([
        getDocs(query(collection(db,'products'),where('merchantId','==',m.id))),
        getDocs(query(collection(db,'orders'),where('storeId','==',m.id))),
        getDocs(query(collection(db,'ratings'),where('targetId','==',m.id),where('targetType','==','store')))
      ]);
      prodC=pSnap.size; ordC=oSnap.size; ratingC=rSnap.size;
      if(ratingC){let sum=0;rSnap.forEach(d=>sum+=d.data().stars||0);ratingAvg=(sum/ratingC).toFixed(1);}
    }catch(e){}
    const createdStr = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleDateString('ar-EG') : '--';
    const statusBadge = m.status==='pending'?'<span class="p-badge">⏳ بانتظار</span>'
      : m.status==='active'?'<span style="color:var(--ok);font-size:10px;font-weight:700">✅ نشط</span>'
      : m.status==='paused'?'<span style="color:var(--warn);font-size:10px;font-weight:700">⏸️ متوقف</span>'
      : m.status==='deleted'?'<span style="color:var(--danger);font-size:10px;font-weight:700">🗑️ محذوف</span>'
      : '<span style="color:var(--danger);font-size:10px;font-weight:700">❌ مرفوض</span>';
    const actionBtns = m.status==='pending'
      ? `<button class="mb2 mb-acc" onclick="admAccStore('${m.id}')">قبول</button><button class="mb2 mb-rej" onclick="admRejStore('${m.id}')">رفض</button>`
      : `<button class="mb2 mb-view" onclick="openStoreManage('${m.id}')">إدارة</button>${m.status==='active'?`<button class="mb2 mb-rej" onclick="smQuickPause('${m.id}')">إيقاف</button>`:m.status==='paused'?`<button class="mb2 mb-acc" onclick="smQuickActivate('${m.id}')">تفعيل</button>`:''}`;
    return `<div class="drv-row2"><div class="drv-av2" style="background:#EFF6FF">🏬</div><div class="drv-info2"><strong>${mName}</strong><small>📱 ${esc(m.storePhone||m.phone)||'--'} | ${statusBadge}</small><br><small style="color:var(--mu);font-size:10px">📦 ${prodC} منتج • 🧾 ${ordC} طلب • ⭐ ${ratingAvg||0} (${ratingC}) • 📅 ${createdStr}</small></div><div class="drv-row2-acts">${actionBtns}</div></div>`;
  }));
  document.getElementById('adm-stores-list').innerHTML = rows.join('');
}
async function smQuickPause(uid){
  if(!confirm('هل تريد إيقاف استقبال الطلبات لهذا المتجر مؤقتًا؟')) return;
  try{ await updateDoc(doc(db,'stores',uid),{status:'paused',updatedAt:serverTimestamp()}); await updateDoc(doc(db,'users',uid),{status:'paused'}).catch(()=>{}); logAudit('إيقاف متجر مؤقتًا'); showToast('✅ تم الإيقاف','ok'); }catch(e){showToast('حدث خطأ','err');}
}
async function smQuickActivate(uid){
  try{ await updateDoc(doc(db,'stores',uid),{status:'active',updatedAt:serverTimestamp()}); await updateDoc(doc(db,'users',uid),{status:'active'}).catch(()=>{}); logAudit('تفعيل متجر'); showToast('✅ تم التفعيل','ok'); }catch(e){showToast('حدث خطأ','err');}
}
async function openStoreManage(uid){
  window.smCurrentStore = uid;
  window.adminTargetStore = uid;
  try{
    const [sDoc,uDoc] = await Promise.all([getDoc(doc(db,'stores',uid)), getDoc(doc(db,'users',uid))]);
    const s = sDoc.exists()?sDoc.data():{};
    const u = uDoc.exists()?uDoc.data():{};
    document.getElementById('sm-title').textContent = s.storeName||u.storeName||'إدارة المتجر';
    document.getElementById('sm-name').value = s.storeName||u.storeName||'';
    document.getElementById('sm-desc').value = s.description||'';
    document.getElementById('sm-phone').value = s.storePhone||u.storePhone||'';
    document.getElementById('sm-wa').value = s.whatsapp||'';
    document.getElementById('sm-addr').value = s.address||u.address||'';
    document.getElementById('sm-hours').value = s.hours||'';
    document.getElementById('sm-minord').value = s.minOrder||'';
    document.getElementById('sm-delfee').value = s.deliveryFee||'';
    const logoBox=document.getElementById('sm-logo-box'); logoBox.style.backgroundImage = s.logoUrl?`url('${s.logoUrl}')`:'none'; logoBox.textContent = s.logoUrl?'':'🏪';
    const coverBox=document.getElementById('sm-cover-box'); coverBox.style.backgroundImage = s.coverUrl?`url('${s.coverUrl}')`:'none'; coverBox.textContent = s.coverUrl?'':'🖼️ صورة الغلاف';
    smSetOpen(s.isOpen!==false);
    document.getElementById('screen-store-manage').style.display='block';
    smTab('profile', document.querySelector('#screen-store-manage .adm-nb'));
    smLoadProducts(uid);
  }catch(e){ showToast('خطأ تحميل بيانات المتجر','err'); }
}
function closeStoreManage(){
  document.getElementById('screen-store-manage').style.display='none';
  window.smCurrentStore=null; window.adminTargetStore=null;
}
function smTab(tab,el){
  document.querySelectorAll('#screen-store-manage .adm-nb').forEach(b=>b.classList.remove('active'));
  if(el)el.classList.add('active');
  document.getElementById('sm-profile').style.display = tab==='profile'?'block':'none';
  document.getElementById('sm-products').style.display = tab==='products'?'block':'none';
}
function smSetOpen(isOpen){
  window._smIsOpen = isOpen;
  document.getElementById('sm-open-btn').classList.toggle('active', isOpen);
  document.getElementById('sm-closed-btn').classList.toggle('active', !isOpen);
}
async function smSaveProfile(){
  if(!window.smCurrentStore) return;
  const uid = window.smCurrentStore;
  const payload = {
    storeName: document.getElementById('sm-name').value.trim(),
    description: document.getElementById('sm-desc').value.trim(),
    storePhone: document.getElementById('sm-phone').value.trim(),
    whatsapp: document.getElementById('sm-wa').value.trim(),
    address: document.getElementById('sm-addr').value.trim(),
    hours: document.getElementById('sm-hours').value.trim(),
    minOrder: parseFloat(document.getElementById('sm-minord').value)||0,
    deliveryFee: parseFloat(document.getElementById('sm-delfee').value)||0,
    isOpen: window._smIsOpen!==false,
    updatedAt: serverTimestamp()
  };
  if(!payload.storeName){ showToast('اسم المتجر مطلوب','err'); return; }
  try{
    await updateDoc(doc(db,'stores',uid), payload);
    await updateDoc(doc(db,'users',uid), {storeName:payload.storeName, storePhone:payload.storePhone, address:payload.address}).catch(()=>{});
    logAudit('تعديل بيانات متجر', payload.storeName);
    document.getElementById('sm-title').textContent = payload.storeName;
    showToast('✅ تم حفظ بيانات المتجر','ok');
  }catch(e){ showToast('حدث خطأ في الحفظ','err'); }
}
async function smUploadLogo(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file||!window.smCurrentStore) return;
    showToast('جارٍ رفع الشعار...','ok');
    try{
      const url=await secureCloudinaryUpload(file);
      await updateDoc(doc(db,'stores',window.smCurrentStore),{logoUrl:url,updatedAt:serverTimestamp()});
      document.getElementById('sm-logo-box').style.backgroundImage=`url('${url}')`;
      document.getElementById('sm-logo-box').textContent='';
      logAudit('تغيير شعار متجر');
      showToast('✅ تم تحديث الشعار','ok');
    }catch(e){ showToast('فشل رفع الصورة','err'); }
  };
  inp.click();
}
async function smUploadCover(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file||!window.smCurrentStore) return;
    showToast('جارٍ رفع الغلاف...','ok');
    try{
      const url=await secureCloudinaryUpload(file);
      await updateDoc(doc(db,'stores',window.smCurrentStore),{coverUrl:url,updatedAt:serverTimestamp()});
      document.getElementById('sm-cover-box').style.backgroundImage=`url('${url}')`;
      document.getElementById('sm-cover-box').textContent='';
      logAudit('تغيير صورة غلاف متجر');
      showToast('✅ تم تحديث الغلاف','ok');
    }catch(e){ showToast('فشل رفع الصورة','err'); }
  };
  inp.click();
}
async function smDeleteCover(){
  if(!window.smCurrentStore) return;
  try{
    await updateDoc(doc(db,'stores',window.smCurrentStore),{coverUrl:'',updatedAt:serverTimestamp()});
    document.getElementById('sm-cover-box').style.backgroundImage='none';
    document.getElementById('sm-cover-box').textContent='🖼️ صورة الغلاف';
    logAudit('حذف صورة غلاف متجر');
    showToast('✅ تم حذف الغلاف','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}
async function smSetAccountStatus(status){
  if(!window.smCurrentStore) return;
  if(status==='paused' && !confirm('هل تريد إيقاف استقبال الطلبات لهذا المتجر مؤقتًا؟')) return;
  try{
    await updateDoc(doc(db,'stores',window.smCurrentStore),{status: status==='paused'?'paused':'active', updatedAt:serverTimestamp()});
    await updateDoc(doc(db,'users',window.smCurrentStore),{status: status==='paused'?'paused':'active'}).catch(()=>{});
    logAudit(status==='paused'?'إيقاف متجر مؤقتًا':'تفعيل متجر');
    showToast('✅ تم التحديث','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}
async function smDeleteStore(){
  if(!window.smCurrentStore) return;
  if(!confirm('هل أنت متأكد من حذف هذا المتجر؟ لا يمكن التراجع عن هذا الإجراء.')) return;
  try{
    await updateDoc(doc(db,'stores',window.smCurrentStore),{status:'deleted',updatedAt:serverTimestamp()});
    await updateDoc(doc(db,'users',window.smCurrentStore),{status:'deleted'}).catch(()=>{});
    logAudit('حذف متجر');
    showToast('✅ تم حذف المتجر','ok');
    closeStoreManage();
  }catch(e){ showToast('حدث خطأ','err'); }
}
let smProdsUnsub = null;
function smLoadProducts(uid){
  if (smProdsUnsub) { try { smProdsUnsub(); } catch(e){} smProdsUnsub = null; }
  const q=query(collection(db,'products'),where('merchantId','==',uid));
  smProdsUnsub=onSnapshot(q,snap=>{
    if(snap.empty){document.getElementById('sm-prods-list').innerHTML='<div class="empty-state"><div class="ei">📦</div><p>لا توجد منتجات</p></div>';return;}
    let html='';
    snap.forEach(d=>{
      const p={...d.data(),id:d.id};
      html+=`<div style="background:#fff;border-radius:var(--r);padding:12px;margin-bottom:8px;box-shadow:var(--sh);border:1px solid var(--border);display:flex;gap:10px;align-items:center">
        <div style="width:48px;height:48px;border-radius:10px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">${p.icon||'📦'}</div>
        <div style="flex:1"><strong style="font-size:13px;font-weight:800;display:block">${esc(p.name)}</strong><small style="color:var(--mu);font-size:11px">${esc(p.unit)}${p.stock!=null?' • الكمية: '+p.stock:''}</small>
          <div style="font-size:14px;font-weight:900;color:var(--p);margin-top:3px">${p.price} ج</div>
          <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">
            <button class="mb2 mb-view" onclick='openEditProd(${JSON.stringify(p).replace(/</g,"\\u003c")})'>✏️ تعديل</button>
            <button class="mb2 ${p.available!==false?'mb-rej':'mb-acc'}" onclick="toggleProdAvail('${d.id}',${p.available!==false})">${p.available!==false?'⏸️ إيقاف':'▶️ تفعيل'}</button>
            <button class="mb2 mb-rej" onclick="admDelProd('${d.id}','${escJs(p.name)}')">🗑️ حذف</button>
          </div>
        </div>
      </div>`;
    });
    document.getElementById('sm-prods-list').innerHTML=html;
  });
}
function openEditProd(p){
  document.getElementById('ep-id').value=p.id;
  document.getElementById('ep-name').value=p.name||'';
  document.getElementById('ep-price').value=p.price||'';
  document.getElementById('ep-stock').value=p.stock??'';
  document.getElementById('ep-unit').value=p.unit||'';
  document.getElementById('ep-icon').value=p.icon||'📦';
  document.getElementById('edit-prod-modal').classList.add('open');
}
async function saveEditProd(){
  const id=document.getElementById('ep-id').value;
  const name=document.getElementById('ep-name').value.trim();
  const price=parseFloat(document.getElementById('ep-price').value)||0;
  const stockRaw=document.getElementById('ep-stock').value;
  const unit=document.getElementById('ep-unit').value.trim();
  const icon=document.getElementById('ep-icon').value||'📦';
  if(!id||!name||!price){ showToast('يرجى تعبئة الاسم والسعر','err'); return; }
  try{
    await updateDoc(doc(db,'products',id),{name,price,unit,icon,stock: stockRaw===''?null:parseInt(stockRaw), updatedAt:serverTimestamp()});
    logAudit('تعديل منتج', name+' — سعر '+price+' ج');
    closeModal('edit-prod-modal');
    showToast('✅ تم حفظ المنتج','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}
async function toggleProdAvail(id, current){
  try{
    await updateDoc(doc(db,'products',id),{available: !current, updatedAt:serverTimestamp()});
    logAudit(current?'إيقاف منتج':'تفعيل منتج');
    showToast('✅ تم التحديث','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}
async function admDelProd(id, name){
  if(!confirm('هل تريد حذف هذا المنتج؟')) return;
  try{
    await deleteDoc(doc(db,'products',id));
    logAudit('حذف منتج', name||'');
    showToast('✅ تم حذف المنتج','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}

function filtOrds(st,btn){
  document.querySelectorAll('#adm-orders .fc2').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#adm-all-ords .drv-row2').forEach(r=>r.style.display=(st==='all'||r.dataset.status===st)?'block':'none');
}

function admNav(page,el){
  document.querySelectorAll('.adm-nb').forEach(b=>b.classList.remove('active'));if(el)el.classList.add('active');
  ['dashboard','drivers','stores','orders','users','finance','cats','banners','coupons','map','audit'].forEach(p=>{const e=document.getElementById('adm-'+p);if(e)e.style.display=p===page?'block':'none';});
  if(page==='map'){setTimeout(()=>initAdminMap([]),200);}
  if(page==='audit'){loadAuditLog();}
}
function filtDrvs(st,btn){document.querySelectorAll('.fc2').forEach(c=>c.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('#adm-drvs-list .drv-row2').forEach(r=>r.style.display=(st==='all'||r.dataset.st===st)?'flex':'none');}
async function saveComm(){
  const v=parseInt(document.getElementById('comm-val').value)||10;
  try{
    await setDoc(doc(db,'settings','commission'),{rate:v,updatedAt:serverTimestamp()});
    // مانحدّثش window.commRate يدوي هنا - هيتحدّث لوحده من خلال listenSettings() لما التغيير يوصل
    document.getElementById('adm-comm-r').textContent=v+'%';
    showToast('✅ تم تحديث العمولة إلى '+v+'%','ok');
  }catch(e){ showToast('حدث خطأ في حفظ العمولة','err'); }
}

// ===== ADMIN: CATEGORY MANAGEMENT =====
function renderAdminCats(items) {
  const list = document.getElementById('adm-cats-list');
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="empty-state" style="padding:16px"><p style="font-size:12px">لا توجد أقسام بعد</p></div>'; return; }
  list.innerHTML = items.map(c => `<div class="drv-row2"><div class="drv-av2" style="background:#F3F4F6">${esc(c.icon)||'🗂️'}</div><div clas
