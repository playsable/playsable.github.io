// Seyble homepage: lightbox, trailer, lazy hero loop, launcher OS hint, latest patch notes, world status.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const saveData = navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || ""));

/* Header: solid once you scroll past the top of the hero. */
const header = document.querySelector("[data-header]");
if (header) {
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, {passive: true});
}

/* Screenshot lightbox. */
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-img");
const caption = document.getElementById("lightbox-caption");
if (lightbox && typeof lightbox.showModal === "function") {
  document.querySelectorAll(".shot").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      const img = link.querySelector("img");
      lightboxImage.src = link.href;
      lightboxImage.alt = img ? img.alt : "";
      const label = link.closest("figure")?.querySelector("figcaption") || link.parentElement.querySelector("span");
      caption.textContent = label ? label.textContent : "";
      lightbox.showModal();
    });
  });
  lightbox.addEventListener("click", (event) => { if (event.target === lightbox) lightbox.close(); });
}

/* Linked <details> (#sky, #pledge) open when targeted. */
function openLinkedDetails() {
  const id = location.hash.slice(1);
  if (!id) return;
  const target = document.getElementById(id);
  if (target instanceof HTMLDetailsElement) target.open = true;
  if (id === "faq") { const pledge = document.getElementById("pledge"); if (pledge) pledge.open = true; }
}
openLinkedDetails();
window.addEventListener("hashchange", openLinkedDetails);
document.querySelectorAll('a[href="#sky"]').forEach((a) => a.addEventListener("click", () => { const s = document.getElementById("sky"); if (s) s.open = true; }));
const sky = document.getElementById("sky");
if (sky) sky.addEventListener("toggle", () => { if (!sky.open) sky.querySelector("video")?.pause(); });

/* Hero background loop: only fetched on larger screens, without Save-Data or reduced motion. */
const loop = document.querySelector(".hero-loop");
const loopToggle = document.querySelector("[data-loop-toggle]");
function setLoopPaused(paused) {
  if (!loop) return;
  if (paused) loop.pause(); else loop.play().catch(() => {});
  loopToggle.setAttribute("aria-pressed", String(paused));
  loopToggle.textContent = paused ? "Play background video" : "Pause background video";
}
function startLoop() {
  if (!loop || loop.src || reduceMotion.matches || saveData || window.innerWidth < 761) return;
  loop.src = loop.dataset.src;
  loop.addEventListener("playing", () => loop.classList.add("is-playing"), {once: true});
  loop.play().catch(() => {});
  if (loopToggle) {
    loopToggle.hidden = false;
    loopToggle.addEventListener("click", () => setLoopPaused(!loop.paused));
  }
  // Don't burn battery decoding off-screen.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      if (loopToggle.getAttribute("aria-pressed") === "true") return;
      if (entry.isIntersecting) loop.play().catch(() => {}); else loop.pause();
    }).observe(loop);
  }
}
if (document.readyState === "complete") startLoop(); else window.addEventListener("load", startLoop, {once: true});

/* Trailer: loads only when asked for; 720p on small screens. */
const trailerDialog = document.getElementById("trailer-dialog");
if (trailerDialog && typeof trailerDialog.showModal === "function") {
  const video = trailerDialog.querySelector("video");
  document.querySelectorAll("[data-trailer]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      if (!video.src) {
        const px = Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
        video.src = px >= 1400 && !saveData ? video.dataset.hd : video.dataset.sd;
      }
      if (loop && !loop.paused) loop.pause();
      trailerDialog.showModal();
      video.play().catch(() => {});
    });
  });
  trailerDialog.addEventListener("close", () => {
    video.pause();
    if (loop && loop.src && loopToggle?.getAttribute("aria-pressed") !== "true") loop.play().catch(() => {});
  });
  trailerDialog.addEventListener("click", (event) => { if (event.target === trailerDialog) trailerDialog.close(); });
}

