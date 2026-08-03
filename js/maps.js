// ===== maps.js — خرائط MapLibre GL JS (Phase 4B: استبدل Leaflet بالكامل) =====
// كل الخرائط في المشروع (تتبع طلب التوصيل، طلب مشوار، حالة مشوار، خريطة المندوب، خريطة
// الأدمن، خريطة تسجيل مندوب جديد) بتستخدم MapLibre GL JS + OpenFreeMap Vector Tiles دلوقتي.
// نقطة واحدة للـ Style (OPENFREEMAP_STYLE) - أي تغيير مستقبلي للـ Style بيتم من هنا بس.
// ممنوع Mapbox، وممنوع Leaflet في أي مكان بعد دلوقتي (زي ما اتحدد صراحة في Phase 4B).

import { DEFAULT_LOC, STORE_LOC, db, doc } from './firebase.js';
import { onListenersCleared, onSnapshot } from './utils.js';
import { decodePolyline } from './routing.js';

// ===== OpenFreeMap Style (الـ Style الرسمي - liberty) =====
export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// ===== أدوات مشتركة =====
// كل إحداثيات المشروع مخزّنة {lat,lng} أو [lat,lng] (نفس نظام Leaflet القديم) - MapLibre
// بياخد [lng,lat] (GeoJSON)، فأي نقطة بتتحول هنا بس قبل ما توصل لأي MapLibre API.
function toLngLat(pt) {
  if (Array.isArray(pt)) return [pt[1], pt[0]]; // [lat,lng] -> [lng,lat]
  return [pt.lng, pt.lat];
}

// ماركر بإيموجي (بديل L.divIcon) - بيرجع الـ Marker instance عشان تقدر تحرّكه/تشيله بعدين.
export function createEmojiMarker(map, pt, emoji, size = 26) {
  if (!map || typeof maplibregl === 'undefined') return null;
  const el = document.createElement('div');
  el.style.fontSize = size + 'px';
  el.style.lineHeight = '1';
  el.textContent = emoji;
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(toLngLat(pt)).addTo(map);
}

// رسم مسار من Encoded Polyline مخزّن (decodePolyline من routing.js - صفر Routing جديد هنا).
// بيرجع true لو اترسم فعلاً، عشان اللي بينده يقرر يعمل fitBounds ولا لأ.
export function drawEncodedRoute(map, encodedPolyline, sourceId) {
  if (!map || !encodedPolyline) return false;
  const points = decodePolyline(encodedPolyline); // [[lat,lng], ...]
  if (!points.length) return false;
  const coords = points.map(p => [p[1], p[0]]); // -> [lng,lat] لـ GeoJSON
  const geojson = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(geojson);
  } else {
    map.addSource(sourceId, { type: 'geojson', data: geojson });
    map.addLayer({
      id: sourceId + '-layer', type: 'line', source: sourceId,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#FF6B00', 'line-width': 4, 'line-opacity': 0.85 },
    });
  }
  return true;
}
export function removeRoute(map, sourceId) {
  if (!map) return;
  if (map.getLayer(sourceId + '-layer')) map.removeLayer(sourceId + '-layer');
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}
function fitToPoints(map, pts) {
  if (!map || !pts.length) return;
  const bounds = pts.reduce((b, p) => b.extend(toLngLat(p)), new maplibregl.LngLatBounds(toLngLat(pts[0]), toLngLat(pts[0])));
  map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
}

// =====================================================================================
// ===== TRACKING MAP (Delivery - زي ما هي بالظبط، Leaflet -> MapLibre بس) =====
// =====================================================================================
export let trackDriverUnsub = null;
export function initTrackMap(ordData) {
  if (window.trackMap) { window.trackMap.remove(); window.trackMap = null; }
  window.driverMarker = null; window.customerMarker = null;
  if (typeof maplibregl === 'undefined') return;
  window.trackMap = new maplibregl.Map({
    container: 'tracking-map', style: OPENFREEMAP_STYLE,
    center: toLngLat(STORE_LOC), zoom: 14, attributionControl: false,
  });
  window.trackMap.on('load', () => {
    createEmojiMarker(window.trackMap, STORE_LOC, '🏪');
    if (window.userLat) {
      window.customerMarker = createEmojiMarker(window.trackMap, [window.userLat, window.userLng], '📍');
    }
    if (trackDriverUnsub) { try { trackDriverUnsub(); } catch (e) {} trackDriverUnsub = null; }
    if (ordData?.driverId) {
      trackDriverUnsub = onSnapshot(doc(db, 'users', ordData.driverId), snap => {
        const d = snap.data();
        if (d?.lat && d?.lng) {
          if (!window.driverMarker) {
            window.driverMarker = createEmojiMarker(window.trackMap, [d.lat, d.lng], '🛵');
          } else {
            window.driverMarker.setLngLat([d.lng, d.lat]);
          }
        }
      });
    }
  });
}

