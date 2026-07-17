// ===== admin.js — لوحة الإدارة: الطلبات، المستخدمين، المتاجر، التصنيفات، البانرات، الكوبونات، سجل التدقيق =====

import { addDoc, collection, db, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from './firebase.js';
import { SC, SL, STEPS, closeModal, esc, escJs, onListenersCleared, onSnapshot, secureCloudinaryUpload, showToast } from './utils.js';
import { doLogout } from './auth.js';
import { zoomDoc } from './driver.js';
import { listenSettings } from './orders.js';
import { initAdminMap } from './maps.js';

// ===== ADMIN FUNCTIONS =====
export let adminOrdersUnsub = null, adminUsersUnsub = null;
export async function loadAdminData() {
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
export async function logAudit(action, details){
  try{
    await addDoc(collection(db,'auditLog'),{
      adminId: window.CU?.uid||null,
      adminName: window.CUD?.name||window.CU?.email||'أدمن',
      action, details: details||'',
      createdAt: serverTimestamp()
    });
  }catch(e){}
}
export let auditLogUnsub = null;
export function loadAuditLog(){
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
export function admLogoutConfirm(){
  if(confirm('هل تريد تسجيل الخروج من لوحة الإدارة؟')) doLogout();
}


// ===== REJECTION REASON MODAL (يُستخدم لرفض المندوب أو المتجر) =====
window._reasonCallback = null;
export function openReasonModal(title, presets, callback){
  document.getElementById('reason-modal-title').textContent = title;
  document.getElementById('reason-text').value='';
  const pr=document.getElementById('reason-presets');
  pr.innerHTML = (presets||[]).map(p=>`<button class="fc2" type="button" onclick="document.getElementById('reason-text').value='${escJs(p)}'">${esc(p)}</button>`).join('');
  window._reasonCallback = callback;
  document.getElementById('reason-modal').classList.add('open');
}
export function closeReasonModal(){
  document.getElementById('reason-modal').classList.remove('open');
  window._reasonCallback = null;
}
export function confirmReasonModal(){
  const reason = document.getElementById('reason-text').value.trim();
  if(!reason){ showToast('اكتب سبب الرفض','err'); return; }
  const cb = window._reasonCallback;
  closeReasonModal();
  if(cb) cb(reason);
}

export async function admUpdOrd(id,status){try{await updateDoc(doc(db,'orders',id),{status,updatedAt:serverTimestamp()});showToast('✅ تم تحديث الطلب','ok');}catch(e){showToast('حدث خطأ','err');}}
export async function admAccDrv(uid){try{await updateDoc(doc(db,'users',uid),{status:'active',approvedAt:serverTimestamp()});await addDoc(collection(db,'notifications'),{userId:uid,title:'🎉 تم قبول حسابك',body:'تم اعتماد حسابك كمندوب توصيل، تقدر تبدأ تستقبل الطلبات الآن.',type:'or',read:false,createdAt:serverTimestamp()});logAudit('قبول مندوب');showToast('✅ تم قبول المندوب','ok');closeModal('drv-modal');}catch(e){showToast('حدث خطأ','err');}}
export function admRejDrv(uid){
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
export async function admAccStore(id){try{await updateDoc(doc(db,'users',id),{status:'active',approvedAt:serverTimestamp()});await updateDoc(doc(db,'stores',id),{status:'active'}).catch(()=>{});await addDoc(collection(db,'notifications'),{userId:id,title:'🎉 تم قبول متجرك',body:'تم اعتماد متجرك على منصة Manayef GO، تقدر تضيف منتجاتك وتستقبل الطلبات الآن.',type:'or',read:false,createdAt:serverTimestamp()});logAudit('قبول متجر');showToast('✅ تم قبول المتجر','ok');}catch(e){showToast('حدث خطأ','err');}}
export function admRejStore(id){
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
export async function openDrvModal(uid){
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
export async function renderAdminStoresList(allStores){
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
export async function smQuickPause(uid){
  if(!confirm('هل تريد إيقاف استقبال الطلبات لهذا المتجر مؤقتًا؟')) return;
  try{ await updateDoc(doc(db,'stores',uid),{status:'paused',updatedAt:serverTimestamp()}); await updateDoc(doc(db,'users',uid),{status:'paused'}).catch(()=>{}); logAudit('إيقاف متجر مؤقتًا'); showToast('✅ تم الإيقاف','ok'); }catch(e){showToast('حدث خطأ','err');}
}
export async function smQuickActivate(uid){
  try{ await updateDoc(doc(db,'stores',uid),{status:'active',updatedAt:serverTimestamp()}); await updateDoc(doc(db,'users',uid),{status:'active'}).catch(()=>{}); logAudit('تفعيل متجر'); showToast('✅ تم التفعيل','ok'); }catch(e){showToast('حدث خطأ','err');}
}
export async function openStoreManage(uid){
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
export function closeStoreManage(){
  document.getElementById('screen-store-manage').style.display='none';
  window.smCurrentStore=null; window.adminTargetStore=null;
}
export function smTab(tab,el){
  document.querySelectorAll('#screen-store-manage .adm-nb').forEach(b=>b.classList.remove('active'));
  if(el)el.classList.add('active');
  document.getElementById('sm-profile').style.display = tab==='profile'?'block':'none';
  document.getElementById('sm-products').style.display = tab==='products'?'block':'none';
}
export function smSetOpen(isOpen){
  window._smIsOpen = isOpen;
  document.getElementById('sm-open-btn').classList.toggle('active', isOpen);
  document.getElementById('sm-closed-btn').classList.toggle('active', !isOpen);
}
export async function smSaveProfile(){
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
export async function smUploadLogo(){
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
export async function smUploadCover(){
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
export async function smDeleteCover(){
  if(!window.smCurrentStore) return;
  try{
    await updateDoc(doc(db,'stores',window.smCurrentStore),{coverUrl:'',updatedAt:serverTimestamp()});
    document.getElementById('sm-cover-box').style.backgroundImage='none';
    document.getElementById('sm-cover-box').textContent='🖼️ صورة الغلاف';
    logAudit('حذف صورة غلاف متجر');
    showToast('✅ تم حذف الغلاف','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}
export async function smSetAccountStatus(status){
  if(!window.smCurrentStore) return;
  if(status==='paused' && !confirm('هل تريد إيقاف استقبال الطلبات لهذا المتجر مؤقتًا؟')) return;
  try{
    await updateDoc(doc(db,'stores',window.smCurrentStore),{status: status==='paused'?'paused':'active', updatedAt:serverTimestamp()});
    await updateDoc(doc(db,'users',window.smCurrentStore),{status: status==='paused'?'paused':'active'}).catch(()=>{});
    logAudit(status==='paused'?'إيقاف متجر مؤقتًا':'تفعيل متجر');
    showToast('✅ تم التحديث','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}
export async function smDeleteStore(){
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
export let smProdsUnsub = null;
export function smLoadProducts(uid){
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
export function openEditProd(p){
  document.getElementById('ep-id').value=p.id;
  document.getElementById('ep-name').value=p.name||'';
  document.getElementById('ep-price').value=p.price||'';
  document.getElementById('ep-stock').value=p.stock??'';
  document.getElementById('ep-unit').value=p.unit||'';
  document.getElementById('ep-icon').value=p.icon||'📦';
  document.getElementById('edit-prod-modal').classList.add('open');
}
export async function saveEditProd(){
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
export async function toggleProdAvail(id, current){
  try{
    await updateDoc(doc(db,'products',id),{available: !current, updatedAt:serverTimestamp()});
    logAudit(current?'إيقاف منتج':'تفعيل منتج');
    showToast('✅ تم التحديث','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}
export async function admDelProd(id, name){
  if(!confirm('هل تريد حذف هذا المنتج؟')) return;
  try{
    await deleteDoc(doc(db,'products',id));
    logAudit('حذف منتج', name||'');
    showToast('✅ تم حذف المنتج','ok');
  }catch(e){ showToast('حدث خطأ','err'); }
}

export function filtOrds(st,btn){
  document.querySelectorAll('#adm-orders .fc2').forEach(c=>c.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#adm-all-ords .drv-row2').forEach(r=>r.style.display=(st==='all'||r.dataset.status===st)?'block':'none');
}

export function admNav(page,el){
  document.querySelectorAll('.adm-nb').forEach(b=>b.classList.remove('active'));if(el)el.classList.add('active');
  ['dashboard','drivers','stores','orders','users','finance','cats','banners','coupons','map','audit'].forEach(p=>{const e=document.getElementById('adm-'+p);if(e)e.style.display=p===page?'block':'none';});
  if(page==='map'){setTimeout(()=>initAdminMap([]),200);}
  if(page==='audit'){loadAuditLog();}
}
export function filtDrvs(st,btn){document.querySelectorAll('.fc2').forEach(c=>c.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('#adm-drvs-list .drv-row2').forEach(r=>r.style.display=(st==='all'||r.dataset.st===st)?'flex':'none');}
export async function saveComm(){
  const v=parseInt(document.getElementById('comm-val').value)||10;
  try{
    await setDoc(doc(db,'settings','commission'),{rate:v,updatedAt:serverTimestamp()});
    // مانحدّثش window.commRate يدوي هنا - هيتحدّث لوحده من خلال listenSettings() لما التغيير يوصل
    document.getElementById('adm-comm-r').textContent=v+'%';
    showToast('✅ تم تحديث العمولة إلى '+v+'%','ok');
  }catch(e){ showToast('حدث خطأ في حفظ العمولة','err'); }
}


// ===== ADMIN: CATEGORY MANAGEMENT =====
export function renderAdminCats(items) {
  const list = document.getElementById('adm-cats-list');
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="empty-state" style="padding:16px"><p style="font-size:12px">لا توجد أقسام بعد</p></div>'; return; }
  list.innerHTML = items.map(c => `<div class="drv-row2"><div class="drv-av2" style="background:#F3F4F6">${esc(c.icon)||'🗂️'}</div><div class="drv-info2"><strong>${esc(c.label)}</strong><small>ترتيب: ${c.order??0}</small></div><div class="drv-row2-acts"><button class="mb2 mb-view" onclick="editCat('${c.id}','${escJs(c.label)}','${escJs(c.icon)}',${c.order??0})">تعديل</button><button class="mb2 mb-rej" onclick="delCat('${c.id}')">حذف</button></div></div>`).join('');
}
export function openAddCat() {
  document.getElementById('cat-modal-title').textContent = '➕ إضافة قسم';
  document.getElementById('ac-id').value = '';
  document.getElementById('ac-label').value = '';
  document.getElementById('ac-icon').value = '';
  document.getElementById('ac-order').value = '';
  document.getElementById('add-cat-modal').classList.add('open');
}
export function editCat(id, label, icon, order) {
  document.getElementById('cat-modal-title').textContent = '✏️ تعديل قسم';
  document.getElementById('ac-id').value = id;
  document.getElementById('ac-label').value = label;
  document.getElementById('ac-icon').value = icon;
  document.getElementById('ac-order').value = order;
  document.getElementById('add-cat-modal').classList.add('open');
}
export async function saveCat() {
  const id = document.getElementById('ac-id').value;
  const label = document.getElementById('ac-label').value.trim();
  const icon = document.getElementById('ac-icon').value.trim();
  const order = parseInt(document.getElementById('ac-order').value) || 0;
  if (!label) { showToast('اكتب اسم القسم', 'err'); return; }
  try {
    if (id) await updateDoc(doc(db,'categories',id), { label, icon, order });
    else await addDoc(collection(db,'categories'), { label, icon, order, createdAt: serverTimestamp() });
    showToast('✅ تم الحفظ', 'ok');
    closeModal('add-cat-modal');
  } catch(e) { showToast('حدث خطأ', 'err'); }
}
export async function delCat(id) {
  try { await deleteDoc(doc(db,'categories',id)); showToast('🗑️ تم حذف القسم', 'ok'); }
  catch(e) { showToast('حدث خطأ', 'err'); }
}


// ===== ADMIN: BANNER MANAGEMENT =====
export function renderAdminBanners(items) {
  const list = document.getElementById('adm-banners-list');
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="empty-state" style="padding:16px"><p style="font-size:12px">لا توجد بانرات بعد</p></div>'; return; }
  list.innerHTML = items.map(b => `<div class="drv-row2"><div class="drv-av2" style="background:#F3F4F6;background-image:url('${esc(b.imageUrl)}');background-size:cover">${b.imageUrl?'':'🖼️'}</div><div class="drv-info2"><strong>${esc(b.title)}</strong><small>ترتيب: ${b.order??0}</small></div><div class="drv-row2-acts"><button class="mb2 mb-view" onclick='editBanner(${JSON.stringify(b).replace(/</g,"\\u003c")})'>تعديل</button><button class="mb2 mb-rej" onclick="delBanner('${b.id}')">حذف</button></div></div>`).join('');
}
export async function uploadBannerImg() {
  const box = document.getElementById('ab-img-box');
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    if (file.size > 5*1024*1024) { showToast('حجم الصورة كبير جدًا (الحد الأقصى 5 ميجا)','err'); return; }
    box.innerHTML = `<div class="u-ic">⏳</div><p style="font-size:12px">جارٍ الرفع...</p>`;
    try {
      const url = await secureCloudinaryUpload(file);
      document.getElementById('ab-imgurl').value = url;
      box.style.backgroundImage = `url('${url}')`;
      box.style.backgroundSize = 'cover';
      box.innerHTML = `<div class="u-ic">✅</div><p style="font-size:12px;color:var(--ok)">تم رفع الصورة</p>`;
    } catch(e) {
      box.innerHTML = `<div class="u-ic">📷</div><p style="font-size:12px;color:#E11">فشل الرفع، اضغط للمحاولة تاني</p>`;
    }
  };
  inp.click();
}
export function openAddBanner() {
  document.getElementById('banner-modal-title').textContent = '➕ إضافة بانر';
  ['ab-id','ab-tag','ab-title','ab-desc','ab-order','ab-start','ab-end','ab-imgurl'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('ab-img-box').innerHTML = `<div class="u-ic">📷</div><p style="font-size:12px">اضغط لرفع صورة</p>`;
  document.getElementById('ab-img-box').style.backgroundImage = '';
  document.getElementById('add-banner-modal').classList.add('open');
}
export function editBanner(b) {
  document.getElementById('banner-modal-title').textContent = '✏️ تعديل بانر';
  document.getElementById('ab-id').value = b.id;
  document.getElementById('ab-tag').value = b.tag||'';
  document.getElementById('ab-title').value = b.title||'';
  document.getElementById('ab-desc').value = b.description||'';
  document.getElementById('ab-order').value = b.order??'';
  document.getElementById('ab-start').value = b.startDate||'';
  document.getElementById('ab-end').value = b.endDate||'';
  document.getElementById('ab-imgurl').value = b.imageUrl||'';
  const box = document.getElementById('ab-img-box');
  if (b.imageUrl) { box.style.backgroundImage = `url('${b.imageUrl}')`; box.style.backgroundSize='cover'; box.innerHTML=''; }
  document.getElementById('add-banner-modal').classList.add('open');
}
export async function saveBanner() {
  const id = document.getElementById('ab-id').value;
  const title = document.getElementById('ab-title').value.trim();
  if (!title) { showToast('اكتب عنوان البانر', 'err'); return; }
  const data = {
    title, tag: document.getElementById('ab-tag').value.trim(),
    description: document.getElementById('ab-desc').value.trim(),
    order: parseInt(document.getElementById('ab-order').value) || 0,
    startDate: document.getElementById('ab-start').value || null,
    endDate: document.getElementById('ab-end').value || null,
    imageUrl: document.getElementById('ab-imgurl').value || null,
    active: true
  };
  try {
    if (id) await updateDoc(doc(db,'banners',id), data);
    else await addDoc(collection(db,'banners'), { ...data, createdAt: serverTimestamp() });
    showToast('✅ تم الحفظ', 'ok');
    closeModal('add-banner-modal');
  } catch(e) { showToast('حدث خطأ', 'err'); }
}
export async function delBanner(id) {
  try { await deleteDoc(doc(db,'banners',id)); showToast('🗑️ تم حذف البانر', 'ok'); }
  catch(e) { showToast('حدث خطأ', 'err'); }
}


// ===== ADMIN: COUPON MANAGEMENT =====
export function renderAdminCoupons(items) {
  const list = document.getElementById('adm-coupons-list');
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="empty-state" style="padding:16px"><p style="font-size:12px">لا توجد قسائم بعد</p></div>'; return; }
  list.innerHTML = items.map(c => `<div class="drv-row2"><div class="drv-av2" style="background:#F3F4F6">${esc(c.icon)||'🎟️'}</div><div class="drv-info2"><strong>${esc(c.title)} — ${esc(c.code)}</strong><small>${esc(c.badge)} | ترتيب: ${c.order??0}</small></div><div class="drv-row2-acts"><button class="mb2 mb-view" onclick='editCoupon(${JSON.stringify(c).replace(/</g,"\\u003c")})'>تعديل</button><button class="mb2 mb-rej" onclick="delCoupon('${c.id}')">حذف</button></div></div>`).join('');
}
export function openAddCoupon() {
  document.getElementById('coupon-modal-title').textContent = '➕ إضافة قسيمة';
  ['ac2-id','ac2-code','ac2-badge','ac2-icon','ac2-title','ac2-desc','ac2-order','ac2-expiry'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('add-coupon-modal').classList.add('open');
}
export function editCoupon(c) {
  document.getElementById('coupon-modal-title').textContent = '✏️ تعديل قسيمة';
  document.getElementById('ac2-id').value = c.id;
  document.getElementById('ac2-code').value = c.code||'';
  document.getElementById('ac2-badge').value = c.badge||'';
  document.getElementById('ac2-icon').value = c.icon||'';
  document.getElementById('ac2-title').value = c.title||'';
  document.getElementById('ac2-desc').value = c.description||'';
  document.getElementById('ac2-order').value = c.order??'';
  document.getElementById('ac2-expiry').value = c.expiryDate||'';
  document.getElementById('add-coupon-modal').classList.add('open');
}
export async function saveCoupon() {
  const id = document.getElementById('ac2-id').value;
  const title = document.getElementById('ac2-title').value.trim();
  const code = document.getElementById('ac2-code').value.trim().toUpperCase();
  if (!title || !code) { showToast('اكتب العنوان والكود', 'err'); return; }
  const data = {
    title, code,
    badge: document.getElementById('ac2-badge').value.trim(),
    icon: document.getElementById('ac2-icon').value.trim(),
    description: document.getElementById('ac2-desc').value.trim(),
    order: parseInt(document.getElementById('ac2-order').value) || 0,
    expiryDate: document.getElementById('ac2-expiry').value || null,
    active: true
  };
  try {
    if (id) await updateDoc(doc(db,'coupons',id), data);
    else await addDoc(collection(db,'coupons'), { ...data, createdAt: serverTimestamp() });
    showToast('✅ تم الحفظ', 'ok');
    closeModal('add-coupon-modal');
  } catch(e) { showToast('حدث خطأ', 'err'); }
}
export async function delCoupon(id) {
  try { await deleteDoc(doc(db,'coupons',id)); showToast('🗑️ تم حذف القسيمة', 'ok'); }
  catch(e) { showToast('حدث خطأ', 'err'); }
}


// ===== تصفير أعلام المتابعة عند تسجيل الخروج (بيتنفذ من utils.js عبر clearAllListeners) =====
onListenersCleared(() => {
  adminOrdersUnsub = null; adminUsersUnsub = null; auditLogUnsub = null; smProdsUnsub = null;
});
