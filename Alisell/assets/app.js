/* Alisell app.js
   The home page stays as the static HTML in index.html.
   This script only takes over when the URL has ?page=... (or a search), and
   re-uses the header/footer already in the HTML. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var app = $("#app");
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var money = function (n) { return "\u20A6" + Number(n || 0).toLocaleString(); };
  var qs = new URLSearchParams(location.search);
  var page = qs.get("page") || ((qs.get("q") || qs.get("category")) ? "shop" : "home");

  /* ---------- cart (localStorage, guarded) ---------- */
  function getCart() { try { return JSON.parse(localStorage.getItem("alisell_cart") || "[]"); } catch (e) { return []; } }
  function setCart(c) { try { localStorage.setItem("alisell_cart", JSON.stringify(c)); } catch (e) {} chrome(); }
  function cartCount() { return getCart().reduce(function (n, i) { return n + i.qty; }, 0); }
  function addToCart(p, qty) {
    var c = getCart(), f = c.find(function (i) { return i.id === p.id; });
    if (f) f.qty += qty; else c.push({ id: p.id, name: p.name || p.title || "Product", price: Number(p.price) || 0, image: pickImg(p), qty: qty });
    setCart(c);
  }
  function pickImg(p) { return p.image || p.image_url || (p.images && p.images[0]) || ""; }

  /* ---------- firebase helpers ---------- */
  function wait(key, evt) {
    return new Promise(function (res, rej) {
      if (window[key]) return res(window[key]);
      var t = setTimeout(function () {
        rej(new Error("Could not connect to Firebase. Refresh the page. If it keeps failing, check your internet and that every file in the assets folder is uploaded."));
      }, 12000);
      window.addEventListener(evt, function () { clearTimeout(t); res(window[key]); }, { once: true });
    });
  }
  var data = function () { return wait("firebaseData", "firebase-data-ready"); };
  var fns = function () { return wait("firebaseFunctions", "firebase-functions-ready"); };
  function authReady() {
    return wait("firebaseAuth", "firebase-ready").then(function (a) { return a.authStateReady ? a.authStateReady() : null; }).then(function () { return window.firebaseAuth.currentUser; });
  }

  /* ---------- header: cart count + sign in/out ---------- */
  function chrome() {
    var cart = document.querySelector('.head-actions a[href*="cart"]');
    if (cart) cart.innerHTML = "&#128722; Cart (" + cartCount() + ")";
    var u = window.firebaseAuth && window.firebaseAuth.currentUser;
    var link = document.querySelector('.head-actions a[href*="login"], .head-actions a[data-signout]');
    if (!link) return;
    if (u) {
      link.textContent = "Sign out (" + (u.displayName || u.email || "me") + ")";
      link.setAttribute("data-signout", "1"); link.href = "#";
      link.onclick = function (e) { e.preventDefault(); window.firebaseAuthFns.signOutUser().then(function () { location.href = "index.html"; }); };
    }
  }
  chrome();
  window.addEventListener("firebase-auth-changed", function (e) {
    chrome();
    var u = e.detail && e.detail.user;
    try {
      if (u && !sessionStorage.getItem("alisell_prof_" + u.uid)) {
        sessionStorage.setItem("alisell_prof_" + u.uid, "1");
        wait("firebaseData", "firebase-data-ready").then(function (d) { return d.ensureUserProfile(u); }).catch(function () {});
      }
    } catch (x) {}
  });
  if (page === "home") return;

  var HEADER = ["top", "header", "nav"].map(function (c) { var e = $("." + c); return e ? e.outerHTML : ""; }).join("");
  var FOOTER = ($(".footer") || { outerHTML: "" }).outerHTML;

  function render(html, bare) {
    app.innerHTML = bare ? html : HEADER + '<main class="page container">' + html + "</main>" + FOOTER;
    chrome(); window.scrollTo(0, 0);
  }
  function note(msg) { var n = $("#msg"); if (n) { n.textContent = msg; n.style.display = msg ? "block" : "none"; } }
  function card(p) {
    var img = pickImg(p), name = p.name || p.title || "Product";
    return '<a class="product" href="index.html?page=product&id=' + encodeURIComponent(p.id) + '">' +
      (img ? '<img class="product-img" loading="lazy" alt="' + esc(name) + '" src="' + esc(img) + '">' : '<div class="product-img"></div>') +
      '<div class="product-body"><div>' + esc(name) + '</div><div class="price">' + money(p.price) + "</div>" +
      '<div class="rating">&#9733; ' + (p.rating ? Number(p.rating).toFixed(1) : "New") + "</div></div></a>";
  }
  function needLogin(u) {
    if (u) return false;
    location.replace("index.html?page=login&next=" + encodeURIComponent(location.search));
    return true;
  }
  var AUTH_MSG = {
    "auth/invalid-credential": "Wrong email or password.", "auth/wrong-password": "Wrong email or password.", "auth/user-not-found": "No account with that email.",
    "auth/email-already-in-use": "That email already has an account. Sign in instead.", "auth/weak-password": "Password must be at least 6 characters.",
    "auth/operation-not-allowed": "This sign-in method is switched off. In Firebase Console > Authentication > Sign-in method, enable Email/Password (and Google).",
    "auth/unauthorized-domain": "This web address is not allowed. Add it in Firebase Console > Authentication > Settings > Authorized domains.",
    "auth/popup-closed-by-user": "The Google window was closed before finishing.", "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups and try again.",
    "auth/network-request-failed": "No internet connection, or the request was blocked.", "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again."
  };
  function authErr(e) { return AUTH_MSG[e && e.code] || errText(e); }
  function fbReady() {
    if (window.firebaseAuthFns) return true;
    note("Firebase did not load, so sign-in cannot work. Open this site through a local server (http://localhost:8000) or your hosting address, not by double-clicking the file.");
    return false;
  }
  function errText(e) { return (e && (e.message || e.code)) ? String(e.message || e.code).replace("Firebase: ", "") : "Something went wrong"; }

  /* ---------- pages ---------- */
  var pages = {
    shop: async function () {
      render('<h1>Shop</h1><p class="muted">Loading products&hellip;</p>');
      try {
        var list = await (await data()).getProducts();
        var q = (qs.get("q") || "").toLowerCase(), cat = (qs.get("category") || "").toLowerCase();
        list = list.filter(function (p) {
          return (!q || ((p.name || p.title || "") + " " + (p.description || "")).toLowerCase().indexOf(q) > -1) &&
                 (!cat || String(p.category || "").toLowerCase() === cat);
        });
        render("<h1>Shop</h1>" + (list.length ? '<div class="product-grid">' + list.map(card).join("") + "</div>" : '<p class="muted">No products found.</p>'));
      } catch (e) { render('<h1>Shop</h1><div class="notice">' + esc(errText(e)) + "</div>"); }
    },

    product: async function () {
      render('<p class="muted">Loading&hellip;</p>');
      try {
        var p = await (await data()).getProduct(qs.get("id")), img = pickImg(p), name = p.name || p.title || "Product";
        render('<div class="detail">' + (img ? '<img class="detail-img" alt="' + esc(name) + '" src="' + esc(img) + '">' : '<div class="detail-img" style="background:#f4f5f6"></div>') +
          "<div><h1>" + esc(name) + '</h1><div class="price">' + money(p.price) + '</div><p class="muted">Sold by ' + esc(p.sellerName || "Seller") + "</p><p>" + esc(p.description || "") + "</p>" +
          '<div class="qty"><button id="minus">-</button><span id="q">1</span><button id="plus">+</button></div><p>' +
          '<button class="btn" id="add">Add to cart</button> <button class="btn alt" id="buy">Buy now</button></p></div></div>');
        var n = 1, q = $("#q");
        $("#minus").onclick = function () { n = Math.max(1, n - 1); q.textContent = n; };
        $("#plus").onclick = function () { n++; q.textContent = n; };
        $("#add").onclick = function () { addToCart(p, n); $("#add").textContent = "Added \u2713"; };
        $("#buy").onclick = function () { addToCart(p, n); location.href = "index.html?page=checkout"; };
      } catch (e) { render('<div class="notice">' + esc(errText(e)) + "</div>"); }
    },

    cart: function () {
      var c = getCart();
      if (!c.length) return render('<h1>Your cart</h1><p class="muted">Your cart is empty.</p><a class="btn" href="index.html?page=shop">Browse products</a>');
      var total = c.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
      render("<h1>Your cart</h1>" + '<div class="panel"><table class="table"><tr><th>Item</th><th>Price</th><th>Qty</th><th></th></tr>' +
        c.map(function (i, k) {
          return "<tr><td>" + esc(i.name) + "</td><td>" + money(i.price) + '</td><td><button data-d="' + k + '" data-v="-1">-</button> ' + i.qty +
            ' <button data-d="' + k + '" data-v="1">+</button></td><td><button data-rm="' + k + '">Remove</button></td></tr>';
        }).join("") + '</table><div class="summary-row total"><span>Total</span><span>' + money(total) + '</span></div><p><a class="btn" href="index.html?page=checkout">Checkout</a></p></div>');
      app.onclick = function (e) {
        var t = e.target, cc = getCart();
        if (t.dataset.d != null) { var it = cc[+t.dataset.d]; it.qty = Math.max(1, it.qty + +t.dataset.v); setCart(cc); pages.cart(); }
        if (t.dataset.rm != null) { cc.splice(+t.dataset.rm, 1); setCart(cc); pages.cart(); }
      };
    },

    checkout: async function () {
      var u = await authReady(); if (needLogin(u)) return;
      var c = getCart();
      if (!c.length) return render('<h1>Checkout</h1><p class="muted">Your cart is empty.</p>');
      var total = c.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
      render('<h1>Checkout</h1><div class="checkout"><form class="panel" id="f"><h3>Delivery details</h3><div id="msg" class="notice" style="display:none"></div>' +
        '<div class="field"><label>Full name</label><input name="name" required value="' + esc(u.displayName || "") + '"></div>' +
        '<div class="field"><label>Phone</label><input name="phone" required></div>' +
        '<div class="field"><label>Delivery address</label><textarea name="address" rows="3" required></textarea></div>' +
        '<button class="btn" id="pay">Pay ' + money(total) + "</button></form>" +
        '<div class="panel"><h3>Order summary</h3>' + c.map(function (i) { return '<div class="summary-row"><span>' + esc(i.name) + " x" + i.qty + "</span><span>" + money(i.price * i.qty) + "</span></div>"; }).join("") +
        '<div class="summary-row total"><span>Total</span><span>' + money(total) + "</span></div></div></div>");
      $("#f").onsubmit = async function (e) {
        e.preventDefault(); var f = e.target, b = $("#pay"); b.disabled = true; note("");
        try {
          var F = await fns();
          // ASSUMPTION: adjust these field names to what your createOrder Cloud Function expects.
          var order = await F.createOrder({ items: c.map(function (i) { return { productId: i.id, quantity: i.qty }; }), name: f.elements.name.value, phone: f.elements.phone.value, address: f.elements.address.value });
          var id = order.orderId || order.id;
          var pay = await F.initializePayment("order", id);
          try { localStorage.removeItem("alisell_cart"); } catch (x) {}
          location.href = pay.authorization_url || pay.url || pay.authorizationUrl;
        } catch (err) { note(errText(err)); b.disabled = false; }
      };
    },

    confirmation: function () {
      render('<div class="panel" style="text-align:center;max-width:520px;margin:auto"><h1>Thank you!</h1><p>Your payment was confirmed.</p><p class="muted">Reference: ' +
        esc(qs.get("reference") || "") + '</p><a class="btn" href="index.html?page=orders">View my orders</a></div>');
    },

    orders: async function () {
      var u = await authReady(); if (needLogin(u)) return;
      render("<h1>My orders</h1><p class=\"muted\">Loading&hellip;</p>");
      try {
        var rows = await (await data()).getOrders();
        render("<h1>My orders</h1>" + (rows.length ? '<div class="panel"><table class="table"><tr><th>Order</th><th>Date</th><th>Payment</th><th>Status</th></tr>' +
          rows.map(function (o) {
            return "<tr><td>" + esc(o.id.slice(0, 8)) + "</td><td>" + o.created_at.toLocaleDateString() + "</td><td>" + esc(o.payment_status || "pending") + '</td><td><span class="badge">' + esc(o.status || "placed") + "</span></td></tr>";
          }).join("") + "</table></div>" : '<p class="muted">You have no orders yet.</p>'));
      } catch (e) { render('<div class="notice">' + esc(errText(e)) + "</div>"); }
    },

    login: function () { authPage("login"); },
    signup: function () { authPage("signup"); },

    sell: async function () {
      var u = await authReady(); if (needLogin(u)) return;
      render('<h1>Sell on Alisell</h1><div id="msg" class="notice" style="display:none"></div>' +
        '<div class="panel" style="margin-bottom:15px"><p>Sellers must be verified before listing. Request the seller role first.</p><button class="btn alt" id="role">Become a seller</button></div>' +
        '<form class="panel" id="f"><h3>Add a product</h3>' +
        '<div class="field"><label>Name</label><input name="name" required></div>' +
        '<div class="field"><label>Price (\u20A6)</label><input name="price" type="number" min="1" required></div>' +
        '<div class="field"><label>Category</label><select name="category"><option>fashion</option><option>electronics</option><option>home</option><option>beauty</option><option>groceries</option></select></div>' +
        '<div class="field"><label>Description</label><textarea name="description" rows="3"></textarea></div>' +
        '<div class="field"><label>Photo</label><input name="photo" type="file" accept="image/*"></div><button class="btn">Publish product</button></form>');
      $("#role").onclick = async function () {
        try { await (await fns()).becomeRole("seller"); note("Seller request sent."); } catch (e) { note(errText(e)); }
      };
      $("#f").onsubmit = async function (e) {
        e.preventDefault(); var f = e.target; note("Publishing\u2026");
        try {
          var image = "";
          if (f.elements.photo.files[0]) { await wait("firebaseStorageFns", "firebase-storage-ready"); image = await window.firebaseStorageFns.uploadListingImage(f.elements.photo.files[0]); }
          var p = await (await data()).createProduct({ name: f.elements.name.value, price: Number(f.elements.price.value), category: f.elements.category.value, description: f.elements.description.value, image: image });
          location.href = "index.html?page=product&id=" + encodeURIComponent(p.id);
        } catch (err) { note(errText(err)); }
      };
    }
  };

  function authPage(mode) {
    var up = mode === "signup";
    render('<div class="auth-wrap"><div class="auth-card"><div class="auth-head"><span class="auth-orb o1"></span><span class="auth-orb o2"></span><a class="logo" href="index.html"><span class="logo-mark"></span>Alisell</a><p>Shop global. Deliver local.</p></div>' +
      '<div class="auth-body"><div class="auth-tabs"><a href="index.html?page=login"' + (up ? "" : ' class="on"') + '>Sign in</a><a href="index.html?page=signup"' + (up ? ' class="on"' : "") + ">Create account</a></div>" +
      '<div id="msg" class="notice" style="display:none"></div><form id="f">' +
      (up ? '<div class="field"><label>Full name</label><input name="name" required></div>' : "") +
      '<div class="field"><label>Email</label><input name="email" type="email" required></div>' +
      '<div class="field"><label>Password</label><input name="password" type="password" minlength="6" required></div>' +
      '<button class="btn" style="width:100%">' + (up ? "Create account" : "Sign in") + "</button></form>" +
      '<div class="auth-or">or</div><button class="btn-google" id="g" type="button">Continue with Google</button>' +
      (up ? "" : '<button class="auth-link" id="reset" type="button">Forgot password?</button>') + "</div></div></div>", true);
    var done = async function (res) {
      // Save the profile in the background, but never let a slow database keep you on the sign-in form.
      try {
        await Promise.race([
          data().then(function (d) { return d.ensureUserProfile(res.user); }),
          new Promise(function (r) { setTimeout(r, 2000); })
        ]);
      } catch (e) {}
      var next = qs.get("next");
      location.href = next && /^\?[\w=&%.\-]+$/.test(next) ? "index.html" + next : "index.html";
    };
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target; note("");
      if (!fbReady()) return;
      try { await done(up ? await window.firebaseAuthFns.signUp(f.elements.name.value, f.elements.email.value, f.elements.password.value) : await window.firebaseAuthFns.signIn(f.elements.email.value, f.elements.password.value)); }
      catch (err) { note(authErr(err)); }
    };
    $("#g").onclick = async function () { if (!fbReady()) return; try { done(await window.firebaseAuthFns.signInWithGoogle()); } catch (err) { note(authErr(err)); } };
    var r = $("#reset");
    if (r) r.onclick = async function () {
      try { await window.firebaseAuthFns.resetPassword($("#f").elements.email.value); note("Password reset email sent."); } catch (err) { note(errText(err)); }
    };
  }

  var api = { $: $, esc: esc, money: money, pages: pages, qs: qs, render: render, note: note, data: data, fns: fns, authReady: authReady, needLogin: needLogin, errText: errText, wait: wait };
  /* ---- hotels, host, properties, agent, verify, review, admin ---- */
  (function (A) {
  var $ = A.$, esc = A.esc, money = A.money, P = A.pages, qs = A.qs, R = A.render, note = A.note;
  var reload = function () { location.reload(); };

  function fld(n, l, t, x) {
    return '<div class="field"><label>' + l + "</label>" +
      (t === "textarea" ? '<textarea name="' + n + '" rows="3"></textarea>' : '<input name="' + n + '" type="' + (t || "text") + '" ' + (x || "") + ">") + "</div>";
  }
  function sel(n, l, opts) {
    return '<div class="field"><label>' + l + '</label><select name="' + n + '">' + opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + "</select></div>";
  }
  function tile(href, x, title, sub, price) {
    var i = x.image || (x.images && x.images[0]) || "";
    return '<a class="product" href="' + href + '">' + (i ? '<img class="product-img" loading="lazy" alt="" src="' + esc(i) + '">' : '<div class="product-img"></div>') +
      '<div class="product-body"><div>' + esc(title) + '</div><div class="muted">' + esc(sub || "") + '</div><div class="price">' + price + "</div></div></a>";
  }
  function pg(fn, login) {
    return async function () {
      R('<p class="muted">Loading&hellip;</p>');
      try {
        var u = await A.authReady();
        if (login && A.needLogin(u)) return;
        await fn(u);
      } catch (e) { R('<div class="notice">' + esc(A.errText(e)) + "</div>"); }
    };
  }
  function click(map) {
    document.getElementById("app").onclick = async function (e) {
      var t = e.target;
      for (var k in map) if (t.dataset && t.dataset[k] != null) {
        e.preventDefault();
        try { await map[k](t.dataset[k], t); } catch (x) { note(A.errText(x)); }
      }
    };
  }
  async function photo(f) {
    var x = f.elements.photo && f.elements.photo.files[0]; if (!x) return "";
    await A.wait("firebaseStorageFns", "firebase-storage-ready");
    return window.firebaseStorageFns.uploadListingImage(x);
  }
  var MSG = '<div id="msg" class="notice" style="display:none"></div>';
  var roleBtn = function (role, label) {
    setTimeout(function () {
      var b = $("#role"); if (b) b.onclick = async function () { try { await (await A.fns()).becomeRole(role); note("Request sent. Reload to see your new access."); } catch (e) { note(A.errText(e)); } };
    });
    return '<div class="panel" style="margin-bottom:15px"><button class="btn alt" id="role">' + label + "</button></div>";
  };
  var rows = function (list, fn, empty) { return list.length ? list.map(fn).join("") : '<p class="muted">' + empty + "</p>"; };

  /* ---------------- Hotels ---------------- */
  P.hotels = pg(async function () {
    R('<h1>Hotels</h1><p class="muted">Loading&hellip;</p>');
    var l = await (await A.data()).getHotels();
    R('<h1>Hotels</h1><p><a class="btn alt" href="index.html?page=host">List your hotel</a> <a class="btn alt" href="index.html?page=mybookings">My bookings</a></p>' +
      (l.length ? '<div class="product-grid">' + l.map(function (h) { return tile("index.html?page=hotel&id=" + h.id, h, h.name, h.city, money(h.price) + " / night"); }).join("") + "</div>" : '<p class="muted">No hotels yet.</p>'));
  });

  P.hotel = pg(async function () {
    var h = await (await A.data()).getHotel(qs.get("id")), i = h.image || (h.images && h.images[0]) || "";
    R('<div class="detail">' + (i ? '<img class="detail-img" alt="" src="' + esc(i) + '">' : '<div class="detail-img" style="background:#f4f5f6"></div>') +
      "<div><h1>" + esc(h.name) + '</h1><p class="muted">' + esc(h.city || "") + '</p><div class="price">' + money(h.price) + " / night</div><p>" + esc(h.description || "") + "</p>" +
      '<form id="f">' + MSG + fld("checkIn", "Check-in", "date", "required") + fld("checkOut", "Check-out", "date", "required") + fld("guests", "Guests", "number", "min=1 value=1 required") + '<button class="btn">Book and pay</button></form></div></div>');
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target; note("");
      try {
        var u = await A.authReady(); if (A.needLogin(u)) return;
        var F = await A.fns();
        // ASSUMPTION: match these payload fields to your createBooking function.
        var b = await F.createBooking({ hotelId: h.id, checkIn: f.elements.checkIn.value, checkOut: f.elements.checkOut.value, guests: +f.elements.guests.value });
        var pay = await F.initializePayment("booking", b.bookingId || b.id);
        location.href = pay.authorization_url || pay.url || pay.authorizationUrl;
      } catch (x) { note(A.errText(x)); }
    };
  });

  P.mybookings = pg(async function () {
    var l = await (await A.data()).getBookingsForCustomer();
    R("<h1>My bookings</h1>" + rows(l, function (b) {
      return '<div class="panel" style="margin-bottom:10px"><b>' + esc(b.hotelName || b.hotelId) + "</b><br>" + esc(b.checkIn) + " to " + esc(b.checkOut) + ' <span class="badge">' + esc(b.status || "pending") + "</span></div>";
    }, "No bookings yet."));
  }, true);

  P.host = pg(async function (u) {
    var d = await A.data(), hs = await d.getHotelsForOwner(u.uid), bk = await d.getBookingsForHotelOwner(u.uid);
    R("<h1>Hotel host</h1>" + MSG + roleBtn("host", "Become a host") +
      '<form class="panel" id="f"><h3>Add a hotel</h3>' + fld("name", "Name", "text", "required") + fld("city", "City", "text", "required") + fld("price", "Price per night (\u20A6)", "number", "min=1 required") + fld("description", "Description", "textarea") + fld("photo", "Photo", "file", 'accept="image/*"') + '<button class="btn">Add hotel</button></form>' +
      '<div class="panel" style="margin-top:15px"><h3>My hotels</h3>' + rows(hs, function (h) { return '<div class="summary-row"><span>' + esc(h.name) + '</span><button data-delh="' + h.id + '">Delete</button></div>'; }, "None yet.") + "</div>" +
      '<div class="panel" style="margin-top:15px"><h3>Bookings</h3>' + rows(bk, function (b) {
        return '<div class="summary-row"><span>' + esc(b.hotelName || b.hotelId) + " &middot; " + esc(b.checkIn) + " to " + esc(b.checkOut) + " &middot; " + esc(b.status || "pending") +
          '</span><span><button data-bk="confirmed" data-id="' + b.id + '">Confirm</button> <button data-bk="cancelled" data-id="' + b.id + '">Cancel</button></span></div>';
      }, "No bookings.") + "</div>");
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target; note("Saving\u2026");
      try { await d.createHotel({ name: f.elements.name.value, city: f.elements.city.value, price: +f.elements.price.value, description: f.elements.description.value, image: await photo(f) }); reload(); } catch (x) { note(A.errText(x)); }
    };
    click({
      delh: async function (id) { await d.deleteHotel(id); reload(); },
      bk: async function (s, t) { await (await A.fns()).updateBookingStatus(t.dataset.id, s); reload(); }
    });
  }, true);

  /* ---------------- Properties ---------------- */
  var TYPES = [["house_rent", "House for rent"], ["house_sale", "House for sale"], ["land_sale", "Land for sale"]];
  var typeName = function (v) { var t = TYPES.filter(function (x) { return x[0] === v; })[0]; return t ? t[1] : v || ""; };

  P.properties = pg(async function () {
    R('<h1>Properties</h1><p class="muted">Loading&hellip;</p>');
    var t = qs.get("type"), l = await (await A.data()).getProperties();
    if (t) l = l.filter(function (p) { return p.type === t; });
    R("<h1>Properties</h1><p>" + TYPES.map(function (x) { return '<a class="btn alt" href="index.html?page=properties&type=' + x[0] + '">' + x[1] + "</a> "; }).join("") +
      '<a class="btn" href="index.html?page=listings">List a property</a></p>' +
      (l.length ? '<div class="product-grid">' + l.map(function (p) { return tile("index.html?page=property&id=" + p.id, p, p.title, typeName(p.type) + (p.city ? ", " + p.city : ""), money(p.price)); }).join("") + "</div>" : '<p class="muted">No properties found.</p>'));
  });

  P.property = pg(async function () {
    var p = await (await A.data()).getProperty(qs.get("id")), i = p.image || (p.images && p.images[0]) || "";
    R('<div class="detail">' + (i ? '<img class="detail-img" alt="" src="' + esc(i) + '">' : '<div class="detail-img" style="background:#f4f5f6"></div>') +
      "<div><h1>" + esc(p.title) + '</h1><p class="muted">' + esc(typeName(p.type)) + " &middot; " + esc(p.city || "") + '</p><div class="price">' + money(p.price) + "</div><p>" + esc(p.description || "") + "</p>" +
      '<form id="f"><h3>Contact the lister</h3>' + MSG + fld("phone", "Your phone", "tel", "required") + fld("message", "Message", "textarea") + '<button class="btn">Send enquiry</button></form></div></div>');
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target; note("");
      try {
        var u = await A.authReady(); if (A.needLogin(u)) return;
        await (await A.data()).createPropertyLead({ propertyId: p.id, propertyTitle: p.title, ownerUid: p.ownerUid, phone: f.elements.phone.value, message: f.elements.message.value });
        f.reset(); note("Enquiry sent. The lister will contact you.");
      } catch (x) { note(A.errText(x)); }
    };
  });

  P.listings = pg(async function (u) {
    var d = await A.data(), ps = await d.getPropertiesForOwner(u.uid), ls = await d.getLeadsForOwner(u.uid);
    R("<h1>My property listings</h1>" + MSG +
      '<form class="panel" id="f"><h3>Add a property</h3>' + fld("title", "Title", "text", "required") + sel("type", "Type", TYPES) + fld("city", "City", "text", "required") + fld("price", "Price (\u20A6)", "number", "min=1 required") + fld("description", "Description", "textarea") + fld("photo", "Photo", "file", 'accept="image/*"') + '<button class="btn">Publish</button></form>' +
      '<div class="panel" style="margin-top:15px"><h3>My properties</h3>' + rows(ps, function (p) { return '<div class="summary-row"><span>' + esc(p.title) + '</span><button data-delp="' + p.id + '">Delete</button></div>'; }, "None yet.") + "</div>" +
      '<div class="panel" style="margin-top:15px"><h3>Enquiries</h3>' + rows(ls, function (l) { return '<div class="summary-row"><span><b>' + esc(l.customerName) + "</b> (" + esc(l.phone) + ") on " + esc(l.propertyTitle || "") + ": " + esc(l.message || "") + "</span></div>"; }, "No enquiries.") + "</div>");
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target; note("Saving\u2026");
      try { await d.createProperty({ title: f.elements.title.value, type: f.elements.type.value, city: f.elements.city.value, price: +f.elements.price.value, description: f.elements.description.value, image: await photo(f) }); reload(); } catch (x) { note(A.errText(x)); }
    };
    click({ delp: async function (id) { await d.deleteProperty(id); reload(); } });
  }, true);

  /* ---------------- Delivery agent ---------------- */
  P.agent = pg(async function (u) {
    var d = await A.data(), open = [], mine = [];
    try { open = await d.getUnassignedOrders(); } catch (e) {}
    mine = await d.getOrdersForAgent(u.uid);
    var line = function (o) { return "Order " + esc(o.id.slice(0, 8)) + " &middot; " + esc(o.address || o.deliveryAddress || "") + " &middot; " + money(o.total); };
    R("<h1>Delivery agent</h1>" + MSG + roleBtn("agent", "Become a delivery agent") +
      '<div class="panel"><h3>Available orders</h3>' + rows(open, function (o) { return '<div class="summary-row"><span>' + line(o) + '</span><button class="btn" data-claim="' + o.id + '">Claim</button></div>'; }, "No orders waiting.") + "</div>" +
      '<div class="panel" style="margin-top:15px"><h3>My deliveries</h3>' + rows(mine, function (o) {
        return '<div class="summary-row"><span>' + line(o) + ' <span class="badge">' + esc(o.status || "assigned") + "</span></span>" + (o.status === "delivered" ? "" : '<button class="btn" data-done="' + o.id + '">Mark delivered</button>') + "</div>";
      }, "Nothing claimed yet.") + "</div>");
    click({
      claim: async function (id) { await (await A.fns()).claimOrder(id); reload(); },
      done: async function (id) { await (await A.fns()).markOrderDelivered(id); reload(); }
    });
  }, true);

  /* ---------------- Verification ---------------- */
  P.verify = pg(async function (u) {
    var d = await A.data(), v = await d.getVerificationRequest(u.uid);
    R("<h1>Verify your identity</h1>" + MSG + (v ? '<p>Status: <span class="badge">' + esc(v.status) + "</span>" + (v.note ? " &mdash; " + esc(v.note) : "") + "</p>" : "") +
      '<form class="panel" id="f">' + fld("address", "Home address", "text", "required") + fld("addressProof", "Proof of address (photo)", "file", 'accept="image/*" required') + fld("selfie", "Selfie", "file", 'accept="image/*" required') + '<button class="btn">Submit for review</button></form>');
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target; note("Uploading\u2026");
      try {
        await A.wait("firebaseStorageFns", "firebase-storage-ready");
        var S = window.firebaseStorageFns, a = await S.uploadVerificationDoc(f.elements.addressProof.files[0], "addressProof"), s = await S.uploadVerificationDoc(f.elements.selfie.files[0], "selfie");
        await (await A.fns()).submitVerification({ address: f.elements.address.value, addressProofPath: a.path, selfiePath: s.path });
        note("Submitted. We will review it shortly.");
      } catch (x) { note(A.errText(x)); }
    };
  }, true);

  /* ---------------- Reviews ---------------- */
  P.review = pg(async function () {
    R("<h1>Leave a review</h1>" + MSG + '<form class="panel" id="f">' + sel("rating", "Rating", [[5, "5 - Excellent"], [4, "4 - Good"], [3, "3 - Okay"], [2, "2 - Poor"], [1, "1 - Bad"]]) + fld("comment", "Comment", "textarea") + '<button class="btn">Submit review</button></form>');
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target; note("");
      try {
        await (await A.fns()).createReview({ targetUid: qs.get("target"), orderId: qs.get("order") || null, bookingId: qs.get("booking") || null, rating: +f.elements.rating.value, comment: f.elements.comment.value });
        note("Thank you for your review.");
      } catch (x) { note(A.errText(x)); }
    };
  }, true);

  /* ---------------- Admin ---------------- */
  P.admin = pg(async function () {
    var F = await A.fns(), d = await A.data(), ov = await F.getAdminOverview(), pv = await d.getPendingVerifications();
    R("<h1>Admin</h1>" + MSG + '<div class="stats">' + Object.keys(ov || {}).filter(function (k) { return typeof ov[k] !== "object"; }).map(function (k) {
      return '<div class="stat"><span class="muted">' + esc(k) + '</span><div class="num">' + esc(ov[k]) + "</div></div>";
    }).join("") + "</div>" +
      '<div class="panel" style="margin-top:15px"><h3>Pending verifications</h3>' + rows(pv, function (v) {
        return '<div class="summary-row"><span>' + esc(v.name || v.id) + ' <a href="#" data-doc="addressProof" data-u="' + v.id + '">address proof</a> <a href="#" data-doc="selfie" data-u="' + v.id + '">selfie</a></span>' +
          '<span><button class="btn" data-rv="approved" data-u="' + v.id + '">Approve</button> <button data-rv="rejected" data-u="' + v.id + '">Reject</button></span></div>';
      }, "Nothing pending.") + "</div>" +
      '<form class="panel" id="f" style="margin-top:15px"><h3>Set a user role</h3>' + fld("uid", "User ID", "text", "required") + sel("role", "Role", [["customer", "customer"], ["seller", "seller"], ["host", "host"], ["agent", "agent"], ["admin", "admin"]]) + '<button class="btn">Update role</button></form>');
    $("#f").onsubmit = async function (e) {
      e.preventDefault(); var f = e.target;
      try { await F.setUserRole(f.elements.uid.value.trim(), f.elements.role.value); note("Role updated."); } catch (x) { note(A.errText(x)); }
    };
    click({
      doc: async function (kind, t) { var r = await F.getVerificationDocumentUrl(t.dataset.u, kind); window.open(r.url || r.signedUrl, "_blank"); },
      rv: async function (decision, t) { await F.reviewVerification(t.dataset.u, decision, ""); reload(); }
    });
  }, true);
})(api);

  // Safety net: any error that slips through is shown instead of leaving a stale or blank page.
  window.addEventListener("unhandledrejection", function (e) { render('<div class="notice">' + esc(errText(e.reason)) + "</div>"); });

  (pages[page] || function () { render('<h1>Page not found</h1><a class="btn" href="index.html">Go home</a>'); })();
})();
