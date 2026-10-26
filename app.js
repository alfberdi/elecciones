// Mapa de candidaturas — sitio 100 % estático (sin servidor). Sirve para el Congreso y el Senado:
// la cámara se lee de datos/candidaturas.json ("camara": "congreso" | "senado").
// Las noticias se piden en directo desde el navegador a fuentes que permiten CORS.
(() => {
  "use strict";

  // ---------- Configuración de noticias ----------
  const NOTICIAS = {
    dias: 30,          // antigüedad máxima
    max: 8,            // titulares a mostrar
    cacheMin: 15,      // minutos que se reutiliza una búsqueda en la misma pestaña
    // GDELT: índice global de prensa (incluye Agencia EFE, Europa Press, RTVE y casi todos los diarios). Sin clave, con CORS.
    gdelt: true,
    // Google Noticias no permite CORS: se lee su RSS a través de rss2json.com (servicio de terceros con límite diario).
    // Pon aquí tu clave gratuita de rss2json para más cupo; deja "" para usar el modo sin clave.
    googleNews: true,
    rss2jsonKey: "",
    // Medios que se destacan con una etiqueta en la lista
    destacados: { "efe.com": "EFE", "europapress.es": "Europa Press", "politico.eu": "Politico", "rtve.es": "RTVE" },
  };

  const CLAVE = "mapa-candidaturas:ccaa";
  // Códigos ISO 3166-2:ES de comunidad → id interno
  const ISO = { AN: "andalucia", AR: "aragon", AS: "asturias", IB: "baleares", PM: "baleares", CN: "canarias",
    CB: "cantabria", S: "cantabria", CL: "castilla-y-leon", CM: "castilla-la-mancha", CT: "cataluna",
    VC: "valenciana", EX: "extremadura", GA: "galicia", MD: "madrid", M: "madrid", MC: "murcia", MU: "murcia",
    NC: "navarra", NA: "navarra", PV: "pais-vasco", RI: "la-rioja", LO: "la-rioja", CE: "ceuta", ML: "melilla" };
  // Nombres en inglés/español que devuelven algunos servicios de geolocalización
  const NOMBRES_GEO = {
    andalusia: "andalucia", andalucia: "andalucia", aragon: "aragon", asturias: "asturias",
    "balearic islands": "baleares", "illes balears": "baleares", baleares: "baleares",
    "canary islands": "canarias", canarias: "canarias", cantabria: "cantabria",
    "castille and leon": "castilla-y-leon", "castile and leon": "castilla-y-leon", "castilla y leon": "castilla-y-leon",
    "castille-la mancha": "castilla-la-mancha", "castile-la mancha": "castilla-la-mancha", "castilla-la mancha": "castilla-la-mancha",
    catalonia: "cataluna", cataluna: "cataluna", catalunya: "cataluna",
    valencia: "valenciana", "valencian community": "valenciana", "comunitat valenciana": "valenciana",
    extremadura: "extremadura", galicia: "galicia", madrid: "madrid", murcia: "murcia",
    navarre: "navarra", navarra: "navarra", "basque country": "pais-vasco", "pais vasco": "pais-vasco", euskadi: "pais-vasco",
    "la rioja": "la-rioja", ceuta: "ceuta", melilla: "melilla" };
  const POR_DEFECTO = "madrid";

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sinAcentos = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const guardar = v => { try { localStorage.setItem(CLAVE, v); } catch (e) {} };
  const leer = () => { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } };

  let D = null, P = { personas: {} };
  let pedido = 0; // descarta respuestas de noticias que llegan tarde
  const estado = { ccaa: null, prov: null, abierto: null, escanos: {}, cand: null, origen: "", marcas: {} };

  // ---------- Geolocalización por IP (desde el navegador, sin servidor propio) ----------
  async function conTiempo(url, ms = 3000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) throw 0; return await r.json(); }
    finally { clearTimeout(t); }
  }
  async function detectarPorIP() {
    try {
      const j = await conTiempo("https://ipapi.co/json/");
      if (j.country_code === "ES" && ISO[j.region_code]) return ISO[j.region_code];
    } catch (e) {}
    try {
      const j = await conTiempo("https://get.geojs.io/v1/ip/geo.json");
      if (j.country_code === "ES" && j.region) return NOMBRES_GEO[sinAcentos(j.region)] || null;
    } catch (e) {}
    return null;
  }
  function porZonaHoraria() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone === "Atlantic/Canary" ? "canarias" : null; }
    catch (e) { return null; }
  }

  // ---------- Render ----------
  const comunidad = id => D.comunidades.find(c => c.id === id);
  const partido = id => D.partidos.find(p => p.id === id);

  function elegir(id, origen) {
    if (!comunidad(id)) return;
    estado.ccaa = id; estado.prov = comunidad(id).provincias[0];
    estado.abierto = null; estado.cand = null;
    if (origen) estado.origen = origen;
    document.querySelectorAll(".mapa .ca").forEach(el => {
      const on = el.dataset.id === id;
      el.classList.toggle("activa", on);
      el.setAttribute("aria-pressed", on);
    });
    $("#sel-ccaa").value = id;
    // El enlace a la otra cámara (en otro dominio) lleva la comunidad elegida
    const otra = $("#otra-camara");
    if (otra) otra.href = otra.dataset.base + "#" + id;
    pintarPanel();
  }

  const SENADO = () => D.camara === "senado";
  const marcadas = () => (estado.marcas[estado.prov] ||= new Set());

  function pintarPanel() {
    const c = comunidad(estado.ccaa);
    const p = D.provincias[estado.prov];
    $("#p-nombre").textContent = c.nombre;
    $("#p-origen").textContent = estado.origen;
    $("#p-origen").hidden = !estado.origen;

    const tabs = $("#p-tabs");
    tabs.hidden = c.provincias.length < 2;
    tabs.innerHTML = c.provincias.map(id => `<button class="tab" role="tab" data-prov="${id}" aria-selected="${id === estado.prov}">${esc(D.provincias[id].nombre)}</button>`).join("");

    $("#p-escanos").textContent = p.escanos;
    $("#p-escanos-txt").textContent = SENADO()
      ? (p.escanos === 1 ? "senador o senadora" : "senadores") + " en juego en " + p.nombre
      : (p.escanos === 1 ? "escaño" : "escaños") + " en juego en " + p.nombre;

    const pap = $("#p-papeleta");
    if (pap) {
      const m = marcadas().size;
      pap.innerHTML = `<span>Tu papeleta de práctica: <b>${m} de ${p.marcas}</b> ${p.marcas === 1 ? "marca" : "marcas"} posibles. Puedes mezclar partidos.</span>
        ${m ? `<button class="borrar" data-borrar="1">Borrar marcas</button>` : ""}`;
    }

    const ids = Object.keys(p.listas);
    $("#p-partidos").innerHTML = ids.map(pid => {
      const pa = partido(pid), l = p.listas[pid], ab = estado.abierto === pid;
      return `<div class="partido${ab ? " abierto" : ""}">
        <button class="partido-btn" data-partido="${pid}" aria-expanded="${ab}">
          <span class="siglas">${esc(pa.siglas)}</span>
          <span>${esc(pa.nombre)}</span>
          <span class="n">${SENADO() ? marcadasDe(l) || "" : ""}${l.length} ${SENADO() ? (l.length === 1 ? "candidato" : "candidatos") : "en lista"}<span class="chev" aria-hidden="true">›</span></span>
        </button>
        ${ab ? lista(pid, l, p) : ""}
      </div>`;
    }).join("") || `<p class="vacio">Aún no hay candidaturas proclamadas en esta provincia.</p>`;

  }

  function marcadasDe(l) {
    const n = l.filter(c => marcadas().has(c.id)).length;
    return n ? `<span class="marca-n">✓ ${n}</span> · ` : "";
  }

  // Senado: lista abierta, el elector marca nombres concretos (por orden alfabético en la papeleta)
  function listaSenado(l, p) {
    const lleno = marcadas().size >= p.marcas;
    return `<div class="lista">
      <p class="muted pequeno">En la papeleta aparecen por orden alfabético de apellido, no por preferencia del partido.</p>
      <ul class="sen">${l.map(c => {
        const on = marcadas().has(c.id);
        return `<li class="sen-fila">
          <input type="checkbox" id="m-${c.id}" data-marca="${c.id}" ${on ? "checked" : ""} ${lleno && !on ? "disabled" : ""}>
          <label for="m-${c.id}" class="sr">Marcar a ${esc(c.nombre)}</label>
          <button class="cand" data-cand="${c.id}" aria-pressed="${estado.cand === c.id}">
            <span>${esc(c.nombre)}${c.independiente ? ' <span class="indep">independiente</span>' : ""}</span><span class="ver">noticias ›</span></button></li>`;
      }).join("")}</ul>
    </div>`;
  }

  function lista(pid, l, p) {
    if (SENADO()) return listaSenado(l, p);
    const k = estado.prov + ":" + pid;
    const n = estado.escanos[k] ?? Math.min(2, p.escanos);
    return `<div class="lista">
      <div class="sim" data-k="${k}" data-max="${p.escanos}">
        <span>Si esta lista consigue</span>
        <button data-d="-1" aria-label="Un escaño menos">−</button>
        <output>${n}</output>
        <button data-d="1" aria-label="Un escaño más">+</button>
        <span>${n === 1 ? "escaño, entra" : "escaños, entran"} ${n === 0 ? "nadie" : n === 1 ? "el nº 1" : "del nº 1 al " + n}.</span>
      </div>
      <ol>${l.map((c, i) => `<li><button class="cand${i < n ? " dentro" : ""}" data-cand="${c.id}" aria-pressed="${estado.cand === c.id}">
        <span class="pos">${i + 1}</span><span>${esc(c.nombre)}${c.independiente ? ' <span class="indep">independiente</span>' : ""}</span><span class="ver">noticias ›</span></button></li>`).join("")}</ol>
    </div>`;
  }

  function buscarCand(id) {
    for (const [pid, l] of Object.entries(D.provincias[estado.prov].listas)) {
      const i = l.findIndex(c => c.id === id);
      if (i >= 0) return { c: l[i], pos: i + 1, pa: partido(pid) };
    }
    return null;
  }

  // ---------- Noticias en directo ----------
  // La prensa suele citar "Nombre Primer-apellido"; si el dato trae "prensa", se usa ese nombre.
  function nombresDePrensa(c) {
    const p = c.nombre.split(/\s+/);
    const corto = c.prensa || (p.length > 2 ? p.slice(0, p.length - 1).join(" ") : c.nombre);
    return [...new Set([c.nombre, corto])];
  }
  const cache = {
    leer(k) { try { const v = JSON.parse(sessionStorage.getItem("n:" + k)); return v && Date.now() - v.t < NOTICIAS.cacheMin * 6e4 ? v.d : null; } catch (e) { return null; } },
    poner(k, d) { try { sessionStorage.setItem("n:" + k, JSON.stringify({ t: Date.now(), d })); } catch (e) {} },
  };
  const dominio = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };

  async function deGdelt(nombres) {
    const q = `(${nombres.map(n => `"${n}"`).join(" OR ")}) sourcelang:spanish`;
    const url = "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&sort=datedesc&maxrecords=25"
      + `&timespan=${NOTICIAS.dias}d&query=${encodeURIComponent(q)}`;
    const r = await fetch(url);
    const txt = await r.text();           // GDELT responde texto plano cuando hay error o límite
    if (!r.ok || txt[0] !== "{") throw new Error("GDELT: " + txt.slice(0, 80));
    const j = JSON.parse(txt);
    return (j.articles || []).map(a => ({
      titulo: a.title, url: a.url, medio: a.domain,
      fecha: new Date(a.seendate.replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/, "$1-$2-$3T$4:$5:$6Z")),
    }));
  }
  async function deGoogleNews(nombres) {
    const q = `(${nombres.map(n => `"${n}"`).join(" OR ")}) when:${NOTICIAS.dias}d`;
    const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es&gl=ES&ceid=ES:es`;
    const url = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(rss)
      + (NOTICIAS.rss2jsonKey ? `&api_key=${NOTICIAS.rss2jsonKey}&count=25` : "");
    const j = await (await fetch(url)).json();
    if (j.status !== "ok") throw new Error("Google Noticias: " + (j.message || "error"));
    return j.items.map(it => {
      const m = it.title.match(/^(.*) - ([^-]+)$/);   // "Titular - Medio"
      return { titulo: m ? m[1] : it.title, url: it.link, medio: m ? m[2].trim() : (it.author || "Google Noticias"),
               fecha: new Date(it.pubDate.replace(" ", "T") + "Z") };
    });
  }
  async function buscarNoticias(c) {
    const hit = cache.leer(c.id);
    if (hit) return { items: hit.map(n => ({ ...n, fecha: new Date(n.fecha) })), fallos: [] };
    const nombres = nombresDePrensa(c);
    const fuentes = [NOTICIAS.gdelt && deGdelt(nombres), NOTICIAS.googleNews && deGoogleNews(nombres)].filter(Boolean);
    const res = await Promise.allSettled(fuentes);
    const vistos = new Set(), items = [];
    for (const r of res) if (r.status === "fulfilled") for (const n of r.value) {
      const k = sinAcentos(n.titulo).replace(/\W+/g, " ").slice(0, 70);
      if (!n.titulo || vistos.has(k) || !(n.fecha > Date.now() - NOTICIAS.dias * 864e5)) continue;
      vistos.add(k); items.push(n);
    }
    items.sort((a, b) => b.fecha - a.fecha);
    const fallos = res.filter(r => r.status === "rejected").map(r => r.reason && r.reason.message);
    if (fallos.length < res.length) cache.poner(c.id, items.slice(0, NOTICIAS.max));
    return { items: items.slice(0, NOTICIAS.max), fallos, todoFallo: fallos.length === res.length };
  }

  // ---------- Parlamentarios en ejercicio y sus declaraciones (datos/parlamentarios.json) ----------
  // Clave de cruce: palabras del nombre sin acentos y ordenadas, para que "Apellidos, Nombre" y "Nombre Apellidos" coincidan.
  const claveNombre = s => sinAcentos(s).replace(/[^a-zñ ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
  const parlamentario = c => P.personas[c.parlamentario || claveNombre(c.nombre)] || null;

  function htmlDeclaraciones(p) {
    if (!p) return "";
    const fecha = f => f ? new Date(f).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "";
    return `<section class="f-sec">
      <p class="label">Declaraciones públicas</p>
      <div class="f-cargo"><span class="chip-cargo">${esc(p.cargo)}</span>
        <span class="muted">${esc([p.grupo, p.circunscripcion].filter(Boolean).join(" · "))}</span></div>
      ${(p.secciones || []).map((s, i) => `<details class="f-det"${i === 0 ? " open" : ""}>
        <summary>${esc(s.titulo)}${s.fecha ? ` <span class="muted">· ${fecha(s.fecha)}</span>` : ""}</summary>
        ${s.filas && s.filas.length ? `<dl>${s.filas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`
          : `<p class="vacio">Sin datos declarados en este apartado.</p>`}
      </details>`).join("")}
      <div class="enlaces">${(p.documentos || []).map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.titulo)} ↗</a>`).join("")}</div>
      <p class="pequeno muted">Fuente: ${esc(p.fuente)}${P.ejemplo ? " · datos de ejemplo" : ""}. Se muestra lo que la persona ha declarado; no es una auditoría.</p>
    </section>`;
  }

  function abrirFicha(id) {
    const r = buscarCand(id); if (!r) return;
    const { c, pos, pa } = r, p = parlamentario(c), dlg = $("#ficha");
    const q = encodeURIComponent(`"${nombresDePrensa(c).pop()}"`);
    estado.cand = id;
    $("#ficha-cuerpo").innerHTML = `
      <header class="f-cab">
        <span class="siglas">${esc(pa.siglas)}</span>
        <div><h2 id="ficha-titulo">${esc(c.nombre)}</h2>
          <p class="muted">${esc(pa.nombre)} · ${SENADO() ? "candidatura al Senado" : `nº ${pos} de la lista al Congreso`} por ${esc(D.provincias[estado.prov].nombre)}</p></div>
      </header>
      ${p ? htmlDeclaraciones(p) : `<p class="f-nota">No ocupa ahora un escaño en el Congreso ni en el Senado, así que no hay declaración de bienes publicada.</p>`}
      <section class="f-sec">
        <p class="label">Noticias de los últimos ${NOTICIAS.dias} días</p>
        <div id="n-lista" aria-busy="true"><p class="vacio cargando">Buscando en EFE, Google Noticias y prensa española…</p></div>
        <div class="enlaces">
          <a href="https://news.google.com/search?q=${q}&hl=es&gl=ES&ceid=ES:es" target="_blank" rel="noopener">Google Noticias ↗</a>
          <a href="https://efe.com/?s=${q}" target="_blank" rel="noopener">Agencia EFE ↗</a>
          <a href="https://www.politico.eu/?s=${q}" target="_blank" rel="noopener">Politico ↗</a>
        </div>
      </section>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    pintarPanel();

    const yo = ++pedido;
    const fmt = f => f.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + ", " + f.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    buscarNoticias(c).then(({ items, todoFallo }) => {
      if (yo !== pedido) return;
      const l = $("#n-lista"); l.removeAttribute("aria-busy");
      if (todoFallo) { l.innerHTML = `<p class="vacio">No se han podido cargar las noticias ahora mismo. Prueba de nuevo en un minuto o usa los enlaces de abajo.</p>`; return; }
      if (!items.length) { l.innerHTML = `<p class="vacio">No hay noticias recientes que mencionen a esta persona.</p>`; return; }
      l.innerHTML = `<ul>${items.map(n => {
        const d = dominio(n.url), tag = Object.entries(NOTICIAS.destacados).find(([k]) => d.endsWith(k) || n.medio.includes(NOTICIAS.destacados[k]));
        return `<li class="noticia"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.titulo)}</a>
          <small>${tag ? `<span class="fuente">${tag[1]}</span> ` : `${esc(n.medio)} · `}${fmt(n.fecha)}</small></li>`;
      }).join("")}</ul><p class="pequeno muted">Resultados automáticos por nombre: pueden aparecer personas con el mismo nombre.</p>`;
    });
  }

  // ---------- Eventos ----------
  function eventos() {
    document.querySelectorAll(".mapa .ca").forEach(el => {
      el.addEventListener("click", () => { elegir(el.dataset.id, "Elegida por ti"); guardar(el.dataset.id); });
      el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.dispatchEvent(new Event("click")); } });
    });
    $("#sel-ccaa").addEventListener("change", e => { elegir(e.target.value, "Elegida por ti"); guardar(e.target.value); });
    $("#panel").addEventListener("click", e => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.borrar) { marcadas().clear(); pintarPanel(); }
      else if (t.dataset.prov) { estado.prov = t.dataset.prov; estado.abierto = null; estado.cand = null; pintarPanel(); }
      else if (t.dataset.partido) { estado.abierto = estado.abierto === t.dataset.partido ? null : t.dataset.partido; estado.cand = null; pintarPanel(); }
      else if (t.dataset.cand) abrirFicha(t.dataset.cand);
      else if (t.dataset.d) {
        const s = t.closest(".sim"), k = s.dataset.k, max = +s.dataset.max;
        const cur = estado.escanos[k] ?? Math.min(2, max);
        estado.escanos[k] = Math.max(0, Math.min(max, cur + +t.dataset.d));
        pintarPanel();
        const b = $(`.sim[data-k="${k}"] button[data-d="${t.dataset.d}"]`); if (b) b.focus();
      }
    });
    const dlg = $("#ficha");
    $("#ficha-cerrar").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }); // clic fuera de la tarjeta
    dlg.addEventListener("close", () => {
      pedido++;
      const id = estado.cand; estado.cand = null; pintarPanel();
      const b = $(`.cand[data-cand="${id}"]`); if (b) b.focus();
    });
    $("#panel").addEventListener("change", e => {
      const id = e.target.dataset.marca; if (!id) return;
      const s = marcadas();
      if (e.target.checked && s.size < D.provincias[estado.prov].marcas) s.add(id); else s.delete(id);
      pintarPanel();
      const cb = document.getElementById("m-" + id); if (cb) cb.focus();
    });
  }

  // ---------- Inicio ----------
  async function iniciar() {
    [D, P] = await Promise.all([
      fetch("datos/candidaturas.json").then(r => r.json()),
      // Opcional: si falta el archivo, la ficha simplemente no muestra declaraciones
      fetch("datos/parlamentarios.json").then(r => r.ok ? r.json() : { personas: {} }).catch(() => ({ personas: {} })),
    ]);
    document.documentElement.dataset.camara = D.camara || "congreso";
    $("#sel-ccaa").innerHTML = D.comunidades.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    // Estado de los datos: ejemplo, listas presentadas (provisionales) o proclamadas (definitivas, BOE)
    const av = $("#aviso"), f = D.fuente;
    if (D.ejemplo) av.hidden = false;
    else if (f) {
      const dia = new Date(f.fecha).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
      av.innerHTML = f.estado === "presentadas"
        ? `Listas presentadas, pendientes de proclamación · <a href="${esc(f.url)}" target="_blank" rel="noopener">BOE ${dia}</a>`
        : `Candidaturas proclamadas · <a href="${esc(f.url)}" target="_blank" rel="noopener">BOE ${dia}</a>`;
      av.classList.toggle("definitivo", f.estado === "proclamadas");
      av.hidden = false;
    }
    eventos();

    // 1) #enlace directo  2) última elección guardada  3) IP  4) zona horaria  5) por defecto
    const hash = location.hash.slice(1);
    if (comunidad(hash)) return elegir(hash, "Desde el enlace");
    const guardada = leer();
    if (comunidad(guardada)) return elegir(guardada, "Tu última elección");
    elegir(POR_DEFECTO, "Buscando tu comunidad…");
    const ip = await detectarPorIP();
    if (estado.origen !== "Buscando tu comunidad…") return; // el usuario ya eligió
    if (ip) return elegir(ip, "Según tu conexión (aproximado)");
    const tz = porZonaHoraria();
    if (tz) return elegir(tz, "Según tu zona horaria");
    elegir(POR_DEFECTO, "No pudimos detectar tu ubicación: elige tu comunidad");
  }
  iniciar().catch(err => {
    $("#p-nombre").textContent = "No se pudieron cargar los datos";
    console.error(err);
  });
})();
