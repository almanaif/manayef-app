// ===== main.js — نقطة الدخول: يجمّع كل الموديولات، يربطها بـ window عشان أزرار onclick في
// الواجهة تلاقيها، يجهّز PWA، ويستمع لحالة تسجيل الدخول في Firebase =====

import { db, auth, doc, getDoc, setDoc, serverTimestamp, onAuthStateChanged, getRedirectResult,
         isSignInWithEmailLink, signInWithEmailLink } from './firebase.js';
import { Logger, initOfflineHandling, callCurrentStore, callStore, closeModal, filterProds, openNotifs, openWA, setLoad, showErr, showScreen, showToast, waCurrentStore } from './utils.js';
import { addNotif, startNotifListener } from './notifications.js';
import { initAdminMap, initTrackMap, toggleDriverMap } from './maps.js';
import { goCheckout, openTrack } from './orders.js';
import { addCart, chgQty, custNav, doSearch, filterCat, loadBanners, loadCategories, loadCoupons, loadCustomerData, loadOrders, loadProducts, loadProductsByStore, loadStores, openAnyReq, openCart, quickReq, removeCartItem, renderProds, selMCat, selectRatingTarget, sendAnyReq, setStar, submitMerchant, submitRating, updateCartUI } from './customer.js';
import { acceptOrd, agreeTermsModal, buildChart, closeTermsModal, closeZoom, dregBack, dregGetLocation, dregInit, dregNext, dregRestart, dregSaveDraft, dregSetExp, drvNav, getLocation, listenNewOrders, loadDriverData, loadDriverOrders, openTermsModal, removeUploadedDoc, startGPS, submitDrvReg, toggleAgree, toggleOnline, updOrdStatus, uploadDoc, zoomDoc } from './driver.js';
import { delProd, loadMerchantData, loadMerchantOrders, loadMerchantProds, openAddProd, saveProd, updOrdStatus2 } from './merchant.js';
import { admAccDrv, admAccStore, admDelProd, admLogoutConfirm, admNav, admRejDrv, admRejStore, admUpdOrd, closeReasonModal, closeStoreManage, confirmReasonModal, delBanner, delCat, delCoupon, editBanner, editCat, editCoupon, filtDrvs, filtOrds, loadAdminData, loadAuditLog, logAudit, openAddBanner, openAddCat, openAddCoupon, openDrvModal, openEditProd, openReasonModal, openStoreManage, renderAdminBanners, renderAdminCats, renderAdminCoupons, saveBanner, saveCat, saveComm, saveCoupon, saveEditProd, smDeleteCover, smDeleteStore, smQuickActivate, smQuickPause, smSaveProfile, smSetAccountStatus, smSetOpen, smTab, smUploadCover, smUploadLogo, toggleProdAvail, uploadBannerImg } from './admin.js';
import { doLogin, doLogout, doRegister, hideLoading, loginGoogle, pickEntryType, routeUser, selectRole, showEmailOTP, showForgot, switchTab, syncToHubSpot, updateEntryLabel } from './auth.js';

// ===== EXPOSE TO WINDOW =====
// app.js (اتقسم دلوقتي لموديولات) بيتحمّل كـ ES module، فالدوال في الأعلى مش بتبقى
// global تلقائيًا. index.html بينده الدوال دي من onclick="..." واللي بتدور عليها في
// window بس. من غير الكتلة دي، أي زرار في التطبيق هيفشل بصمت.
Object.assign(window, {
  callCurrentStore, callStore, closeModal, filterProds, openNotifs, openWA, setLoad, showErr,
  showScreen, showToast, waCurrentStore, addNotif, startNotifListener, initAdminMap,
  initTrackMap, toggleDriverMap, goCheckout, openTrack, addCart, chgQty, custNav, doSearch,
  filterCat, loadBanners, loadCategories, loadCoupons, loadCustomerData, loadOrders,
  loadProducts, loadProductsByStore, loadStores, openAnyReq, openCart, quickReq,
  removeCartItem, renderProds, selMCat, selectRatingTarget, sendAnyReq, setStar,
  submitMerchant, submitRating, updateCartUI, acceptOrd, agreeTermsModal, buildChart,
  closeTermsModal, closeZoom, dregBack, dregGetLocation, dregInit, dregNext, dregRestart,
  dregSaveDraft, dregSetExp, drvNav, getLocation, listenNewOrders, loadDriverData,
  loadDriverOrders, openTermsModal, removeUploadedDoc, startGPS, submitDrvReg, toggleAgree,
  toggleOnline, updOrdStatus, uploadDoc, zoomDoc, delProd, loadMerchantData,
  loadMerchantOrders, loadMerchantProds, openAddProd, saveProd, updOrdStatus2, admAccDrv,
  admAccStore, admDelProd, admLogoutConfirm, admNav, admRejDrv, admRejStore, admUpdOrd,
  closeReasonModal, closeStoreManage, confirmReasonModal, delBanner, delCat, delCoupon,
  editBanner, editCat, editCoupon, filtDrvs, filtOrds, loadAdminData, loadAuditLog, logAudit,
  openAddBanner, openAddCat, openAddCoupon, openDrvModal, openEditProd, openReasonModal,
  openStoreManage, renderAdminBanners, renderAdminCats, renderAdminCoupons, saveBanner,
  saveCat, saveComm, saveCoupon, saveEditProd, smDeleteCover, smDeleteStore, smQuickActivate,
  smQuickPause, smSaveProfile, smSetAccountStatus, smSetOpen, smTab, smUploadCover,
  smUploadLogo, toggleProdAvail, uploadBannerImg, doLogin, doLogout, doRegister, hideLoading,
  loginGoogle, pickEntryType, routeUser, selectRole, showEmailOTP, showForgot, switchTab,
  syncToHubSpot, updateEntryLabel
});

