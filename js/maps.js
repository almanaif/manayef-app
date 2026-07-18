// ===== maps.js — خرائط Leaflet (تتبع الطلب، خريطة المندوب، خريطة الأدمن) =====

import { DEFAULT_LOC, STORE_LOC, db, doc } from './firebase.js';
import { onListenersCleared, onSnapshot } from './utils.js';

// ===== MAPS =====
export let trackDriverUnsub = null;
export function initTrackMap(ordData) {
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

export function toggleDriverMap() {
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

export function initAdminMap(drivers=[]) {
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


// ===== تصفير أعلام المتابعة عند تسجيل الخروج (بيتنفذ من utils.js عبر clearAllListeners) =====
export function registerMapsResets() {
  onListenersCleared(() => {
  trackDriverUnsub = null;
  });
}