// =====================================================================================
// ===== DRIVER MAP (خريطة المندوب الشخصية - Idle / Ride Mode) =====
// =====================================================================================
// Idle: موقع المندوب بس. Ride: + Pickup + Route. نفس الخريطة (#driver-map) في الحالتين -
// بترجع تلقائيًا للوضع الطبيعي (Idle) لما المشوار يخلص (completed/cancelled).
let drvSelfMarker = null;
let drvPickupMarker = null;
let driverMapRideData = null; // لو موجودة، يبقى فيه مشوار جاري - نستخدمها وقت إنشاء الخريطة لو اتفتحت أثناء مشوار

export function toggleDriverMap() {
  const sec = document.getElementById('drv-map-sec');
  const show = sec.style.display === 'none';
  sec.style.display = show ? 'block' : 'none';
  if (show && !window.drvMap && typeof maplibregl !== 'undefined') {
    setTimeout(() => {
      window.drvMap = new maplibregl.Map({
        container: 'driver-map', style: OPENFREEMAP_STYLE,
        center: toLngLat(DEFAULT_LOC), zoom: 14, attributionControl: false,
      });
      drvSelfMarker = null; drvPickupMarker = null;
      window.drvMap.on('load', () => {
        if (typeof window.driverLat === 'number' && typeof window.driverLng === 'number') {
          drvSelfMarker = createEmojiMarker(window.drvMap, [window.driverLat, window.driverLng], '🛵');
        }
        if (driverMapRideData) applyDriverMapRideMode(driverMapRideData);
      });
    }, 100);
  }
}

// بتتنده من driver.js في كل نبضة GPS (بعد نفس منطق throttle الحالي - صفر كتابات إضافية) عشان
// تحرّك نقطة المندوب على خريطته الشخصية، سواء في وضع Idle أو Ride.
export function updateDriverSelfLocation(lat, lng) {
  if (!window.drvMap) return;
  if (!drvSelfMarker) { drvSelfMarker = createEmojiMarker(window.drvMap, [lat, lng], '🛵'); }
  else { drvSelfMarker.setLngLat([lng, lat]); }
}

function applyDriverMapRideMode(rideData) {
  if (!window.drvMap) return;
  if (drvPickupMarker) { drvPickupMarker.remove(); drvPickupMarker = null; }
  if (rideData?.pickup) drvPickupMarker = createEmojiMarker(window.drvMap, rideData.pickup, '🟢');
  if (rideData?.routeGeometry) drawEncodedRoute(window.drvMap, rideData.routeGeometry, 'drv-ride-route');
}

// بتتنده من rides.js لما المندوب يبقى عنده مشوار جاري (driver_assigned/driver_arrived/in_progress)
export function setDriverMapRideMode(rideData) {
  driverMapRideData = rideData;
  if (window.drvMap && window.drvMap.loaded && window.drvMap.loaded()) applyDriverMapRideMode(rideData);
}

// بتتنده من rides.js لما المشوار يخلص (completed/cancelled) - رجوع تلقائي للوضع الطبيعي
export function setDriverMapIdleMode() {
  driverMapRideData = null;
  if (!window.drvMap) return;
  if (drvPickupMarker) { drvPickupMarker.remove(); drvPickupMarker = null; }
  removeRoute(window.drvMap, 'drv-ride-route');
}

