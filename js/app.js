import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, collection, writeBatch, increment, runTransaction, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Offline cache: internet chala jaye to bhi app chalti rahe, wapis aane par sync
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

export const DEFAULT_SETTINGS = {
  cafeName: "Chai Chuski",
  address: "117B F/F C Commercial Jasmine Block Bahria Town Lahore",
  phone: "0300-1723299",
  shiftStart: 18,
  shiftEnd: 4,
  cancelHash: ""
};

let settingsCache = null;
export async function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    const s = await getDoc(doc(db, "settings", "app"));
    settingsCache = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
  } catch { settingsCache = { ...DEFAULT_SETTINGS }; }
  return settingsCache;
}

/* ---------- helpers ---------- */
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
export const num = (n) => Number(n || 0);
export const money = (n) => num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " PKR";
export const fmtN = (n) => (Number.isInteger(num(n)) ? num(n) : num(n).toFixed(2));
export const toDate = (t) => (t?.toDate ? t.toDate() : t ? new Date(t) : null);
const p2 = (n) => String(n).padStart(2, "0");
export function fmtDate(t, withTime = true) {
  const d = toDate(t); if (!d) return "";
  let s = `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()}`;
  if (withTime) { let h = d.getHours(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; s += ` ${p2(h)}:${p2(d.getMinutes())} ${ap}`; }
  return s;
}
export const toLocalInput = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const nowTs = () => Timestamp.now();
export const tsFrom = (d) => Timestamp.fromDate(d);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shift range e.g. 6 PM -> 4 AM next day */
export function shiftRange(settings, daysBack = 0) {
  const start = num(settings.shiftStart), end = num(settings.shiftEnd);
  const base = new Date(); base.setHours(0, 0, 0, 0);
  if (new Date().getHours() < end) base.setDate(base.getDate() - 1);
  base.setDate(base.getDate() - daysBack);
  const from = new Date(base); from.setHours(start, 0, 0, 0);
  const to = new Date(base); to.setHours(end, 0, 0, 0);
  if (end <= start) to.setDate(to.getDate() + 1);
  return [from, to];
}

export function orderLabel(o) {
  if (o.orderType === "dine-in") return "Table " + (o.tableNo || "");
  return o.orderType === "takeaway" ? "Take Away" : "Delivery";
}
export const PAY_LABEL = { cash: "Cash", transaction: "Transaction", pay_later: "Pay Later" };

export function toast(msg, type = "success") {
  let box = $("toastBox");
  if (!box) { box = document.createElement("div"); box.id = "toastBox"; box.className = "fixed top-4 right-4 z-50 space-y-2"; document.body.appendChild(box); }
  const el = document.createElement("div");
  el.className = "rounded-md px-4 py-3 text-sm shadow border " + (type === "error" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200");
  el.textContent = msg; box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ---------- products & stock ---------- */
export async function loadProducts() {
  const snap = await getDocs(collection(db, "products"));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  all.sort((a, b) => num(a.sort) - num(b.sort) || String(a.name).localeCompare(b.name));
  const cats = all.filter((p) => !p.parentId);
  const children = {};
  all.filter((p) => p.parentId).forEach((p) => (children[p.parentId] ||= []).push(p));
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  return { all, cats, children, byId };
}

/** direction -1 = sale (stock kam), +1 = wapis */
export function addStockOps(batch, items, direction, byId) {
  for (const it of items) {
    if (!it.productId || !byId[it.productId]) continue;
    const p = byId[it.productId];
    batch.update(doc(db, "products", p.id), { stock: increment(direction * num(it.qty)) });
    if (p.parentId && num(p.ratio) > 0 && byId[p.parentId]) {
      batch.update(doc(db, "products", p.parentId), { stock: increment(direction * num(it.qty) * num(p.ratio)) });
    }
  }
}

export async function nextOrderNo() {
  try {
    return await runTransaction(db, async (tx) => {
      const ref = doc(db, "settings", "counter");
      const s = await tx.get(ref);
      const n = (s.exists() ? num(s.data().orderNo) : 0) + 1;
      tx.set(ref, { orderNo: n }, { merge: true });
      return n;
    });
  } catch {
    return Number(String(Date.now()).slice(-6)); // offline fallback
  }
}

export { writeBatch, increment };

/* ---------- layout ---------- */
const NAV = [
  ["pos.html", "POS"], ["orders.html", "Order History"], ["products.html", "Manage Products"],
  ["expenses.html", "Manage Expenses"], ["customers.html", "Manage Customers"], ["loans.html", "Manage Loan"]
];

function renderNav(user, settings) {
  const page = location.pathname.split("/").pop() || "index.html";
  const active = { "customer.html": "customers.html" }[page] || page;
  const links = NAV.map(([f, l]) => `<a href="${f}" class="inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium leading-5 ${active === f ? "border-indigo-400 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}">${l}</a>`).join("");
  const mlinks = NAV.map(([f, l]) => `<a href="${f}" class="block ps-4 py-2 ${active === f ? "bg-indigo-50 border-l-4 border-indigo-400 text-indigo-700" : "text-gray-600"}">${l}</a>`).join("");
  const nav = document.createElement("nav");
  nav.className = "bg-white border-b border-gray-100 no-print";
  nav.innerHTML = `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div class="flex justify-between h-16">
    <div class="flex items-center">
      <a href="pos.html" class="shrink-0 flex items-center gap-2"><span class="h-9 w-9 rounded-lg bg-amber-500 text-white flex items-center justify-center font-bold">☕</span><span class="font-semibold hidden xl:inline">${esc(settings.cafeName)}</span></a>
      <div class="hidden sm:flex sm:ms-8 h-full space-x-6">${links}</div>
    </div>
    <div class="flex items-center gap-2">
      <div class="relative" id="userMenu">
        <button type="button" id="userBtn" class="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700">${esc(user.displayName || "Admin")} <span class="ms-1">▾</span></button>
        <div id="userDrop" class="hidden absolute right-0 z-50 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black/5 py-1">
          <div class="px-4 py-2 text-xs text-gray-500 border-b">${esc(user.email)}</div>
          <a href="settings.html" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Settings</a>
          <button id="logoutBtn" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Log Out</button>
        </div>
      </div>
      <button type="button" class="sm:hidden p-2 text-gray-500" id="mBtn">☰</button>
    </div>
  </div></div>
  <div id="mobileNav" class="hidden sm:hidden border-t border-gray-100 pb-2">${mlinks}</div>`;
  document.body.prepend(nav);
  $("userBtn").onclick = () => $("userDrop").classList.toggle("hidden");
  $("mBtn").onclick = () => $("mobileNav").classList.toggle("hidden");
  $("logoutBtn").onclick = async () => { await signOut(auth); location.href = "index.html"; };
  document.addEventListener("click", (e) => { if (!$("userMenu").contains(e.target)) $("userDrop").classList.add("hidden"); });
}

/** Har protected page isko call kare. Login na ho to index.html par bhej deta hai. */
export function requireAuth(start, { nav = true } = {}) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.href = "index.html"; return; }
    const settings = await getSettings();
    if (nav) renderNav(user, settings);
    document.body.classList.remove("invisible");
    try { await start(user, settings); }
    catch (e) {
      console.error(e);
      const msg = e?.code === "permission-denied" ? "Is account ko data dekhne ki ijazat nahi (Firestore rules check karein)." : (e.message || e);
      toast("Error: " + msg, "error");
    }
  });
}
