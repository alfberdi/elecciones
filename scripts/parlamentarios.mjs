// Reúne los diputados y senadores en ejercicio y sus declaraciones públicas en comun/parlamentarios.json.
// Se ejecuta fuera del navegador (GitHub Actions, cada semana) porque congreso.es y senado.es no permiten
// llamadas desde otras webs y las declaraciones del Senado son PDF que hay que leer.
//
// Uso (desde la raíz del repositorio):  npm install --no-save pdfjs-dist@4.10.38 && node scripts/parlamentarios.mjs
// Variables opcionales: LEGIS_SENADO (por defecto 15; súbela al empezar una legislatura nueva).
import { writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const LEGIS = process.env.LEGIS_SENADO || "15";
const UA = { "User-Agent": "mapa-candidaturas (sitio estático; contacto en el repositorio)" };
const espera = ms => new Promise(r => setTimeout(r, ms));

// Misma clave que usa app.js para cruzar nombres
const sinAcentos = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const claveNombre = s => sinAcentos(s).replace(/[^a-zñ ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
const bonito = k => k.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
const campo = (o, re) => Object.keys(o).find(k => re.test(k));
const lista = j => Array.isArray(j) ? j : (Object.values(j).find(Array.isArray) || []);

async function texto(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
async function existe(url) { try { return (await fetch(url, { method: "HEAD", headers: UA })).ok; } catch { return false; } }

const personas = {};
function poner(nombre, datos) {
  const k = claveNombre(nombre);
  if (personas[k]) { console.warn(`Nombre repetido, se descarta el cruce automático: ${nombre}`); personas[k] = null; return; }
  personas[k] = datos;
}

// ---------- Congreso: datos abiertos en JSON ----------
async function congreso() {
  const portal = await texto("https://www.congreso.es/es/opendata/diputados");
  const base = "https://www.congreso.es/webpublica/opendata/diputados/";
  const archivo = n => (portal.match(new RegExp(n + "__\\d+\\.json")) || [])[0];
  if (!archivo("DiputadosActivos")) throw new Error("No se encuentra el archivo de diputados en activo");

  const activos = lista(JSON.parse(await texto(base + archivo("DiputadosActivos"))));
  const intereses = archivo("docacteco") ? lista(JSON.parse(await texto(base + archivo("docacteco")))) : [];
  const nInt = intereses[0] && campo(intereses[0], /^nombre$|nombre/i);
  const porNombre = {};
  for (const r of intereses) (porNombre[claveNombre(r[nInt] || "")] ||= []).push(r);

  for (const d of activos) {
    const nombre = d[campo(d, /^nombre$|nombre/i)]; if (!nombre) continue;
    const filas = [];
    for (const r of porNombre[claveNombre(nombre)] || [])
      for (const [k, v] of Object.entries(r))
        if (k !== nInt && v != null && String(v).trim() && !/legislatura|nombre/i.test(k)) filas.push([bonito(k), String(v).trim()]);
    poner(nombre, {
      cargo: "Diputado/a en el Congreso",
      circunscripcion: d[campo(d, /circunscrip/i)] || "",
      grupo: d[campo(d, /grupo/i)] || d[campo(d, /formaci/i)] || "",
      fuente: "Portal de datos abiertos del Congreso de los Diputados",
      secciones: [{ titulo: "Declaración de intereses económicos", filas }],
      documentos: [{ titulo: "Ficha y declaración de bienes en congreso.es", url: "https://www.congreso.es/es/busqueda-de-diputados" }],
    });
  }
  console.log(`Congreso: ${activos.length} diputados en activo`);
}

// ---------- Senado: lista en XML + declaración de bienes y rentas en PDF ----------
const SECCIONES = [
  ["Rentas percibidas", /rentas percibidas|rendimientos/i],
  ["Bienes inmuebles", /bienes inmuebles|patrimonio inmobiliario|urban[ao]s/i],
  ["Depósitos en cuentas", /dep[oó]sitos/i],
  ["Deuda pública, valores y participaciones", /deuda p[uú]blica|valores|acciones y participaciones/i],
  ["Vehículos, embarcaciones y aeronaves", /veh[ií]culos/i],
  ["Préstamos y deudas", /^\s*(deudas|pr[eé]stamos|cr[eé]ditos)/i],
  ["Observaciones", /^\s*observaciones/i],
];
// Importe al final de la línea: "12.300,00", "48.520" o "120 €" (un año suelto como "2018" no cuenta)
const IMPORTE = /(?:^|\s)(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d{1,3}(?:\.\d{3})+|-?\d+(?=\s*(?:€|euros)))\s*(?:€|euros)?\s*$/i;

async function lineasPdf(url) {
  const r = await fetch(url, { headers: UA }); if (!r.ok) return null;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()), useSystemFonts: true }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const filas = new Map();
    for (const it of (await (await doc.getPage(i)).getTextContent()).items) {
      const y = Math.round(it.transform[5] / 3); // agrupa trozos de la misma línea
      filas.set(y, (filas.get(y) || "") + " " + it.str);
    }
    [...filas.entries()].sort((a, b) => b[0] - a[0]).forEach(([, t]) => { t = t.replace(/\s+/g, " ").trim(); if (t) out.push(t); });
  }
  return out;
}
function seccionar(lineas) {
  const res = []; let actual = null;
  for (const l of lineas) {
    const s = SECCIONES.find(([, re]) => re.test(l) && l.length < 90);
    if (s) { actual = res.find(x => x.titulo === s[0]) || (res.push({ titulo: s[0], filas: [] }), res[res.length - 1]); continue; }
    if (!actual || actual.filas.length >= 40) continue;
    const m = l.match(IMPORTE);
    actual.filas.push(m && m.index > 0 ? [l.slice(0, m.index).trim(), m[1] + " €"] : [l, ""]);
  }
  return res;
}

async function senado() {
  const xml = await texto(`https://www.senado.es/web/ficopendataservlet?tipoFich=10&legis=${LEGIS}`);
  const tag = (b, re) => { const m = b.match(new RegExp(`<(${re})>\\s*([^<]*?)\\s*</\\1>`, "i")); return m ? m[2] : ""; };
  // El elemento que agrupa a cada senador es la etiqueta que aparece tantas veces como <idweb> y lo envuelve
  const nId = (xml.match(/<idweb>/gi) || []).length, primero = xml.search(/<idweb>/i);
  const candidatos = [...new Set([...xml.slice(0, primero).matchAll(/<(\w+)[^>\/]*>/g)].map(m => m[1]))]
    .filter(t => (xml.match(new RegExp(`<${t}[\\s>]`, "g")) || []).length === nId);
  const reg = candidatos[0]; // la más externa
  if (!reg) throw new Error("Formato del XML del Senado no reconocido");
  const bloques = [...xml.matchAll(new RegExp(`<${reg}[\\s>][\\s\\S]*?</${reg}>`, "g"))].map(m => m[0]);
  let n = 0;
  for (const b of bloques) {
    const id = tag(b, "idweb"), nom = tag(b, "nombre"), ape = tag(b, "apellidos");
    if (!id || !nom || tag(b, "fechaBaja|fechabaja|baja")) continue;
    const dbr = `https://www.senado.es/legis${LEGIS}/senadores/regbi/DBR_${id}.pdf`;
    const dae = `https://www.senado.es/legis${LEGIS}/senadores/regbi/DAE_${id}.pdf`;
    let secciones = [];
    try { const l = await lineasPdf(dbr); if (l) secciones = seccionar(l); } catch (e) { console.warn(`PDF ilegible ${dbr}: ${e.message}`); }
    const documentos = [];
    if (secciones.length || await existe(dbr)) documentos.push({ titulo: "Declaración de bienes y rentas (PDF)", url: dbr });
    if (await existe(dae)) documentos.push({ titulo: "Declaración de actividades (PDF)", url: dae });
    poner(`${nom} ${ape}`, {
      cargo: "Senador/a",
      circunscripcion: tag(b, "procedLiteral|circunscripcion|procedencia"),
      grupo: tag(b, "grupoNombre|grupoSiglas|grupo"),
      fuente: "Registro de intereses del Senado",
      secciones, documentos,
    });
    n++;
    await espera(400); // sin prisas con senado.es
  }
  console.log(`Senado (legislatura ${LEGIS}): ${n} senadores`);
}

const errores = [];
for (const [nombre, fn] of [["Congreso", congreso], ["Senado", senado]])
  try { await fn(); } catch (e) { errores.push(nombre); console.error(`${nombre}: ${e.message}`); }
if (errores.length === 2) { console.error("No se ha podido leer ninguna fuente; no se modifica el archivo."); process.exit(1); }

for (const k of Object.keys(personas)) if (!personas[k]) delete personas[k];
writeFileSync("comun/parlamentarios.json", JSON.stringify({ generado: new Date().toISOString(), ejemplo: false, personas }, null, 1));
console.log(`Guardadas ${Object.keys(personas).length} personas en comun/parlamentarios.json`);
