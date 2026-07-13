// ===== Manayef GO - Main Application Logic =====
// Imported from firebase.js module








import { db, auth, gProvider, collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where, orderBy, serverTimestamp, limit, deleteDoc, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, sendPasswordResetEmail, isSignInWithEmailLink, signInWithEmailLink, sendSignInLinkToEmail, CLOUDINARY_CLOUD, CLOUDINARY_PRESET, STORE_LOC, DEFAULT_LOC } from './firebase.js';








// ===== ORDER STATUS CONSTANTS =====
const SL = {new:'جديد',accepted:'تم القبول',preparing:'جاري التحضير',ready:'جاهز',delivering:'في الطريق',done:'تم التسليم'};
const SC = {new:'sb sb-new',accepted:'sb sb-accepted',preparing:'sb sb-preparing',ready:'sb sb-ready',delivering:'sb sb-delivering',done:'sb sb-done'};
const STEPS = ['new','accepted','preparing','ready','delivering','done'];
const STEP_ICONS = ['🆕','✅','👨‍🍳','📦','🛵','✅'];
const STEP_LABELS = ['جديد','تم القبول','جاري التحضير','جاهز للاستلام','في الطريق','تم التسليم'];








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
      `<div class="off-card"><div class="off-badge">${c.badge||''}</div><div class="off-icon">${c.icon||'🎟️'}</div><h4>${c.title||''}</h4><p>${c.description||''}</p><div class="off-code">${c.code||''}</div></div>`
    ).join('');
  });
}








// Export to window for HTML onclick handlers
window.showScreen = showScreen;
window.pickEntryType = pickEntryType;
window.switchTab = switchTab;
window.doLogin = doLogin;
window.loginGoogle = loginGoogle;
window.hideLoading = hideLoading;

function hideLoading() {
    const ld = document.getElementById('loading');
    if (ld) ld.classList.add('hide');
}
