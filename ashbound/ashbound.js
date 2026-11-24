"use strict";
// Ashbound on seyble.com: sign in with your Seyble account (email code, same as the game), then Stripe Checkout.
// The checkout is created server-side for the signed-in account (client_reference_id + metadata), and the
// signature-verified webhook grants the items to that account. No card data ever touches this page.
(() => {
const SUPABASE = "https://cbabwpvvwerumifvbema.supabase.co";
const FN = SUPABASE + "/functions/v1/create-checkout";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiYWJ3cHZ2d2VydW1pZnZiZW1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4OTgyOTUsImV4cCI6MjExMDQ3NDI5NX0.1ICtyaSMqcjWV6bd7raBGb7WDxlRKOLfJEoPscPER3U"; // public anon key (same as the game)
const LIVE = true; // payments open
const $ = (s) => document.querySelector(s);
const store = window.sessionStorage;
let session = null;
try { session = JSON.parse(store.getItem("seyble_session") || "null"); } catch (e) { session = null; }
if (session && session.expires_at * 1000 < Date.now() + 60000) session = null;

const dlg = $("#ash-signin"), emailIn = $("#ash-email"), codeIn = $("#ash-code"), msg = $("#ash-signin-msg");
const status = $("#ash-status"), who = $("#ash-who");
let pending = null; // product to buy after sign-in

function say(el, text, bad) { if (!el) return; el.textContent = text; el.classList.toggle("bad", !!bad); }
async function auth(path, body) {
  const r = await fetch(SUPABASE + "/auth/v1/" + path, { method: "POST", headers: { "content-type": "application/json", apikey: ANON }, body: JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, data };
}
async function fn(body, extra) {
  const r = await fetch(FN, { method: "POST", headers: Object.assign({ "content-type": "application/json", apikey: ANON, authorization: "Bearer " + session.access_token }, extra || {}), body: JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch (e) {}
  if (r.status === 401) signOut();
  return { ok: r.ok, status: r.status, data: data || {} };
}
function signOut() { session = null; store.removeItem("seyble_session"); render({}); }
function render(st) {
  const signed = !!session;
  document.body.classList.toggle("signed-in", signed);
  if (who) who.textContent = signed ? "Signed in as " + (session.email || "your Seyble account") : "";
  const join = $("#ash-join"), starter = $("#ash-starter"), manage = $("#ash-manage"), out = $("#ash-signout");
  if (out) out.hidden = !signed;
  if (join) { join.disabled = !LIVE || !!st.member; join.textContent = st.member ? "You're Ashbound" : "Join Ashbound \u00b7 $4.99/mo"; }
  if (starter) { starter.disabled = !LIVE || !!st.starter_owned; starter.textContent = st.starter_owned ? "Starter pack owned" : "Get the Ember Starter Pack \u00b7 $0.99"; }
  if (manage) manage.hidden = !(signed && st.has_billing);
  if (st.member && st.cancel_at_period_end && st.current_period_end) say(status, "Your membership ends on " + new Date(st.current_period_end).toLocaleDateString() + ". You keep everything you've earned.");
}
async function refresh() {
  if (!session) { render({}); return; }
  const r = await fn({ action: "status" });
  render(r.ok ? r.data : {});
}
function openSignIn(product) {
  pending = product || null;
  say(msg, ""); codeIn.value = ""; $("#ash-step-code").hidden = true; $("#ash-step-email").hidden = false;
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  emailIn.focus();
}
async function sendCode(e) {
  e.preventDefault();
  const email = emailIn.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(msg, "Enter the email you use for Seyble.", true);
  say(msg, "Sending your code\u2026");
  const r = await auth("otp", { email, create_user: false });
  if (!r.ok && (r.status === 422 || (r.data && /otp_disabled|signup/.test(r.data.error_code || "")))) return say(msg, "No Seyble account uses that email. Make one in the game first, then come back.", true);
  if (!r.ok) return say(msg, r.status === 429 ? "Too many tries. Wait a minute and try again." : "Couldn't send a code right now. Try again.", true);
  $("#ash-step-email").hidden = true; $("#ash-step-code").hidden = false; codeIn.focus();
  say(msg, "We emailed a sign-in code to " + email + ".");
}
async function verify(e) {
  e.preventDefault();
  const email = emailIn.value.trim(), code = codeIn.value.trim();
  if (!/^[0-9]{6,10}$/.test(code)) return say(msg, "Enter the code from your email.", true);
  say(msg, "Signing in\u2026");
  const r = await auth("verify", { email, token: code, type: "email" });
  if (!r.ok || !r.data || !r.data.access_token) return say(msg, "That code didn't work. Check it, or send a new one.", true);
  session = { access_token: r.data.access_token, expires_at: Math.floor(Date.now() / 1000) + Number(r.data.expires_in || 3600), email };
  store.setItem("seyble_session", JSON.stringify(session));
  dlg.close ? dlg.close() : dlg.removeAttribute("open");
  await refresh();
  if (pending) { const p = pending; pending = null; buy(p); }
}
async function buy(product) {
  if (!LIVE) return;
  if (!session) return openSignIn(product);
  say(status, "Opening secure checkout\u2026");
  const r = await fn({ product_id: product, request_id: crypto.randomUUID() }, { "x-seyble-return": "ashbound" });
  if (r.ok && /^https:\/\/checkout\.stripe\.com\//.test(r.data.url || "")) { window.location.href = r.data.url; return; }
  const err = r.data.error || "";
  if (err === "already_owned") say(status, product === "ashbound_monthly" ? "You're already Ashbound on this account." : "You already own the Ember Starter Pack.", true);
  else if (err === "sign_in_required") { openSignIn(product); say(status, ""); }
  else if (err === "profile_required") say(status, "Finish making your character in the game first, then come back.", true);
  else if (err === "account_frozen") say(status, "Purchases are paused on this account.", true);
  else say(status, "Checkout isn't available right now. Nothing was charged. Try again in a minute.", true);
}
async function manage() {
  const r = await fn({ action: "portal" });
  if (r.ok && /^https:\/\/billing\.stripe\.com\//.test(r.data.url || "")) window.location.href = r.data.url;
  else say(status, "Couldn't open billing right now. Try again in a minute.", true);
}
// Success page: the reveal + sound play from the player's click (browsers block autoplay sound).
function success(requestId) {
  const box = $("#ash-success"); if (!box) return;
  box.hidden = false;
  const btn = $("#ash-reveal"), note = $("#ash-success-note");
  const audio = new Audio("/assets/ashbound/ashbound_success.mp3"); audio.preload = "auto"; audio.volume = 0.8;
  btn.addEventListener("click", () => {
    audio.currentTime = 0; audio.play().catch(() => {});
    box.classList.add("revealed"); btn.hidden = true;
  });
  $("#ash-success-close").addEventListener("click", () => { box.hidden = true; history.replaceState(null, "", "/ashbound/"); });
  if (!session) { say(note, "Your items go to the Seyble account you paid with. They show up the next time you play (or right away if you're already in)."); return; }
  let tries = 0;
  const poll = async () => {
    const r = await fetch(SUPABASE + "/rest/v1/rpc/sable_store_state", { method: "POST", headers: { "content-type": "application/json", apikey: ANON, authorization: "Bearer " + session.access_token }, body: JSON.stringify({ p_request_id: requestId }) });
    let d = null; try { d = await r.json(); } catch (e) {}
    const st = d && d.order && d.order.status;
    if (st === "paid") { say(note, "It's on your account. Hop in game, everything is waiting for you (already online? it lands within a minute)."); refresh(); return; }
    if (++tries < 20) setTimeout(poll, 3000); else say(note, "Payment received. Your items are on the way to your account and will show up in game shortly.");
  };
  poll();
}
$("#ash-join") && $("#ash-join").addEventListener("click", () => buy("ashbound_monthly"));
$("#ash-starter") && $("#ash-starter").addEventListener("click", () => buy("ember_starter_pack"));
$("#ash-manage") && $("#ash-manage").addEventListener("click", manage);
$("#ash-signout") && $("#ash-signout").addEventListener("click", signOut);
$("#ash-signin-link") && $("#ash-signin-link").addEventListener("click", () => openSignIn(null));
$("#ash-form-email").addEventListener("submit", sendCode);
$("#ash-form-code").addEventListener("submit", verify);
$("#ash-resend").addEventListener("click", (e) => { $("#ash-step-code").hidden = true; $("#ash-step-email").hidden = false; sendCode(e); });
$("#ash-cancel").addEventListener("click", () => dlg.close ? dlg.close() : dlg.removeAttribute("open"));
const q = new URLSearchParams(location.search);
if (q.get("checkout") === "success" && /^[0-9a-f-]{36}$/.test(q.get("request_id") || "")) success(q.get("request_id"));
else if (q.get("checkout") === "cancel") say(status, "Checkout cancelled. You weren't charged.");
refresh();
})();
