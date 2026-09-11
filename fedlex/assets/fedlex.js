/* ------------------------------------------------------------------
   Fedlex — RS 220
   La barre de recherche en haut à droite dialogue avec Claude Haiku.
   La réponse s'affiche à la place du texte de l'art. 3 CO.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------
  var API_URL   = 'https://api.anthropic.com/v1/messages';
  var MODEL     = 'claude-haiku-4-5';
  var MAX_TOK   = 4096;
  var KEY_STORE = 'fedlex.rs220.k';     // localStorage : la clé API
  var MSG_STORE = 'fedlex.rs220.m';     // sessionStorage : le fil de discussion

  // Reconnaît une clé Anthropic n'importe où dans un texte. Sert de garde-fou :
  // une clé ne doit jamais partir dans le corps d'un message ni rester dans
  // l'historique, où elle serait renvoyée à chaque tour suivant.
  var KEY_RE = /sk-ant-[A-Za-z0-9_-]{8,}/;

  var SYSTEM = [
    "Tu es un assistant généraliste, précis et serviable.",
    "Réponds toujours dans la langue de l'utilisateur.",
    "Écris en texte brut uniquement : pas de Markdown, pas de titres, pas de gras,",
    "pas de listes à puces, pas de blocs de code.",
    "Structure ta réponse en paragraphes courts séparés par une ligne vide.",
    "Va droit au but : pas de formule d'introduction ni de conclusion superflue."
  ].join(' ');

  // ---------------------------------------------------------------
  // Éléments
  // ---------------------------------------------------------------
  var form   = document.getElementById('search');
  var input  = document.getElementById('q');
  var target = document.getElementById('art-3-body');
  var article3 = document.getElementById('art-3');
  if (!form || !input || !target) return;

  var ORIGINAL = target.innerHTML;   // le vrai texte de l'art. 3, pour le restaurer
  var controller = null;

  // ---------------------------------------------------------------
  // Stockage
  // ---------------------------------------------------------------
  function safeGet(store, k) {
    try { return window[store].getItem(k); } catch (e) { return null; }
  }
  function safeSet(store, k, v) {
    try { window[store].setItem(k, v); return true; } catch (e) { return false; }
  }
  function safeDel(store, k) {
    try { window[store].removeItem(k); } catch (e) {}
  }

  function getKey()    { return safeGet('localStorage', KEY_STORE) || window.FEDLEX_API_KEY || ''; }
  function setKey(k)   { return safeSet('localStorage', KEY_STORE, k); }
  function clearKey()  { safeDel('localStorage', KEY_STORE); }

  // Ne conserve que des tours (question, réponse) complets et exempts de clé.
  // Retirer un seul message laisserait un historique désaccordé, que l'API
  // refuse : elle attend une alternance stricte commençant par « user ».
  function withoutKeys(msgs) {
    var out = [];
    for (var i = 0; i + 1 < msgs.length; i += 2) {
      var u = msgs[i], a = msgs[i + 1];
      if (!u || !a || u.role !== 'user' || a.role !== 'assistant') continue;
      if (typeof u.content !== 'string' || typeof a.content !== 'string') continue;
      if (KEY_RE.test(u.content) || KEY_RE.test(a.content)) continue;
      out.push(u, a);
    }
    return out;
  }
  function getHistory() {
    try { return withoutKeys(JSON.parse(safeGet('sessionStorage', MSG_STORE) || '[]')); }
    catch (e) { return []; }
  }
  function setHistory(m) {
    // on ne garde que les 20 derniers tours pour rester léger
    safeSet('sessionStorage', MSG_STORE, JSON.stringify(withoutKeys(m).slice(-20)));
  }

  // ---------------------------------------------------------------
  // Rendu : transformer un texte en paragraphes d'article
  // ---------------------------------------------------------------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Nettoie les éventuelles marques Markdown résiduelles.
  function stripMarkup(line) {
    return line
      .replace(/^\s{0,3}#{1,6}\s+/, '')          // titres
      .replace(/^\s*[-*+]\s+/, '')               // puces
      .replace(/^\s*\d+[.)]\s+/, '')             // listes numérotées
      .replace(/\*\*(.+?)\*\*/g, '$1')           // gras
      .replace(/\*([^*\n]+)\*/g, '$1')          // italique
      .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')     // code
      .trim();
  }

  function toParagraphs(text) {
    var out = [];
    String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/).forEach(function (block) {
      block.split('\n').forEach(function (line) {
        var clean = stripMarkup(line);
        if (clean) out.push(clean);
      });
    });
    return out;
  }

  // Affiche un texte dans le corps de l'art. 3, avec la numérotation
  // en exposant propre aux alinéas du CO (un seul alinéa => pas de numéro).
  function render(text) {
    var paras = toParagraphs(text);
    if (!paras.length) { target.innerHTML = '<p></p>'; return; }
    target.innerHTML = paras.map(function (p, i) {
      var num = paras.length > 1 ? '<sup>' + (i + 1) + '</sup>' : '';
      return '<p>' + num + escapeHtml(p) + '</p>';
    }).join('');
  }

  function restore() { target.innerHTML = ORIGINAL; }

  function busy(on) {
    form.classList.toggle('is-busy', on);
    target.classList.toggle('is-loading', on);
    input.disabled = on;
  }

  function focusArticle() {
    if (!article3) return;
    var box = article3.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      article3.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ---------------------------------------------------------------
  // Appel de l'API (en flux, pour que le texte s'écrive au fil de l'eau)
  // ---------------------------------------------------------------
  function ask(question) {
    var key = getKey();
    if (!key) {
      render("Aucune clé n'est enregistrée dans ce navigateur.\n\n" +
             "Pour en enregistrer une, saisissez « clé » suivi d'un espace et de votre clé API " +
             "dans le champ de recherche, puis validez. Elle est conservée uniquement sur cet " +
             "appareil et n'est transmise qu'à api.anthropic.com.");
      focusArticle();
      return;
    }

    if (controller) controller.abort();
    controller = new AbortController();

    var history = getHistory();
    var messages = history.concat([{ role: 'user', content: question }]);

    busy(true);
    render('…');
    focusArticle();

    var answer = '';

    fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOK,
        stream: true,
        system: SYSTEM,
        messages: messages
      })
    })
    .then(function (res) {
      if (!res.ok) {
        return res.text().then(function (body) {
          var detail = '';
          try { detail = (JSON.parse(body).error || {}).message || ''; } catch (e) { detail = ''; }
          throw new Error(httpMessage(res.status, detail));
        });
      }
      return readStream(res, function (chunk) {
        answer += chunk;
        render(answer);
      });
    })
    .then(function () {
      busy(false);
      if (!answer.trim()) { render('Aucune réponse n\'a été reçue.'); return; }
      render(answer);
      setHistory(messages.concat([{ role: 'assistant', content: answer }]));
      focusArticle();
    })
    .catch(function (err) {
      busy(false);
      if (err && err.name === 'AbortError') return;
      render(err && err.message ? err.message : 'La requête n\'a pas abouti.');
      focusArticle();
    });
  }

  function httpMessage(status, detail) {
    if (/credit balance is too low/i.test(detail)) {
      return "Le compte associé à cette clé n'a pas de crédit. Ajoutez-en sur " +
             "console.anthropic.com, rubrique Billing, puis réessayez.";
    }
    if (status === 401) return "La clé enregistrée n'a pas été acceptée. Vérifiez qu'il s'agit bien de la clé " +
                              "elle-même (elle commence par « sk-ant-api03- ») et non de son identifiant. " +
                              "Saisissez « clé » suivi de sa valeur pour la remplacer.";
    if (status === 403) return "L'accès a été refusé pour cette clé.";
    if (status === 429) return "La limite de requêtes est atteinte. Réessayez dans un instant.";
    if (status >= 500)  return "Le service est momentanément indisponible. Réessayez dans un instant.";
    return "La requête n'a pas abouti (" + status + ")" + (detail ? " : " + detail : ".");
  }

  // Lecture du flux SSE renvoyé par l'API.
  function readStream(res, onText) {
    var reader  = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer  = '';

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buffer += decoder.decode(r.value, { stream: true });

        var parts = buffer.split('\n\n');
        buffer = parts.pop();

        parts.forEach(function (evt) {
          evt.split('\n').forEach(function (line) {
            if (line.indexOf('data:') !== 0) return;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            var data;
            try { data = JSON.parse(payload); } catch (e) { return; }
            if (data.type === 'content_block_delta' && data.delta &&
                data.delta.type === 'text_delta') {
              onText(data.delta.text);
            }
          });
        });
        return pump();
      });
    }
    return pump();
  }

  // ---------------------------------------------------------------
  // Barre de recherche
  // ---------------------------------------------------------------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = '';

    // « clé <valeur> », « clé : <valeur> », « /key <valeur> » — ou la clé collée
    // seule, sans rien devant : dans tous les cas l'intention est la même.
    var m = q.match(/^(?:cl[ée]s?|\/key)\s*[:=]?\s*(\S+)$/i) ||
            q.match(/^(sk-ant-[A-Za-z0-9_-]{8,}|apikey[_-]\S+)$/i);
    if (m) {
      // Le tableau de bord affiche deux choses différentes : l'identifiant de la
      // clé (« apikey_… »), visible en permanence, et la clé elle-même
      // (« sk-ant-api03-… »), montrée une seule fois à la création. Seule la
      // seconde est acceptée par l'API : on le signale tout de suite.
      if (/^apikey[_-]/i.test(m[1])) {
        render("Cette valeur est l'identifiant de la clé, pas la clé elle-même.\n\n" +
               "La clé commence par « sk-ant-api03- » et n'apparaît qu'une seule fois, " +
               "au moment de sa création. Si elle n'a pas été conservée, créez-en une " +
               "nouvelle sur console.anthropic.com et copiez sa valeur entière.");
        focusArticle();
        return;
      }
      if (m[1].indexOf('sk-ant-') !== 0) {
        render("Cette valeur ne ressemble pas à une clé Anthropic : une clé commence " +
               "par « sk-ant-api03- ». Elle a tout de même été enregistrée ; en cas de " +
               "refus, saisissez « clé » suivi de la bonne valeur.");
        setKey(m[1]);
        focusArticle();
        return;
      }
      if (setKey(m[1])) {
        render("La clé a été enregistrée sur cet appareil. Vous pouvez poser votre question.");
      } else {
        render("La clé n'a pas pu être enregistrée : le stockage local est indisponible dans ce navigateur.");
      }
      focusArticle();
      return;
    }

    // « /oubli » : supprime la clé enregistrée.
    if (/^\/(oubli|forget)$/i.test(q)) {
      clearKey();
      render("La clé enregistrée a été supprimée de cet appareil.");
      focusArticle();
      return;
    }

    // « /reset » : vide le fil de discussion et remet le vrai texte de l'art. 3.
    if (/^\/(reset|raz)$/i.test(q)) {
      if (controller) controller.abort();
      safeDel('sessionStorage', MSG_STORE);
      busy(false);
      restore();
      return;
    }

    // Garde-fou : si le texte contient une clé, il ne part pas vers l'API.
    if (KEY_RE.test(q)) {
      render("Ce texte contient ce qui ressemble à une clé API : il n'a pas été envoyé.\n\n" +
             "Pour enregistrer une clé, saisissez « clé », un espace, puis sa valeur — " +
             "rien d'autre sur la ligne. Pour poser une question, retirez la clé du texte.");
      focusArticle();
      return;
    }

    ask(q);
  });

  // Échap : interrompt et restaure le texte d'origine.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (controller) controller.abort();
      busy(false);
      input.value = '';
      restore();
    }
  });

  // ---------------------------------------------------------------
  // Comportements d'interface (arborescence, avis de maintenance)
  // ---------------------------------------------------------------
  function setNode(li, open) {
    li.setAttribute('aria-expanded', open ? 'true' : 'false');
    var btn = li.querySelector(':scope > .toc-row > .toc-toggle');
    if (btn && !btn.hasAttribute('hidden')) {
      btn.innerHTML = open ? '&minus;' : '+';
      btn.setAttribute('aria-label', open ? 'Réduire' : 'Développer');
    }
  }

  var toc = document.getElementById('toc');
  if (toc) {
    toc.addEventListener('click', function (e) {
      var btn = e.target.closest('.toc-toggle');
      if (!btn || btn.hasAttribute('hidden')) return;
      e.preventDefault();
      var li = btn.closest('li');
      setNode(li, li.getAttribute('aria-expanded') !== 'true');
    });
  }

  function allNodes(open) {
    if (!toc) return;
    toc.querySelectorAll('li[aria-expanded]').forEach(function (li) { setNode(li, open); });
  }

  var expandAll = document.getElementById('expand-all');
  var collapseAll = document.getElementById('collapse-all');
  if (expandAll)   expandAll.addEventListener('click', function (e) { e.preventDefault(); allNodes(true); });
  if (collapseAll) collapseAll.addEventListener('click', function (e) { e.preventDefault(); allNodes(false); });

  var closeBtn = document.getElementById('close-maintenance');
  var maintenance = document.getElementById('maintenance');
  if (closeBtn && maintenance) {
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      maintenance.remove();
    });
  }
})();
