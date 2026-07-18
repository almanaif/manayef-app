// ===== notifications.js — الإشعارات داخل التطبيق =====

import { collection, db, query, where } from './firebase.js';
import { esc, onListenersCleared, onSnapshot } from './utils.js';

// ===== NOTIFICATIONS =====
export function addNotif(title, body, type='gn') {
  const list = document.getElementById('notif-list');
  const n = document.getElementById('notif-c');
  const count = parseInt(n.textContent)||0;
  n.textContent = count+1;
  list.insertAdjacentHTML('afterbegin', `<div class="ni"><div class="ni-dot ${esc(type)}"></div><div class="ni-info"><p>${esc(title)}</p><small>${esc(body)}</small></div></div>`);
}

export let notifListenerStarted = false;
export function startNotifListener() {
  if (notifListenerStarted || !window.CU) return;
  notifListenerStarted = true;
  const q = query(collection(db,'notifications'), where('userId','==',window.CU.uid));
  onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const d = change.doc.data();
        addNotif(d.title||'إشعار جديد', d.body||'', d.type||'gn');
      }
    });
  });
}


// ===== تصفير أعلام المتابعة عند تسجيل الخروج (بيتنفذ من utils.js عبر clearAllListeners) =====
export function registerNotificationsResets() {
  onListenersCleared(() => {
  notifListenerStarted = false;
  });
}
