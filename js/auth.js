// ===== auth.js — تسجيل الدخول/إنشاء حساب، التوجيه بعد الدخول (Routing)، مزامنة HubSpot =====

import { auth, createUserWithEmailAndPassword, db, doc, gProvider, sendPasswordResetEmail, sendSignInLinkToEmail, serverTimestamp, setDoc, signInWithEmailAndPassword, signInWithRedirect, signOut } from './firebase.js';
import { loadBanners, loadCategories, loadCoupons, loadCustomerData, loadProducts } from './customer.js';
import { clearAllListeners, setLoad, showErr, showScreen, showToast } from './utils.js';
import { getLocation, loadDriverData, startGPS } from './driver.js';
import { loadAdminData } from './admin.js';
import { startNotifListener } from './notifications.js';
import { loadMerchantData } from './merchant.js';
import { listenSettings } from './orders.js';

// ===== AUTH FUNCTIONS =====
export function hideLoading() {
  const ld = document.getElementById('loading');
  ld.classList.add('hide');
  setTimeout(() => ld.style.display = 'none', 500);
}

export function switchTab(t) {
  document.querySelectorAll('.auth-tab').forEach((b,i) => b.classList.toggle('active',(t==='login'&&i===0)||(t==='register'&&i===1)));
  document.getElementById('auth-login').style.display = t==='login'?'block':'none';
  document.getElementById('auth-register').style.display = t==='register'?'block':'none';
  document.getElementById('err-msg').style.display = 'none';
  updateEntryLabel(t);
}

export const ENTRY_LABELS = {customer:{icon:'👤',name:'عميل'},driver:{icon:'🛵',name:'مندوب'},merchant:{icon:'🏪',name:'تاجر'},admin:{icon:'⚙️',name:'إدارة'}};
export function updateEntryLabel(tab) {
  const cfg = ENTRY_LABELS[window.selectedType] || ENTRY_LABELS.customer;
  document.getElementById('entry-type-icon').textContent = cfg.icon;
  document.getElementById('entry-type-label').textContent = tab === 'register' ? `حساب ${cfg.name} جديد` : `دخول كـ${cfg.name}`;
}

export function pickEntryType(type) {
  window.selectedType = type;
  ['customer','merchant','driver','admin'].forEach(t => {
    const el = document.getElementById('reg-'+t+'-fields');
    if (el) el.style.display = t === type ? 'block' : 'none';
  });
  switchTab('register');
  showScreen('screen-auth');
}

export async function showEmailOTP() {
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

export async function loginGoogle() {
  try {
    showToast('جاري تسجيل الدخول بـ Google...','inf');
    await signInWithRedirect(auth, gProvider);
  } catch(e) {
    if (e.code === 'auth/unauthorized-domain') showToast('الدومين غير مصرح في Firebase','err');
    else showToast('خطأ في تسجيل الدخول بـ Google','err');
  }
}

export async function doLogin() {
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

export async function doRegister() {
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

export async function doLogout() {
  if (window._gpsWatch) navigator.geolocation.clearWatch(window._gpsWatch);
  if (window._gpsInterval) clearInterval(window._gpsInterval);
  clearAllListeners(); // بيصفّر كل الـ listeners + أعلام المتابعة بما فيها إحداثيات GPS المندوب (مسجلة من driver.js) // يقفل كل الـ onSnapshot listeners المفتوحة (طلبات، منتجات، إشعارات...)
  try { await signOut(auth); } catch(e) {}
  showScreen('screen-entry');
}

export async function showForgot() {
  const email = document.getElementById('lmail').value.trim();
  if (!email) { showErr('أدخل بريدك الإلكتروني أولاً'); return; }
  try { await sendPasswordResetEmail(auth, email); showToast('تم إرسال رابط الاستعادة ✅','ok'); } catch(e) { showToast('حدث خطأ','err'); }
}

export async function selectRole(role) {
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


// ===== ROUTING =====
export function routeUser() {
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


// ===== HUBSPOT SYNC =====
export function syncToHubSpot(data) {
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
