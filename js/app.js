/* FridgeWise UI: rendering and event handling. */
(function () {
  var L = FW.logic;
  var state = FW.storage.load();
  var listFilter = null;            // null | "orange" | "red"
  var sortMode = "category";        // "category" | "expiry"
  var recipeFilters = {};           // ready / quick / vegetarian
  var editingId = null;
  var expiryTouched = false;
  var undoTimer = null;
  var hintShown = false;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function fmtQty(it) {
    var u = it.unit === "units" ? (Number(it.qty) === 1 ? "unit" : "units") : it.unit;
    return it.qty + " " + u;
  }
  function emojiFor(name, category) {
    var key = String(name || "").toLowerCase().trim();
    if (FW.PRODUCT_EMOJI[key]) return FW.PRODUCT_EMOJI[key];
    var p = L.findProduct(key);
    if (p) return FW.CATEGORY_EMOJI[p.category] || "🛒";
    return FW.CATEGORY_EMOJI[category] || "🛒";
  }

  function persist() {
    FW.storage.save(state);
    render();
  }

  /* ---------- Header ---------- */
  function renderHeader() {
    var h = new Date().getHours();
    var greet = h < 5 ? "Late night snack? 🌙" : h < 12 ? "Good morning ☀️" : h < 17 ? "Good afternoon 👋" : "Good evening 🌆";
    $("#hello").textContent = greet;
  }

  /* ---------- Fridge screen ---------- */
  function soonItems() {
    return state.items.filter(function (it) {
      var d = L.daysLeft(it.expiry);
      return d >= 0 && d <= L.SOON_DAYS;
    }).sort(function (a, b) { return L.daysLeft(a.expiry) - L.daysLeft(b.expiry); });
  }

  // Hero card: the main call to action, focused on food that should be used first (spec §6.5)
  function renderHero() {
    var el = $("#hero");
    if (!state.items.length) { el.hidden = true; return; }
    el.hidden = false;
    var soon = soonItems();
    var ready = L.scoreRecipes(state.items).filter(function (r) { return r.missingRequired === 0; }).length;

    if (soon.length) {
      el.className = "hero hero--alert";
      el.innerHTML =
        '<div class="hero-kicker">⏰ Use it soon</div>' +
        '<h2>' + soon.length + (soon.length === 1 ? ' item needs' : ' items need') + ' some love</h2>' +
        '<div class="hero-items">' + soon.map(function (it) {
          return '<span class="hero-pill"><span aria-hidden="true">' + emojiFor(it.name, it.category) + '</span>' +
            esc(it.name) + ' <small>' + L.daysLabel(it.expiry).toLowerCase() + '</small></span>';
        }).join("") + '</div>' +
        '<button type="button" class="hero-btn" data-go="cook">🍳 What should I cook today?</button>';
    } else {
      el.className = "hero";
      el.innerHTML =
        '<div class="hero-kicker">✨ All fresh</div>' +
        '<h2>' + (ready ? ready + ' recipe' + (ready > 1 ? 's' : '') + ' ready with what you have' : 'Let\'s find something to cook') + '</h2>' +
        '<button type="button" class="hero-btn" data-go="cook">🍳 What should I cook today?</button>';
    }
  }

  function renderSummary() {
    var soon = 0, red = 0;
    state.items.forEach(function (it) {
      var s = L.status(it.expiry);
      if (s === "orange") soon++;
      if (s === "red") red++;
    });
    $("#summary").innerHTML =
      '<button type="button" class="stat all" data-stat="all" aria-pressed="' + (listFilter === null) + '"><b>' + state.items.length + '</b><span><i class="dot"></i>All items</span></button>' +
      '<button type="button" class="stat orange" data-stat="orange" aria-pressed="' + (listFilter === "orange") + '"><b>' + soon + '</b><span><i class="dot"></i>Expiring soon</span></button>' +
      '<button type="button" class="stat red" data-stat="red" aria-pressed="' + (listFilter === "red") + '"><b>' + red + '</b><span><i class="dot"></i>Today / gone</span></button>';
    $("#summary").hidden = state.items.length === 0;
  }

  function itemRow(it) {
    var st = L.status(it.expiry);
    var canDec = it.unit === "units" && Number(it.qty) > 1;
    return '<div class="item ' + st + '">' +
      '<div class="item-ico" aria-hidden="true">' + emojiFor(it.name, it.category) + '</div>' +
      '<button type="button" class="item-main" data-edit="' + it.id + '" aria-label="Edit ' + esc(it.name) + '">' +
        '<div class="item-name">' + esc(it.name) + '</div>' +
        '<div class="item-meta"><span class="badge ' + st + '">' + L.daysLabel(it.expiry) + '</span><span>' + esc(fmtQty(it)) + '</span></div>' +
      '</button>' +
      '<div class="item-actions">' +
        (canDec ? '<button type="button" class="icon-btn" data-dec="' + it.id + '" title="Used one" aria-label="Use one ' + esc(it.name) + '">−1</button>' : '') +
        '<button type="button" class="icon-btn used" data-used="' + it.id + '" title="Used up / thrown away" aria-label="Remove ' + esc(it.name) + '">✓</button>' +
      '</div>' +
    '</div>';
  }

  function renderFridge() {
    renderHero();
    renderSummary();
    var q = $("#search").value.trim().toLowerCase();
    var items = state.items.filter(function (it) {
      if (q && it.name.toLowerCase().indexOf(q) === -1) return false;
      if (listFilter && L.status(it.expiry) !== listFilter) return false;
      return true;
    }).sort(function (a, b) { return L.daysLeft(a.expiry) - L.daysLeft(b.expiry); });

    var empty = state.items.length === 0;
    $("#empty-state").hidden = !empty;
    $("#toolbar").hidden = empty;
    $$("[data-sort]").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.sort === sortMode); });

    var html = "";
    if (!empty && items.length === 0) {
      html = '<p class="lead" style="text-align:center;padding:24px">Nothing here 🙂</p>';
    } else if (sortMode === "category") {
      FW.CATEGORIES.forEach(function (cat) {
        var g = items.filter(function (it) { return (it.category || "Other") === cat; });
        if (!g.length) return;
        html += '<h3 class="group-title"><span aria-hidden="true">' + FW.CATEGORY_EMOJI[cat] + '</span>' + esc(cat) +
          '<span class="count">' + g.length + '</span></h3>' + g.map(itemRow).join("");
      });
    } else {
      html = items.map(itemRow).join("");
    }
    $("#fridge-list").innerHTML = html;
    renderReminder();
  }

  // spec §7.3: friendly, non-nagging reminder if the inventory hasn't been updated lately
  function renderReminder() {
    var el = $("#reminder");
    var dismissed = false;
    try { dismissed = sessionStorage.getItem("fw.reminderDismissed") === "1"; } catch (e) {}
    if (!state.items.length || !state.lastUpdated || dismissed) { el.hidden = true; return; }
    var days = Math.floor((Date.now() - new Date(state.lastUpdated).getTime()) / 86400000);
    if (days < 3) { el.hidden = true; return; }
    el.innerHTML = '<span aria-hidden="true">👋</span><span>It\'s been ' + days + ' days since your last update. Used anything? Tap ✓ to keep ideas accurate.</span>' +
      '<button type="button" class="close" aria-label="Dismiss">×</button>';
    el.hidden = false;
  }

  /* ---------- Cook screen ---------- */
  function ingChip(cls, label) {
    return '<li class="ing ' + cls + '">' + esc(label) + '</li>';
  }

  function renderRecipes() {
    var results = L.scoreRecipes(state.items).filter(function (r) {
      if (recipeFilters.ready && r.missingRequired > 0) return false;
      if (recipeFilters.quick && r.recipe.minutes > 20) return false;
      if (recipeFilters.vegetarian && r.recipe.tags.indexOf("vegetarian") === -1) return false;
      return true;
    });

    var el = $("#recipe-list");
    if (!state.items.length) {
      el.innerHTML = '<div class="empty"><div class="empty-art" aria-hidden="true">🍳</div><h2>Nothing to cook with yet</h2>' +
        '<p>Add a few things from your fridge and we\'ll suggest recipes.</p>' +
        '<div class="empty-actions"><button class="btn primary" type="button" data-action="open-add">＋ Add products</button></div></div>';
      return;
    }
    if (!results.length) {
      el.innerHTML = '<p class="lead" style="text-align:center;padding:24px">No recipes match these filters. Try removing one.</p>';
      return;
    }

    el.innerHTML = results.map(function (r, i) {
      var pct = Math.round(r.ratio * 100);
      var haveChips = r.have.map(function (h) {
        return ingChip("have" + (h.opt ? " opt" : ""), "✓ " + h.name + (h.opt ? " (opt.)" : ""));
      }).join("");
      var missChips = r.missing.map(function (m) {
        return ingChip("miss" + (m.opt ? " opt" : ""), "+ " + m.name + (m.opt ? " (opt.)" : ""));
      }).join("");
      var stapleChips = r.staples.map(function (s) { return ingChip("staple", s); }).join("");
      var ok = r.missingRequired === 0;
      var status = ok ? "✅ You have everything!" : "🛒 Missing " + r.missingRequired + " ingredient" + (r.missingRequired > 1 ? "s" : "");

      return '<article class="recipe' + (i === 0 ? " top" : "") + '">' +
        '<div class="recipe-hero">' +
          '<div class="recipe-emoji" aria-hidden="true">' + (FW.RECIPE_EMOJI[r.recipe.id] || "🍽️") + '</div>' +
          '<div class="recipe-title">' +
            (i === 0 ? '<div class="best">⭐ Best pick today</div>' : '') +
            '<h3>' + esc(r.recipe.name) + '</h3>' +
            '<div class="recipe-meta">⏱ ' + r.recipe.minutes + ' min' +
              (r.recipe.tags.indexOf("vegetarian") !== -1 ? ' · 🌱 Veggie' : '') + '</div>' +
          '</div>' +
          '<div class="ring" style="--p:' + pct + '" role="img" aria-label="' + pct + '% match"><span>' + pct + '%</span></div>' +
        '</div>' +
        '<div class="recipe-body">' +
          '<div class="status-line ' + (ok ? "ok" : "miss") + '">' + status + '</div>' +
          (r.urgent.length ? '<div class="urgent"><span aria-hidden="true">⏰</span><span>Uses up <b>' + r.urgent.map(esc).join(", ") + '</b> before it goes bad</span></div>' : '') +
          '<div class="ing-label">From your fridge</div><ul class="ing-list">' + haveChips + '</ul>' +
          (missChips ? '<div class="ing-label">You\'ll need</div><ul class="ing-list">' + missChips + '</ul>' : '') +
          (stapleChips ? '<div class="ing-label">Pantry basics</div><ul class="ing-list">' + stapleChips + '</ul>' : '') +
        '</div>' +
        '<details><summary>How to make it</summary><ol>' +
          r.recipe.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join("") +
        '</ol></details>' +
      '</article>';
    }).join("");
  }

  function render() {
    renderHeader();
    renderFridge();
    renderRecipes();
  }

  function showScreen(name) {
    $$(".screen").forEach(function (s) { s.classList.toggle("active", s.id === "screen-" + name); });
    $$(".tab").forEach(function (t) {
      var on = t.dataset.screen === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
    });
    $("#screen-heading").textContent = name === "cook" ? "What to cook" : "My Fridge";
    window.scrollTo(0, 0);
  }

  /* ---------- Toast ---------- */
  function toast(msg, actionLabel, action) {
    var el = $("#toast");
    clearTimeout(undoTimer);
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button">' + esc(actionLabel) + '</button>' : '');
    el.hidden = false;
    if (actionLabel) {
      el.querySelector("button").onclick = function () { el.hidden = true; action(); };
    }
    undoTimer = setTimeout(function () { el.hidden = true; }, 5000);
  }

  /* ---------- Item actions ---------- */
  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return i;
    return -1;
  }

  function removeItem(id) {
    var i = findItem(id);
    if (i === -1) return;
    var removed = state.items.splice(i, 1)[0];
    persist();
    toast(removed.name + " removed", "Undo", function () {
      state.items.splice(Math.min(i, state.items.length), 0, removed);
      persist();
    });
  }

  function decItem(id) {
    var i = findItem(id);
    if (i === -1) return;
    var it = state.items[i];
    it.qty = Math.max(0, Number(it.qty) - 1);
    if (it.qty === 0) { removeItem(id); return; }
    persist();
  }

  /* ---------- Add / edit sheet ---------- */
  var dialog = $("#item-dialog");
  var form = $("#item-form");

  function fillStatics() {
    $("#product-suggestions").innerHTML = FW.PRODUCTS.map(function (p) {
      return '<option value="' + esc(p.name) + '">';
    }).join("");
    $("#f-category").innerHTML = FW.CATEGORIES.map(function (c) {
      return '<option value="' + esc(c) + '">' + FW.CATEGORY_EMOJI[c] + ' ' + esc(c) + '</option>';
    }).join("");
    var picks = ["Milk", "Eggs", "Tomatoes", "Cottage cheese", "Yellow cheese", "Cucumbers", "Bread", "Chicken breast"];
    $("#quick-picks").innerHTML = picks.map(function (p) {
      return '<button type="button" data-pick="' + esc(p) + '"><span aria-hidden="true">' + emojiFor(p) + '</span>' +
        esc({ "Yellow cheese": "Cheese", "Cottage cheese": "Cottage", "Chicken breast": "Chicken" }[p] || p) + '</button>';
    }).join("");
  }

  function markDateChip() {
    var d = L.daysLeft($("#f-expiry").value);
    $$("#date-chips button").forEach(function (b) { b.classList.toggle("on", Number(b.dataset.days) === d); });
  }

  function updateNameEmoji() {
    $("#name-emoji").textContent = emojiFor($("#f-name").value, $("#f-category").value);
    var v = $("#f-name").value.trim().toLowerCase();
    $$("#quick-picks button").forEach(function (b) { b.classList.toggle("on", b.dataset.pick.toLowerCase() === v); });
  }

  function applyProductDefaults() {
    var p = L.findProduct($("#f-name").value);
    if (p) {
      $("#f-category").value = p.category;
      $("#f-unit").value = p.unit;
      if (p.unit !== "units" && Number($("#f-qty").value) === 1) {
        $("#f-qty").value = p.unit === "g" ? 250 : 1000;
      }
      if (!expiryTouched && editingId === null) {
        $("#f-expiry").value = L.addDays(p.shelf);
        $("#expiry-hint").textContent = "💡 " + p.name + ": usually good for about " + p.shelf + " days. Check the package and adjust.";
      }
    } else {
      $("#expiry-hint").textContent = "";
    }
    updateNameEmoji();
    markDateChip();
  }

  function resetForm() {
    form.reset();
    $("#f-qty").value = 1;
    $("#f-unit").value = "units";
    $("#f-category").value = "Other";
    $("#f-expiry").value = L.addDays(7);
    $("#expiry-hint").textContent = "";
    expiryTouched = false;
    $("#f-keep-open").checked = true;
    updateNameEmoji();
    markDateChip();
  }

  function openAdd() {
    editingId = null;
    resetForm();
    $("#dialog-title").textContent = "Add to fridge";
    $("#f-save").textContent = "Add to fridge";
    $("#f-delete").hidden = true;
    $("#keep-open-wrap").hidden = false;
    $("#pick-section").hidden = false;
    dialog.showModal();
  }

  function openEdit(id) {
    var i = findItem(id);
    if (i === -1) return;
    var it = state.items[i];
    editingId = id;
    resetForm();
    $("#dialog-title").textContent = "Edit product";
    $("#f-save").textContent = "Save changes";
    $("#f-delete").hidden = false;
    $("#keep-open-wrap").hidden = true;
    $("#pick-section").hidden = true;
    $("#f-name").value = it.name;
    $("#f-qty").value = it.qty;
    $("#f-unit").value = it.unit;
    $("#f-category").value = it.category || "Other";
    $("#f-expiry").value = it.expiry;
    expiryTouched = true;
    updateNameEmoji();
    markDateChip();
    dialog.showModal();
  }

  function stepQty(dir) {
    var unit = $("#f-unit").value;
    var step = unit === "units" ? 1 : unit === "g" ? 50 : 100;
    var v = Math.max(0, (Number($("#f-qty").value) || 0) + dir * step);
    $("#f-qty").value = v;
  }

  function submitForm(e) {
    e.preventDefault();
    var name = $("#f-name").value.trim();
    var qty = Number($("#f-qty").value);
    var expiry = $("#f-expiry").value;
    if (!name) { $("#f-name").focus(); return; }
    if (!expiry || !(qty >= 0)) return;
    name = cap(name);
    var data = { name: name, qty: qty, unit: $("#f-unit").value, expiry: expiry, category: $("#f-category").value };

    if (editingId) {
      var i = findItem(editingId);
      if (i !== -1) Object.assign(state.items[i], data);
      dialog.close();
      persist();
      toast(name + " updated");
      return;
    }

    data.id = uid();
    data.added = L.todayISO();
    state.items.push(data);
    persist();

    var keepOpen = $("#f-keep-open").checked;
    // spec §7.3 habit loop: show value after the first 2–3 items
    if (!hintShown && state.items.length >= 2 && state.items.length <= 3) {
      hintShown = true;
      toast(name + " added. You can already get recipe ideas!", "Show me", function () {
        dialog.close(); showScreen("cook");
      });
    } else {
      toast(emojiFor(name, data.category) + " " + name + " added");
    }
    if (keepOpen) {
      resetForm();
    } else {
      dialog.close();
    }
  }

  /* ---------- Sample data (Daniel scenario from the spec) ---------- */
  function loadSample() {
    var mk = function (name, qty, unit, days, category) {
      return { id: uid(), name: name, qty: qty, unit: unit, expiry: L.addDays(days), category: category, added: L.todayISO() };
    };
    state.items = [
      mk("Milk", 1000, "ml", 5, "Dairy"),
      mk("Cottage cheese", 250, "g", 0, "Dairy"),
      mk("Tomatoes", 4, "units", 2, "Vegetables"),
      mk("Yellow cheese", 200, "g", 12, "Dairy"),
      mk("Eggs", 6, "units", 14, "Eggs"),
      mk("Cucumbers", 3, "units", 6, "Vegetables")
    ];
    persist();
    toast("Sample fridge loaded");
  }

  /* ---------- Events ---------- */
  function bind() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.action === "open-add") return openAdd();
      if (t.dataset.go) return showScreen(t.dataset.go);
      if (t.dataset.edit) return openEdit(t.dataset.edit);
      if (t.dataset.used) return removeItem(t.dataset.used);
      if (t.dataset.dec) return decItem(t.dataset.dec);
      if (t.dataset.screen) return showScreen(t.dataset.screen);
      if (t.dataset.sort) { sortMode = t.dataset.sort; return renderFridge(); }
      if (t.dataset.stat) {
        listFilter = t.dataset.stat === "all" || listFilter === t.dataset.stat ? null : t.dataset.stat;
        return renderFridge();
      }
      if (t.dataset.filter) {
        var f = t.dataset.filter;
        recipeFilters[f] = !recipeFilters[f];
        t.setAttribute("aria-pressed", recipeFilters[f]);
        return renderRecipes();
      }
      if (t.dataset.pick) {
        $("#f-name").value = t.dataset.pick;
        return applyProductDefaults();
      }
      if (t.dataset.days) {
        $("#f-expiry").value = L.addDays(Number(t.dataset.days));
        expiryTouched = true;
        $("#expiry-hint").textContent = "";
        return markDateChip();
      }
      if (t.classList.contains("close") && t.closest("#reminder")) {
        try { sessionStorage.setItem("fw.reminderDismissed", "1"); } catch (err) {}
        $("#reminder").hidden = true;
      }
    });

    $("#load-sample").addEventListener("click", loadSample);
    $("#search").addEventListener("input", renderFridge);

    $("#f-name").addEventListener("input", applyProductDefaults);
    $("#f-name").addEventListener("change", applyProductDefaults);
    $("#f-category").addEventListener("change", updateNameEmoji);
    $("#f-expiry").addEventListener("input", function () { expiryTouched = true; $("#expiry-hint").textContent = ""; markDateChip(); });
    $("#qty-minus").addEventListener("click", function () { stepQty(-1); });
    $("#qty-plus").addEventListener("click", function () { stepQty(1); });
    form.addEventListener("submit", submitForm);
    $("#f-cancel").addEventListener("click", function () { dialog.close(); });
    $("#f-delete").addEventListener("click", function () {
      var id = editingId;
      dialog.close();
      removeItem(id);
    });
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });

    // Re-render every hour so colours stay right if the app stays open.
    setInterval(render, 60 * 60 * 1000);
  }

  fillStatics();
  bind();
  render();
})();
