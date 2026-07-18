// ===== driver.js — شاشات المندوب: GPS، الطلبات، معالج تسجيل مندوب جديد =====

import { collection, db, doc, limit, orderBy, query, runTransaction, serverTimestamp, updateDoc, where } from './firebase.js';
import { SC, SL, esc, escJs, onListenersCleared, onSnapshot, secureCloudinaryUpload, setLoad, showScreen, showToast } from './utils.js';
import { getNextRequestId } from './merchant.js';

// ===== GPS / LOCATION =====
export function getLocation() {
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
export function _distMeters(lat1,lng1,lat2,lng2){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
export let _lastGpsWrite = 0, _lastGpsLat = null, _lastGpsLng = null;
export function startGPS() {
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


// ===== DRIVER FUNCTIONS =====
export function loadDriverData() {
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

export let newOrdersUnsub = null;
export function listenNewOrders() {
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

export let driverOrdersUnsub = null;
export function loadDriverOrders() {
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

export async function acceptOrd() {
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

export async function updOrdStatus(id, status) {
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

export function toggleOnline(el) {
  window.onlineStatus = !window.onlineStatus;
  document.getElementById('tog-dot').className='tog-dot '+(window.onlineStatus?'on':'off');
  document.getElementById('tog-lbl').textContent = window.onlineStatus?'متاح':'غير متاح';
  showToast(window.onlineStatus?'🟢 أنت متاح الآن':'⚫ أنت غير متاح',window.onlineStatus?'ok':'');
  if (!window.onlineStatus) document.getElementById('new-ord-banner').style.display='none';
}

export function drvNav(tab,el) {
  document.querySelectorAll('#screen-driver .nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('drv-home-tab').style.display=tab==='home'?'block':'none';
  document.getElementById('drv-stats-tab').style.display=tab==='stats'?'block':'none';
  document.getElementById('drv-profile-tab').style.display=tab==='profile'?'block':'none';
  document.getElementById('drv-extra').style.display=tab==='home'?'grid':'none';
}

export function buildChart() {
  const days=['سب','أح','اث','ثل','أر','خم','جم'];
  const vals=[0,0,0,0,0,0,0];
  const mx=Math.max(...vals)||1;
  document.getElementById('earn-bars').innerHTML=days.map((d,i)=>`<div class="cb-wrap"><div class="cb" style="height:${Math.max((vals[i]/mx*100),4)}%"></div><span class="cb-day">${d}</span></div>`).join('');
}


// ===== DRIVER REGISTRATION WIZARD =====
window.dregStep = window.dregStep || 1;
window.driverLoc = window.driverLoc || null;
window.uploadedDocs = {};

// --- Draft autosave: لو المندوب قفل الصفحة، بياناته متحفوظة محليًا ومترجعله تاني ---
export const DREG_DRAFT_KEY = 'manayef_drv_draft';
export function dregSaveDraft(){
  try{
    const ids=['d-name','d-phone','d-dob','d-nid','d-emerg','d-addr','d-vtype','d-vmodel','d-vcolor','d-plate'];
    const data={}; ids.forEach(id=>{const el=document.getElementById(id); if(el) data[id]=el.value;});
    data.hasExp = window.driverHasExp!==false;
    localStorage.setItem(DREG_DRAFT_KEY, JSON.stringify(data));
  }catch(e){}
  dregUpdateProgress();
}
export function dregLoadDraft(){
  try{
    const raw=localStorage.getItem(DREG_DRAFT_KEY); if(!raw) return;
    const data=JSON.parse(raw);
    Object.keys(data).forEach(id=>{const el=document.getElementById(id); if(el && id!=='hasExp') el.value=data[id];});
    if(data.hasExp===false) dregSetExp(false);
  }catch(e){}
}
export function dregClearDraft(){ try{localStorage.removeItem(DREG_DRAFT_KEY);}catch(e){} }

export function dregSetExp(val){
  window.driverHasExp = val;
  document.getElementById('exp-yes').classList.toggle('active', val);
  document.getElementById('exp-no').classList.toggle('active', !val);
  dregSaveDraft();
}

// --- تنقل بين الخطوات ---
export function dregShowFieldErr(id, msg){
  const inp=document.getElementById(id), err=document.getElementById('err-'+id);
  if(inp) inp.classList.add('err');
  if(err){ err.textContent=msg; err.style.display='block'; }
}
export function dregClearFieldErr(id){
  const inp=document.getElementById(id), err=document.getElementById('err-'+id);
  if(inp) inp.classList.remove('err');
  if(err){ err.style.display='none'; }
}
export function dregValidateStep1(){
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
export function dregValidateStep2(){
  const required=['d-id1','d-id2','d-photo','d-license'];
  const missing=required.filter(id=>!(window.uploadedDocs&&window.uploadedDocs[id]));
  const err=document.getElementById('err-docs');
  if(missing.length){ err.textContent='لازم ترفع كل المستندات الأربعة'; err.style.display='block'; return false; }
  err.style.display='none'; return true;
}
export function dregValidateStep3(){
  if(!window.agreedTerms){
    document.getElementById('err-agree').textContent='لازم توافق على البنود والشروط';
    document.getElementById('err-agree').style.display='block';
    return false;
  }
  document.getElementById('err-agree').style.display='none';
  return true;
}
export function dregGoto(step){
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
export function dregNext(){
  if(window.dregStep===1 && !dregValidateStep1()) return;
  if(window.dregStep===2 && !dregValidateStep2()) return;
  dregGoto(window.dregStep+1);
}
export function dregBack(){
  if(window.dregStep<=1){ showScreen('screen-entry'); return; }
  dregGoto(window.dregStep-1);
}
export function dregUpdateProgress(){
  const ids=['d-name','d-phone','d-dob','d-nid','d-emerg','d-addr','d-vtype'];
  let filled=0; ids.forEach(id=>{const el=document.getElementById(id); if(el&&el.value.trim())filled++;});
  const docsCount=Object.keys(window.uploadedDocs||{}).length;
  const total=ids.length+4+1;
  let done=filled+Math.min(docsCount,4)+(window.agreedTerms?1:0);
  const pct=Math.round(done/total*100);
  const el=document.getElementById('dreg-pct');
  if(el) el.textContent=`اكتمال التسجيل: ${pct}%`;
}
export function dregRenderReview(){
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
export async function dregGetLocation(){
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
export function openTermsModal(){
  document.getElementById('terms-full-txt').textContent = TERMS_FULL_TEXT;
  document.getElementById('terms-modal').classList.add('show');
}
export function closeTermsModal(){ document.getElementById('terms-modal').classList.remove('show'); }
export function agreeTermsModal(){
  closeTermsModal();
  if(!window.agreedTerms) toggleAgree();
}

// --- ضغط الصورة قبل الرفع (تقليل الحجم مع الحفاظ على جودة مقبولة) ---
export function compressImage(file, maxDim=1280, quality=0.75){
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
export async function uploadDoc(id, label){
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
export function dregRenderDocPreview(id,label,url){
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
export function removeUploadedDoc(id,label){
  delete window.uploadedDocs[id];
  const wrap=document.getElementById(id+'-wrap');
  wrap.innerHTML=`<div class="upload-box" onclick="uploadDoc('${escJs(id)}','${escJs(label)}')" id="${id}"><span class="doc-help" onclick="event.stopPropagation();showToast('لازم تكون الصورة واضحة وكل البيانات ظاهرة')">؟</span><div class="u-ic">📷</div><p>${esc(label)}</p></div>`;
  dregUpdateProgress();
}
export function zoomDoc(url){
  document.getElementById('zoom-img').src=url;
  document.getElementById('zoom-ov').classList.add('show');
}
export function closeZoom(){ document.getElementById('zoom-ov').classList.remove('show'); }

export function toggleAgree(el){
  window.agreedTerms=!window.agreedTerms;
  const b=document.getElementById('agree-box');
  b.style.background=window.agreedTerms?'var(--ok)':'#fff';
  b.style.borderColor=window.agreedTerms?'var(--ok)':'var(--border)';
  b.innerHTML=window.agreedTerms?'<span style="color:#fff;font-size:12px">✓</span>':'';
  dregUpdateProgress();
}

export async function submitDrvReg(){
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
export function dregInit(){
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
export function dregRestart(){
  document.getElementById('dreg-rejected').style.display='none';
  document.querySelector('.dreg-hdr').style.display='block';
  document.getElementById('dreg-form').style.display='block';
  window.dregStep=1; window.uploadedDocs={}; window.agreedTerms=false; window.driverLoc=null; window.driverHasExp=true;
  dregGoto(1);
}


// ===== تصفير أعلام المتابعة عند تسجيل الخروج (بيتنفذ من utils.js عبر clearAllListeners) =====
export function registerDriverResets() {
  onListenersCleared(() => {
  newOrdersUnsub = null; driverOrdersUnsub = null;
  _lastGpsWrite = 0; _lastGpsLat = null; _lastGpsLng = null;
  });
}
