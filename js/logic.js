/* FridgeWise core logic: expiry status, ingredient matching and recipe scoring.
   Pure functions only — no DOM access. */

window.FW = window.FW || {};

FW.logic = (function () {
  var SOON_DAYS = 3; // spec §6.3: "close to expiry" = 3 days or less
  var COOKS_PER_SPIN = 3; // every 3 cooked dishes earn one spin of the lucky wheel

  // Generic ingredients that several specific products can satisfy.
  var GENERIC = {
    "cheese": ["cheese", "feta cheese", "parmesan"]
  };

  function todayISO() {
    var d = new Date();
    return toISO(d);
  }

  function toISO(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function addDays(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  // Whole days from today until the expiry date (negative = already expired).
  function daysLeft(expiryISO) {
    if (!expiryISO) return Infinity;
    var p = expiryISO.split("-").map(Number);
    var exp = new Date(p[0], p[1] - 1, p[2]);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((exp - today) / 86400000);
  }

  // green: far away, orange: 1–3 days, red: today or past (spec §6.3)
  function status(expiryISO) {
    var d = daysLeft(expiryISO);
    if (d <= 0) return "red";
    if (d <= SOON_DAYS) return "orange";
    return "green";
  }

  function daysLabel(expiryISO) {
    var d = daysLeft(expiryISO);
    if (d === Infinity) return "No date";
    if (d < -1) return "Expired " + (-d) + " days ago";
    if (d === -1) return "Expired yesterday";
    if (d === 0) return "Expires today";
    if (d === 1) return "Expires tomorrow";
    return d + " days left";
  }

  function normalize(name) {
    var s = String(name || "").toLowerCase().trim().replace(/\s+/g, " ");
    if (FW.ALIASES[s]) return FW.ALIASES[s];
    // try singular/plural variants
    var alt = s.endsWith("s") ? s.slice(0, -1) : s + "s";
    if (FW.ALIASES[alt]) return FW.ALIASES[alt];
    return s;
  }

  function isStaple(name) {
    return FW.STAPLES.indexOf(name) !== -1;
  }

  // Usable inventory: not expired (expiring today is still OK) and quantity > 0.
  // Returns map canonicalName -> soonest-expiring matching item.
  function usableIndex(items) {
    var idx = {};
    items.forEach(function (it) {
      if (Number(it.qty) <= 0) return;
      if (daysLeft(it.expiry) < 0) return; // unsafe — never suggest
      var key = normalize(it.name);
      if (!idx[key] || daysLeft(it.expiry) < daysLeft(idx[key].expiry)) idx[key] = it;
    });
    return idx;
  }

  function findMatch(ingredient, idx) {
    var candidates = GENERIC[ingredient] || [ingredient];
    var best = null;
    candidates.forEach(function (c) {
      var it = idx[c];
      if (it && (!best || daysLeft(it.expiry) < daysLeft(best.expiry))) best = it;
    });
    return best;
  }

  function urgencyBonus(item) {
    var d = daysLeft(item.expiry);
    if (d === 0) return 40;
    if (d <= SOON_DAYS) return 30;
    return 0;
  }

  /* Score every recipe against the inventory.
     score = % of required ingredients available
           + 5 per optional ingredient available
           + urgency bonus for each used item that expires soon (spec §6.5) */
  function scoreRecipes(items) {
    var idx = usableIndex(items);
    var results = [];

    FW.RECIPES.forEach(function (r) {
      var have = [], missing = [], staples = [], urgent = [];
      var reqTotal = 0, reqHave = 0, optHave = 0, bonus = 0;

      r.ingredients.forEach(function (ing) {
        var name = ing.n;
        if (isStaple(name)) { staples.push(name); return; }
        if (!ing.opt) reqTotal++;
        var match = findMatch(name, idx);
        if (match) {
          have.push({ name: name, opt: !!ing.opt, item: match });
          if (ing.opt) optHave++; else reqHave++;
          var b = urgencyBonus(match);
          if (b) { bonus += b; urgent.push(match.name); }
        } else {
          missing.push({ name: name, opt: !!ing.opt });
        }
      });

      if (have.length === 0) return; // nothing from the fridge is used

      var ratio = reqTotal ? reqHave / reqTotal : 1;
      var score = Math.round(ratio * 100 + optHave * 5 + bonus);
      var missingRequired = missing.filter(function (m) { return !m.opt; });

      results.push({
        recipe: r,
        score: score,
        ratio: ratio,
        have: have,
        missing: missing,
        missingRequired: missingRequired.length,
        staples: staples,
        urgent: urgent.filter(function (v, i, a) { return a.indexOf(v) === i; })
      });
    });

    results.sort(function (a, b) {
      return b.score - a.score || a.missingRequired - b.missingRequired || a.recipe.minutes - b.recipe.minutes;
    });
    return results;
  }

  /* Cooking rewards. cooking = { log: [{ id, date }], spinsUsed, bonusSpins, prizes: [{ i, date }] } */
  function cookedToday(cooking, recipeId) {
    var t = todayISO();
    return cooking.log.some(function (c) { return c.id === recipeId && c.date === t; });
  }

  function cookStats(cooking) {
    var dishes = cooking.log.length;
    var earned = Math.floor(dishes / COOKS_PER_SPIN) + (cooking.bonusSpins || 0);
    return {
      dishes: dishes,
      spins: Math.max(0, earned - (cooking.spinsUsed || 0)),
      progress: dishes % COOKS_PER_SPIN, // dishes towards the next spin
      perSpin: COOKS_PER_SPIN
    };
  }

  function findProduct(name) {
    var s = String(name || "").toLowerCase().trim();
    for (var i = 0; i < FW.PRODUCTS.length; i++) {
      if (FW.PRODUCTS[i].name.toLowerCase() === s) return FW.PRODUCTS[i];
    }
    return null;
  }

  return {
    SOON_DAYS: SOON_DAYS,
    COOKS_PER_SPIN: COOKS_PER_SPIN,
    cookedToday: cookedToday,
    cookStats: cookStats,
    todayISO: todayISO,
    addDays: addDays,
    daysLeft: daysLeft,
    status: status,
    daysLabel: daysLabel,
    normalize: normalize,
    scoreRecipes: scoreRecipes,
    findProduct: findProduct
  };
})();
