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
  DRIVER_ASSIGNED: 'driver_assigned',
  DRIVER_ARRIVED: 'driver_arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

// خريطة الانتقالات المسموحة - نفس فلسفة ORDER_TRANSITIONS في orders.js تمامًا (تصميم قابل
// لإعادة الاستخدام)، بس بحالات المشوار. مش متربطة بأي Transaction أو تنفيذ فعلي حاليًا.
export const RIDE_TRANSITIONS = {
  [RIDE_STATUS.REQUESTED]:       [RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.CANCELLED],
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

import { db, collection, addDoc, serverTimestamp } from './firebase.js';
import { showToast, showScreen, RIDE_ELIGIBLE_VEHICLES } from './utils.js';
import { getPricingConfig, calculateFare } from './pricing.js';
import { _distMeters } from './driver.js';
import { reverseGeocode } from './orders.js';

let rrMap = null;
let rrPickup = null;   // {lat,lng}
let rrDropoff = null;  // {lat,lng}
let rrMarkerPickup = null;
let rrMarkerDropoff = null;
let rrVehicleType = null;
let rrPricingSnapshot = null;
let rrDistanceKm = null;

function rrReset() {
  rrPickup = null; rrDropoff = null; rrVehicleType = null;
  rrPricingSnapshot = null; rrDistanceKm = null;
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

  // ===== Distance Validation (المهمة 7) =====
  const distMeters = _distMeters(rrPickup.lat, rrPickup.lng, rrDropoff.lat, rrDropoff.lng);
  const distanceKm = distMeters / 1000;
  if (!distanceKm || distanceKm <= 0 || isNaN(distanceKm) || !isFinite(distanceKm)) {
    showToast('لا يمكن تحديد نفس النقطة كبداية ونهاية', 'err');
    resetRideRequest();
    return;
  }

  // ===== Pricing Integration (المهمة 4) — بدون أي Default أو رقم Hardcoded =====
  // قراءة واحدة بس لـ settings/pricing (بدل قراءتين) عشان نقدر نتحقق من maxDistanceKm
  // قبل ما نعتمد السعر، ونستخدم calculateFare() اللي هي نفسها المحرك المشترك.
  let pricingCfg, fare;
  try {
    pricingCfg = await getPricingConfig();
    if (!pricingCfg.ride) throw new Error('pricing-missing-ride');
  } catch (e) {
    showToast('خدمة المشاوير غير متاحة حاليًا', 'err');
    console.error('[rides] pricing config missing:', e);
    resetRideRequest();
    return;
  }

  // ===== Maximum Distance (المهمة 8) — القيمة من Settings فقط =====
  if (!isWithinMaxDistance(distanceKm, pricingCfg.ride)) {
    showToast('المسافة خارج نطاق الخدمة', 'err');
    resetRideRequest();
    return;
  }

  fare = calculateFare(pricingCfg, 'ride', { distanceKm });

  rrDistanceKm = Math.round(distanceKm * 100) / 100;
  rrPricingSnapshot = fare;
  if (priceCard) {
    document.getElementById('rr-distance-val').textContent = rrDistanceKm + ' كم';
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
      distanceKm: rrDistanceKm,
      pricingSnapshot: rrPricingSnapshot,
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, RIDES_COLLECTION), rideDoc);
    showToast('تم إنشاء طلب المشوار بنجاح', 'ok');
    resetRideRequest();
    showScreen('screen-customer');
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
