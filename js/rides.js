// ===== rides.js — Ride Service: Architecture Foundation فقط (Phase 2) =====
// الملف ده مقصود يكون منفصل تمامًا عن orders.js (State Machine مستقلة للمشاوير، زي ما
// اتحدد صراحة)، عشان محدش يحتاج يلمس Delivery State Machine وقت ما Ride Lifecycle يتنفذ لاحقًا.
//
// مهم جدًا: الملف ده تصميم بس. مفيهوش:
// - أي كود بيكتب/يقرأ من Firestore (مفيش collection('rides') ولا addDoc ولا onSnapshot هنا).
// - أي دالة بتنفذ انتقال فعلي أو تربط حالة بطلب/مندوب حقيقي.
// - أي استدعاء من أي شاشة في الواجهة حاليًا (الملف مش متستورد من أي مكان لسه، ده متعمد).
// هيتفعّل ويتربط فعليًا بس وقت ما Ride Lifecycle Phase تبدأ صراحة.

// اسم الـ Collection المستقبلي (تعريف بس، مفيش استخدام فعلي للـ Firestore هنا)
export const RIDES_COLLECTION = 'rides';

// حالات المشوار المقترحة - أبسط من Delivery عمدًا لأن مفيش تاجر في السلسلة خالص
// (مفيش waiting_merchant / merchant_accepted / merchant_rejected)
export const RIDE_STATUS = {
  REQUESTED: 'requested',
  DRIVER_OFFERED: 'driver_offered',
  DRIVER_ASSIGNED: 'driver_assigned',
  DRIVER_ARRIVED: 'driver_arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

// خريطة الانتقالات المسموحة - نفس فلسفة ORDER_TRANSITIONS في orders.js تمامًا (تصميم قابل
// لإعادة الاستخدام)، بس بحالات المشوار. مش متربطة بأي Transaction أو تنفيذ فعلي حاليًا.
export const RIDE_TRANSITIONS = {
  [RIDE_STATUS.REQUESTED]:       [RIDE_STATUS.DRIVER_OFFERED, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.DRIVER_OFFERED]:  [RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.REQUESTED, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.DRIVER_ASSIGNED]: [RIDE_STATUS.DRIVER_ARRIVED, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.DRIVER_ARRIVED]:  [RIDE_STATUS.IN_PROGRESS, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.IN_PROGRESS]:     [RIDE_STATUS.COMPLETED], // بعد بدء الرحلة، مفيش رجوع أو إلغاء
  [RIDE_STATUS.COMPLETED]:       [], // نهائية
  [RIDE_STATUS.CANCELLED]:       [], // نهائية
};

// دالة تحقق نقية (Pure Function) بس - زي canTransition في orders.js، بدون أي أثر جانبي.
// جاهزة تُستخدم وقت ما transitionRide() فعلية تتكتب في مرحلة Ride Lifecycle.
export function canTransitionRide(fromStatus, toStatus) {
  const allowed = RIDE_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

// حد أقصى للمسافة (كم) - القيمة من settings/pricing.ride.maxDistanceKm فقط (مفيش رقم Hardcoded).
export function isWithinMaxDistance(distanceKm, pricingRideCfg) {
  const max = Number(pricingRideCfg?.maxDistanceKm);
  if (!max || max <= 0) return true; // لو مش متحدد حد أقصى في الإعدادات، مفيش تقييد
  return Number(distanceKm) <= max;
}

// ===== Phase 3A — Ride Request Creation (تنفيذ فعلي) =====
// كل الكود من هنا لتحت هو أول تنفيذ حقيقي. لسه: صفر Dispatch، صفر Notification للمندوب،
// صفر تغيير حالة بعد الإنشاء. الهدف الوحيد: العميل يحدد نقطتين، يشوف السعر، ويأكد.

import { db, collection, addDoc, getDoc, getDocs, updateDoc, doc, query, where, onSnapshot, runTransaction, arrayUnion, serverTimestamp } from './firebase.js';
import { showToast, showScreen, RIDE_ELIGIBLE_VEHICLES } from './utils.js';
import { getPricingConfig, calculateFare } from './pricing.js';
import { _distMeters } from './driver.js';
import { reverseGeocode } from './orders.js';
import { getRoute } from './routing.js';

// أقصى عدد سائقين مرشحين لكل محاولة Dispatch - القيمة دي معمارية (جزء من التصميم المعتمد)
// مش تسعير، فمكانها هنا صح مش في settings/pricing.
const MAX_CANDIDATE_DRIVERS = 3;
// سقف صريح لطول dispatchLog عشان يفضل محدود (زي ما اتطلب صراحة)
const MAX_DISPATCH_LOG = 20;

function trimLog(log, entry) {
  return [...(Array.isArray(log) ? log : []), entry].slice(-MAX_DISPATCH_LOG);
}

let rrMap = null;
let rrPickup = null;   // {lat,lng}
let rrDropoff = null;  // {lat,lng}
let rrMarkerPickup = null;
let rrMarkerDropoff = null;
let rrVehicleType = null;
let rrPricingSnapshot = null;
let rrDistanceKm = null;
let rrTripEtaMinutes = null;  // Phase 4: ETA المتوقع للمشوار بالكامل، من Routing Engine
let rrRouteGeometry = null;   // Phase 4: Encoded Polyline لمسار الطريق الفعلي

function rrReset() {
  rrPickup = null; rrDropoff = null; rrVehicleType = null;
  rrPricingSnapshot = null; rrDistanceKm = null; rrTripEtaMinutes = null; rrRouteGeometry = null;
  rrMarkerPickup = null; rrMarkerDropoff = null;
  const vSel = document.getElementById('rr-vehicle'); if (vSel) vSel.value = '';
  const priceCard = document.getElementById('rr-price-card'); if (priceCard) priceCard.style.display = 'none';
  const confirmBtn = document.getElementById('rr-confirm-btn'); if (confirmBtn) confirmBtn.disabled = true;
  rrUpdateStepLabel();
}

// شاشة الدخول لطلب مشوار - بتتفتح من زرار في الرئيسية
export function openRideRequest() {
  if (!window.CU) { showScreen('screen-entry'); return; }
  showScreen('screen-ride-request');
  rrReset();
  if (typeof L === 'undefined') { showToast('تعذر تحميل الخريطة', 'err'); return; }
  if (rrMap) { rrMap.remove(); rrMap = null; }
  rrMap = L.map('ride-request-map', { zoomControl: false, attributionControl: false })
    .setView(window.userLat && window.userLng ? [window.userLat, window.userLng] : [30.5965, 32.2715], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(rrMap);
  rrMap.on('click', rrHandleMapClick);
}

function rrUpdateStepLabel() {
  const lbl = document.getElementById('rr-step-label');
  if (!lbl) return;
  if (!rrPickup) lbl.textContent = 'اضغط على الخريطة لتحديد نقطة الانطلاق';
  else if (!rrDropoff) lbl.textContent = 'اضغط على الخريطة لتحديد نقطة الوصول';
  else lbl.textContent = 'تم تحديد النقطتين - اختر نوع المركبة';
}

function rrHandleMapClick(e) {
  const { lat, lng } = e.latlng;
  if (!rrPickup) {
    rrPickup = { lat, lng };
    const icon = L.divIcon({ html: '<div style="font-size:26px;line-height:1">🟢</div>', className: '', iconSize: [30, 30] });
    rrMarkerPickup = L.marker([lat, lng], { icon }).addTo(rrMap);
  } else if (!rrDropoff) {
    rrDropoff = { lat, lng };
    const icon = L.divIcon({ html: '<div style="font-size:26px;line-height:1">🔴</div>', className: '', iconSize: [30, 30] });
    rrMarkerDropoff = L.marker([lat, lng], { icon }).addTo(rrMap);
    rrComputePrice(); // النقطتين اتحددوا - نحسب المسافة والسعر فورًا
  }
  rrUpdateStepLabel();
}

export function resetRideRequest() {
  if (rrMarkerPickup) { rrMap?.removeLayer(rrMarkerPickup); }
  if (rrMarkerDropoff) { rrMap?.removeLayer(rrMarkerDropoff); }
  rrReset();
}

async function rrComputePrice() {
  const priceCard = document.getElementById('rr-price-card');
  const confirmBtn = document.getElementById('rr-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;

  // ===== فحص محلي رخيص قبل أي طلب شبكة (نفس النقطة بداية ونهاية) — Haversine هنا للفحص
  // السريع بس، مش للتسعير ولا لتخزينه. صفر طلب Routing لو أصلاً النقطتين متطابقتين. =====
  const straightMeters = _distMeters(rrPickup.lat, rrPickup.lng, rrDropoff.lat, rrDropoff.lng);
  if (!straightMeters || straightMeters <= 0 || isNaN(straightMeters) || !isFinite(straightMeters)) {
    showToast('لا يمكن تحديد نفس النقطة كبداية ونهاية', 'err');
    resetRideRequest();
    return;
  }

  // ===== Pricing Integration — بدون أي Default أو رقم Hardcoded =====
  let pricingCfg;
  try {
    pricingCfg = await getPricingConfig();
    if (!pricingCfg.ride) throw new Error('pricing-missing-ride');
  } catch (e) {
    showToast('خدمة المشاوير غير متاحة حاليًا', 'err');
    console.error('[rides] pricing config missing:', e);
    resetRideRequest();
    return;
  }

  // ===== Actual Road Distance + ETA + Geometry (Phase 4 - Routing Service Layer) =====
  // القرار المعتمد: صفر Haversine في التسعير، وصفر Fallback لو فشل الـ Routing — لو الطلب
  // فشل (شبكة/Timeout/مفيش مسار)، مفيش سعر بيتحسب ومفيش مشوار بيتعمل، بس رسالة واضحة.
  let route;
  try {
    route = await getRoute(rrPickup, rrDropoff);
  } catch (e) {
    console.error('[rides] routing failed:', e);
    showToast('تعذر حساب مسار الطريق حاليًا، حاول مرة أخرى', 'err');
    resetRideRequest();
    return;
  }

  // ===== Maximum Distance — بيتحقق على المسافة الفعلية للطريق دلوقتي، مش الخط المستقيم =====
  if (!isWithinMaxDistance(route.distanceKm, pricingCfg.ride)) {
    showToast('المسافة خارج نطاق الخدمة', 'err');
    resetRideRequest();
    return;
  }

  const fare = calculateFare(pricingCfg, 'ride', {
    distanceKm: route.distanceKm,
    estimatedDurationMinutes: route.durationMinutes,
  });

  rrDistanceKm = route.distanceKm;
  rrTripEtaMinutes = route.durationMinutes;
  rrRouteGeometry = route.polyline;
  rrPricingSnapshot = fare;
  if (priceCard) {
    document.getElementById('rr-distance-val').textContent = rrDistanceKm + ' كم';
    const etaEl = document.getElementById('rr-eta-val');
    if (etaEl) etaEl.textContent = rrTripEtaMinutes + ' دقيقة';
    document.getElementById('rr-price-val').textContent = fare.finalFare + ' ج';
    priceCard.style.display = 'block';
  }
  rrCheckReady();
}

export function selectRideVehicle(type) {
  rrVehicleType = type;
  rrCheckReady();
}

function rrCheckReady() {
  const confirmBtn = document.getElementById('rr-confirm-btn');
  if (!confirmBtn) return;
  const ok = rrPickup && rrDropoff && rrPricingSnapshot && rrVehicleType && RIDE_ELIGIBLE_VEHICLES.includes(rrVehicleType);
  confirmBtn.disabled = !ok;
}

// ===== إنشاء المشوار الفعلي (المهمة 5+6+8) =====
export async function createRideRequest() {
  if (!window.CU) { showScreen('screen-entry'); return; }
  // إعادة تحقق كاملة قبل الكتابة - مانعتمدش إن الواجهة عطلت الزرار صح بس
  if (!rrPickup || !rrDropoff) { showToast('حدد نقطة الانطلاق والوصول أولاً', 'err'); return; }
  if (!rrVehicleType || !RIDE_ELIGIBLE_VEHICLES.includes(rrVehicleType)) {
    showToast('اختر نوع مركبة صحيح', 'err'); return;
  }
  if (!rrDistanceKm || rrDistanceKm <= 0 || isNaN(rrDistanceKm) || !isFinite(rrDistanceKm)) {
    showToast('المسافة غير صالحة، أعد التحديد', 'err'); return;
  }
  if (!rrPricingSnapshot) { showToast('السعر غير محسوب، أعد التحديد', 'err'); return; }
  // Phase 4: نفس فلسفة rrPricingSnapshot فوق - لو المسار (Geometry/ETA) مش موجود لأي سبب،
  // مانكملش، لأن القرار المعتمد إن Road Distance/ETA/Geometry لازم تكون موجودة قبل إنشاء أي Ride.
  if (!rrRouteGeometry || rrTripEtaMinutes == null) {
    showToast('بيانات المسار غير مكتملة، أعد التحديد', 'err'); return;
  }

  const btn = document.getElementById('rr-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    const [pGeo, dGeo] = await Promise.all([
      reverseGeocode(rrPickup.lat, rrPickup.lng),
      reverseGeocode(rrDropoff.lat, rrDropoff.lng),
    ]);
    const rideDoc = {
      customerId: window.CU.uid,
      pickup: { lat: rrPickup.lat, lng: rrPickup.lng, address: pGeo.address || null },
      dropoff: { lat: rrDropoff.lat, lng: rrDropoff.lng, address: dGeo.address || null },
      vehicleType: rrVehicleType,
      status: RIDE_STATUS.REQUESTED,
      driverId: null, // Phase 3B: لازم يكون موجود من الإنشاء عشان قواعد Dispatch تتحقق منه
      distanceKm: rrDistanceKm, // Actual Road Distance (Phase 4 - Routing Service Layer، مش Haversine)
      tripEtaMinutes: rrTripEtaMinutes, // Trip ETA - الوقت المتوقع للمشوار بالكامل
      routeGeometry: rrRouteGeometry,   // Encoded Polyline لمسار الطريق - Immutable بعد الإنشاء
      routingProvider: 'osrm-public-demo', // للتوثيق/التتبع فقط - نفس القيمة اللي routing.js بترجعها
      pricingSnapshot: rrPricingSnapshot,
      createdAt: serverTimestamp(),
    };
    const rideRef = await addDoc(collection(db, RIDES_COLLECTION), rideDoc);
    resetRideRequest();
    rsShowStatus(rideRef.id, RIDE_STATUS.REQUESTED);
    showScreen('screen-ride-status');
    dispatchRide(rideRef.id); // فور الإنشاء - نفس Client، صفر Orchestrator منفصل (زي التصميم المعتمد)
  } catch (e) {
    console.error('[createRideRequest] failed:', e);
    showToast('حدث خطأ أثناء إنشاء الطلب، حاول مرة أخرى', 'err');
    if (btn) btn.disabled = false;
  }
}
// TECH DEBT (مسجل صراحة زي ما اتطلب): السعر النهائي هنا بيتحقق منه Client-side بس عن طريق
// previewFare(). Server-side expectedFare validation لمشاوير (مكافئ calculatePrice في
// firestore.rules الموجودة للتوصيل) لسه ملقتش تنفيذها في Phase 3A ده - محتاجة إضافة قبل أي
// تفعيل حقيقي لـ Dispatch/Finance، تمامًا زي ما orders.js بيعمل بالفعل.
// Future Improvement: Ride pricing validation requires server-side verification before production dispatch.
// ملاحظة: الفجوة دي اتقفلت فعليًا في Phase 3A Security Hardening (rideFareOk/rideDistanceOk
// في firestore.rules) - التعليق فوق اتسيب زي ما هو كسجل تاريخي بس.

// ===== Phase 3B — Driver Dispatch (Ranked Limited Broadcast) =====
// التصميم المعتمد: أقرب 3 سائقين مؤهلين بس، بث ليهم سويًا، أول Accept ناجح بـ Transaction يفوز.
// صفر Timeout، صفر Background Service، صفر Cloud Function - العميل نفسه (لسه حاضر فعليًا وقت
// الإنشاء) هو اللي بيبدأ أول محاولة Dispatch، وأي رجوع لـ requested بعد رفض الكل بيتم من نفس
// Client السائق اللي رفض آخر رفض (حاضر فعليًا وقتها هو كمان) - صفر حاجة محتاجة "تراقب" وقت.

export async function dispatchRide(rideId) {
  const rideRef = doc(db, RIDES_COLLECTION, rideId);
  const rideSnap = await getDoc(rideRef);
  if (!rideSnap.exists()) return;
  const ride = rideSnap.data();
  if (ride.status !== RIDE_STATUS.REQUESTED) return; // مش وقتها - حد تاني سبقنا أو الحالة اتغيرت

  // ===== Driver Selection (المهمة 2) — Query بسيط بدون vehicleType (مفيش فهرسة زيادة)،
  // فلترة النوع + الترتيب بالمسافة بيحصلوا Client-side =====
  // ملحوظة معمارية صريحة (Phase 4): الترتيب هنا بيستخدم Haversine (_distMeters) عمدًا،
  // مش Actual Road Distance. القرار المعتمد: Routing Provider (routing.js) يُستخدم للتسعير
  // والـ ETA بس (راجع rrComputePrice فوق) — مش لترتيب السائقين، لأن حساب مسار فعلي لكل
  // سائق مرشح في كل محاولة Dispatch هيبقى عدد كبير من طلبات Routing بدون فائدة تشغيلية
  // حقيقية تستاهل التكلفة. Driver Dispatch نفسه غير معدّل في هذه المرحلة زي ما اتحدد صراحة.
  const q = query(collection(db, 'users'),
    where('role', '==', 'driver'),
    where('status', '==', 'active'),
    where('isOnline', '==', true),
    where('activeRideId', '==', null));
  const snap = await getDocs(q);

  const candidates = [];
  snap.forEach(d => {
    const u = d.data();
    if (!RIDE_ELIGIBLE_VEHICLES.includes(u.vehicleType)) return;
    if (typeof u.lat !== 'number' || typeof u.lng !== 'number') return; // مفيش موقع = مينفعش نرتبه بالمسافة
    const distM = _distMeters(ride.pickup.lat, ride.pickup.lng, u.lat, u.lng);
    candidates.push({ id: d.id, distM });
  });
  candidates.sort((a, b) => a.distM - b.distM);
  const top3 = candidates.slice(0, MAX_CANDIDATE_DRIVERS).map(c => c.id);

  if (top3.length === 0) {
    // لا يوجد سائقين مناسبين - الحالة تفضل requested زي ما هي (المهمة 3)
    rsSetLabel('لا يوجد سائقين متاحين حاليًا');
    rsShowRetry(true);
    return;
  }

  await updateDoc(rideRef, {
    status: RIDE_STATUS.DRIVER_OFFERED,
    candidateDriverIds: top3,
    rejectedDriverIds: [],
    offeredAt: serverTimestamp(),
    dispatchLog: trimLog(ride.dispatchLog, { event: 'dispatch_started', at: Date.now(), candidateCount: top3.length }),
  });
}

// إعادة محاولة يدوية من شاشة حالة المشوار - Recovery بسيط بدون أي Timer (المهمة 8)
export function retryDispatch() {
  if (!rsCurrentRideId) return;
  rsShowRetry(false);
  rsSetLabel('جاري البحث عن سائق...');
  dispatchRide(rsCurrentRideId);
}

// ===== Driver Accept (المهمة 5) — Transaction إلزامية =====
export async function acceptRideOffer() {
  if (!window.CU || !window.currentRideOfferId) return;
  const rideId = window.currentRideOfferId;
  const rideRef = doc(db, RIDES_COLLECTION, rideId);
  const driverRef = doc(db, 'users', window.CU.uid);

  // ===== Pickup ETA (Phase 4) — بيتحسب مرة واحدة قبل الـ Transaction، مش جواها، عشان مانديش
  // طلب Routing متكرر مع أي إعادة محاولة تحصل للـ Transaction نفسها لو فيه Contention. لو فشل
  // حساب الـ ETA (شبكة/مفيش موقع حالي للسائق)، القبول نفسه بيكمل عادي (Best-effort - زي فلسفة
  // GPS/notifications في باقي المشروع) لأن غياب رقم تقديري مش المفروض يمنع قبول مشوار حقيقي.
  let pickupEtaMinutes = null;
  try {
    const preSnap = await getDoc(rideRef);
    const preRide = preSnap.data();
    const driverLat = window.driverLat, driverLng = window.driverLng;
    if (preRide?.pickup && typeof driverLat === 'number' && typeof driverLng === 'number') {
      const pickupRoute = await getRoute({ lat: driverLat, lng: driverLng }, preRide.pickup);
      pickupEtaMinutes = pickupRoute.durationMinutes;
    }
  } catch (e) {
    console.error('[acceptRideOffer] pickup ETA calculation failed (non-fatal):', e);
  }

  try {
    await runTransaction(db, async (t) => {
      const [rideSnap, driverSnap] = await Promise.all([t.get(rideRef), t.get(driverRef)]);
      const ride = rideSnap.data();
      const drv = driverSnap.data();
      if (!ride || ride.status !== RIDE_STATUS.DRIVER_OFFERED) throw new Error('ride-not-offered');
      if (ride.driverId) throw new Error('already-assigned');
      if (!Array.isArray(ride.candidateDriverIds) || !ride.candidateDriverIds.includes(window.CU.uid)) throw new Error('not-a-candidate');
      if (!drv || drv.status !== 'active' || drv.isOnline !== true || drv.activeRideId) throw new Error('driver-not-eligible');
      const updatePayload = {
        driverId: window.CU.uid,
        status: RIDE_STATUS.DRIVER_ASSIGNED,
        dispatchLog: trimLog(ride.dispatchLog, { event: 'driver_accepted', driverId: window.CU.uid, at: Date.now() }),
      };
      // Pickup ETA (Trip ETA للوصول لنقطة الالتقاط) - حقل إضافي بس، مش من ضمن rideCoreUnchanged()
      // في firestore.rules، فإضافته هنا متوافقة مع القواعد الحالية بدون أي تعديل عليها.
      if (pickupEtaMinutes != null) updatePayload.pickupEtaMinutes = pickupEtaMinutes;
      t.update(rideRef, updatePayload);
      t.update(driverRef, { activeRideId: rideId });
    });
    showToast('تم قبول المشوار', 'ok');
    hideRideOfferBanner();
  } catch (e) {
    console.error('[acceptRideOffer] failed:', e);
    showToast('تعذر قبول المشوار (ربما اتاخد بالفعل)', 'err');
    hideRideOfferBanner();
  }
}

// ===== Driver Reject (المهمة 6) — Transaction برضه (منع Race بين رفضين في نفس اللحظة) =====
export async function rejectRideOffer() {
  if (!window.CU || !window.currentRideOfferId) return;
  const rideId = window.currentRideOfferId;
  const rideRef = doc(db, RIDES_COLLECTION, rideId);
  try {
    await runTransaction(db, async (t) => {
      const rideSnap = await t.get(rideRef);
      const ride = rideSnap.data();
      if (!ride || ride.status !== RIDE_STATUS.DRIVER_OFFERED) throw new Error('ride-not-offered');
      if (!Array.isArray(ride.candidateDriverIds) || !ride.candidateDriverIds.includes(window.CU.uid)) throw new Error('not-a-candidate');
      const already = Array.isArray(ride.rejectedDriverIds) ? ride.rejectedDriverIds : [];
      if (already.includes(window.CU.uid)) return; // رفض مسبقًا - لا حاجة لتكرار
      const newRejected = [...already, window.CU.uid];
      const log = trimLog(ride.dispatchLog, { event: 'driver_rejected', driverId: window.CU.uid, at: Date.now() });
      if (newRejected.length >= ride.candidateDriverIds.length) {
        // كل المرشحين رفضوا - رجوع لـ requested (المهمة 6)
        t.update(rideRef, { status: RIDE_STATUS.REQUESTED, candidateDriverIds: [], rejectedDriverIds: [], dispatchLog: log });
      } else {
        t.update(rideRef, { rejectedDriverIds: newRejected, dispatchLog: log });
      }
    });
  } catch (e) {
    console.error('[rejectRideOffer] failed:', e);
  }
  hideRideOfferBanner();
}

function hideRideOfferBanner() {
  window.currentRideOfferId = null;
  const b = document.getElementById('ride-offer-banner');
  if (b) b.style.display = 'none';
}

// ===== Driver Listener (المهمة 7) — السائق يشوف بس العروض الموجهة له بالاسم =====
let driverOfferUnsub = null;
export function listenRideOffers() {
  if (driverOfferUnsub || !window.CU) return;
  const q = query(collection(db, RIDES_COLLECTION),
    where('candidateDriverIds', 'array-contains', window.CU.uid),
    where('status', '==', RIDE_STATUS.DRIVER_OFFERED));
  driverOfferUnsub = onSnapshot(q, snap => {
    const offer = snap.docs[0]; // نظريًا سائق ممكن يكون مرشح لأكتر من طلب - بناخد أول واحد بس
    const banner = document.getElementById('ride-offer-banner');
    if (!banner) return;
    if (offer) {
      window.currentRideOfferId = offer.id;
      const d = offer.data();
      document.getElementById('ride-offer-txt').textContent =
        (d.distanceKm ? d.distanceKm + ' كم - ' : '') +
        (d.tripEtaMinutes ? '~' + d.tripEtaMinutes + ' د - ' : '') +
        (d.pricingSnapshot?.finalFare ? d.pricingSnapshot.finalFare + ' ج' : '');
      banner.style.display = 'flex';
    } else {
      hideRideOfferBanner();
    }
  });
}

// ===== Customer Status Screen (Recovery فقط - بدون خريطة/تتبع حي) =====
let rsCurrentRideId = null;
let rsUnsub = null;
const RS_LABELS = {
  [RIDE_STATUS.REQUESTED]: 'جاري البحث عن سائق...',
  [RIDE_STATUS.DRIVER_OFFERED]: 'تم إرسال العرض لأقرب السائقين، في انتظار الرد',
  [RIDE_STATUS.DRIVER_ASSIGNED]: 'تم تعيين مندوب لك ✅',
  [RIDE_STATUS.CANCELLED]: 'تم إلغاء المشوار',
};
function rsSetLabel(text) {
  const el = document.getElementById('rs-status-label');
  if (el) el.textContent = text;
}
function rsShowRetry(show) {
  const btn = document.getElementById('rs-retry-btn');
  if (btn) btn.style.display = show ? 'block' : 'none';
}
function rsShowStatus(rideId, initialStatus) {
  rsCurrentRideId = rideId;
  rsSetLabel(RS_LABELS[initialStatus] || initialStatus);
  rsShowRetry(false);
  if (rsUnsub) { rsUnsub(); rsUnsub = null; }
  rsUnsub = onSnapshot(doc(db, RIDES_COLLECTION, rideId), snap => {
    if (!snap.exists()) return;
    const d = snap.data();
    const st = d.status;
    let label = RS_LABELS[st] || st;
    // Pickup ETA (Phase 4) - بتتضاف للعميل بس بعد ما مندوب يتعين فعليًا ويتحسب الرقم بنجاح
    if (st === RIDE_STATUS.DRIVER_ASSIGNED && typeof d.pickupEtaMinutes === 'number') {
      label += ` — الوصول خلال ${d.pickupEtaMinutes} دقيقة تقريبًا`;
    }
    rsSetLabel(label);
    rsShowRetry(st === RIDE_STATUS.REQUESTED);
  });
}
