// ===== utils.js — أدوات عامة مشتركة (Logger, XSS escaping, debounce, listener registry, offline handling, رفع Cloudinary, helpers عامة للواجهة) =====

import { onSnapshot as _onSnapshotRaw } from './firebase.js';
import { renderProds } from './customer.js';
import { dregInit } from './driver.js';

// ===== LISTENER REGISTRY (تنظيف onSnapshot تلقائيًا عند تسجيل الخروج) =====
// أي كود في الملف بينده onSnapshot(...) بيتسجل هنا تلقائيًا من غير ما نلمس كل مكان مستخدم فيه.
// ده بيحل مشكلتين: تسريب الذاكرة (listeners بتفضل شغالة بعد تسجيل الخروج)، وتسريب بيانات
// مستخدم لمستخدم تاني بيسجل دخول بعده على نفس الجهاز من غير ما الصفحة تتعمل لها reload.
export const _listeners = [];
const _resetCallbacks = [];
export function onSnapshot(...args) {
  const unsub = _onSnapshotRaw(...args);
  _listeners.push(unsub);
  return unsub;
}
// كل موديول يملك أعلام "already subscribed" (زي productsUnsub) بيسجل هنا دالة تصفّرها،
// بدل ما clearAllListeners يعرف بأسماء متغيرات موديولات تانية (ده كان مستحيل أصلاً بعد
// تقسيم الملف لموديولات ES، لأن مينفعش تعدّل متغير let مستورد من موديول تاني مباشرة).
export function onListenersCleared(cb) { _resetCallbacks.push(cb); }
export function clearAllListeners() {
  _listeners.forEach(u => { try { u(); } catch (e) { Logger.error(e); } });
  _listeners.length = 0;
  _resetCallbacks.forEach(cb => { try { cb(); } catch (e) { Logger.error(e); } });
}


// ===== ORDER STATUS CONSTANTS =====
export const SL = {new:'جديد',accepted:'تم القبول',preparing:'جاري التحضير',ready:'جاهز',delivering:'في الطريق',done:'تم التسليم',cancelled:'ملغي'};
export const SC = {new:'sb sb-new',accepted:'sb sb-accepted',preparing:'sb sb-preparing',ready:'sb sb-ready',delivering:'sb sb-delivering',done:'sb sb-done',cancelled:'sb sb-cancelled'};
export const STEPS = ['new','accepted','preparing','ready','delivering','done'];
export const STEP_ICONS = ['🆕','✅','👨‍🍳','📦','🛵','✅'];
export const STEP_LABELS = ['جديد','تم القبول','جاري التحضير','جاهز للاستلام','في الطريق','تم التسليم'];


// ===== LOGGER (بديل موحد لـ console.log) =====
const DEV_MODE = false; // خليها true وقت التطوير فقط
export const Logger = {
  info: (...a) => { if (DEV_MODE) console.log('[INFO]', ...a); },
  warn: (...a) => { if (DEV_MODE) console.warn('[WARN]', ...a); },
  error: (...a) => { console.error('[ERROR]', ...a); } // الأخطاء تتسجل دايمًا
};


// ===== DEBOUNCE =====
export function debounce(fn, wait = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}


// ===== OFFLINE HANDLING =====
export function initOfflineHandling() {
  window.addEventListener('offline', () => showToast('⚠️ لا يوجد اتصال بالإنترنت', 'err'));
  window.addEventListener('online', () => showToast('✅ تم استعادة الاتصال', 'ok'));
}


// ===== XSS PROTECTION =====
// أي نص جاي من قاعدة البيانات (اسم منتج، اسم متجر، اسم مستخدم...) لازم يعدي من هنا
// قبل ما يتحط جوه innerHTML، عشان محدش يقدر يحط <script> أو onerror داخل اسمه ويشغّل كود عند غيره.
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
// نسخة خاصة بالنصوص اللي بتتحط جوه onclick="...('نص')" لأن السياق هنا HTML attribute
// وجوّاه كود JS في نفس الوقت، فلازم نأمّن الاتنين مع بعض.
export function escJs(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ===== SECURE CLOUDINARY UPLOAD =====
// بدل ما نستخدم upload_preset مفتوح (أي حد يقدر يرفع بيه من برة التطبيق)،
// بنجيب توقيع (signature) صالح لمدة دقايق من الـ Worker قبل كل رفعة، والتوقيع ده مربوط
// بالتوقيت فبيبقى صالح لفترة قصيرة بس، فمينفعش حد يستخدمه غير من جوه التطبيق وقت الرفع.
export const CLOUDINARY_SIGN_URL = 'https://manayef-cloudinary-sign.mohamedselim3121998.workers.dev';
export async function secureCloudinaryUpload(file) {
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


// ===== HELPERS =====
export function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');window.scrollTo(0,0);if(id==='screen-driver-register')dregInit();}
export function showToast(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='toast'+(type?' '+type:'');t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
export function showErr(msg){const e=document.getElementById('err-msg');e.textContent=msg;e.style.display='block';e.scrollIntoView({behavior:'smooth',block:'center'});}
export function setLoad(btnId,spId,on){const btn=document.getElementById(btnId);const sp=spId?document.getElementById(spId):null;if(btn)btn.disabled=on;if(sp)sp.style.display=on?'block':'none';}
export function callStore(num){window.location.href='tel:'+num;}
export function openWA(num,name){window.open('https://wa.me/'+num+'?text=أهلاً، أريد الطلب من '+name,'_blank');}
export function callCurrentStore(){ if(!window.currentStorePhone){showToast('رقم المتجر غير متاح','err');return;} callStore(window.currentStorePhone); }
export function waCurrentStore(){ if(!window.currentStorePhone){showToast('رقم المتجر غير متاح','err');return;} openWA(window.currentStorePhone, window.currentStoreName||'المتجر'); }
export function closeModal(id){document.getElementById(id).classList.remove('open');}
export function openNotifs(){document.getElementById('notif-overlay').classList.add('open');}

export function filterProds(cat, btn) {
  document.querySelectorAll('.pc-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderProds(cat);
}
