'use strict';
/* ══════════════════════════════════════════════════════════════════════
   Driver Safety Monitor — Sonnerie de l'appel police (côté superviseur)
   Chargé AVANT app.js. Ne dépend pas du code de app.js:
   - débloque l'audio du navigateur dès le 1er clic (sinon Chrome bloque le son)
   - joue une sonnerie de téléphone tant que la fenêtre d'appel police est ouverte
   - arrête la sonnerie quand on clique Répondre / Envoyer une unité / Clôturer / ×
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  const Native = window.AudioContext || window.webkitAudioContext;
  if (!Native || window.__dsmExtras) return;
  window.__dsmExtras = true;

  // 1) Garder la liste de tous les AudioContext créés par le site (pour les débloquer)
  const all = [];
  const Patched = function () { const c = new (Function.prototype.bind.apply(Native, [null].concat([].slice.call(arguments))))(); all.push(c); return c; };
  Patched.prototype = Native.prototype;
  window.AudioContext = Patched;
  if (window.webkitAudioContext) window.webkitAudioContext = Patched;

  // 2) Notre propre contexte pour la sonnerie
  let own = null;
  const ctx = () => { if (!own) { try { own = new Native(); } catch (e) { /* pas d'audio */ } } return own; };

  // 3) Déblocage au premier geste de l'utilisateur (clic, touche, toucher)
  let unlocked = false;
  function unlock() {
    all.forEach(c => { if (c.state === 'suspended') c.resume().catch(() => {}); });
    const c = ctx(); if (c && c.state === 'suspended') c.resume().catch(() => {});
    if (!unlocked) {
      unlocked = true;
      try { if (window.speechSynthesis) { window.speechSynthesis.getVoices(); window.speechSynthesis.speak(new SpeechSynthesisUtterance('')); } } catch (e) { /* ignore */ }
    }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));

  // 4) La sonnerie: deux "drrring" puis une pause, en boucle
  function burst(c, t) {
    [440, 480].forEach(f => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.03);
      g.gain.setValueAtTime(0.3, t + 0.4);
      g.gain.linearRampToValueAtTime(0, t + 0.45);
      o.start(t); o.stop(t + 0.5);
    });
  }
  let timer = null, killer = null;
  function cycle() {
    const c = ctx(); if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const t = c.currentTime + 0.05;
    burst(c, t); burst(c, t + 0.6);
  }
  function startRing() {
    if (timer) return;
    cycle(); timer = setInterval(cycle, 2800);
    killer = setTimeout(stopRing, 90000); // sécurité: max 90 s
  }
  function stopRing() { clearInterval(timer); clearTimeout(killer); timer = killer = null; }
  window.dsmRingTest = function () { unlock(); startRing(); setTimeout(stopRing, 5000); };

  // 5) Surveiller la fenêtre d'appel police (#policeDispatchOverlay)
  function boot() {
    const ov = document.getElementById('policeDispatchOverlay');
    if (!ov) return;
    const isOpen = () => {
      const cs = getComputedStyle(ov);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05 && ov.getClientRects().length > 0;
    };
    let was = isOpen();
    const check = () => { const now = isOpen(); if (now && !was) startRing(); if (!now && was) stopRing(); was = now; };
    new MutationObserver(check).observe(ov, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    ['btnDispatchRespond', 'btnDispatchSendUnit', 'btnDispatchCloseAlert', 'btnDispatchClose'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', stopRing, true);
    });
    if (was) startRing();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
