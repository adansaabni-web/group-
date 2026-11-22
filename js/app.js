/* FridgeWise UI: rendering and event handling. */
(function () {
  var L = FW.logic;
  var state = FW.storage.load();
  // Cooking rewards (lucky spin). Older saved data has no "cooking" field yet.
  var ck = state.cooking && typeof state.cooking === "object" ? state.cooking : {};
  state.cooking = {
    log: Array.isArray(ck.log) ? ck.log : [],
    spinsUsed: Number(ck.spinsUsed) || 0,
    bonusSpins: Number(ck.bonusSpins) || 0,
    prizes: Array.isArray(ck.prizes) ? ck.prizes : []
  };
  var wheelTurn = 0;                // current wheel rotation in degrees
  var spinning = false;
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

  // Chef rewards card at the top of the Cook screen: every few cooked dishes earn a lucky spin.
  function renderChefCard() {
    var s = L.cookStats(state.cooking);
    var dots = "";
    var filled = s.spins && !s.progress ? s.perSpin : s.progress; // a full bar right after earning a spin
    for (var i = 0; i < s.perSpin; i++) dots += '<i class="' + (i < filled ? "on" : "") + '"></i>';
    var left = s.perSpin - s.progress;
    $("#chef-card").innerHTML =
      '<div class="chef-top">' +
        '<div class="chef-ico" aria-hidden="true">🎡</div>' +
        '<div class="chef-text">' +
          '<div class="chef-kicker">Cook &amp; win</div>' +
          '<b>' + (s.dishes ? s.dishes + ' dish' + (s.dishes > 1 ? 'es' : '') + ' cooked' : 'Cook a recipe to start') + '</b>' +
          '<span>' + (s.spins ? 'You have ' + s.spins + ' spin' + (s.spins > 1 ? 's' : '') + ' ready!' :
            left + ' more dish' + (left > 1 ? 'es' : '') + ' to your next lucky spin') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="chef-dots" role="img" aria-label="' + s.progress + ' of ' + s.perSpin + ' dishes to the next spin">' + dots + '</div>' +
      '<button type="button" class="chef-btn" data-action="open-spin">' +
        (s.spins ? '🎡 Spin the wheel (' + s.spins + ')' : '🎡 See the prizes') + '</button>';
    $("#chef-card").classList.toggle("ready", s.spins > 0);
  }

  function renderRecipes() {
    renderChefCard();
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
          (L.cookedToday(state.cooking, r.recipe.id)
            ? '<button type="button" class="cooked-btn done" disabled>✅ Cooked today</button>'
            : '<button type="button" class="cooked-btn" data-cooked="' + esc(r.recipe.id) + '">🍳 I cooked this!</button>') +
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

  /* ---------- Cook & win: lucky spin ---------- */
  // A suggested recipe counts once per day, so tapping twice doesn't farm spins.
  function cookRecipe(id) {
    if (L.cookedToday(state.cooking, id)) return;
    var before = L.cookStats(state.cooking).spins;
    var entry = { id: id, date: L.todayISO() };
    state.cooking.log.push(entry);
    persist();
    var s = L.cookStats(state.cooking);
    var undo = function () {
      var i = state.cooking.log.indexOf(entry);
      if (i !== -1) state.cooking.log.splice(i, 1);
      persist();
    };
    if (s.spins > before) {
      toast("🎉 " + s.dishes + " dishes cooked. You earned a lucky spin!", "Spin now", openSpin);
    } else {
      toast("👩‍🍳 Nice cooking! " + s.progress + "/" + s.perSpin + " to your next spin", "Undo", undo);
    }
  }

  function buildWheel() {
    var n = FW.SPIN_PRIZES.length, slice = 360 / n;
    $("#wheel").innerHTML = FW.SPIN_PRIZES.map(function (p, i) {
      return '<span class="wheel-label" style="--a:' + (i * slice + slice / 2) + 'deg">' +
        '<b>' + p.emoji + '</b><small>' + esc(p.label) + '</small></span>';
    }).join("");
  }

  function renderSpinSheet() {
    var s = L.cookStats(state.cooking);
    $("#spin-sub").textContent = s.spins
      ? "You have " + s.spins + " spin" + (s.spins > 1 ? "s" : "") + ". Good luck, chef!"
      : "Cook " + (s.perSpin - s.progress) + " more suggested dish" + (s.perSpin - s.progress > 1 ? "es" : "") +
        " to earn a spin. Every " + s.perSpin + " dishes = 1 spin.";
    var go = $("#spin-go");
    go.disabled = spinning || !s.spins;
    go.textContent = s.spins ? "Spin!" : "Cook to unlock 🔒";
    var recent = state.cooking.prizes.slice(-5).reverse();
    $("#prize-history").innerHTML = recent.length
      ? '<p class="sheet-label">Your prizes</p><ul class="prize-list">' + recent.map(function (w) {
          var p = FW.SPIN_PRIZES[w.i] || FW.SPIN_PRIZES[0];
          return '<li><span aria-hidden="true">' + p.emoji + '</span>' + esc(p.label) + '<small>' + fmtDate(w.date) + '</small></li>';
        }).join("") + '</ul>'
      : "";
  }

  function openSpin() {
    $("#spin-result").textContent = "";
    $("#spin-result").classList.remove("win");
    renderSpinSheet();
    var d = $("#spin-dialog");
    if (!d.open) d.showModal();
  }

  function spin() {
    if (spinning || !L.cookStats(state.cooking).spins) return;
    spinning = true;
    var n = FW.SPIN_PRIZES.length, slice = 360 / n;
    var idx = Math.floor(Math.random() * n);
    var prize = FW.SPIN_PRIZES[idx];
    // Use the spin and save the prize right away, so closing the sheet mid-spin can't lose it.
    state.cooking.spinsUsed++;
    if (prize.spin) state.cooking.bonusSpins++;
    state.cooking.prizes.push({ i: idx, date: L.todayISO() });
    persist();

    // The pointer is at the top, so turn the wheel until the middle of slice idx is under it.
    var land = (360 - (idx * slice + slice / 2)) % 360;
    wheelTurn = wheelTurn - (wheelTurn % 360) + 360 * 5 + land;
    $("#spin-result").textContent = "Spinning…";
    $("#spin-result").classList.remove("win");
    $("#spin-go").disabled = true;
    $("#wheel").style.transform = "rotate(" + wheelTurn + "deg)";

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(function () {
      spinning = false;
      $("#spin-result").innerHTML = '<span class="prize-emoji" aria-hidden="true">' + prize.emoji + '</span>' +
        '<b>' + esc(prize.label) + '</b><span>' + esc(prize.text) + '</span>';
      $("#spin-result").classList.add("win");
      renderSpinSheet();
    }, reduce ? 50 : 4200);
  }

  function bindSpin() {
    buildWheel();
    var d = $("#spin-dialog");
    $("#spin-go").addEventListener("click", spin);
    $("#spin-close").addEventListener("click", function () { d.close(); });
    d.addEventListener("click", function (e) { if (e.target === d) d.close(); });
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
      if (t.dataset.action === "open-spin") return openSpin();
      if (t.dataset.cooked) return cookRecipe(t.dataset.cooked);
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
      if (t.classList.contains("close") && t.closest("#welcome")) {
        try { sessionStorage.setItem("fw.welcomeDismissed", "1"); } catch (err) {}
        $("#welcome").hidden = true;
      }
    });

    // Welcome message: shown when the app opens, hidden for the rest of the session once dismissed.
    try { $("#welcome").hidden = sessionStorage.getItem("fw.welcomeDismissed") === "1"; } catch (err) {}

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

  /* ---------- API for the voice agent (js/voice.js) ---------- */
  function matchProduct(name) {
    var n = L.normalize(name);
    return L.findProduct(name) || FW.PRODUCTS.filter(function (p) { return L.normalize(p.name) === n; })[0] || null;
  }

  function findByName(name) {
    var n = L.normalize(name), q = String(name || "").toLowerCase().trim();
    var hits = state.items.filter(function (it) {
      var lower = it.name.toLowerCase();
      return L.normalize(it.name) === n || lower === q || lower.indexOf(q) !== -1 || (q.length > 3 && q.indexOf(lower) !== -1);
    }).sort(function (a, b) { return L.daysLeft(a.expiry) - L.daysLeft(b.expiry); });
    return hits[0] || null;
  }

  FW.app = {
    getItems: function () { return state.items.slice(); },
    addItem: function (o) {
      var raw = String(o.name || "").trim();
      if (!raw) return null;
      var p = matchProduct(raw);
      var unit = o.unit || (p ? p.unit : "units");
      var qty = Number(o.qty) > 0 ? Number(o.qty) : (unit === "g" ? 250 : unit === "ml" ? 1000 : 1);
      var days = typeof o.expiresInDays === "number" ? Math.round(o.expiresInDays) : (p ? p.shelf : 7);
      var it = { id: uid(), name: p ? p.name : cap(raw), qty: qty, unit: unit, expiry: L.addDays(days),
        category: p ? p.category : "Other", added: L.todayISO() };
      state.items.push(it);
      persist();
      toast("🎙️ " + emojiFor(it.name, it.category) + " " + it.name + " added");
      return it;
    },
    useItem: function (name, amount) {
      var it = findByName(name);
      if (!it) return null;
      if (Number(amount) > 0 && Number(amount) < Number(it.qty)) {
        it.qty = Number(it.qty) - Number(amount);
        persist();
        toast("🎙️ " + it.name + ": " + fmtQty(it) + " left");
        return { updated: it.name, left: it.qty, unit: it.unit };
      }
      removeItem(it.id);
      return { removed: it.name };
    },
    showScreen: showScreen
  };

  /* ---------- Voice assistant sheet ---------- */
  function bindVoice() {
    var vd = $("#voice-dialog");
    if (!vd || !FW.voice) return;
    var log = $("#voice-log"), orb = $("#voice-orb"), status = $("#voice-status"), toggle = $("#voice-toggle");
    var bubbles = {};

    function addBubble(who, text, id) {
      var b = document.createElement("div");
      b.className = "bubble " + who;
      b.textContent = text;
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      if (id) bubbles[id] = b;
      $("#voice-examples").hidden = true;
      return b;
    }

    FW.voice.on(function (e) {
      if (e.kind === "state") {
        orb.dataset.state = e.state;
        status.textContent = e.text || "";
        var live = FW.voice.isActive();
        toggle.textContent = live ? "End conversation" : (e.state === "error" ? "Try again" : "Start talking");
        toggle.classList.toggle("danger", live);
        toggle.classList.toggle("primary", !live);
      } else if (e.kind === "user") {
        addBubble("user", e.text);
      } else if (e.kind === "assistant-delta") {
        var b = bubbles[e.id] || addBubble("assistant", "", e.id);
        b.textContent += e.text || "";
        log.scrollTop = log.scrollHeight;
      } else if (e.kind === "assistant-done") {
        if (e.text) (bubbles[e.id] || addBubble("assistant", "", e.id)).textContent = e.text;
      } else if (e.kind === "tool") {
        var labels = { get_fridge: "Checked your fridge", suggest_recipes: "Looked up recipes", get_recipe: "Opened a recipe",
          add_item: "Added " + (e.args.name || "a product"), use_item: "Updated " + (e.args.name || "a product") };
        addBubble("tool", "🔧 " + (labels[e.name] || e.name));
      } else if (e.kind === "error") {
        addBubble("tool", "⚠️ " + e.text);
      }
    });

    $("#voice-btn").addEventListener("click", function () {
      log.innerHTML = ""; bubbles = {};
      $("#voice-examples").hidden = false;
      orb.dataset.state = "idle";
      toggle.disabled = false;
      toggle.textContent = "Start talking";
      toggle.classList.add("primary"); toggle.classList.remove("danger");
      status.textContent = "Checking voice setup…";
      vd.showModal();
      FW.voice.checkAvailable().then(function (r) {
        status.textContent = r.ok ? "Tap start and talk to me" : r.reason;
        if (!r.ok) { orb.dataset.state = "error"; toggle.disabled = true; }
      });
    });
    toggle.addEventListener("click", function () {
      if (FW.voice.isActive()) FW.voice.stop(); else FW.voice.start();
    });
    $("#voice-examples").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (!FW.voice.sendText(b.textContent.replace(/[“”"]/g, ""))) status.textContent = "Tap start first, then try an example.";
    });
    function closeVoice() { FW.voice.stop(); if (vd.open) vd.close(); }
    $("#voice-close").addEventListener("click", closeVoice);
    vd.addEventListener("close", function () { FW.voice.stop(); });
    vd.addEventListener("click", function (e) { if (e.target === vd) closeVoice(); });
  }

  fillStatics();
  bind();
  bindVoice();
  bindSpin();
  render();
})();
