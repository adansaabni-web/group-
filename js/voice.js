/* FridgeWise voice agent — OpenAI Realtime API over WebRTC (speech-to-speech).
   Flow: ask our local server for a short-lived key (POST /token) -> WebRTC offer to
   https://api.openai.com/v1/realtime/calls -> tools run here in the browser on the fridge data.
   Docs: https://developers.openai.com/api/docs/guides/voice-agents */

window.FW = window.FW || {};

FW.voice = (function () {
  var L = FW.logic;
  var pc = null, dc = null, mic = null, audioEl = null;
  var state = "idle";            // idle | connecting | listening | thinking | speaking | error
  var listeners = [];
  var handledCalls = {};

  var INSTRUCTIONS = [
    "You are FridgeWise, a friendly kitchen helper for students who cook for themselves.",
    "You help the user decide what to cook from what is already in their fridge, and keep the fridge list up to date.",
    "Always speak English. Keep answers short and natural for speech: 1-3 sentences, no lists longer than 3 items, no markdown.",
    "Use the tools for any fact about the fridge or recipes. Never invent items or recipes.",
    "Prefer recipes that use food expiring soon, and mention that it's a good way to use it up.",
    "Never suggest using food that has already expired; if asked, say it's safer to throw it away.",
    "When the user says they bought something, call add_item once per product. If they don't say the expiry, use the default.",
    "When the user says they used, ate, finished or threw away something, call use_item.",
    "After changing the fridge, confirm briefly what you did."
  ].join(" ");

  var TOOLS = [
    { type: "function", name: "get_fridge",
      description: "List everything currently in the user's fridge with quantity and how many days until it expires.",
      parameters: { type: "object", properties: {}, required: [] } },
    { type: "function", name: "suggest_recipes",
      description: "Get the best recipes for what is in the fridge right now, ranked with soon-to-expire food first.",
      parameters: { type: "object", properties: {
        max_minutes: { type: "number", description: "Only recipes that take at most this many minutes." },
        vegetarian: { type: "boolean", description: "Only vegetarian recipes." },
        ready_only: { type: "boolean", description: "Only recipes the user can make with nothing missing." }
      }, required: [] } },
    { type: "function", name: "get_recipe",
      description: "Get the ingredients (have / missing) and the steps for one recipe.",
      parameters: { type: "object", properties: {
        name: { type: "string", description: "Recipe name, e.g. 'Shakshuka'." }
      }, required: ["name"] } },
    { type: "function", name: "add_item",
      description: "Add a product the user bought to the fridge.",
      parameters: { type: "object", properties: {
        name: { type: "string", description: "Product name in English, e.g. 'Milk', 'Eggs', 'Cottage cheese'." },
        quantity: { type: "number", description: "Amount. Optional." },
        unit: { type: "string", enum: ["units", "g", "ml"], description: "Optional." },
        expires_in_days: { type: "number", description: "Days until expiry. Optional; a typical default is used." }
      }, required: ["name"] } },
    { type: "function", name: "use_item",
      description: "The user used, ate, finished or threw away a product. Removes it, or lowers the quantity if a quantity is given.",
      parameters: { type: "object", properties: {
        name: { type: "string" },
        quantity: { type: "number", description: "How much was used. Omit if all of it." }
      }, required: ["name"] } }
  ];

  /* ---------- tools (run locally on the fridge data) ---------- */
  function fridgeSummary() {
    return FW.app.getItems().map(function (it) {
      return { name: it.name, quantity: it.qty, unit: it.unit,
        days_left: L.daysLeft(it.expiry), expiry: L.daysLabel(it.expiry),
        status: L.daysLeft(it.expiry) < 0 ? "expired" : L.status(it.expiry) === "green" ? "fresh" : "use soon" };
    }).sort(function (a, b) { return a.days_left - b.days_left; });
  }

  function findRecipe(name) {
    var q = String(name || "").toLowerCase().trim();
    var best = null;
    FW.RECIPES.forEach(function (r) {
      var n = r.name.toLowerCase();
      if (!best && (n === q || n.indexOf(q) !== -1 || q.indexOf(n) !== -1)) best = r;
    });
    if (!best) {
      var words = q.split(/\s+/).filter(function (w) { return w.length > 3; });
      FW.RECIPES.forEach(function (r) {
        if (!best && words.some(function (w) { return r.name.toLowerCase().indexOf(w) !== -1; })) best = r;
      });
    }
    return best;
  }

  var tools = {
    get_fridge: function () {
      var items = fridgeSummary();
      return items.length ? { items: items } : { items: [], note: "The fridge is empty." };
    },
    suggest_recipes: function (a) {
      var list = L.scoreRecipes(FW.app.getItems()).filter(function (r) {
        if (a.max_minutes && r.recipe.minutes > a.max_minutes) return false;
        if (a.vegetarian && r.recipe.tags.indexOf("vegetarian") === -1) return false;
        if (a.ready_only && r.missingRequired > 0) return false;
        return true;
      }).slice(0, 5);
      return { recipes: list.map(function (r) {
        return { name: r.recipe.name, minutes: r.recipe.minutes, match_percent: Math.round(r.ratio * 100),
          missing: r.missing.filter(function (m) { return !m.opt; }).map(function (m) { return m.name; }),
          uses_soon_expiring: r.urgent };
      }) };
    },
    get_recipe: function (a) {
      var r = findRecipe(a.name);
      if (!r) return { error: "No recipe called '" + a.name + "'." };
      var scored = L.scoreRecipes(FW.app.getItems()).filter(function (s) { return s.recipe.id === r.id; })[0];
      return { name: r.name, minutes: r.minutes,
        have: scored ? scored.have.map(function (h) { return h.name; }) : [],
        missing: scored ? scored.missing.map(function (m) { return m.name + (m.opt ? " (optional)" : ""); })
                        : r.ingredients.map(function (i) { return i.n; }),
        steps: r.steps };
    },
    add_item: function (a) {
      var it = FW.app.addItem({ name: a.name, qty: a.quantity, unit: a.unit, expiresInDays: a.expires_in_days });
      return it ? { added: it.name, quantity: it.qty, unit: it.unit, expiry: L.daysLabel(it.expiry) } : { error: "Missing product name." };
    },
    use_item: function (a) {
      var r = FW.app.useItem(a.name, a.quantity);
      return r || { error: "There is no '" + a.name + "' in the fridge." };
    }
  };

  /* ---------- connection ---------- */
  function send(evt) {
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(evt));
  }

  function setState(s, text) {
    state = s;
    emit({ kind: "state", state: s, text: text });
  }
  function emit(e) { listeners.forEach(function (fn) { fn(e); }); }

  function errorText(err) {
    if (location.protocol === "file:") return "Voice needs the local server. Run server/serve.ps1 and open http://localhost:5178.";
    if (err && err.name === "NotAllowedError") return "Microphone permission was blocked. Allow it in the browser and try again.";
    if (err && err.name === "NotFoundError") return "No microphone was found.";
    return (err && err.message) || "Something went wrong.";
  }

  function start() {
    if (pc) return Promise.resolve();
    if (location.protocol === "file:") { setState("error", errorText()); return Promise.resolve(); }
    handledCalls = {};
    setState("connecting", "Connecting…");

    return fetch("/token", { method: "POST" })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok || !j.value) throw new Error(j.error || "Couldn't get a voice session from the server.");
          return j.value;
        });
      })
      .then(function (key) {
        return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          mic = stream;
          pc = new RTCPeerConnection();
          audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          pc.ontrack = function (e) { audioEl.srcObject = e.streams[0]; };
          pc.addTrack(stream.getTracks()[0]);
          pc.onconnectionstatechange = function () {
            if (pc && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
              stop(); setState("error", "The connection dropped. Tap start to try again.");
            }
          };
          dc = pc.createDataChannel("oai-events");
          dc.onopen = onOpen;
          dc.onmessage = function (m) { try { onEvent(JSON.parse(m.data)); } catch (e) {} };
          return pc.createOffer();
        }).then(function (offer) {
          return pc.setLocalDescription(offer).then(function () {
            return fetch("https://api.openai.com/v1/realtime/calls", {
              method: "POST", body: offer.sdp,
              headers: { Authorization: "Bearer " + key, "Content-Type": "application/sdp" }
            });
          });
        }).then(function (res) {
          if (!res.ok) throw new Error("OpenAI refused the voice connection (" + res.status + ").");
          return res.text();
        }).then(function (sdp) {
          return pc.setRemoteDescription({ type: "answer", sdp: sdp });
        });
      })
      .catch(function (err) {
        stop();
        setState("error", errorText(err));
      });
  }

  function onOpen() {
    var items = FW.app.getItems();
    send({ type: "session.update", session: {
      type: "realtime",
      instructions: INSTRUCTIONS + " Today is " + new Date().toDateString() + ". The fridge has " + items.length + " products.",
      tools: TOOLS,
      tool_choice: "auto",
      audio: { input: { transcription: { model: "gpt-4o-transcribe" } } }
    } });
    send({ type: "response.create", response: {
      instructions: "Greet the user in one short sentence. If something in the fridge expires within 3 days (check with get_fridge), mention it and offer a recipe idea."
    } });
    setState("listening", "Listening… ask me anything");
  }

  function onEvent(e) {
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        setState("listening", "Listening…");
        break;
      case "input_audio_buffer.speech_stopped":
        setState("thinking", "Thinking…");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.transcript && e.transcript.trim()) emit({ kind: "user", text: e.transcript.trim() });
        break;
      case "response.output_audio_transcript.delta":
        emit({ kind: "assistant-delta", id: e.response_id || e.item_id, text: e.delta });
        if (state !== "speaking") setState("speaking", "Speaking…");
        break;
      case "response.output_audio_transcript.done":
        emit({ kind: "assistant-done", id: e.response_id || e.item_id, text: e.transcript });
        break;
      case "output_audio_buffer.stopped":
        setState("listening", "Listening…");
        break;
      case "response.done":
        handleToolCalls(e.response);
        break;
      case "error":
        emit({ kind: "error", text: (e.error && e.error.message) || "Voice error" });
        break;
    }
  }

  function handleToolCalls(response) {
    var calls = ((response && response.output) || []).filter(function (o) {
      return o.type === "function_call" && !handledCalls[o.call_id];
    });
    if (!calls.length) {
      if (state === "thinking") setState("listening", "Listening…");
      return;
    }
    calls.forEach(function (c) {
      handledCalls[c.call_id] = true;
      var args = {};
      try { args = JSON.parse(c.arguments || "{}"); } catch (err) {}
      var result;
      try { result = tools[c.name] ? tools[c.name](args) : { error: "Unknown tool " + c.name }; }
      catch (err) { result = { error: String(err && err.message || err) }; }
      emit({ kind: "tool", name: c.name, args: args });
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: JSON.stringify(result) } });
    });
    send({ type: "response.create" });
  }

  // Typed question (used by the example chips): same conversation, no microphone needed to speak it.
  function sendText(text) {
    if (!dc || dc.readyState !== "open") return false;
    emit({ kind: "user", text: text });
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: text }] } });
    send({ type: "response.create" });
    setState("thinking", "Thinking…");
    return true;
  }

  function stop() {
    try { if (dc) dc.close(); } catch (e) {}
    try { if (pc) pc.close(); } catch (e) {}
    if (mic) mic.getTracks().forEach(function (t) { t.stop(); });
    if (audioEl) audioEl.srcObject = null;
    pc = dc = mic = audioEl = null;
    if (state !== "error") setState("idle", "Tap start and talk to me");
  }

  function checkAvailable() {
    if (location.protocol === "file:") return Promise.resolve({ ok: false, reason: errorText() });
    if (!navigator.mediaDevices || !window.RTCPeerConnection) return Promise.resolve({ ok: false, reason: "This browser doesn't support voice." });
    return fetch("/health").then(function (r) { return r.json(); }).then(function (j) {
      return j.voice ? { ok: true } : { ok: false, reason: "No OpenAI API key on the server yet. Add OPENAI_API_KEY to a .env file and restart the server." };
    }).catch(function () { return { ok: false, reason: errorText() }; });
  }

  return {
    start: start, stop: stop, sendText: sendText, checkAvailable: checkAvailable,
    isActive: function () { return !!pc; },
    on: function (fn) { listeners.push(fn); },
    tools: tools   // exposed for testing
  };
})();
