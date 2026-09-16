// Insert section headers into the theme's download dropdown, so the page's own
// source files and the worksheets rendered by sphinx-typst-render read as two
// labelled groups rather than one undifferentiated list.
//
// The headers are added here rather than server side because the theme macro
// dispatches on a fixed set of button types and forces its own item class, so
// a non-link entry cannot be expressed through the header_buttons context.
(function () {
  "use strict";

  var OURS = ".btn-typst-download";
  var MARK = "data-typst-headed";

  function addHeader(menu, before, text) {
    if (!text || !before) return;
    var item = document.createElement("li");
    var heading = document.createElement("h6");
    heading.className = "dropdown-header";
    heading.textContent = text;
    item.appendChild(heading);
    menu.insertBefore(item, before);
  }

  function decorate() {
    var labels = window.typstRenderLabels || {};
    var menus = document.querySelectorAll(".dropdown-download-buttons ul.dropdown-menu");

    Array.prototype.forEach.call(menus, function (menu) {
      if (menu.hasAttribute(MARK)) return;

      var items = Array.prototype.slice.call(menu.children);
      var ours = items.filter(function (li) { return li.querySelector(OURS); });
      // Nothing of ours on this page means nothing to separate.
      if (!ours.length) return;

      var theirs = items.filter(function (li) { return !li.querySelector(OURS); });
      menu.setAttribute(MARK, "");
      // Insert the lower header first so the reference node stays valid.
      addHeader(menu, ours[0], labels.downloads);
      addHeader(menu, theirs[0], labels.source);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", decorate);
  } else {
    decorate();
  }
})();
