import { getHiddenCount, onHideChange, undoLastHide } from "./apply";

const CHIP_ID = "slopradar-chip";

export function ensureChip(): HTMLElement {
  let chip = document.getElementById(CHIP_ID);
  if (chip) return chip;

  chip = document.createElement("div");
  chip.id = CHIP_ID;
  chip.innerHTML = `
    <span class="slopradar-chip__count">0 hidden</span>
    <button type="button" class="slopradar-chip__undo" title="Show last hidden tweet">undo</button>
  `;
  document.documentElement.appendChild(chip);

  chip.querySelector(".slopradar-chip__undo")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    undoLastHide();
    refreshChip();
  });

  onHideChange(() => refreshChip());
  refreshChip();
  return chip;
}

export function refreshChip(): void {
  const chip = document.getElementById(CHIP_ID);
  if (!chip) return;
  const n = getHiddenCount();
  const count = chip.querySelector(".slopradar-chip__count");
  if (count) count.textContent = `${n} hidden`;
  chip.classList.toggle("slopradar-chip--empty", n === 0);
}

export function setChipVisible(visible: boolean): void {
  const chip = ensureChip();
  chip.style.display = visible ? "" : "none";
}
