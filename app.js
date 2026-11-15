const CONFIG = { name: "Alkhair Drinks Catering Kano" };

const naira = n => "₦" + Number(n).toLocaleString();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// Turns 0803 123 4567 or +234 803 123 4567 into 2348031234567
function normalizePhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("2340")) d = "234" + d.slice(4);
  else if (d.startsWith("0")) d = "234" + d.slice(1);
  return d;
}

let MENU = [];
let deliveryFee = 0;
let waNumber = "";
let activeCat = "All";
let session = null;
let authMode = "login";
let popId = null;
let popQty = 1;
let toastTimer = null;
let pendingId = null;
try { pendingId = Number(localStorage.getItem("kwaido_pending")) || null; } catch (e) {}
let cart = {};
try { cart = JSON.parse(localStorage.getItem("kwaido_cart")) || {}; } catch (e) { cart = {}; }

function saveCart() {
  try { localStorage.setItem("kwaido_cart", JSON.stringify(cart)); } catch (e) {}
}
function savePending() {
  try {
    if (pendingId) localStorage.setItem("kwaido_pending", String(pendingId));
    else localStorage.removeItem("kwaido_pending");
  } catch (e) {}
}

// ---------- Menu ----------
async function loadData() {
  const [p, s] = await Promise.all([
    sb.from("products").select("*").order("sort").order("id"),
    sb.from("settings").select("*").in("key", ["delivery_fee", "logo_url", "whatsapp"])
  ]);
  if (p.error) {
    $("menu").innerHTML = '<p class="empty">Could not load the menu. Please refresh.</p>';
    return;
  }
  MENU = p.data;
  const set = {};
  (s.data || []).forEach(r => set[r.key] = r.value);
  deliveryFee = Number(set.delivery_fee) || 0;
  waNumber = normalizePhone(set.whatsapp);
  if (set.logo_url) { $("logo").src = set.logo_url; $("logo").hidden = false; }
  if (waNumber) {
    $("cateringLink").href = `https://wa.me/${waNumber}?text=${encodeURIComponent("Hello, I want to make a catering enquiry.")}`;
    $("cateringLink").hidden = false;
  }
  renderTabs();
  renderMenu();
  renderCart();
  checkPending();
}

