/* ============================================================
   stepspeak — client-side one-step-at-a-time spoken walkthrough.
   No network. No dependencies. Voices are the device's own.
   State (last list + settings) lives in localStorage only.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var LS = {
    list:   "stepspeak:list",
    prefs:  "stepspeak:prefs"
  };

  var storageOk = true;
  function storageGet(key) {
    if (!storageOk) return null;
    try { return localStorage.getItem(key); } catch (e) { storageOk = false; return null; }
  }
  function storageSet(key, val) {
    if (!storageOk) return;
    try { localStorage.setItem(key, val); } catch (e) { storageOk = false; }
  }

  /* ---------- built-in example lists ---------- */
  var EXAMPLES = {
    coffee:
      "1. Fill the kettle with fresh water and switch it on.\n" +
      "2. Put one heaped spoon of instant coffee into your mug.\n" +
      "3. Add sugar now if you take it.\n" +
      "4. When the kettle clicks off, pour the hot water into the mug.\n" +
      "5. Stir well for about ten seconds.\n" +
      "6. Add a splash of milk if you like, then stir again.\n" +
      "7. Let it cool for a minute before your first sip.",
    bleed:
      "1. Stay calm and sit or lie the person down.\n" +
      "2. If there is anything easy to remove, take rings or a watch off the injured area.\n" +
      "3. Press firmly on the wound with a clean cloth or pad.\n" +
      "4. Keep pressing without lifting to check for at least ten minutes.\n" +
      "5. If blood soaks through, add another cloth on top and keep pressing.\n" +
      "6. Raise the injured part above the level of the heart if you can.\n" +
      "7. Once bleeding slows, hold the pad in place with a bandage.\n" +
      "8. Get medical help if the wound is deep, will not stop, or was caused by something dirty.",
    shelf:
      "1. Lay all the parts out and check them against the parts list.\n" +
      "2. Stand the two long side panels upright, facing each other.\n" +
      "3. Push the wooden dowels into the holes along the inside of each side panel.\n" +
      "4. Fit the top shelf onto the dowels at the top of both sides.\n" +
      "5. Fit the bottom shelf onto the dowels near the base.\n" +
      "6. Slide the middle shelf onto the dowels in the centre.\n" +
      "7. Turn each cam lock a half turn with a screwdriver to pull the joints tight.\n" +
      "8. Attach the thin backing board with the small nails provided.\n" +
      "9. Stand the shelf up and check it does not wobble before you load it."
  };

  /* ============================================================
     PARSING — text -> array of step strings
     Splits on newlines, strips a single leading list marker,
     ignores blank lines.
     ============================================================ */
  function parseSteps(text) {
    if (!text) return [];
    return text.split(/\r?\n/).map(function (line) {
      // strip a leading marker: "1." "1)" "12 -" "-" "*" "•" "a." etc.
      return line
        .replace(/^\s+/, "")
        .replace(/^(?:\d{1,3}[.)\]:]|[-*•·▪]|[a-zA-Z][.)])\s+/, "")
        .replace(/\s+$/, "");
    }).filter(function (line) { return line.length > 0; });
  }

  /* ============================================================
     SPEECH — the browser's built-in speechSynthesis.
     Handles the async onvoiceschanged so the picker isn't empty.
     ============================================================ */
  var synth = ("speechSynthesis" in window) ? window.speechSynthesis : null;
  var voices = [];

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices() || [];
    populateVoiceSelect();
  }

  function populateVoiceSelect() {
    var sel = $("#voiceSelect");
    var note = $("#voiceNote");
    if (!sel) return;

    if (!synth) {
      sel.innerHTML = "";
      var o = document.createElement("option");
      o.value = ""; o.textContent = "Speech not supported here";
      sel.appendChild(o);
      sel.disabled = true;
      if (note) note.textContent = "This browser has no speech synthesis. The large-print stepper still works silently.";
      return;
    }

    var want = prefs.voiceURI;
    sel.innerHTML = "";

    if (!voices.length) {
      var opt = document.createElement("option");
      opt.value = ""; opt.textContent = "No device voices found";
      sel.appendChild(opt);
      if (note) note.textContent = "No speech voices are installed on this device, so steps can't be read aloud. The large-print stepper still works silently.";
      return;
    }

    // Prefer local voices; sort English-ish first, then by name.
    var sorted = voices.slice().sort(function (a, b) {
      var ae = /^en/i.test(a.lang) ? 0 : 1;
      var be = /^en/i.test(b.lang) ? 0 : 1;
      if (ae !== be) return ae - be;
      return (a.name || "").localeCompare(b.name || "");
    });

    sorted.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = v.name + " (" + v.lang + ")" + (v.localService ? "" : " · remote");
      sel.appendChild(opt);
    });

    // restore a saved choice, else pick the first local English voice
    if (want && sorted.some(function (v) { return v.voiceURI === want; })) {
      sel.value = want;
    } else {
      var def = sorted.filter(function (v) { return v.localService; })[0] || sorted[0];
      if (def) { sel.value = def.voiceURI; prefs.voiceURI = def.voiceURI; }
    }
    if (note) note.textContent = "Voices come from your device — the list may differ on another computer or phone.";
  }

  function currentVoice() {
    var uri = prefs.voiceURI;
    if (!uri) return null;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].voiceURI === uri) return voices[i];
    }
    return null;
  }

  function speak(text) {
    if (!synth || !text) return;
    try {
      synth.cancel(); // never let steps stack up
      var u = new SpeechSynthesisUtterance(text);
      var v = currentVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = prefs.rate;
      u.pitch = prefs.pitch;
      var bubble = $(".bubble");
      u.onstart = function () { if (bubble) bubble.classList.add("is-speaking"); };
      u.onend = function () { if (bubble) bubble.classList.remove("is-speaking"); };
      u.onerror = function () { if (bubble) bubble.classList.remove("is-speaking"); };
      synth.speak(u);
    } catch (e) { /* speech is best-effort */ }
  }

  function stopSpeaking() {
    if (!synth) return;
    try { synth.cancel(); } catch (e) {}
    var bubble = $(".bubble");
    if (bubble) bubble.classList.remove("is-speaking");
  }

  /* ============================================================
     PREFERENCES — persisted in localStorage
     ============================================================ */
  var prefs = {
    autoSpeak: true,
    voiceURI: "",
    rate: 1,
    pitch: 1,
    size: "large",
    theme: "system"
  };

  function loadPrefs() {
    var raw = storageGet(LS.prefs);
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (typeof p.autoSpeak === "boolean") prefs.autoSpeak = p.autoSpeak;
        if (typeof p.voiceURI === "string") prefs.voiceURI = p.voiceURI;
        if (typeof p.rate === "number") prefs.rate = clamp(p.rate, 0.5, 1.6);
        if (typeof p.pitch === "number") prefs.pitch = clamp(p.pitch, 0.6, 1.6);
        if (["normal", "large", "huge"].indexOf(p.size) >= 0) prefs.size = p.size;
        if (["system", "light", "dark"].indexOf(p.theme) >= 0) prefs.theme = p.theme;
      }
    } catch (e) { /* keep defaults */ }
  }
  function savePrefs() { storageSet(LS.prefs, JSON.stringify(prefs)); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function applyTheme() {
    var root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
  }
  function applySize() {
    document.documentElement.setAttribute("data-size", prefs.size);
  }

  /* ============================================================
     STEPPER STATE
     ============================================================ */
  var steps = [];
  var idx = 0;

  function enterStepper(autoSpeakFirst) {
    var section = $("#stepper");
    section.hidden = false;
    idx = 0;
    renderStep(autoSpeakFirst);
    // move focus to Next so keyboard users land in the walkthrough
    var next = $("#nextBtn");
    if (next && next.focus) next.focus();
    if (section.scrollIntoView) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderStep(doSpeak) {
    if (!steps.length) return;
    idx = clamp(idx, 0, steps.length - 1);
    var total = steps.length;
    var human = idx + 1;
    var text = steps[idx];
    var counter = "Step " + human + " of " + total;

    $("#stepText").textContent = text;
    $("#stepChip").textContent = String(human);
    $("#bubbleCount").textContent = counter;
    $("#progressRead").textContent = counter;
    $("#progressFill").style.width = Math.round((human / total) * 100) + "%";

    // announce for screen readers
    $("#liveStep").textContent = counter + ". " + text;

    // prev/next enabled state
    $("#prevBtn").disabled = (idx === 0);
    $("#nextBtn").disabled = (idx === total - 1);

    if (doSpeak && prefs.autoSpeak) speak(text);
    else stopSpeaking();
  }

  function go(delta) {
    var target = idx + delta;
    if (target < 0 || target > steps.length - 1) return;
    idx = target;
    renderStep(true);
  }

  function repeat() {
    if (!steps.length) return;
    // repeat always speaks (that's the whole point of the button/Enter),
    // regardless of the auto-speak toggle, if speech is available.
    speak(steps[idx]);
  }

  /* ============================================================
     COMPOSER wiring
     ============================================================ */
  function updateCount() {
    var parsed = parseSteps($("#stepsInput").value);
    var elc = $("#stepsCount");
    if (!parsed.length) {
      elc.textContent = "No steps yet.";
      elc.classList.remove("has-steps");
    } else {
      elc.textContent = parsed.length + (parsed.length === 1 ? " step ready." : " steps ready.");
      elc.classList.add("has-steps");
    }
    return parsed;
  }

  function start() {
    var parsed = parseSteps($("#stepsInput").value);
    if (!parsed.length) {
      $("#stepsInput").focus();
      var elc = $("#stepsCount");
      elc.textContent = "Add at least one step first, one per line.";
      elc.classList.remove("has-steps");
      return;
    }
    steps = parsed;
    storageSet(LS.list, $("#stepsInput").value);
    // don't auto-speak on the very first render triggered by a click,
    // because some browsers require a user gesture — the click IS that
    // gesture, so speaking here is allowed and expected.
    enterStepper(true);
  }

  /* ============================================================
     SETTINGS wiring
     ============================================================ */
  function reflectPrefsToUI() {
    $("#autoSpeak").checked = prefs.autoSpeak;
    $("#rate").value = prefs.rate;
    $("#pitch").value = prefs.pitch;
    $("#rateVal").textContent = prefs.rate.toFixed(1) + "×";
    $("#pitchVal").textContent = prefs.pitch.toFixed(1);
    var sizeRadio = $('input[name="size"][value="' + prefs.size + '"]');
    if (sizeRadio) sizeRadio.checked = true;
    var themeRadio = $('input[name="theme"][value="' + prefs.theme + '"]');
    if (themeRadio) themeRadio.checked = true;
  }

  function init() {
    // storage feature test
    try { localStorage.setItem("stepspeak:test", "1"); localStorage.removeItem("stepspeak:test"); }
    catch (e) { storageOk = false; }

    loadPrefs();
    applyTheme();
    applySize();
    reflectPrefsToUI();

    // restore last list
    var savedList = storageGet(LS.list);
    if (savedList) { $("#stepsInput").value = savedList; }
    updateCount();

    /* ---- composer ---- */
    $("#composer").addEventListener("submit", function (e) { e.preventDefault(); start(); });
    $("#stepsInput").addEventListener("input", updateCount);
    $("#clearBtn").addEventListener("click", function () {
      $("#stepsInput").value = "";
      storageSet(LS.list, "");
      updateCount();
      $("#stepsInput").focus();
    });

    $$("#examplesRow .pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-example");
        if (EXAMPLES[key]) {
          $("#stepsInput").value = EXAMPLES[key];
          storageSet(LS.list, EXAMPLES[key]);
          updateCount();
          $("#stepsInput").focus();
        }
      });
    });

    /* ---- stepper nav ---- */
    $("#prevBtn").addEventListener("click", function () { go(-1); });
    $("#nextBtn").addEventListener("click", function () { go(1); });
    $("#repeatBtn").addEventListener("click", repeat);
    $("#editBtn").addEventListener("click", function () {
      stopSpeaking();
      $("#stepper").hidden = true;
      $("#stepsInput").focus();
      $("#make").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // keyboard: only while the stepper is visible and focus isn't in a text field
    document.addEventListener("keydown", function (e) {
      var stepper = $("#stepper");
      if (stepper.hidden) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); go(1); }
      else if (e.key === "Enter") { e.preventDefault(); repeat(); }
    });

    /* ---- speaking settings ---- */
    $("#autoSpeak").addEventListener("change", function () {
      prefs.autoSpeak = $("#autoSpeak").checked;
      savePrefs();
      if (!prefs.autoSpeak) stopSpeaking();
    });
    $("#voiceSelect").addEventListener("change", function () {
      prefs.voiceURI = $("#voiceSelect").value;
      savePrefs();
    });
    $("#rate").addEventListener("input", function () {
      prefs.rate = clamp(parseFloat($("#rate").value) || 1, 0.5, 1.6);
      $("#rateVal").textContent = prefs.rate.toFixed(1) + "×";
      savePrefs();
    });
    $("#pitch").addEventListener("input", function () {
      prefs.pitch = clamp(parseFloat($("#pitch").value) || 1, 0.6, 1.6);
      $("#pitchVal").textContent = prefs.pitch.toFixed(1);
      savePrefs();
    });
    $("#testVoiceBtn").addEventListener("click", function () {
      speak("This is how stepspeak will read your steps.");
    });

    /* ---- comfort settings ---- */
    $$('input[name="size"]').forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked) { prefs.size = r.value; applySize(); savePrefs(); }
      });
    });
    $$('input[name="theme"]').forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.checked) { prefs.theme = r.value; applyTheme(); savePrefs(); }
      });
    });

    /* ---- voices (async) ---- */
    if (synth) {
      loadVoices();
      if (typeof synth.onvoiceschanged !== "undefined") {
        synth.onvoiceschanged = loadVoices;
      }
      // some browsers populate late without firing the event — retry a few times
      var tries = 0;
      var poll = setInterval(function () {
        tries++;
        if (voices.length || tries > 10) { clearInterval(poll); }
        else loadVoices();
      }, 250);
      // stop any speech if the page is hidden or unloaded
      window.addEventListener("pagehide", stopSpeaking);
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stopSpeaking();
      });
    } else {
      populateVoiceSelect();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
