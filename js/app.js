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
window.loginEmail = async function() {
  const email = document.getElementById('li-email').value.trim();
  const pass = document.getElementById('li-pass').value;
  if(!email || !pass) return showToast('يرجى إدخال البيانات','err');
  
  // Hardcoded admin check
  if (email === 'admin@manayef.app' && pass === 'admin224444') {
    window.CU = { email: email, uid: 'admin_hardcoded' };
    window.CUD = { role: 'admin', name: 'المدير العام' };
    showToast('تم تسجيل دخول الإدارة بنجاح');
    showScreen('screen-admin');
    return;
  }
  
  try {
    const res = await signInWithEmailAndPassword(auth, email, pass);
    // ... rest of the original logic
  } catch(e) {
    showToast('خطأ في تسجيل الدخول','err');
  }
}
