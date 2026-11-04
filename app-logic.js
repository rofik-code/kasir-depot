/* ============================================================
 * Kasir Depot Air — app-logic.js
 * SEMUA logika bisnis sebagai pure function TANPA DOM.
 * Bisa di-require di node (module.exports) atau dipakai di
 * browser via window.KasirLogic.
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------- util ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function formatRupiah(n) {
    n = Math.round(Number(n) || 0);
    var neg = n < 0;
    var s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-Rp' : 'Rp') + s;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // dateISO -> "04/11/2026 21:40"
  function formatDateID(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // 'YYYY-MM-DD' hari ini (waktu lokal)
  function todayISODate() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ---------- seed ---------- */

  var SEED_PRODUCTS = [
    { id: 'p-isi19',  name: 'Isi Ulang Galon 19L',        price: 8000,  stock: 0 },
    { id: 'p-isi15',  name: 'Isi Ulang Galon 15L',        price: 7000,  stock: 0 },
    { id: 'p-baru19', name: 'Galon Baru + Isi 19L',       price: 45000, stock: 0 },
    { id: 'p-botol',  name: 'Air Mineral Botol 600ml (Dus)', price: 38000, stock: 0 },
    { id: 'p-gelas',  name: 'Air Mineral Gelas 240ml (Dus)', price: 28000, stock: 0 },
    { id: 'p-tutup',  name: 'Tutup Galon',                price: 2000,  stock: 0 },
    { id: 'p-tisu',   name: 'Tisu Galon',                 price: 1000,  stock: 0 }
  ];

  var SEED_ZONES = [
    { id: 'z-ganjar',    name: 'Desa Ganjar',     fee: 0 },
    { id: 'z-boro',      name: 'Dusun Boro',      fee: 2000 },
    { id: 'z-bureng',    name: 'Bureng',          fee: 2000 },
    { id: 'z-bulupitu1', name: 'Desa Bulupitu 1', fee: 2000 },
    { id: 'z-bulupitu2', name: 'Desa Bulupitu 2', fee: 3000 },
    { id: 'z-dien',      name: 'Desa Dien',       fee: 3000 },
    { id: 'z-putukrejo', name: 'Putuk Rejo',      fee: 3000 },
    { id: 'z-bulupayung',name: 'Bulupayung',      fee: 4000 },
    { id: 'z-sukosari',  name: 'Sukosari',        fee: 5000 },
    { id: 'z-putatlor',  name: 'Putat Lor',       fee: 5000 },
    { id: 'z-gondanglegi', name: 'Gondanglegi',   fee: 5000 },
    { id: 'z-karangasem', name: 'Karang Asem',    fee: 10000 }
  ];

  function seedDB(storeName) {
    return {
      products: SEED_PRODUCTS.map(function (p) {
        return { id: p.id, name: p.name, price: p.price, stock: p.stock };
      }),
      customers: [],
      zones: SEED_ZONES.map(function (z) {
        return { id: z.id, name: z.name, fee: z.fee };
      }),
      transactions: [],
      settings: { storeName: storeName || 'Depot Air Minum' }
    };
  }

  /* ---------- zona ---------- */

  function getZone(zones, zoneId) {
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].id === zoneId) return zones[i];
    }
    return null;
  }

  function getZoneFee(zones, zoneId) {
    var z = getZone(zones, zoneId);
    return z ? Number(z.fee) || 0 : 0;
  }

  function getZoneName(zones, zoneId) {
    var z = getZone(zones, zoneId);
    return z ? z.name : '-';
  }

  /* ---------- keranjang & transaksi ---------- */

  // items: [{productId, name, price, qty}]
  function calcCart(items) {
    var subtotal = 0, totalQty = 0;
    (items || []).forEach(function (it) {
      var qty = Math.max(0, Math.floor(Number(it.qty) || 0));
      var price = Math.max(0, Number(it.price) || 0);
      subtotal += price * qty;
      totalQty += qty;
    });
    return { subtotal: subtotal, totalQty: totalQty, count: (items || []).length };
  }

  // -> {subtotalAir, shippingFee, total, change, debt}
  function calcTransaction(o) {
    o = o || {};
    var cart = calcCart(o.items);
    var mode = o.mode === 'ambil' ? 'ambil' : 'antar';
    var zoneFee = Math.max(0, Number(o.zoneFee) || 0);
    var shippingFee = mode === 'antar' ? zoneFee : 0;
    var total = cart.subtotal + shippingFee;
    var paid = Math.max(0, Number(o.payAmount) || 0);
    var change = Math.max(0, paid - total);
    var debt = Math.max(0, total - paid);
    return {
      subtotalAir: cart.subtotal,
      shippingFee: shippingFee,
      total: total,
      change: change,
      debt: debt
    };
  }

  // -> array pesan error (kosong = valid)
  function validateTransaction(o) {
    o = o || {};
    var errors = [];
    var items = o.items || [];
    if (!items.length) errors.push('Keranjang masih kosong.');
    items.forEach(function (it) {
      if (!(Number(it.qty) > 0)) errors.push('Jumlah "' + (it.name || 'produk') + '" harus lebih dari 0.');
      if (!(Number(it.price) >= 0)) errors.push('Harga "' + (it.name || 'produk') + '" tidak valid.');
    });
    if (o.mode !== 'ambil' && o.mode !== 'antar') errors.push('Mode transaksi harus Ambil atau Diantar.');
    var methods = ['tunai', 'transfer', 'qris', 'hutang'];
    if (methods.indexOf(o.payMethod) < 0) errors.push('Metode bayar belum dipilih.');
    if (!(Number(o.payAmount) >= 0)) errors.push('Jumlah bayar tidak valid.');
    if (o.payMethod === 'hutang' && !o.customerId) {
      errors.push('Hutang harus dicatat atas nama pelanggan.');
    }
    return errors;
  }

  // Bangun objek transaksi lengkap (siap simpan)
  function buildTransaction(o) {
    o = o || {};
    var calc = calcTransaction(o);
    return {
      id: uid(),
      dateISO: new Date().toISOString(),
      items: (o.items || []).map(function (it) {
        return {
          productId: it.productId,
          name: it.name,
          price: Number(it.price) || 0,
          qty: Math.floor(Number(it.qty) || 0)
        };
      }),
      customerId: o.customerId || null,
      customerName: o.customerName || '',
      zoneId: o.zoneId || null,
      zoneName: o.zoneName || '',
      mode: o.mode === 'ambil' ? 'ambil' : 'antar',
      zoneFeeApplied: o.mode === 'ambil' ? 0 : (Math.max(0, Number(o.zoneFee) || 0)),
      subtotalAir: calc.subtotalAir,
      shippingFee: calc.shippingFee,
      total: calc.total,
      payMethod: o.payMethod,
      payAmount: Math.max(0, Number(o.payAmount) || 0),
      change: calc.change,
      debt: calc.debt,
      debtHistory: []
    };
  }

  /* ---------- stok (murni, tanpa DOM) ---------- */

  // direction: -1 = penjualan (kurangi), +1 = kembalikan (tambah)
  // -> array products BARU (tidak mutasi input)
  function adjustStock(products, items, direction) {
    var dir = direction >= 0 ? 1 : -1;
    return (products || []).map(function (p) {
      var np = { id: p.id, name: p.name, price: p.price, stock: Number(p.stock) || 0 };
      (items || []).forEach(function (it) {
        if (it.productId === p.id) np.stock += dir * (Math.floor(Number(it.qty) || 0));
      });
      return np;
    });
  }

  /* ---------- hutang ---------- */

  // Lunasi sebagian/seluruh hutang satu transaksi -> transaksi BARU
  function recordDebtPayment(tx, amount) {
    var a = Math.max(0, Number(amount) || 0);
    var pay = Math.min(a, tx.debt);
    var nt = {};
    for (var k in tx) nt[k] = tx[k];
    nt.debt = tx.debt - pay;
    nt.debtHistory = (tx.debtHistory || []).concat([{
      dateISO: new Date().toISOString(),
      amount: pay
    }]);
    nt.payAmount = (Number(tx.payAmount) || 0) + pay;
    return nt;
  }

  // -> [{customerId, customerName, totalDebt}] totalDebt>0, urut terbesar dulu
  function debtByCustomer(transactions) {
    var map = {};
    (transactions || []).forEach(function (tx) {
      var d = Number(tx.debt) || 0;
      if (d <= 0 || !tx.customerId) return;
      if (!map[tx.customerId]) {
        map[tx.customerId] = {
          customerId: tx.customerId,
          customerName: tx.customerName || 'Tanpa nama',
          totalDebt: 0
        };
      }
      map[tx.customerId].totalDebt += d;
    });
    var out = Object.keys(map).map(function (k) { return map[k]; });
    out.sort(function (a, b) { return b.totalDebt - a.totalDebt; });
    return out;
  }

  /* ---------- filter & ringkasan ---------- */

  // from/to: 'YYYY-MM-DD' atau null (inklusif)
  function filterByDate(transactions, from, to) {
    return (transactions || []).filter(function (tx) {
      var d = (tx.dateISO || '').slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  // -> {omzetAir, omzetOngkir, total, count}
  function summarize(transactions) {
    var s = { omzetAir: 0, omzetOngkir: 0, total: 0, count: 0 };
    (transactions || []).forEach(function (tx) {
      s.omzetAir += Number(tx.subtotalAir) || 0;
      s.omzetOngkir += Number(tx.shippingFee) || 0;
      s.total += Number(tx.total) || 0;
      s.count += 1;
    });
    return s;
  }

  /* ---------- struk ---------- */

  var PAY_LABEL = { tunai: 'Tunai', transfer: 'Transfer', qris: 'QRIS', hutang: 'Hutang' };

  function buildReceiptText(settings, tx) {
    var store = (settings && settings.storeName) || 'Depot Air Minum';
    var L = [];
    L.push(store);
    L.push('--------------------------------');
    L.push('Tanggal: ' + formatDateID(tx.dateISO));
    if (tx.customerName) L.push('Pelanggan: ' + tx.customerName);
    L.push('--------------------------------');
    (tx.items || []).forEach(function (it) {
      L.push(it.qty + 'x ' + it.name);
      L.push('    ' + formatRupiah(it.price * it.qty));
    });
    L.push('--------------------------------');
    L.push('Subtotal air : ' + formatRupiah(tx.subtotalAir));
    if (tx.mode === 'antar') {
      var zn = tx.zoneName ? ' (' + tx.zoneName + ')' : '';
      L.push('Ongkir' + zn + ' : ' + formatRupiah(tx.shippingFee));
    } else {
      L.push('Ongkir : Diambil sendiri - tanpa ongkir');
    }
    L.push('TOTAL        : ' + formatRupiah(tx.total));
    L.push('Bayar (' + (PAY_LABEL[tx.payMethod] || tx.payMethod) + ') : ' + formatRupiah(tx.payAmount));
    if (Number(tx.change) > 0) L.push('Kembali      : ' + formatRupiah(tx.change));
    if (Number(tx.debt) > 0) L.push('Sisa hutang  : ' + formatRupiah(tx.debt));
    L.push('--------------------------------');
    L.push('Terima kasih atas kunjungannya!');
    return L.join('\n');
  }

  /* ---------- no. WA ---------- */

  // "0812..." -> "62812...", buang spasi/tanda
  function normalizeWa(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.charAt(0) === '0') d = '62' + d.slice(1);
    return d;
  }

  function waLink(number, text) {
    var n = normalizeWa(number);
    if (!n) return '';
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || '');
  }

  /* ---------- export ---------- */

  var api = {
    uid: uid,
    formatRupiah: formatRupiah,
    formatDateID: formatDateID,
    todayISODate: todayISODate,
    SEED_PRODUCTS: SEED_PRODUCTS,
    SEED_ZONES: SEED_ZONES,
    seedDB: seedDB,
    getZone: getZone,
    getZoneFee: getZoneFee,
    getZoneName: getZoneName,
    calcCart: calcCart,
    calcTransaction: calcTransaction,
    validateTransaction: validateTransaction,
    buildTransaction: buildTransaction,
    adjustStock: adjustStock,
    recordDebtPayment: recordDebtPayment,
    debtByCustomer: debtByCustomer,
    filterByDate: filterByDate,
    summarize: summarize,
    buildReceiptText: buildReceiptText,
    normalizeWa: normalizeWa,
    waLink: waLink,
    PAY_LABEL: PAY_LABEL
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KasirLogic = api;
  }
})(typeof self !== 'undefined' ? self : this);
