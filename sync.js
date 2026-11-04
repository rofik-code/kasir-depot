/* ============================================================
 * Kasir Depot Air — sync.js
 * Sinkronisasi offline-first dengan Google Apps Script.
 * TANPA DOM. Bisa di-require di node (module.exports) atau
 * dipakai di browser via window.KasirSync.
 *
 * store: adapter penyimpanan dengan interface:
 *   load()            -> db | null
 *   saveAll(data)     -> void   (timpa products/customers/zones/
 *                                transactions/settings dari server)
 *   getOutbox()       -> [{action,payload,at}]
 *   setOutbox(q)      -> void
 *   getMeta()         -> {webAppUrl,lastSync,...}
 *   setMeta(m)        -> void
 * fetchFn: fungsi fetch (default: fetch global). Di-test dengan mock.
 * ============================================================ */
(function (root) {
  'use strict';

  function nowISO() { return new Date().toISOString(); }

  function apiGet(baseUrl, action, fetchFn) {
    var f = fetchFn || fetch;
    var url = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') +
      'action=' + encodeURIComponent(action);
    return f(url, { method: 'GET' }).then(function (r) { return r.json(); });
  }

  function apiPost(baseUrl, action, payload, fetchFn) {
    var f = fetchFn || fetch;
    return f(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {} })
    }).then(function (r) { return r.json(); });
  }

  /* ---------- outbox ---------- */

  function getOutbox(store) {
    try { return store.getOutbox() || []; } catch (e) { return []; }
  }

  function queueOp(store, action, payload) {
    var q = getOutbox(store);
    q.push({ action: action, payload: payload || {}, at: nowISO() });
    store.setOutbox(q);
    return q.length;
  }

  // Kirim satu operasi; gagal -> masuk outbox
  function sendOrQueue(baseUrl, store, fetchFn, action, payload, online) {
    if (!online) {
      queueOp(store, action, payload);
      return Promise.resolve({ sent: false, queued: true });
    }
    return apiPost(baseUrl, action, payload, fetchFn).then(function (res) {
      if (res && res.ok) return { sent: true, queued: false };
      queueOp(store, action, payload);
      return { sent: false, queued: true };
    }).catch(function () {
      queueOp(store, action, payload);
      return { sent: false, queued: true };
    });
  }

  // Kirim antrian satu per satu SESUAI URUTAN; berhenti di kegagalan pertama
  function pushOutbox(baseUrl, store, fetchFn) {
    var q = getOutbox(store).slice();
    var sent = 0;
    function next() {
      if (!q.length) {
        store.setOutbox([]);
        return Promise.resolve({ sent: sent, remaining: 0, failed: false });
      }
      var op = q[0];
      return apiPost(baseUrl, op.action, op.payload, fetchFn).then(function (res) {
        if (res && res.ok) {
          q.shift();
          sent++;
          return next();
        }
        store.setOutbox(q);
        return { sent: sent, remaining: q.length, failed: true };
      }).catch(function () {
        store.setOutbox(q);
        return { sent: sent, remaining: q.length, failed: true };
      });
    }
    return next();
  }

  /* ---------- pull ---------- */

  // Server menang penuh: timpa data lokal dengan data server
  function pull(baseUrl, store, fetchFn) {
    return apiGet(baseUrl, 'getAll', fetchFn).then(function (res) {
      if (res && res.ok && res.data) {
        store.saveAll(res.data);
        var m = store.getMeta() || {};
        m.lastSync = nowISO();
        store.setMeta(m);
      }
      return res;
    });
  }

  // Sheet masih kosong -> unggah seluruh data lokal (setup pertama kali)
  function seedServerIfEmpty(baseUrl, store, fetchFn) {
    var db = store.load();
    if (!db) return Promise.resolve({ seeded: false });
    var chain = Promise.resolve();
    var count = 0;
    function enq(action, payload) {
      chain = chain.then(function () {
        return apiPost(baseUrl, action, payload, fetchFn).then(function () { count++; });
      });
    }
    return apiGet(baseUrl, 'getAll', fetchFn).then(function (res) {
      var d = (res && res.data) || {};
      var serverEmpty = !(d.products && d.products.length) && !(d.zones && d.zones.length);
      if (!serverEmpty) return { seeded: false };
      (db.products || []).forEach(function (p) { enq('saveProduct', p); });
      (db.zones || []).forEach(function (z) { enq('saveZone', z); });
      (db.customers || []).forEach(function (c) { enq('saveCustomer', c); });
      (db.transactions || []).forEach(function (t) { enq('saveTransaction', t); });
      if (db.settings) enq('saveSettings', db.settings);
      return chain.then(function () { return { seeded: true, count: count }; });
    });
  }

  // Urutan aman: dorong antrian dulu, lalu seed bila perlu, lalu tarik
  function syncNow(baseUrl, store, fetchFn) {
    return pushOutbox(baseUrl, store, fetchFn)
      .then(function () { return seedServerIfEmpty(baseUrl, store, fetchFn); })
      .then(function () { return pull(baseUrl, store, fetchFn); });
  }

  var api = {
    apiGet: apiGet,
    apiPost: apiPost,
    queueOp: queueOp,
    getOutbox: getOutbox,
    sendOrQueue: sendOrQueue,
    pushOutbox: pushOutbox,
    pull: pull,
    seedServerIfEmpty: seedServerIfEmpty,
    syncNow: syncNow
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KasirSync = api;
  }
})(typeof self !== 'undefined' ? self : this);