function renderTabs() {
  const cats = ["All", ...new Set(MENU.map(m => m.cat))];
  $("tabs").innerHTML = cats.map(c =>
    `<button class="tab ${c === activeCat ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
    activeCat = b.dataset.cat; renderTabs(); renderMenu();
  });
}

function renderMenu() {
  const items = MENU.filter(m => activeCat === "All" || m.cat === activeCat);
  $("menu").innerHTML = items.map(m => `
    <div class="card ${m.available ? "" : "out"}" data-id="${m.id}">
      ${m.image_url
        ? `<img class="p-img" src="${esc(m.image_url)}" alt="${esc(m.name)}" loading="lazy">`
        : `<div class="emoji">${esc(m.emoji || "🍽️")}</div>`}
      <h4>${esc(m.name)}</h4>
      <div class="price">${naira(m.price)}</div>
      <button ${m.available ? "" : "disabled"}>${m.available ? "Order this" : "Sold out"}</button>
    </div>`).join("");
  document.querySelectorAll(".card").forEach(c => c.onclick = () => {
    if (!c.classList.contains("out")) selectProduct(Number(c.dataset.id));
  });
}

// ---------- Product popup ----------
async function selectProduct(id) {
  await authReady;
  if (!session) {
    pendingId = id; savePending();
    openAuth("signup", "Create an account to start ordering. It only takes a minute.");
    return;
  }
  openProduct(id);
}

function openProduct(id) {
  const m = MENU.find(x => x.id === id);
  if (!m || !m.available) return;
  popId = id; popQty = 1;
  if (m.image_url) {
    $("prodImg").src = m.image_url;
    $("prodImg").hidden = false;
    $("prodEmoji").hidden = true;
  } else {
    $("prodImg").hidden = true;
    $("prodEmoji").hidden = false;
    $("prodEmoji").textContent = m.emoji || "🍽️";
  }
  $("prodName").textContent = m.name;
  $("prodCat").textContent = m.cat;
  $("prodPrice").textContent = naira(m.price);
  $("pQty").textContent = popQty;
  $("prodModal").hidden = false;
}

function closeProd() { $("prodModal").hidden = true; }

$("closeProd").onclick = closeProd;
$("prodModal").onclick = e => { if (e.target === $("prodModal")) closeProd(); };
$("pMinus").onclick = () => { if (popQty > 1) { popQty--; $("pQty").textContent = popQty; } };
$("pPlus").onclick = () => { if (popQty < 50) { popQty++; $("pQty").textContent = popQty; } };

$("pAdd").onclick = () => {
  const m = MENU.find(x => x.id === popId);
  if (!m) return;
  cart[popId] = Math.min(50, (cart[popId] || 0) + popQty);
  saveCart(); renderCart(); closeProd();
  showToast(`✅ ${popQty} x ${m.name} added to cart`);
  const btn = $("openCart"); btn.style.transform = "scale(1.2)";
  setTimeout(() => btn.style.transform = "", 200);
};

function showToast(text) {
  $("toastText").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").hidden = true, 3500);
}
$("toastView").onclick = () => { $("toast").hidden = true; openCart(); };

// ---------- Cart ----------
function changeQty(id, d) {
  cart[id] = Math.min(50, (cart[id] || 0) + d);
  if (cart[id] <= 0) delete cart[id];
  saveCart(); renderCart();
}

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function totals() {
  let sub = 0;
  for (const id in cart) {
    const m = MENU.find(x => x.id == id);
    if (m) sub += m.price * cart[id];
  }
  const fee = mode() === "delivery" && sub > 0 ? deliveryFee : 0;
  return { sub, fee, total: sub + fee };
}

function renderCart() {
  if (MENU.length) {
    for (const id in cart) {
      const m = MENU.find(x => x.id == id);
      if (!m || !m.available) delete cart[id];
    }
  }
  const ids = Object.keys(cart);
  $("cartCount").textContent = ids.reduce((a, id) => a + cart[id], 0);
  $("cartItems").innerHTML = ids.length ? ids.map(id => {
    const m = MENU.find(x => x.id == id);
    if (!m) return "";
    return `<div class="cart-item">
      <div class="ci-left">
        ${m.image_url ? `<img class="ci-img" src="${esc(m.image_url)}" alt="">` : ""}
        <div>${esc(m.name)}<br><small>${naira(m.price)} each</small></div>
      </div>
      <div class="qty">
        <button onclick="changeQty(${id},-1)">−</button>
        <span>${cart[id]}</span>
        <button onclick="changeQty(${id},1)">+</button>
      </div></div>`;
  }).join("") : `<div class="empty">Your cart is empty</div>`;

  const t = totals();
  $("subtotal").textContent = naira(t.sub);
  $("fee").textContent = naira(t.fee);
  $("total").textContent = naira(t.total);
  $("address").style.display = mode() === "delivery" ? "block" : "none";
}

function openCart() { $("drawer").classList.add("open"); $("overlay").classList.add("show"); }
function closeCart() {
  $("drawer").classList.remove("open");
  $("overlay").classList.remove("show");
  $("cartView").style.display = "block";
  $("done").style.display = "none";
}

$("openCart").onclick = openCart;
$("closeCart").onclick = closeCart;
$("overlay").onclick = closeCart;
document.querySelectorAll('input[name="mode"]').forEach(r => r.onchange = renderCart);

// ---------- Accounts ----------
function userInfo() {
  const u = session && session.user;
  const m = (u && u.user_metadata) || {};
  return { name: m.full_name || m.name || "", phone: m.phone || "" };
}

function updateAuthUI() {
  const info = userInfo();
  $("authBtn").textContent = session ? "Logout" : "Login";
  $("hello").textContent = session && info.name ? "Hi, " + info.name.split(" ")[0] : "";
  $("submitBtn").textContent = session ? "Place order" : "Log in to place order";
  if (session) {
    if (!$("name").value) $("name").value = info.name;
    if (!$("phone").value) $("phone").value = info.phone;
  }
}

function setAuthMode(m) {
  authMode = m;
  const su = m === "signup";
  $("authTitle").textContent = su ? "Create account" : "Log in";
  $("a-name").hidden = !su;
  $("a-phone").hidden = !su;
  $("authSubmit").textContent = su ? "Create account" : "Log in";
  $("authSwitch").innerHTML = su
    ? 'Already have an account? <a href="#" id="swLink">Log in</a>'
    : 'New here? <a href="#" id="swLink">Create account</a>';
  $("swLink").onclick = ev => { ev.preventDefault(); setAuthMode(su ? "login" : "signup"); };
  $("authMsg").textContent = "";
}

function openAuth(m, note) {
  setAuthMode(m || "login");
  $("authNote").textContent = note || "";
  $("authNote").hidden = !note;
  $("authModal").hidden = false;
}
function closeAuth() { $("authModal").hidden = true; }

function userCloseAuth() {
  pendingId = null; savePending();
  closeAuth();
}

// After login or signup, open the product the customer clicked earlier.
function checkPending() {
  if (!session || !pendingId || !MENU.length) return;
  const id = pendingId;
  pendingId = null; savePending();
  closeAuth();
  openProduct(id);
}

$("authBtn").onclick = async () => {
  if (session) { await sb.auth.signOut(); return; }
  openAuth("login");
};
$("closeAuth").onclick = userCloseAuth;
$("authModal").onclick = e => { if (e.target === $("authModal")) userCloseAuth(); };

$("googleBtn").onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) { $("authMsg").className = "auth-msg err"; $("authMsg").textContent = error.message; }
};

$("authForm").onsubmit = async e => {
  e.preventDefault();
  const msg = $("authMsg");
  msg.className = "auth-msg err"; msg.textContent = "";
  const email = $("a-email").value.trim();
  const password = $("a-password").value;
  const btn = $("authSubmit");
  btn.disabled = true;

  let res;
  if (authMode === "signup") {
    const name = $("a-name").value.trim();
    const phone = $("a-phone").value.trim();
    if (!name || !phone) {
      btn.disabled = false;
      msg.textContent = "Please enter your full name and phone number.";
      return;
    }
    res = await sb.auth.signUp({ email, password, options: { data: { full_name: name, phone } } });
  } else {
    res = await sb.auth.signInWithPassword({ email, password });
  }

  btn.disabled = false;
  if (res.error) { msg.textContent = res.error.message; return; }
  if (!res.data.session) {
    msg.className = "auth-msg ok";
    msg.textContent = "Account created. Check your email to confirm, then log in.";
    return;
  }
  $("authForm").reset();
  closeAuth();
  checkPending();
};

const authReady = sb.auth.getSession().then(({ data }) => {
  session = data.session;
  updateAuthUI();
  checkPending();
});
sb.auth.onAuthStateChange((_event, s) => {
  session = s;
  updateAuthUI();
  checkPending();
});

// ---------- Checkout ----------
$("checkout").onsubmit = async e => {
  e.preventDefault();
  const ids = Object.keys(cart);
  if (!ids.length) return alert("Your cart is empty.");
  if (!session) { openAuth("login"); return; }

  const isDelivery = mode() === "delivery";
  const name = $("name").value.trim();
  const phone = $("phone").value.trim();
  const address = $("address").value.trim();
  const notes = $("notes").value.trim();
  if (!name || !phone) return alert("Please enter your name and phone number.");
  if (isDelivery && !address) return alert("Please enter your delivery address.");

  const btn = $("submitBtn");
  btn.disabled = true; btn.textContent = "Placing order...";

  const items = ids.map(id => ({ id: Number(id), qty: cart[id] }));
  const { data, error } = await sb.rpc("place_order", {
    p_name: name, p_phone: phone, p_mode: mode(),
    p_address: isDelivery ? address : "", p_notes: notes, p_items: items
  });

  btn.disabled = false; updateAuthUI();
  if (error) return alert("Could not place order: " + error.message);

  const trackUrl = new URL("track.html?code=" + data.code, location.href).href;
  const lines = ids.map(id => {
    const m = MENU.find(x => x.id == id);
    return `- ${cart[id]} x ${m.name} = ${naira(m.price * cart[id])}`;
  }).join("\n");

  const msg =
`*New order ${data.code} - ${CONFIG.name}*

${lines}

Subtotal: ${naira(data.subtotal)}
Delivery fee: ${naira(data.fee)}
*Total: ${naira(data.total)}*

Type: ${isDelivery ? "Delivery" : "Pickup"}
Name: ${name}
Phone: ${phone}${isDelivery ? "\nAddress: " + address : ""}${notes ? "\nNotes: " + notes : ""}

Track: ${trackUrl}`;

  const waButton = waNumber
    ? `<a class="order-btn" style="display:block;text-decoration:none;margin:14px 0" href="https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}" target="_blank">Also send on WhatsApp</a>`
    : "";

  $("cartView").style.display = "none";
  $("done").style.display = "block";
  $("done").innerHTML = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:48px">✅</div>
      <h3>Order placed!</h3>
      <p style="margin:10px 0">Your order code is</p>
      <p style="font-size:26px;font-weight:bold;color:#1b6b3a;letter-spacing:2px">${data.code}</p>
      <p style="color:#666;margin:10px 0">Total: ${naira(data.total)}</p>
      ${waButton}
      <a style="color:#1b6b3a" href="${trackUrl}">Track my order</a>
    </div>`;

  cart = {}; saveCart();
  $("address").value = ""; $("notes").value = "";
  renderCart();
};

renderCart();
loadData();