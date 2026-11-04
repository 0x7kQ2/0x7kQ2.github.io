const FULL = "0x7kQ2";
const brand = document.getElementById("brand");
const brandText = document.getElementById("brand-text");
const brandCursor = document.getElementById("brand-cursor");
const social = document.getElementById("social");

let open = false;
let typingDone = false;

function typeBrand() {
  brandText.textContent = "";
  brandCursor.hidden = false;
  let i = 0;

  const tick = () => {
    if (i < FULL.length) {
      brandText.textContent += FULL[i];
      i += 1;
      setTimeout(tick, 90 + Math.random() * 70);
      return;
    }
    brandCursor.hidden = true;
    typingDone = true;
  };

  setTimeout(tick, 400);
}

function setSocial(visible) {
  open = visible;
  social.hidden = !visible;
  brand.setAttribute("aria-expanded", visible ? "true" : "false");
  document.body.classList.toggle("social-open", visible);
}

function toggleSocial(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!typingDone) return;
  setSocial(!open);
}

brand.addEventListener("click", toggleSocial);
brand.addEventListener(
  "pointerdown",
  (event) => {
    event.stopPropagation();
  },
  { capture: true }
);

social.addEventListener(
  "pointerdown",
  (event) => {
    event.stopPropagation();
  },
  { capture: true }
);

typeBrand();
