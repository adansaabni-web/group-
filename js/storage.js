/* FridgeWise local storage (spec §11: v1 keeps data on the device). */

window.FW = window.FW || {};

FW.storage = (function () {
  var KEY = "fridgewise.v1";

  function empty() {
    return { items: [], lastUpdated: null };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return empty();
      return data;
    } catch (e) {
      return empty();
    }
  }

  function save(state) {
    state.lastUpdated = new Date().toISOString();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  return { load: load, save: save };
})();
