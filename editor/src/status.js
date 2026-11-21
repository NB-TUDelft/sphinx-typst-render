// SPDX-License-Identifier: AGPL-3.0-or-later
// The save status next to the Export button.

let badge;

export function bindBadge(el) { badge = el; }

export function setSaveBadge(text, tone = '') {
  if (!badge) return;
  badge.textContent = text;
  badge.dataset.tone = tone;
}