/* Launcher: point at the build for this computer. */
(async () => {
  const ua = navigator.userAgent;
  let os = /Windows/.test(ua) ? "win" : /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) && navigator.maxTouchPoints < 2 ? "mac" : "";
  if (os === "mac") {
    os = "mac-arm";
    try {
      const hints = await navigator.userAgentData?.getHighEntropyValues?.(["architecture"]);
      if (hints && hints.architecture === "x86") os = "mac-intel";
    } catch { /* default to Apple silicon, the current Mac line */ }
  }
  if (os) document.querySelectorAll(`[data-os="${os}"]`).forEach((a) => a.classList.add("is-mine"));
})();

/* Latest patch notes: refresh the three cards from /patch-notes/ (static cards stay if this fails). */
const notes = document.querySelector("[data-latest-notes]");
if (notes && "IntersectionObserver" in window) {
  const known = {
    "stay-near-the-fire": "/assets/ob/notes/stay-near-the-fire.webp",
    "ember-and-ale": "/assets/ob/notes/ember-and-ale.webp",
  };
  const fallback = "/assets/ob/regions/cinderwatch-640.webp";
  const io = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    try {
      const response = await fetch("/patch-notes/", {cache: "no-cache"});
      if (!response.ok) return;
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const entries = [...doc.querySelectorAll("article.patch-entry[id]")].slice(0, 3);
      if (entries.length < 3) return;
      const cards = entries.map((article) => {
        const id = article.id;
        const title = article.querySelector("h2")?.textContent.trim() || "Patch notes";
        const time = article.querySelector("time");
        const firstP = [...article.querySelectorAll("p")].find((p) => !p.classList.contains("patch-date"));
        const img = known[id] || article.querySelector("figure img[src$='.png'], figure img[src$='.jpg'], figure img[src$='.webp']")?.getAttribute("src") || fallback;
        const card = document.createElement("article");
        card.className = "note-card";
        const a = document.createElement("a");
        a.href = `/patch-notes/#${encodeURIComponent(id)}`;
        const im = new Image();
        im.src = img; im.alt = ""; im.loading = "lazy"; im.decoding = "async"; im.width = 640; im.height = 360;
        const date = document.createElement("p"); date.className = "note-date";
        if (time) { const t = document.createElement("time"); t.dateTime = time.getAttribute("datetime") || ""; t.textContent = time.textContent; date.append(t); }
        const h3 = document.createElement("h3"); h3.textContent = title;
        const p = document.createElement("p"); p.textContent = firstP ? firstP.textContent.trim() : "";
        a.append(im, date, h3, p); card.append(a);
        return card;
      });
      notes.replaceChildren(...cards);
    } catch { /* keep the static cards */ }
  }, {rootMargin: "400px"});
  io.observe(notes);
}

/* World status. */
const status = document.querySelector("[data-server-status]");
let pending = false;
async function refreshWorldStatus() {
  if (!status || document.hidden || pending) return;
  pending = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  let state = "unknown";
  let text = "World status unavailable";
  try {
    const response = await fetch("https://51-81-86-210.sslip.io/status", {cache: "no-store", signal: controller.signal});
    if (response.ok) {
      const data = await response.json();
      const age = Date.now() / 1000 - Number(data?.updated);
      if (Number.isFinite(age) && age >= -30 && age <= 30 && typeof data.online === "boolean") {
        state = data.online ? "online" : "offline";
        text = data.online ? "World online" : "World offline · solo play available";
      }
    }
  } catch {
    // A failed heartbeat request leaves the world's availability unknown.
  } finally {
    window.clearTimeout(timeout);
    pending = false;
  }
  if (status.dataset.state !== state) {
    status.dataset.state = state;
    status.querySelector(".server-label").textContent = text;
  }
}
if (status) {
  refreshWorldStatus();
  window.setInterval(refreshWorldStatus, 20000);
  document.addEventListener("visibilitychange", refreshWorldStatus);
}
