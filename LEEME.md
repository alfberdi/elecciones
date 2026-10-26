# Candidaturas a las generales

Web estática (sin servidor) con dos secciones, Congreso y Senado, en un solo repositorio y un solo dominio. Las dos usan el mismo código; cada una lee su cámara de `datos/candidaturas.json` (`"camara": "congreso"` o `"senado"`).

```
index.html                   portada: elige Congreso o Senado (acepta /#sevilla o /#andalucia)
comun/
  app.js                     lógica de las dos secciones
  estilos.css                estilos (colores pastel, modo claro y oscuro)
  parlamentarios.json        diputados y senadores en ejercicio y sus declaraciones (automático, semanal)
congreso/
  index.html                 el mapa de España va dibujado dentro, en SVG
  datos/candidaturas.json    listas al Congreso (automático desde el BOE)
senado/
  index.html
  datos/candidaturas.json    candidaturas al Senado (automático desde el BOE)
scripts/
  boe-candidaturas.mjs       lee el BOE y genera las listas
  parlamentarios.mjs         reúne las declaraciones del Congreso y del Senado
.github/workflows/
  candidaturas.yml           cada día: BOE → congreso/ y senado/
  declaraciones.yml          cada lunes: declaraciones → comun/
```

Direcciones resultantes: `https://TU_USUARIO.github.io/elecciones/`, `…/elecciones/congreso/` y `…/elecciones/senado/` (o `tudominio.es/`, `tudominio.es/congreso/` y `tudominio.es/senado/` con dominio propio). El selector «Congreso | Senado» usa enlaces relativos y conserva la comunidad elegida, así que no hay que configurar nada.

## Publicar en GitHub Pages

1. **Crea un repositorio público** en GitHub, por ejemplo `elecciones`, vacío (sin README).
2. **Sube el contenido de esta carpeta a la raíz del repositorio** (`index.html`, `comun/`, `congreso/`… deben quedar arriba del todo). Usa git o GitHub Desktop: la subida arrastrando archivos en la web suele saltarse la carpeta oculta `.github`.
   ```
   cd elecciones
   git init -b main && git add . && git commit -m "Primera versión"
   git remote add origin https://github.com/TU_USUARIO/elecciones.git
   git push -u origin main
   ```
3. **Activa Pages**: *Settings → Pages → Build and deployment*, elige *Deploy from a branch*, rama `main`, carpeta `/ (root)` y pulsa *Save*. En uno o dos minutos la web queda en `https://TU_USUARIO.github.io/elecciones/`.
4. **Dominio propio (opcional)**: en *Settings → Pages → Custom domain* escribe tu dominio (por ejemplo `elecciones.tudominio.es`) y guarda. En tu proveedor de dominio crea un registro **CNAME** `elecciones` → `TU_USUARIO.github.io`. Cuando GitHub lo verifique, marca *Enforce HTTPS*.
5. **Permite que los trabajos automáticos guarden datos**: *Settings → Actions → General → Workflow permissions → Read and write permissions → Save*.
6. **Primera ejecución**: en la pestaña *Actions*, abre «Actualizar declaraciones de parlamentarios» y pulsa *Run workflow* para generar el primer `comun/parlamentarios.json` real. «Leer candidaturas del BOE» ya se ejecuta solo cada día.

Los dos trabajos escriben en la misma rama, así que comparten un grupo de concurrencia: si coinciden, uno espera al otro.

Para probar en local, desde la raíz: `npx serve .` o `python3 -m http.server`, y abre `http://localhost:8000/` (abrir el archivo con doble clic no permite leer los JSON).

## Noticias en directo

No hay archivos de noticias: al abrir una persona, el navegador consulta en ese momento:

1. **GDELT** (api.gdeltproject.org): índice mundial de prensa que se actualiza cada 15 minutos e incluye Agencia EFE, Europa Press, RTVE y casi todos los diarios españoles. Es gratuito, no necesita clave y permite llamadas desde el navegador.
2. **Google Noticias**: su RSS no permite llamadas desde el navegador, así que se lee a través de **rss2json.com**. Sin clave tiene un cupo diario limitado; con una clave gratuita (variable `rss2jsonKey` en `app.js`) el cupo sube.

Los resultados se juntan, se quitan duplicados y se ordenan por fecha. EFE, Europa Press, Politico y RTVE llevan una etiqueta (lista `destacados` en `app.js`). Cada búsqueda se reutiliza 15 minutos en la misma pestaña para no saturar los servicios. Si los dos fallan, se muestra un aviso y quedan los enlaces directos a Google Noticias, EFE y Politico.

Se busca por nombre completo y por «Nombre Primer-apellido», que es como suele citar la prensa. Si una persona es conocida de otra forma, añade `"prensa": "Nombre habitual"` a su entrada.

## Candidaturas automáticas desde el BOE

`scripts/boe-candidaturas.mjs` se ejecuta cada día (`.github/workflows/candidaturas.yml`), una vez dentro de `congreso/` y otra dentro de `senado/`, y publica las listas en cuanto salen en el BOE.

1. Consulta el sumario de los últimos 14 días en la API de datos abiertos del BOE (`boe.es/datosabiertos/api/boe/sumario/AAAAMMDD`).
2. Busca la disposición «Candidaturas presentadas…» o «Candidaturas proclamadas para las elecciones al Congreso de los Diputados y al Senado».
   - **Presentadas** (unos 20 días después de la convocatoria): se publican como provisionales y la web lo indica.
   - **Proclamadas** (unos 6 días después): sustituyen a las anteriores y quedan como definitivas.
