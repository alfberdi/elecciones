// Lee el BOE cada día y, cuando aparecen las candidaturas de las elecciones generales, genera datos/candidaturas.json.
//
// 1. Recorre los sumarios diarios del BOE de los últimos días (API de datos abiertos).
// 2. Busca «Candidaturas presentadas/proclamadas para las elecciones al Congreso de los Diputados y al Senado».
//    Las presentadas salen primero (provisionales); las proclamadas unos días después y las sustituyen.
// 3. Descarga el texto, lo interpreta provincia a provincia y escribe las listas de la cámara de este sitio.
//
// Sin dependencias (Node 20+). Uso:
//   node scripts/boe-candidaturas.mjs                      revisa los últimos 14 días
//   node scripts/boe-candidaturas.mjs --fecha 20230627     revisa un día concreto (útil para probar con 2023)
//   node scripts/boe-candidaturas.mjs --dias 30 --salida /tmp/prueba.json --forzar
import { readFileSync, writeFileSync } from "node:fs";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const DIAS = +arg("dias", 14);
const FECHA = arg("fecha", "");
const ENTRADA = "datos/candidaturas.json";
const SALIDA = arg("salida", ENTRADA);
const FORZAR = process.argv.includes("--forzar");
const UA = { "User-Agent": "mapa-candidaturas (sitio estático, GitHub Actions)" };

const actual = JSON.parse(readFileSync(ENTRADA, "utf8"));
const CAMARA = actual.camara || "congreso";

// ---------- Nombres de provincia e isla tal como pueden aparecer en el BOE → id del sitio ----------
const sinAcentos = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const ALIAS = {
  "a coruna": "a-coruna", "la coruna": "a-coruna", coruna: "a-coruna", alava: "alava", araba: "alava", "araba/alava": "alava", "alava/araba": "alava",
  albacete: "albacete", alicante: "alicante", alacant: "alicante", "alicante/alacant": "alicante", almeria: "almeria", asturias: "asturias",
  avila: "avila", badajoz: "badajoz", baleares: "baleares", "illes balears": "baleares", "islas baleares": "baleares", barcelona: "barcelona",
  bizkaia: "bizkaia", vizcaya: "bizkaia", burgos: "burgos", caceres: "caceres", cadiz: "cadiz", cantabria: "cantabria",
  castellon: "castellon", castello: "castellon", "castellon/castello": "castellon", ceuta: "ceuta", "ciudad real": "ciudad-real",
  cordoba: "cordoba", cuenca: "cuenca", gipuzkoa: "gipuzkoa", guipuzcoa: "gipuzkoa", girona: "girona", gerona: "girona",
  granada: "granada", guadalajara: "guadalajara", huelva: "huelva", huesca: "huesca", jaen: "jaen", "la rioja": "la-rioja",
  "las palmas": "las-palmas", leon: "leon", lleida: "lleida", lerida: "lleida", lugo: "lugo", madrid: "madrid", malaga: "malaga",
  melilla: "melilla", murcia: "murcia", navarra: "navarra", ourense: "ourense", orense: "ourense", palencia: "palencia",
  pontevedra: "pontevedra", salamanca: "salamanca", "santa cruz de tenerife": "santa-cruz", segovia: "segovia", sevilla: "sevilla",
  soria: "soria", tarragona: "tarragona", teruel: "teruel", toledo: "toledo", valencia: "valencia", "valencia/valencia": "valencia",
  valladolid: "valladolid", zamora: "zamora", zaragoza: "zaragoza",
  // circunscripciones insulares del Senado
  mallorca: "mallorca", menorca: "menorca", "eivissa-formentera": "eivissa-formentera", "ibiza-formentera": "eivissa-formentera",
  "eivissa y formentera": "eivissa-formentera", "ibiza y formentera": "eivissa-formentera", "gran canaria": "gran-canaria",
  tenerife: "tenerife", fuerteventura: "fuerteventura", lanzarote: "lanzarote", "lanzarote-la graciosa": "lanzarote",
  "lanzarote y la graciosa": "lanzarote", "la palma": "la-palma", "la gomera": "la-gomera", "el hierro": "el-hierro", hierro: "el-hierro",
};
function idDe(nombre) {
  const k = sinAcentos(nombre).replace(/[.:]+$/, "").trim();
  return ALIAS[k] ?? ALIAS[k.replace(/\s*-\s*/g, "-")] ?? ALIAS[k.replace(/\s*\/\s*/g, "/")] ?? ALIAS[k.split("/")[0].trim()] ?? null;
}

