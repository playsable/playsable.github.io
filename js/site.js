const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-img");
const caption = document.getElementById("lightbox-caption");

if (lightbox && typeof lightbox.showModal === "function") {
  document.querySelectorAll(".shot").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      lightboxImage.src = link.href;
      lightboxImage.alt = link.querySelector("img").alt;
      caption.textContent = link.closest("figure").querySelector("figcaption").textContent;
      lightbox.showModal();
    });
  });
  lightbox.addEventListener("click", (event) => {
    if (event.target !== lightbox) return;
    const bounds = lightbox.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) lightbox.close();
  });
}

const sky = document.getElementById("sky");
function openLinkedDetails() {
  const target = document.getElementById(location.hash.slice(1));
  if (target instanceof HTMLDetailsElement) target.open = true;
}
openLinkedDetails();
window.addEventListener("hashchange", openLinkedDetails);
sky.addEventListener("toggle", () => {
  if (!sky.open) sky.querySelector("video").pause();
});

const status = document.querySelector("[data-server-status]");
let pending = false;
async function refreshWorldStatus() {
  if (document.hidden || pending) return;
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

refreshWorldStatus();
window.setInterval(refreshWorldStatus, 20000);
document.addEventListener("visibilitychange", refreshWorldStatus);
