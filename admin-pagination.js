// ===== admin-pagination.js — أدوات ترقيم (Pagination) عامة لقوائم لوحة الأدمن الطويلة =====
// جزء من Sprint 2.3 (Performance Review). الهدف: تقليل قراءات Firestore في الشاشات اللي
// بتعرض قوائم كبيرة (عملاء/مندوبين/تجار/طلبات) عبر limit()+startAfter() بدل تحميل الـ
// Collection كاملة، بدون أي فقدان للحظية (Real-time) في الصفحة اللي الأدمن شايفها فعليًا.
//
// القرار المعماري المعتمد (Sprint 2.3):
// - الصفحة الأولى: Live بالكامل (onSnapshot) - أي تغيير يحصل فيها بيتحدث فورًا في الواجهة.
// - "تحميل المزيد": بيجيب صفحة إضافية مرة واحدة (getDocs) مش Listener جديد - لو كل صفحة
//   فتحها الأدمن فضلت Live، كنا هنرجع لنفس مشكلة "عدد Listeners بلا حد" اللي السبرنت ده
//   أصلاً بيحاول يحلها. الصفحة الأولى (الأحدث) هي الأهم عمليًا للمتابعة اللحظية.
//
// مفيش استخدام لـ offset() في أي مكان هنا - بالكامل limit()+startAfter() زي ما هو متفق عليه.

import { onSnapshot as wrappedOnSnapshot } from './utils.js';
import { getDocs, limit, query, startAfter } from './firebase.js';

/**
 * @param {object} opts
 * @param {import('firebase/firestore').Query} opts.baseQuery - استعلام بدون limit/startAfter (فيه where/orderBy بس)
 * @param {number} opts.pageSize
 * @param {(docs: any[], meta: {isFirstPage: boolean, hasMore: boolean}) => void} opts.onPage
 * @returns {{ loadMore: () => Promise<boolean>, stop: () => void, restart: () => void }}
 */
export function createPaginatedListener({ baseQuery, pageSize, onPage }) {
  let unsub = null;
  let lastDoc = null;
  let stopped = false;

  function start() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    stopped = false;
    lastDoc = null;
    const q = query(baseQuery, limit(pageSize));
    unsub = wrappedOnSnapshot(q, snap => {
      if (stopped) return;
      lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      onPage(snap.docs, { isFirstPage: true, hasMore: snap.docs.length === pageSize });
    }, () => {});
  }

  async function loadMore() {
    if (!lastDoc || stopped) return false;
    const q = query(baseQuery, startAfter(lastDoc), limit(pageSize));
    const snap = await getDocs(q);
    if (stopped) return false;
    if (snap.empty) return false;
    lastDoc = snap.docs[snap.docs.length - 1];
    onPage(snap.docs, { isFirstPage: false, hasMore: snap.docs.length === pageSize });
    return true;
  }

  function stop() {
    stopped = true;
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    lastDoc = null;
  }

  start();
  return { loadMore, stop, restart: start };
}