// ---------- BOE: sumarios y documentos ----------
async function get(url, accept) {
  const r = await fetch(url, { headers: { ...UA, Accept: accept } });
  if (r.status === 404) return null;               // día sin BOE
  if (!r.ok) throw new Error(`${r.status} en ${url}`);
  return accept.includes("json") ? r.json() : r.text();
}
const comoLista = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
function itemsDelSumario(j) {
  const out = [];
  for (const d of comoLista(j?.data?.sumario?.diario))
    for (const s of comoLista(d.seccion))
      for (const dep of comoLista(s.departamento)) {
        const items = [...comoLista(dep.item), ...comoLista(dep.epigrafe).flatMap(e => comoLista(e.item))];
        for (const it of items) out.push({ ...it, departamento: dep.nombre || "" });
      }
  return out;
}
const RE_TITULO = /candidaturas\s+(presentadas|proclamadas)\b.*congreso de los diputados/i;
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");

async function buscarPublicaciones() {
  const fechas = FECHA ? [FECHA] : Array.from({ length: DIAS }, (_, i) => ymd(new Date(Date.now() - i * 864e5)));
  const halladas = [];
  for (const f of fechas) {
    const j = await get(`https://www.boe.es/datosabiertos/api/boe/sumario/${f}`, "application/json");
    for (const it of itemsDelSumario(j)) {
      const m = (it.titulo || "").match(RE_TITULO);
      if (m && !/correcci[oó]n de errores/i.test(it.titulo))
        halladas.push({ id: it.identificador, titulo: it.titulo, fecha: f, estado: m[1].toLowerCase(), url: it.url_html || `https://www.boe.es/diario_boe/txt.php?id=${it.identificador}` });
      else if (m) console.warn(`Hay una corrección de errores que conviene revisar a mano: ${it.identificador} ${it.titulo}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return halladas;
}

// El XML del documento trae el texto en párrafos <p>; lo pasamos a líneas limpias
const decodificar = s => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
async function lineasDe(id) {
  const xml = await get(`https://www.boe.es/diario_boe/xml.php?id=${id}`, "application/xml");
  const texto = (xml.match(/<texto[^>]*>([\s\S]*?)<\/texto>/i) || [, xml])[1];
  return [...texto.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => decodificar(m[1])).filter(Boolean);
}

// ---------- Interpretación del texto ----------
const MINUS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "i", "per", "por", "para", "en", "a", "d", "l"]);
const titulo = s => s.toLowerCase().split(" ").map((w, i) => i && MINUS.has(w) ? w : w.replace(/(^|[-'’])(\p{L})/gu, (_, a, c) => a + c.toUpperCase())).join(" ");
const slug = s => sinAcentos(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Una línea de partido va en mayúsculas («1. PARTIDO EJEMPLO (PE)»); las de candidatos, en minúsculas y mayúsculas
function esPartido(t) {
  const letras = t.replace(/^\[|\]\.?$/g, "").replace(/\([^)]*\)/g, "").match(/\p{L}/gu) || [];
  const minus = letras.filter(c => c !== c.toUpperCase()).length;
  return letras.length > 1 && minus / letras.length < 0.2;
}
function partido(t) {
  t = t.replace(/^\[|\]\.?$/g, "").replace(/\.$/, "").trim();
  const m = t.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  const nombre = (m ? m[1] : t).trim(), siglas = (m ? m[2] : t).trim();
  return { id: slug(siglas).slice(0, 40), siglas, nombre: titulo(nombre || siglas) };
}
function candidato(t) {
  const independiente = /\((independiente|independent|independentea|independente)\)/i.test(t);
  const nombre = t.replace(/\((independiente|independent|independentea|independente)\)/gi, "")
    .replace(/«[^»]*»|"[^"]*"|\([^)]*\)/g, "")      // apodos entre paréntesis o comillas
    .replace(/\.\s*$/, "").replace(/\s+/g, " ").trim();
  return { nombre: esPartido(nombre) ? titulo(nombre) : nombre, independiente };  // nombres en mayúsculas → normales
}

function interpretar(lineas) {
  const circs = {};             // circ -> { partidoId -> { partido, titulares: [] } }
  const partidos = {};
  let prov = null, camara = null, circ = null, actualP = null, modo = "tit", numP = 0, avisos = [];
  for (const l of lineas) {
    let m;
    if ((m = l.match(/^JUNTA ELECTORAL (?:PROVINCIAL )?DE\s+(.+?)\.?$/i))) {
      prov = idDe(m[1]); camara = null; circ = null; actualP = null;
      if (!prov) avisos.push(`Provincia no reconocida: «${m[1]}»`);
      continue;
    }
    if (!prov) continue;
    if (/^CONGRESO DE LOS DIPUTADOS\.?$/i.test(l)) { camara = "congreso"; circ = prov; actualP = null; numP = 0; continue; }
    if (/^SENADO\.?$/i.test(l)) { camara = "senado"; circ = prov; actualP = null; numP = 0; continue; }
    if ((m = l.match(/^Circunscripci[oó]n(?: electoral)?\s*:?\s*(?:insular\s*(?:de)?\s*)?(.+?)\.?$/i))) {
      const c = idDe(m[1]); if (c) { circ = c; actualP = null; numP = 0; } else avisos.push(`Circunscripción no reconocida: «${m[1]}»`);
      continue;
    }
    if (camara !== CAMARA) continue;
    if (/^No proclamada\.?$/i.test(l)) { if (actualP) delete circs[circ][actualP]; actualP = null; continue; }
    if (/^Suplentes\s*:?$/i.test(l)) { modo = "sup"; continue; }
    if (/^Suplente\s*\d*\s*:/i.test(l)) continue;     // suplentes del Senado
    if (!(m = l.match(/^(\d+)\s*\.\s*(.+)$/))) continue; // texto de trámite, firmas…
    const [, num, resto] = m;
    // Partido: va en mayúsculas y sigue la numeración de partidos. Si un nombre de candidato viniera en mayúsculas,
    // lo distingue que continúa la numeración de la lista y no lleva siglas entre paréntesis.
    const n = +num, largo = actualP ? circs[circ][actualP].titulares.length : -1;
    const pareceCand = actualP && modo === "tit" && n === largo + 1 && !/[()[\]]/.test(resto);
    if (!actualP || (esPartido(resto) && n === numP + 1 && !pareceCand) || (esPartido(resto) && /[()[\]]/.test(resto) && n === numP + 1)) {
      numP = n;
      const p = partido(resto);
      partidos[p.id] ||= { id: p.id, siglas: p.siglas, nombre: p.nombre };
      (circs[circ] ||= {})[p.id] = { titulares: [] };
      actualP = p.id; modo = "tit";
      continue;
    }
    if (modo !== "tit") continue;
    const c = candidato(resto);
    const lista = circs[circ][actualP].titulares;
    if (n !== lista.length + 1) avisos.push(`${circ}/${actualP}: se esperaba el nº ${lista.length + 1} y llega el ${num}`);
    lista.push(c);
  }
  return { circs, partidos, avisos };
}

// ---------- Construcción del archivo del sitio ----------
function construir(pub, { circs, partidos }) {
  const out = structuredClone(actual);
  const usados = new Set();
  for (const [id, prov] of Object.entries(out.provincias)) {
    const listas = {};
    for (const [pid, { titulares }] of Object.entries(circs[id] || {})) {
      if (!titulares.length) continue;
      usados.add(pid);
      listas[pid] = titulares.map((c, i) => ({
        id: `${CAMARA === "senado" ? "sen-" : ""}${id}-${pid}-${i + 1}`,
        nombre: c.nombre, ...(c.independiente ? { independiente: true } : {}),
      }));
    }
    prov.listas = listas;
    // Congreso: cada lista completa lleva tantos nombres como escaños tiene la provincia
    if (CAMARA === "congreso") { const max = Math.max(0, ...Object.values(listas).map(l => l.length)); if (max) prov.escanos = max; }
  }
  out.partidos = Object.values(partidos).filter(p => usados.has(p.id)).sort((a, b) => a.siglas.localeCompare(b.siglas, "es"));
  out.ejemplo = false;
  out.fuente = { boe: pub.id, url: pub.url, fecha: `${pub.fecha.slice(0, 4)}-${pub.fecha.slice(4, 6)}-${pub.fecha.slice(6)}`, estado: pub.estado, titulo: pub.titulo };
  out.actualizado = new Date().toISOString().slice(0, 10);
  delete out.nota;
  return out;
}

// ---------- Programa ----------
const pubs = await buscarPublicaciones();
if (!pubs.length) { console.log(`Sin candidaturas de elecciones generales en el BOE (${FECHA || `últimos ${DIAS} días`}).`); process.exit(0); }
// Las proclamadas mandan sobre las presentadas; entre iguales, la más reciente
pubs.sort((a, b) => (a.estado === b.estado ? b.fecha.localeCompare(a.fecha) : a.estado === "proclamadas" ? -1 : 1));
const elegida = pubs[0];
const delMismoDia = pubs.filter(p => p.estado === elegida.estado && p.fecha === elegida.fecha); // por si se publica en varios documentos
if (!FORZAR && actual.fuente && actual.fuente.estado === elegida.estado && actual.fuente.boe === elegida.id) {
  console.log(`Ya está publicado ${elegida.id} (${elegida.estado}). Nada que hacer.`); process.exit(0);
}
if (!FORZAR && actual.fuente?.estado === "proclamadas" && elegida.estado === "presentadas") {
  console.log("Ya hay candidaturas proclamadas; no se vuelve a las presentadas."); process.exit(0);
}

console.log(`Leyendo ${delMismoDia.map(p => p.id).join(", ")} (${elegida.estado}) para ${CAMARA}…`);
const lineas = (await Promise.all(delMismoDia.map(p => lineasDe(p.id)))).flat();
const res = interpretar(lineas);
res.avisos.slice(0, 30).forEach(a => console.warn("Aviso: " + a));

// Validación: no se publica nada si el texto no se ha entendido bien
const total = Object.keys(actual.provincias).length;
const conListas = Object.keys(actual.provincias).filter(id => Object.values(res.circs[id] || {}).some(l => l.titulares.length));
const nCand = Object.values(res.circs).flatMap(c => Object.values(c)).reduce((s, l) => s + l.titulares.length, 0);
console.log(`${conListas.length}/${total} circunscripciones con listas, ${Object.keys(res.partidos).length} candidaturas distintas, ${nCand} candidatos.`);
const faltan = Object.keys(actual.provincias).filter(id => !conListas.includes(id));
if (faltan.length) console.warn("Sin listas: " + faltan.join(", "));
if (conListas.length < total * 0.9 && !FORZAR) {
  console.error("Demasiadas circunscripciones sin listas: probablemente el formato del BOE ha cambiado. No se modifica el sitio.");
  process.exit(1);
}

writeFileSync(SALIDA, JSON.stringify(construir(elegida, res), null, 1));
console.log(`Escrito ${SALIDA} desde ${elegida.id}.`);
