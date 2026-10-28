// Fills the page backdrop with floating flowers.
// Purely decorative: the backdrop is aria-hidden and ignores the pointer.

const FLOWER_SVG =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><g transform="translate(16 16)">' +
  [0, 72, 144, 216, 288]
    .map((a) => `<ellipse rx="5" ry="8.5" cy="-7.5" transform="rotate(${a})"/>`)
    .join("") +
  '</g><circle cx="16" cy="16" r="3.6"/></svg>';

const COLORS = ["--flower-1", "--flower-2", "--flower-3"];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function addFlowers(container) {
  if (!container) return;
  container.querySelectorAll(".flower").forEach((f) => f.remove());
  const count = window.innerWidth < 640 ? 8 : 14;
  for (let i = 0; i < count; i++) {
    const flower = document.createElement("div");
    flower.className = "flower";
    const duration = rand(18, 34);
    flower.style.setProperty("--x", `${rand(0, 98).toFixed(1)}vw`);
    flower.style.setProperty("--s", `${Math.round(rand(14, 28))}px`);
    flower.style.setProperty("--c", `var(${COLORS[i % COLORS.length]})`);
    flower.style.setProperty("--d", `${duration.toFixed(0)}s`);
    // Negative delays spread the flowers down the page on first paint.
    flower.style.setProperty("--delay", `${(-rand(0, duration)).toFixed(1)}s`);
    flower.style.setProperty("--r", `${Math.round(rand(-240, 240))}deg`);
    flower.style.setProperty("--sy", `${rand(4, 92).toFixed(1)}vh`);
    flower.innerHTML = FLOWER_SVG;
    container.append(flower);
  }
}
