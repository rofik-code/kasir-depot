/* ============================================================
 * Kasir Depot Air — app-ui.js
 * Semua kode DOM/UI. Logika bisnis murni dari app-logic.js (L),
 * sinkronisasi dari sync.js (Sync). Tanpa library eksternal.
 * ============================================================ */
(function () {
  'use strict';
  var L = window.KasirLogic;
  var Sync = window.KasirSync;

  var LS_DB = 'kasirDepot.v1';
  var LS_META = 'kasirDepot.meta';

  /* ---------- penyimpanan lokal ---------- */

  function loadDB() {
    try {
      var raw = localStorage.getItem(LS_DB);
      if (raw) {
        var db = JSON.parse(raw);
        db.products = db.products || [];
        db.customers = db.customers || [];
        db.zones = db.zones || [];
        db.transactions = db.transactions || [];
        db.settings = db.settings || { storeName: 'Depot Air Minum' };
        return db;
      }
    } catch (e) {}
    return null;
  }
  function saveDB() {
    try { localStorage.setItem(LS_DB, JSON.stringify(DB)); } catch (e) {}
  }
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(LS_META) || '{}'); }
    catch (e) { return {}; }
  }
  function saveMeta(m) {
    try { localStorage.setItem(LS_META, JSON.stringify(m)); } catch (e) {}
  }

  var DB = loadDB() || L.seedDB('Depot Air Minum');
  saveDB();

  // Adapter untuk sync.js
  var store = {
    load: function () { return DB; },
    saveAll: function (data) {
      DB.products = data.products || [];
      DB.customers = data.customers || [];
      DB.zones = data.zones || [];
      DB.transactions = data.transactions || [];
      DB.settings = data.settings || { storeName: 'Depot Air Minum' };
      saveDB();
    },
    getOutbox: function () {
      try { return JSON.parse(localStorage.getItem(LS_META) || '{}').outbox || []; }
      catch (e) { return []; }
    },
    setOutbox: function (q) {
      var m = loadMeta(); m.outbox = q; saveMeta(m);
    },
    getMeta: loadMeta,
    setMeta: saveMeta
  };

  function webUrl() { return (loadMeta().webAppUrl || '').trim(); }
  function isOnline() { return navigator.onLine; }

  /* ---------- tulis: lokal dulu, lalu kirim/antre ---------- */

  function commit(action, payload, applyLocal) {
    if (applyLocal) applyLocal();
    saveDB();
    var url = webUrl();
    if (!url) { updateSyncStatus(); return Promise.resolve({ sent: false, queued: false, skipped: true }); }
    return Sync.sendOrQueue(url, store, null, action, payload, isOnline())
      .then(function () { updateSyncStatus(); })
      .catch(function () { updateSyncStatus(); });
  }

  function doSync() {
    var url = webUrl();
    if (!url) { updateSyncStatus(); return Promise.resolve(); }
    setSyncStatus('Menyinkronkan...');
    return Sync.syncNow(url, store, null).then(function () {
      renderAll();
      updateSyncStatus();
    }).catch(function (err) {
      setSyncStatus('Gagal sinkron: ' + (err && err.message || 'periksa koneksi/URL.'));
      updateSyncStatus();
    });
  }

  function setSyncStatus(t) {
    var el = document.getElementById('syncStatus');
    if (el) el.textContent = t;
  }

  function updateSyncStatus() {
    var url = webUrl();
    var q = store.getOutbox().length;
    var m = loadMeta();
    var last = m.lastSync ? L.formatDateID(m.lastSync) : null;
    var t;
    if (!url) t = 'Sinkronisasi belum diatur — isi URL Web App di bawah.';
    else if (!isOnline()) t = 'Offline — ' + q + ' operasi menunggu dikirim.';
    else if (q > 0) t = 'Online — ' + q + ' operasi menunggu dikirim.' + (last ? ' Terakhir sinkron: ' + last + '.' : '');
    else t = last ? 'Terakhir sinkron: ' + last + '. Data sama di semua HP.' : 'Siap sinkron — belum pernah sinkron.';
    setSyncStatus(t);
  }

  /* ---------- helper DOM ---------- */

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function findProduct(id) {
    for (var i = 0; i < DB.products.length; i++) if (DB.products[i].id === id) return DB.products[i];
    return null;
  }
  function findCustomer(id) {
    for (var i = 0; i < DB.customers.length; i++) if (DB.customers[i].id === id) return DB.customers[i];
    return null;
  }

  /* ---------- navigasi tab ---------- */

  var RENDER = {};
  function showTab(name) {
    var secs = document.querySelectorAll('.tab');
    for (var i = 0; i < secs.length; i++) secs[i].classList.remove('active');
    el('tab-' + name).classList.add('active');
    var btns = document.querySelectorAll('#bottomnav button');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('active', btns[j].getAttribute('data-tab') === name);
    }
    if (RENDER[name]) RENDER[name]();
    window.scrollTo(0, 0);
  }
  function renderAll() {
    el('storeTitle').textContent = DB.settings.storeName || 'Kasir Depot Air';
    Object.keys(RENDER).forEach(function (k) { RENDER[k](); });
  }

  /* ==================== 1. KASIR ==================== */

  var K = { cart: {}, customerId: '', mode: 'antar', feeOverride: '', payMethod: 'tunai', payAmount: '' };

  function kasirItems() {
    var items = [];
    Object.keys(K.cart).forEach(function (pid) {
      var qty = K.cart[pid] | 0;
      if (qty <= 0) return;
      var p = findProduct(pid);
      if (!p) return;
      items.push({ productId: pid, name: p.name, price: p.price, qty: qty });
    });
    return items;
  }

  function kasirZoneFee() {
    if (K.feeOverride !== '' && K.feeOverride != null) {
      var v = Number(K.feeOverride);
      if (!isNaN(v) && v >= 0) return v;
    }
    var c = findCustomer(K.customerId);
    return c ? L.getZoneFee(DB.zones, c.zoneId) : 0;
  }

  function kasirCalc() {
    return L.calcTransaction({
      items: kasirItems(),
      zoneFee: kasirZoneFee(),
      mode: K.mode,
      payAmount: Number(K.payAmount) || 0
    });
  }

  function renderKasirProducts() {
    var w = el('kasirProducts');
    var html = '';
    DB.products.forEach(function (p) {
      var qty = K.cart[p.id] | 0;
      var st = Number(p.stock) || 0;
      var cls = st < 0 ? 'neg' : (st <= 5 ? 'low' : '');
      html += '<div class="prod">' +
        '<div class="pname">' + esc(p.name) + '</div>' +
        '<div class="pprice">' + L.formatRupiah(p.price) + '</div>' +
        '<div class="pstock ' + cls + '">Stok: ' + st + '</div>' +
        '<div class="stepper">' +
        '<button data-dec="' + p.id + '">−</button>' +
        '<span class="qty">' + qty + '</span>' +
        '<button data-inc="' + p.id + '">+</button>' +
        '</div></div>';
    });
    w.innerHTML = html || '<div class="muted">Belum ada produk.</div>';
  }

  function renderKasirCustomer() {
    var q = (el('kasirCustSearch').value || '').toLowerCase();
    var sel = el('kasirCustomer');
    var html = '<option value="">-- Tanpa pelanggan --</option>';
    DB.customers.forEach(function (c) {
      if (q && c.name.toLowerCase().indexOf(q) < 0) return;
      var z = L.getZoneName(DB.zones, c.zoneId);
      html += '<option value="' + c.id + '"' + (K.customerId === c.id ? ' selected' : '') + '>' +
        esc(c.name) + ' (' + esc(z) + ')</option>';
    });
    sel.innerHTML = html;
  }

  function recalcKasir() {
    var c = kasirCalc();
    var cust = findCustomer(K.customerId);
    el('kasirZoneName').textContent = K.mode === 'antar'
      ? (cust ? L.getZoneName(DB.zones, cust.zoneId) : '(pilih pelanggan)') : '';
    el('kasirShipBox').style.display = K.mode === 'antar' ? '' : 'none';
    el('kasirShipFee').textContent = L.formatRupiah(c.shippingFee);
    el('kasirSubtotal').textContent = L.formatRupiah(c.subtotalAir);
    el('kasirShipTotal').textContent = L.formatRupiah(c.shippingFee);
    el('kasirTotal').textContent = L.formatRupiah(c.total);
    el('kasirChange').textContent = L.formatRupiah(c.change);
    el('kasirDebt').textContent = L.formatRupiah(c.debt);
  }

  function resetKasir() {
    K.cart = {}; K.customerId = ''; K.feeOverride = '';
    K.payMethod = 'tunai'; K.payAmount = '';
    el('kasirCustSearch').value = '';
    el('kasirFeeOverride').value = '';
    el('kasirPayAmount').value = '';
    syncSeg(el('kasirMode'), 'antar');
    syncPay();
    renderKasirProducts(); renderKasirCustomer(); recalcKasir();
  }

  function syncSeg(box, val) {
    var bs = box.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute('data-mode') === val || bs[i].getAttribute('data-pay') === val || bs[i].getAttribute('data-p') === val;
      bs[i].classList.toggle('on', on);
    }
  }
  function syncPay() { syncSeg(el('kasirPay'), K.payMethod); }

  RENDER.kasir = function () {
    renderKasirProducts(); renderKasirCustomer(); recalcKasir();
    var qc = el('kasirCashQuick');
    if (!qc.innerHTML) {
      var vals = [0, 10000, 20000, 50000, 100000, 200000];
      qc.innerHTML = vals.map(function (v) {
        return '<button data-cash="' + v + '">' + (v === 0 ? 'Uang pas' : L.formatRupiah(v)) + '</button>';
      }).join('');
    }
  };

  /* ==================== 2. STRUK ==================== */

  var currentTx = null;

  function showReceipt(tx) {
    currentTx = tx;
    el('strukEmpty').classList.add('hidden');
    el('strukWrap').classList.remove('hidden');
    el('strukText').textContent = L.buildReceiptText(DB.settings, tx);
  }

  RENDER.struk = function () {
    if (!currentTx) {
      el('strukEmpty').classList.remove('hidden');
      el('strukWrap').classList.add('hidden');
    }
  };

  /* ==================== 3. RIWAYAT ==================== */

  var riwExpanded = null;

  RENDER.riwayat = function () {
    var from = el('riwFrom').value || null;
    var to = el('riwTo').value || null;
    var list = L.filterByDate(DB.transactions, from, to);
    var w = el('riwayatList');
    if (!list.length) { w.innerHTML = '<div class="card muted">Tidak ada transaksi pada periode ini.</div>'; return; }
    var html = '';
    list.forEach(function (tx) {
      var badge = tx.debt > 0 ? '<span class="badge debt">Hutang ' + L.formatRupiah(tx.debt) + '</span>'
                              : '<span class="badge ok">Lunas</span>';
      html += '<div class="listitem" data-tx="' + tx.id + '">' +
        '<div class="row between"><span class="t1">' + esc(tx.customerName || 'Tanpa pelanggan') + '</span>' +
        '<span class="amt">' + L.formatRupiah(tx.total) + '</span></div>' +
        '<div class="t2">' + L.formatDateID(tx.dateISO) + ' · ' +
        (tx.mode === 'antar' ? 'Diantar' : 'Ambil') + ' · ' + (L.PAY_LABEL[tx.payMethod] || '') + badge + '</div>';
      if (riwExpanded === tx.id) {
        html += '<div class="mt"><div class="receipt">' + esc(L.buildReceiptText(DB.settings, tx)) + '</div>' +
          '<button class="btn danger small block" data-del-tx="' + tx.id + '">Hapus transaksi (stok kembali)</button></div>';
      }
      html += '</div>';
    });
    w.innerHTML = html;
  };

  /* ==================== 4. PRODUK ==================== */

  function resetProdForm() {
    el('prodId').value = ''; el('prodName').value = '';
    el('prodPrice').value = ''; el('prodStock').value = '';
  }

  RENDER.produk = function () {
    var w = el('produkList');
    var html = '';
    DB.products.forEach(function (p) {
      var st = Number(p.stock) || 0;
      var cls = st < 0 ? 'neg' : (st <= 5 ? 'low' : '');
      var note = st < 0 ? ' (minus!)' : (st <= 5 ? ' (menipis)' : '');
      html += '<div class="listitem"><div class="row between"><span class="t1">' + esc(p.name) + '</span>' +
        '<span class="amt">' + L.formatRupiah(p.price) + '</span></div>' +
        '<div class="t2 pstock ' + cls + '">Stok: ' + st + note + '</div>' +
        '<div class="btnrow mt"><button class="btn secondary small" data-edit-prod="' + p.id + '">Ubah</button>' +
        '<button class="btn danger small" data-del-prod="' + p.id + '">Hapus</button></div></div>';
    });
    w.innerHTML = html || '<div class="card muted">Belum ada produk.</div>';
  };

  /* ==================== 5. PELANGGAN ==================== */

  var custExpanded = null;

  function resetCustForm() {
    el('custId').value = ''; el('custName').value = ''; el('custWa').value = '';
  }
  function renderCustZoneOptions(selected) {
    el('custZone').innerHTML = DB.zones.map(function (z) {
      return '<option value="' + z.id + '"' + (selected === z.id ? ' selected' : '') + '>' +
        esc(z.name) + ' — ' + L.formatRupiah(z.fee) + '</option>';
    }).join('');
  }

  RENDER.pelanggan = function () {
    renderCustZoneOptions(el('custZone').value || (DB.zones[0] && DB.zones[0].id));
    var w = el('pelangganList');
    var html = '';
    DB.customers.forEach(function (c) {
      var z = L.getZoneName(DB.zones, c.zoneId);
      var debts = L.debtByCustomer(DB.transactions.filter(function (t) { return t.customerId === c.id; }));
      var totDebt = debts.length ? debts[0].totalDebt : 0;
      html += '<div class="listitem" data-cust="' + c.id + '">' +
        '<div class="row between"><span class="t1">' + esc(c.name) + '</span>' +
        (totDebt > 0 ? '<span class="badge debt">Hutang ' + L.formatRupiah(totDebt) + '</span>' : '') + '</div>' +
        '<div class="t2">' + esc(z) + (c.wa ? ' · ' + esc(c.wa) : '') + '</div>' +
        '<div class="btnrow mt">';
      if (c.wa) html += '<button class="btn secondary small" data-wa-cust="' + c.id + '">Chat WA</button>';
      html += '<button class="btn secondary small" data-edit-cust="' + c.id + '">Ubah</button>' +
        '<button class="btn danger small" data-del-cust="' + c.id + '">Hapus</button></div>';
      if (custExpanded === c.id) {
        var hist = DB.transactions.filter(function (t) { return t.customerId === c.id; });
        html += '<div class="mt small">' + (hist.length ? hist.map(function (t) {
          return '<div class="row between"><span>' + L.formatDateID(t.dateISO) + '</span><span><strong>' +
            L.formatRupiah(t.total) + '</strong>' + (t.debt > 0 ? ' <span class="badge debt">sisa ' + L.formatRupiah(t.debt) + '</span>' : '') + '</span></div>';
        }).join('') : '<span class="muted">Belum ada transaksi.</span>') + '</div>';
      }
      html += '</div>';
    });
    w.innerHTML = html || '<div class="card muted">Belum ada pelanggan.</div>';
  };

  /* ==================== 6. LAPORAN ==================== */

  var lapPeriod = 'today';
  function lapRange() {
    var today = L.todayISODate();
    if (lapPeriod === 'today') return { from: today, to: today };
    if (lapPeriod === '7' || lapPeriod === '30') {
      var d = new Date(); d.setDate(d.getDate() - (Number(lapPeriod) - 1));
      var from = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
      return { from: from, to: today };
    }
    return { from: el('lapFrom').value || null, to: el('lapTo').value || null };
  }

  RENDER.laporan = function () {
    syncSeg(el('lapPeriod'), lapPeriod);
    el('lapCustom').classList.toggle('hidden', lapPeriod !== 'custom');
    var r = lapRange();
    var list = L.filterByDate(DB.transactions, r.from, r.to);
    var s = L.summarize(list);
    el('lapOmzetAir').textContent = L.formatRupiah(s.omzetAir);
    el('lapOmzetOngkir').textContent = L.formatRupiah(s.omzetOngkir);
    el('lapTotal').textContent = L.formatRupiah(s.total);
    el('lapCount').textContent = s.count;
    var debts = L.debtByCustomer(DB.transactions);
    var w = el('lapDebts');
    if (!debts.length) { w.innerHTML = '<span class="muted">Tidak ada hutang.</span>'; return; }
    w.innerHTML = debts.map(function (d) {
      return '<div class="listitem"><div class="row between"><span class="t1">' + esc(d.customerName) + '</span>' +
        '<span class="amt">' + L.formatRupiah(d.totalDebt) + '</span></div>' +
        '<div class="row mt"><input type="number" min="0" step="500" placeholder="Jumlah bayar" ' +
        'id="pay-' + d.customerId + '" style="flex:1">' +
        '<button class="btn small" data-lunasi="' + d.customerId + '">Lunasi</button></div></div>';
    }).join('');
  };

  function applyPayDebtLocal(customerId, amount) {
    var txs = DB.transactions
      .filter(function (t) { return t.customerId === customerId && Number(t.debt) > 0; })
      .sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : 1; });
    var rest = Math.max(0, Number(amount) || 0);
    txs.forEach(function (t) {
      if (rest <= 0) return;
      var nt = L.recordDebtPayment(t, rest);
      rest -= (Number(t.debt) - Number(nt.debt));
      DB.transactions[DB.transactions.indexOf(t)] = nt;
    });
  }

  /* ==================== 7. PENGATURAN ==================== */

  function renderZones() {
    var w = el('zoneList');
    w.innerHTML = DB.zones.map(function (z) {
      var used = DB.customers.some(function (c) { return c.zoneId === z.id; });
      return '<div class="listitem"><div class="row between"><span class="t1">' + esc(z.name) + '</span>' +
        '<span class="amt">' + (z.fee === 0 ? 'GRATIS' : L.formatRupiah(z.fee)) + '</span></div>' +
        '<div class="btnrow mt"><button class="btn secondary small" data-edit-zone="' + z.id + '">Ubah</button>' +
        (used ? '<span class="small muted">Dipakai pelanggan — tidak bisa dihapus</span>'
              : '<button class="btn danger small" data-del-zone="' + z.id + '">Hapus</button>') + '</div></div>';
    }).join('') || '<span class="muted">Belum ada zona.</span>';
  }
  function resetZoneForm() { el('zoneId').value = ''; el('zoneName').value = ''; el('zoneFee').value = ''; }

  RENDER.pengaturan = function () {
    el('setStoreName').value = DB.settings.storeName || '';
    el('syncUrl').value = webUrl();
    renderZones();
    updateSyncStatus();
  };

  /* ---------- event wiring ---------- */

  function on(id, ev, fn) { el(id).addEventListener(ev, fn); }

  function bindEvents() {
    // nav
    var btns = document.querySelectorAll('#bottomnav button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { showTab(this.getAttribute('data-tab')); });
    }

    // kasir: stepper (delegation)
    el('kasirProducts').addEventListener('click', function (e) {
      var inc = e.target.getAttribute('data-inc');
      var dec = e.target.getAttribute('data-dec');
      if (inc) K.cart[inc] = (K.cart[inc] | 0) + 1;
      if (dec) K.cart[dec] = Math.max(0, (K.cart[dec] | 0) - 1);
      if (inc || dec) { renderKasirProducts(); recalcKasir(); }
    });
    on('kasirCustSearch', 'input', renderKasirCustomer);
    on('kasirCustomer', 'change', function () { K.customerId = this.value; K.feeOverride = ''; el('kasirFeeOverride').value = ''; recalcKasir(); });
    el('kasirMode').addEventListener('click', function (e) {
      var m = e.target.getAttribute('data-mode');
      if (m) { K.mode = m; syncSeg(el('kasirMode'), m); recalcKasir(); }
    });
    on('kasirFeeOverride', 'input', function () { K.feeOverride = this.value; recalcKasir(); });
    el('kasirPay').addEventListener('click', function (e) {
      var p = e.target.getAttribute('data-pay');
      if (p) { K.payMethod = p; syncPay(); }
    });
    el('kasirCashQuick').addEventListener('click', function (e) {
      var v = e.target.getAttribute('data-cash');
      if (v != null) {
        if (v === '0') { el('kasirPayAmount').value = kasirCalc().total; }
        else { el('kasirPayAmount').value = (Number(el('kasirPayAmount').value) || 0) + Number(v); }
        K.payAmount = el('kasirPayAmount').value;
        recalcKasir();
      }
    });
    on('kasirPayAmount', 'input', function () { K.payAmount = this.value; recalcKasir(); });

    on('kasirSave', 'click', function () {
      var items = kasirItems();
      var cust = findCustomer(K.customerId);
      var fee = kasirZoneFee();
      var errs = L.validateTransaction({
        items: items, mode: K.mode, payMethod: K.payMethod,
        payAmount: Number(K.payAmount) || 0, customerId: K.customerId || null
      });
      if (errs.length) { alert(errs.join('\n')); return; }
      var tx = L.buildTransaction({
        items: items, zoneFee: fee, zoneId: cust ? cust.zoneId : null,
        zoneName: cust ? L.getZoneName(DB.zones, cust.zoneId) : '',
        mode: K.mode, payMethod: K.payMethod,
        payAmount: Number(K.payAmount) || 0,
        customerId: K.customerId || null, customerName: cust ? cust.name : ''
      });
      commit('saveTransaction', tx, function () {
        DB.transactions.unshift(tx);
        DB.products = L.adjustStock(DB.products, tx.items, -1);
      }).then(function () {
        showReceipt(tx);
        resetKasir();
        showTab('struk');
      });
    });

    // struk
    on('strukWA', 'click', function () {
      if (!currentTx) return;
      var text = L.buildReceiptText(DB.settings, currentTx);
      var cust = findCustomer(currentTx.customerId);
      var link = cust && cust.wa ? L.waLink(cust.wa, text)
                                 : 'https://wa.me/?text=' + encodeURIComponent(text);
      if (link) window.open(link, '_blank');
    });
    on('strukNew', 'click', function () { resetKasir(); showTab('kasir'); });

    // riwayat
    on('riwToday', 'click', function () {
      var t = L.todayISODate();
      el('riwFrom').value = t; el('riwTo').value = t;
      RENDER.riwayat();
    });
    on('riwFrom', 'change', RENDER.riwayat);
    on('riwTo', 'change', RENDER.riwayat);
    el('riwayatList').addEventListener('click', function (e) {
      var del = e.target.getAttribute('data-del-tx');
      if (del) {
        var tx = null;
        DB.transactions.forEach(function (t) { if (t.id === del) tx = t; });
        if (tx && confirm('Hapus transaksi ini? Stok produk akan dikembalikan.')) {
          commit('deleteTransaction', { id: del }, function () {
            DB.transactions = DB.transactions.filter(function (t) { return t.id !== del; });
            DB.products = L.adjustStock(DB.products, tx.items, 1);
          }).then(function () { riwExpanded = null; RENDER.riwayat(); });
        }
        return;
      }
      var item = e.target.closest('.listitem');
      if (item && item.getAttribute('data-tx')) {
        var id = item.getAttribute('data-tx');
        riwExpanded = (riwExpanded === id) ? null : id;
        RENDER.riwayat();
      }
    });

    // produk
    on('prodSave', 'click', function () {
      var name = el('prodName').value.trim();
      var price = Number(el('prodPrice').value);
      var stock = el('prodStock').value === '' ? 0 : Number(el('prodStock').value);
      if (!name) { alert('Nama produk wajib diisi.'); return; }
      if (!(price >= 0)) { alert('Harga tidak valid.'); return; }
      var id = el('prodId').value || L.uid();
      var p = { id: id, name: name, price: price, stock: stock };
      commit('saveProduct', p, function () {
        var i = DB.products.findIndex(function (x) { return x.id === id; });
        if (i >= 0) DB.products[i] = p; else DB.products.push(p);
      }).then(function () { resetProdForm(); RENDER.produk(); renderKasirProducts(); });
    });
    on('prodCancel', 'click', resetProdForm);
    el('produkList').addEventListener('click', function (e) {
      var ed = e.target.getAttribute('data-edit-prod');
      var del = e.target.getAttribute('data-del-prod');
      if (ed) {
        var p = findProduct(ed);
        if (p) { el('prodId').value = p.id; el('prodName').value = p.name; el('prodPrice').value = p.price; el('prodStock').value = p.stock; window.scrollTo(0, 0); }
      }
      if (del && confirm('Hapus produk ini?')) {
        commit('deleteProduct', { id: del }, function () {
          DB.products = DB.products.filter(function (x) { return x.id !== del; });
        }).then(function () { RENDER.produk(); renderKasirProducts(); });
      }
    });

    // pelanggan
    on('custSave', 'click', function () {
      var name = el('custName').value.trim();
      var wa = el('custWa').value.trim();
      var zoneId = el('custZone').value;
      if (!name) { alert('Nama pelanggan wajib diisi.'); return; }
      var id = el('custId').value || L.uid();
      var c = { id: id, name: name, wa: wa, zoneId: zoneId };
      commit('saveCustomer', c, function () {
        var i = DB.customers.findIndex(function (x) { return x.id === id; });
        if (i >= 0) DB.customers[i] = c; else DB.customers.push(c);
      }).then(function () { resetCustForm(); RENDER.pelanggan(); renderKasirCustomer(); });
    });
    on('custCancel', 'click', resetCustForm);
    el('pelangganList').addEventListener('click', function (e) {
      var wa = e.target.getAttribute('data-wa-cust');
      var ed = e.target.getAttribute('data-edit-cust');
      var del = e.target.getAttribute('data-del-cust');
      if (wa) {
        var c = findCustomer(wa);
        var link = L.waLink(c.wa, 'Assalamualaikum ' + c.name + ', ini dari ' + (DB.settings.storeName || 'depot air') + '.');
        if (link) window.open(link, '_blank');
        return;
      }
      if (ed) {
        var cc = findCustomer(ed);
        if (cc) { el('custId').value = cc.id; el('custName').value = cc.name; el('custWa').value = cc.wa || ''; renderCustZoneOptions(cc.zoneId); window.scrollTo(0, 0); }
        return;
      }
      if (del && confirm('Hapus pelanggan ini? Riwayat transaksinya tetap tersimpan.')) {
        commit('deleteCustomer', { id: del }, function () {
          DB.customers = DB.customers.filter(function (x) { return x.id !== del; });
        }).then(function () { RENDER.pelanggan(); renderKasirCustomer(); });
        return;
      }
      var item = e.target.closest('.listitem');
      if (item && item.getAttribute('data-cust')) {
        var id = item.getAttribute('data-cust');
        custExpanded = (custExpanded === id) ? null : id;
        RENDER.pelanggan();
      }
    });

    // laporan
    el('lapPeriod').addEventListener('click', function (e) {
      var p = e.target.getAttribute('data-p');
      if (p) { lapPeriod = p; RENDER.laporan(); }
    });
    on('lapFrom', 'change', RENDER.laporan);
    on('lapTo', 'change', RENDER.laporan);
    el('lapDebts').addEventListener('click', function (e) {
      var id = e.target.getAttribute('data-lunasi');
      if (!id) return;
      var inp = el('pay-' + id);
      var amount = Number(inp ? inp.value : 0);
      if (!(amount > 0)) { alert('Isi jumlah pembayaran dulu.'); return; }
      commit('payDebt', { customerId: id, amount: amount, dateISO: new Date().toISOString() },
        function () { applyPayDebtLocal(id, amount); })
        .then(function () { RENDER.laporan(); });
    });

    // pengaturan
    on('setSaveStore', 'click', function () {
      var name = el('setStoreName').value.trim() || 'Depot Air Minum';
      commit('saveSettings', { storeName: name }, function () { DB.settings.storeName = name; })
        .then(function () { el('storeTitle').textContent = name; alert('Nama toko disimpan.'); });
    });
    on('zoneSave', 'click', function () {
      var name = el('zoneName').value.trim();
      var fee = Number(el('zoneFee').value);
      if (!name) { alert('Nama zona wajib diisi.'); return; }
      if (!(fee >= 0)) { alert('Tarif tidak valid.'); return; }
      var id = el('zoneId').value || L.uid();
      var z = { id: id, name: name, fee: fee };
      commit('saveZone', z, function () {
        var i = DB.zones.findIndex(function (x) { return x.id === id; });
        if (i >= 0) DB.zones[i] = z; else DB.zones.push(z);
      }).then(function () { resetZoneForm(); renderZones(); renderKasirCustomer(); });
    });
    on('zoneCancel', 'click', resetZoneForm);
    el('zoneList').addEventListener('click', function (e) {
      var ed = e.target.getAttribute('data-edit-zone');
      var del = e.target.getAttribute('data-del-zone');
      if (ed) {
        var z = null;
        DB.zones.forEach(function (x) { if (x.id === ed) z = x; });
        if (z) { el('zoneId').value = z.id; el('zoneName').value = z.name; el('zoneFee').value = z.fee; }
      }
      if (del && confirm('Hapus zona ini?')) {
        commit('deleteZone', { id: del }, function () {
          DB.zones = DB.zones.filter(function (x) { return x.id !== del; });
        }).then(function () { renderZones(); renderKasirCustomer(); });
      }
    });

    // sinkronisasi
    on('syncSaveUrl', 'click', function () {
      var m = loadMeta();
      m.webAppUrl = el('syncUrl').value.trim();
      saveMeta(m);
      updateSyncStatus();
      alert('URL Web App disimpan.');
      if (m.webAppUrl && isOnline()) doSync();
    });
    on('syncNowBtn', 'click', function () {
      if (!webUrl()) { alert('Isi URL Web App dulu.'); return; }
      if (!isOnline()) { alert('HP sedang offline. Data tersimpan lokal dan akan terkirim otomatis saat online.'); return; }
      doSync();
    });

    // backup
    on('setExport', 'click', function () {
      var blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kasir-depot-backup-' + L.todayISODate() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    on('setImportBtn', 'click', function () { el('setImport').click(); });
    on('setImport', 'change', function () {
      var f = this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var db = JSON.parse(rd.result);
          if (!db.products || !db.zones) throw new Error('format salah');
          if (!confirm('Ganti SEMUA data di HP ini dengan file backup?')) return;
          DB = db;
          saveDB();
          // dorong semua ke server (antre), lalu sinkron
          var url = webUrl();
          if (url && isOnline()) {
            var ops = [];
            DB.products.forEach(function (p) { ops.push(['saveProduct', p]); });
            DB.zones.forEach(function (z) { ops.push(['saveZone', z]); });
            DB.customers.forEach(function (c) { ops.push(['saveCustomer', c]); });
            DB.transactions.forEach(function (t) { ops.push(['saveTransaction', t]); });
            ops.push(['saveSettings', DB.settings]);
            var chain = Promise.resolve();
            ops.forEach(function (op) {
              chain = chain.then(function () { return Sync.sendOrQueue(url, store, null, op[0], op[1], true); });
            });
            chain.then(doSync);
          } else {
            renderAll();
          }
          alert('Data dipulihkan.');
        } catch (err) { alert('File tidak valid.'); }
      };
      rd.readAsText(f);
      this.value = '';
    });
    on('setWipe', 'click', function () {
      if (!confirm('HAPUS SEMUA data di HP ini? (tidak menghapus data di Google Sheets)')) return;
      if (!confirm('Yakin? Tindakan ini tidak bisa dibatalkan.')) return;
      DB = L.seedDB('Depot Air Minum');
      saveDB();
      currentTx = null;
      renderAll();
      alert('Data di HP ini dihapus dan dikembalikan ke awal.');
    });

    // online/offline
    window.addEventListener('online', function () { updateSyncStatus(); doSync(); });
    window.addEventListener('offline', updateSyncStatus);
  }

  /* ---------- service worker ---------- */

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  /* ---------- init ---------- */

  function init() {
    el('todayLabel').textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    bindEvents();
    renderAll();
    showTab('kasir');
    updateSyncStatus();
    registerSW();
    // otomatis tarik data terbaru saat dibuka & online
    if (webUrl() && isOnline()) doSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