// ===== PWA =====
// ملحوظة: أي خطأ هنا (خصوصًا تسجيل service worker من blob: URL، اللي ممكن يرفضه المتصفح)
// كان بيوقف تنفيذ باقي الملف بالكامل — بما فيه مستمع onAuthStateChanged اللي بيقفل شاشة
// التحميل. لف الكود ده في try/catch يضمن إن فشل جزء PWA (ثانوي) مايوقفش تحميل التطبيق كله.
try {
  const mf={name:'منايف GO',short_name:'منايف GO',start_url:'/',display:'standalone',background_color:'#1A1A2E',theme_color:'#FF6B00',description:'توصيل سريع في المنايف',icons:[{src:'https://via.placeholder.com/192x192/FF6B00/FFFFFF?text=GO',sizes:'192x192',type:'image/png'},{src:'https://via.placeholder.com/512x512/FF6B00/FFFFFF?text=GO',sizes:'512x512',type:'image/png'}]};
  const mb=new Blob([JSON.stringify(mf)],{type:'application/json'});
  const manifestLink = document.getElementById('manifest-link');
  if(manifestLink) manifestLink.setAttribute('href',URL.createObjectURL(mb));
  if('serviceWorker' in navigator){const sw=`const C='mg-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`;const sb=new Blob([sw],{type:'application/javascript'});navigator.serviceWorker.register(URL.createObjectURL(sb)).catch(()=>{});}
} catch(e) { Logger.error('PWA setup failed (non-fatal):', e); }

// ===== AUTH STATE LISTENER =====
getRedirectResult(auth).catch(e => {
  console.log('Redirect result error:', e);
  if (e?.code && e.code !== 'auth/no-auth-event') {
    setTimeout(() => showToast('خطأ Google: ' + e.code, 'err'), 1500);
  }
});

if (isSignInWithEmailLink(auth, window.location.href)) {
  let emailForLink = window.localStorage?.getItem('emailForSignIn');
  if (!emailForLink) emailForLink = prompt('أدخل بريدك الإلكتروني لتأكيد الدخول:');
  if (emailForLink) {
    signInWithEmailLink(auth, emailForLink, window.location.href)
      .then(() => {
        window.localStorage?.removeItem('emailForSignIn');
        window.history.replaceState({}, document.title, window.location.pathname);
      })
      .catch(e => {
        showToast('فشل تسجيل الدخول بالرابط: ' + (e.message || e.code), 'err');
        window.history.replaceState({}, document.title, window.location.pathname);
      });
  }
}

initOfflineHandling();

onAuthStateChanged(auth, async user => {
  if (user) {
    window.CU = user;
    try {
      const ud = await getDoc(doc(db,'users',user.uid));
      if (ud.exists()) {
        window.CUD = ud.data();
        hideLoading();
        routeUser();
      } else {
        const role = window.selectedType || 'customer';
        const data = {
          name: user.displayName || 'مستخدم',
          email: user.email || '',
          phone: '',
          role,
          points: 0,
          photoURL: user.photoURL || '',
          status: role === 'driver' ? 'pending' : 'active',
          createdAt: serverTimestamp()
        };
        await setDoc(doc(db,'users',user.uid), data);
        window.CUD = data;
        syncToHubSpot(data);
        hideLoading();
        if (role === 'driver') showScreen('screen-driver-register');
        else routeUser();
      }
    } catch(e) {
      console.error('Auth routing error:', e);
      hideLoading();
      showToast('حدث خطأ أثناء تحميل حسابك: ' + (e.message || e.code || e), 'err');
      showScreen('screen-entry');
    }
  } else {
    window.CU = null; window.CUD = null;
    hideLoading();
    showScreen('screen-entry');
  }
});