3. Lee el texto provincia a provincia («JUNTA ELECTORAL DE …», «CONGRESO DE LOS DIPUTADOS», «SENADO», «Circunscripción electoral: Mallorca»…). Quita las listas «No proclamada», los suplentes y los apodos, y marca a los independientes.
4. Los escaños del Congreso se deducen de las listas, porque cada lista completa lleva tantos nombres como escaños tiene la provincia.
5. **Comprueba el resultado antes de publicar**: si faltan listas en más del 10 % de las circunscripciones, no toca la web y el workflow falla (GitHub te avisa por correo). Así un cambio de formato del BOE nunca publica datos rotos.
6. Si ya está publicado lo mismo, no hace nada. Si el BOE publica una «corrección de errores», lo avisa en el registro del workflow para revisarla a mano.

**Probarlo con las elecciones de 2023** (sin tocar la web), desde la raíz del repositorio:
```
cd congreso && node ../scripts/boe-candidaturas.mjs --fecha 20230627 --salida /tmp/congreso-2023.json --forzar
cd ../senado && node ../scripts/boe-candidaturas.mjs --fecha 20230627 --salida /tmp/senado-2023.json --forzar
```
Ese día se publicaron las proclamadas de 2023 (BOE-A-2023-15066). Revisa los dos archivos antes de confiar en el automatismo.

**Lanzarlo a mano**: pestaña *Actions → Leer candidaturas del BOE → Run workflow*. Puedes indicar una fecha concreta o forzar que se regenere.

## Ficha de candidato y declaraciones

Al tocar un nombre se abre una ficha sobre el fondo desenfocado (se cierra con ×, Esc o tocando fuera). Si la persona ocupa ya un escaño en el Congreso o en el Senado, la ficha muestra lo que ha declarado. La lista sale de `comun/parlamentarios.json`, un único archivo para las dos cámaras porque un candidato al Congreso puede ser hoy senador y al revés.

Ese archivo lo genera `scripts/parlamentarios.mjs` (desde la raíz del repositorio) cada lunes en GitHub Actions (`.github/workflows/declaraciones.yml`). No se puede leer en directo desde el navegador: congreso.es y senado.es no lo permiten y las declaraciones del Senado son PDF.

- **Congreso**: diputados en activo y su declaración de intereses económicos, desde el portal de datos abiertos (JSON). Las declaraciones de bienes del Congreso no están en datos abiertos; la ficha enlaza a congreso.es.
- **Senado**: senadores de la legislatura (XML de datos abiertos) y su declaración de bienes y rentas (PDF `DBR_<id>.pdf`), de la que se extraen los apartados: rentas, inmuebles, depósitos, valores, vehículos, deudas y observaciones. Siempre se enlaza el PDF original.
- **Cruce de nombres**: se compara el nombre completo sin acentos ni orden. Si dos personas comparten nombre, el script no las cruza. Para forzar o corregir un cruce, añade al candidato `"parlamentario": "<clave>"` con la clave que aparece en `parlamentarios.json`.
- **Legislatura nueva**: cuando se constituyan las nuevas Cortes, sube `LEGIS_SENADO` en el workflow (15 → 16).

El primer uso real conviene revisarlo: los formatos de estas fuentes oficiales cambian a veces y el script se ha probado con copias simuladas de ellas.

## Datos

Los datos incluidos son **de ejemplo** (partidos y personas ficticios) y la web lo indica con un aviso. El trabajo diario del BOE los sustituye solo cuando salgan las candidaturas; si prefieres cargarlas a mano, este es el formato:

```json
"provincias": {
  "sevilla": {
    "nombre": "Sevilla", "ccaa": "andalucia", "escanos": 4, "marcas": 3,
    "listas": { "abc": [ { "id": "sen-sevilla-abc-1", "nombre": "Nombre Apellido Apellido" } ] }
  }
}
```

- **Congreso**: una entrada por provincia; el orden de cada lista es el orden de la papeleta. Los escaños por provincia se recalculan en cada real decreto de convocatoria (los incluidos son los de 2023).
- **Senado**: una entrada por circunscripción. En Baleares y Canarias, cada isla o agrupación de islas es una circunscripción. `escanos` son los senadores que se eligen (4 provincia, 3 o 1 isla, 2 Ceuta y Melilla) y `marcas` las que puede hacer cada elector (3, 2, 1 y 1). Ordena los candidatos de cada partido alfabéticamente por apellido, como en la papeleta.

## Provincia inicial, mapa y buscador

Las elecciones generales se votan por provincia (en el Senado, en Baleares y Canarias, por isla), así que el mapa y el buscador eligen provincias. Las comunidades aparecen como un trazo algo más marcado en el mapa y como grupos en el buscador.

- **Buscador**: filtra mientras escribes, sin tener en cuenta acentos. Encuentra provincias, comunidades («Galicia» muestra sus cuatro provincias), islas («Lanzarote» abre Las Palmas y, en el Senado, la pestaña de la isla) y personas candidatas (a partir de 3 letras; al elegir una se abre su ficha). Se maneja con las flechas, Intro y Esc.
- **Enlaces directos**: `#sevilla`, `#lanzarote` o `#andalucia` (que abre su capital). El selector «Congreso | Senado» y la portada conservan la provincia.
- **Provincia inicial**, por orden: enlace directo, última elección guardada en el navegador, ubicación por IP y zona horaria (detecta Canarias). Si no funciona nada, se usa Madrid (`POR_DEFECTO` en `comun/app.js`).
  - **Ubicación por IP**: ipapi.co da el código postal, cuyas dos primeras cifras son el código INE de la provincia. Si solo se conoce la comunidad (geojs.io), se propone su capital y se pide comprobarlo.