// =====================================================================================
// ===== ADMIN MAP =====
// =====================================================================================
// المناديب (زي ما هي) + المشاوير الجارية فوقها (Pickup/Dropoff/Route/Driver Live Location) -
// كله من البيانات المخزّنة بالفعل، صفر Routing جديد (routeGeometry مخزّنة من وقت إنشاء المشوار).
let admRouteSources = [];
export function initAdminMap(drivers = [], rides = []) {
  if (window.admMap) { window.admMap.remove(); window.admMap = null; }
  if (typeof maplibregl === 'undefined') return;
  admRouteSources = [];
  setTimeout(() => {
    window.admMap = new maplibregl.Map({
      container: 'admin-map', style: OPENFREEMAP_STYLE,
      center: toLngLat(DEFAULT_LOC), zoom: 13, attributionControl: true,
    });
    window.admMap.on('load', () => {
      drivers.forEach(d => {
        if (typeof d.lat === 'number' && typeof d.lng === 'number') createEmojiMarker(window.admMap, [d.lat, d.lng], '🛵');
      });
      rides.forEach((r, i) => {
        if (r.pickup) createEmojiMarker(window.admMap, r.pickup, '🟢', 22);
        if (r.dropoff) createEmojiMarker(window.admMap, r.dropoff, '🔴', 22);
        if (r.driverLocation) createEmojiMarker(window.admMap, r.driverLocation, '🛵', 22);
        if (r.routeGeometry) {
          const sid = 'adm-ride-route-' + i;
          if (drawEncodedRoute(window.admMap, r.routeGeometry, sid)) admRouteSources.push(sid);
        }
      });
    });
  }, 150);
}

// =====================================================================================
// ===== RIDE STATUS MAP (Customer - Phase 4B: جديد بالكامل) =====
// =====================================================================================
// Pickup + Dropoff + Route (كلهم من ride doc، مخزّنين من وقت الإنشاء) + Driver Live Location
// (rides/{rideId}.driverLocation - Phase 4B، بديل قراءة users/{driverId} القديمة للمشاوير).
let rsMap = null;
let rsDriverMarker = null;
export function initRideStatusMap(rideData) {
  clearRideStatusMap();
  if (typeof maplibregl === 'undefined' || !rideData?.pickup) return;
  rsMap = new maplibregl.Map({
    container: 'ride-status-map', style: OPENFREEMAP_STYLE,
    center: toLngLat(rideData.pickup), zoom: 13, attributionControl: false,
  });
  rsMap.on('load', () => {
    if (!rsMap) return; // ممكن اتشالت قبل ما الـ load event يحصل (تغيير سريع للشاشة)
    createEmojiMarker(rsMap, rideData.pickup, '🟢');
    if (rideData.dropoff) createEmojiMarker(rsMap, rideData.dropoff, '🔴');
    if (rideData.routeGeometry) drawEncodedRoute(rsMap, rideData.routeGeometry, 'rs-route');
    fitToPoints(rsMap, [rideData.pickup, rideData.dropoff].filter(Boolean));
    if (rideData.driverLocation) rsDriverMarker = createEmojiMarker(rsMap, rideData.driverLocation, '🛵');
  });
}
export function updateRideStatusDriverLocation(loc) {
  if (!rsMap || !loc) return;
  if (!rsDriverMarker) { rsDriverMarker = createEmojiMarker(rsMap, loc, '🛵'); }
  else { rsDriverMarker.setLngLat([loc.lng, loc.lat]); }
}
export function clearRideStatusMap() {
  if (rsMap) { rsMap.remove(); rsMap = null; }
  rsDriverMarker = null;
}

// =====================================================================================
// ===== DRIVER REGISTRATION LOCATION MAP =====
// =====================================================================================
export function initDriverRegLocationMap(lat, lng) {
  if (typeof maplibregl === 'undefined') return;
  if (window._locMap) { window._locMap.remove(); window._locMap = null; }
  window._locMap = new maplibregl.Map({
    container: 'loc-map', style: OPENFREEMAP_STYLE,
    center: [lng, lat], zoom: 16, attributionControl: false,
  });
  window._locMap.on('load', () => { createEmojiMarker(window._locMap, [lat, lng], '📍'); });
}

// ===== تصفير أعلام المتابعة عند تسجيل الخروج (بيتنفذ من utils.js عبر clearAllListeners) =====
export function registerMapsResets() {
  onListenersCleared(() => {
    trackDriverUnsub = null;
    drvSelfMarker = null; drvPickupMarker = null; driverMapRideData = null;
    admRouteSources = [];
    clearRideStatusMap();
  });
}
