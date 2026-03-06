const CLP = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DEC = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LP_B2C_FIRST = 7;
const LP_B2C_AFTER = 10;
const PICKUP_TARIFA_POR_VEZ = 4500;
const ALMACENAJE_UF_PALLET = 0.255;
const SERVICIO_RECEPCION_UF = 0.32;

const PICKING_BULTO_UF = 0.0284863;
const GESTION_ORDEN_UF = 0.0162513;
const IVA_FACTOR = 1.19;
const TARIFA_PALLET_SUELTO_UF = 0.25;
const TARIFA_BULTO_SUELTO_UF = 0.022;
const TARIFA_SOBREDIM_UF = 0.4947;
const TARIFA_UNITARIO_UF = 0.007256;
const CLP_FIELD_IDS = new Set([
  "ufValue",
  "b2cPrecioBruto",
  "b2cEnvio",
  "b2cCompra",
  "b2bPrecioBruto",
  "b2bEnvio",
  "b2bCompra"
]);

const $ = (id) => document.getElementById(id);

function n(id) {
  if (CLP_FIELD_IDS.has(id)) {
    return parseClpInput($(id).value);
  }
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : 0;
}

function setVal(id, value) {
  if (CLP_FIELD_IDS.has(id)) {
    $(id).value = formatClpInput(value);
    return;
  }
  $(id).value = String(value);
}

function money(v) {
  return `$${CLP.format(Math.round(v))}`;
}

function pct(v) {
  return `${PCT.format(v)}%`;
}

function dec(v) {
  return DEC.format(v);
}

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

function toNet(v) {
  return v / IVA_FACTOR;
}

function parseClpInput(raw) {
  const digits = String(raw).replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatClpInput(value) {
  const n = Number(value) || 0;
  return CLP.format(Math.round(n));
}

function formatDateCL(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CL");
}

function setUfMeta(text) {
  const el = $("ufMeta");
  if (!el) return;
  el.textContent = text;
}

async function refreshUfOnline() {
  const btn = $("refreshUf");
  if (btn) btn.disabled = true;
  setUfMeta("Consultando UF en línea...");
  try {
    // API pública de indicadores de Chile
    const res = await fetch("https://mindicador.cl/api/uf");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const serie0 = data?.serie?.[0];
    const valor = Number(serie0?.valor);
    const fecha = serie0?.fecha;
    if (!Number.isFinite(valor) || valor <= 0) throw new Error("UF inválida");
    $("ufValue").value = formatClpInput(valor);
    const f = formatDateCL(fecha) || formatDateCL(new Date().toISOString());
    setUfMeta(`UF en línea al ${f} (fuente: mindicador.cl)`);
    renderB2C();
    renderB2B();
  } catch (err) {
    const hoy = new Date().toLocaleDateString("es-CL");
    setUfMeta(`UF manual vigente al ${hoy} (sin conexión a API)`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function recepcionMensualCLP(prefix) {
  const uf = n("ufValue");
  const tarifaUf = n(`${prefix}IngresoTipo`);
  const cantidadPorIngreso = Math.max(1, n(`${prefix}CantidadIngreso`));
  const ingresosMes = Math.max(1, n(`${prefix}VecesIngreso`));
  const extraPalletSuelto = Math.max(0, n(`${prefix}ExtraPalletSuelto`));
  const extraBultosSuelto = Math.max(0, n(`${prefix}ExtraBultosSuelto`));
  const extraTonSobredim = Math.max(0, n(`${prefix}ExtraTonSobredim`));
  const extraArticulosUnitario = Math.max(0, n(`${prefix}ExtraArticulosUnitario`));

  const extrasUfPorIngreso =
    (extraPalletSuelto * TARIFA_PALLET_SUELTO_UF) +
    (extraBultosSuelto * TARIFA_BULTO_SUELTO_UF) +
    (extraTonSobredim * TARIFA_SOBREDIM_UF) +
    (extraArticulosUnitario * TARIFA_UNITARIO_UF);

  const ufMensual = ((tarifaUf * cantidadPorIngreso) + extrasUfPorIngreso + SERVICIO_RECEPCION_UF) * ingresosMes;
  return {
    ufMensual,
    clpMensual: ufMensual * uf,
    ingresosMes,
    cantidadPorIngreso,
    tarifaUf,
    extrasUfPorIngreso
  };
}

function updateIngresoContext(prefix) {
  const tipo = Number($(`${prefix}IngresoTipo`).value);
  const label = $(`${prefix}CantidadIngresoLabel`);
  const input = $(`${prefix}CantidadIngreso`);

  if (Math.abs(tipo - 0.022) < 1e-9) {
    // Carga suelta: cantidad en bultos
    label.textContent = "Cantidad de bultos por ingreso";
    input.step = "1";
    input.min = "1";
    if (Number(input.value) < 1) input.value = "1";
    return;
  }

  if (Math.abs(tipo - 0.4947) < 1e-9) {
    // Carga sobredimensionada: cantidad en toneladas
    label.textContent = "Toneladas por ingreso";
    input.step = "0.01";
    input.min = "0.01";
    if (Number(input.value) <= 0) input.value = "1";
    return;
  }

  label.textContent = "Cantidad por ingreso";
  input.step = "1";
  input.min = "1";
  if (Number(input.value) < 1) input.value = "1";
}

function collectInputsForPdf(type) {
  const ids = type === "b2c"
    ? [
      "ufValue", "rollosPorCaja", "b2cPeriodo", "b2cVentaRollos", "b2cIngresoTipo", "b2cCantidadIngreso",
      "b2cVecesIngreso", "b2cExtraPalletSuelto", "b2cExtraBultosSuelto", "b2cExtraTonSobredim",
      "b2cExtraArticulosUnitario", "b2cPosicionesPallet", "b2cPickupVecesMes", "b2cPrecioBruto",
      "b2cComisionMeli", "b2cPublicidad", "b2cEnvio", "b2cEnvioPagaCliente", "b2cCompra"
    ]
    : [
      "ufValue", "rollosPorCaja", "b2bCajasPedido", "b2bPedidosMes", "b2bIngresoTipo", "b2bCantidadIngreso",
      "b2bVecesIngreso", "b2bExtraPalletSuelto", "b2bExtraBultosSuelto", "b2bExtraTonSobredim",
      "b2bExtraArticulosUnitario", "b2bPosicionesPallet", "b2bPrecioBruto", "b2bComisionCanal",
      "b2bPublicidad", "b2bEnvio", "b2bEnvioPagaCliente", "b2bCompra"
    ];

  return ids.map((id) => {
    const el = $(id);
    if (!el) return null;
    const labelEl = el.closest("label");
    let label = id;
    if (labelEl) {
      const text = labelEl.textContent.replace(/\s+/g, " ").trim();
      label = text.replace(/\$|%/g, "").trim();
    }
    let value = "";
    if (el.tagName === "SELECT") value = el.options[el.selectedIndex]?.text || "";
    else if (el.type === "checkbox") value = el.checked ? "Sí" : "No";
    else value = el.value;
    return { label, value };
  }).filter(Boolean);
}

function collectRowsForPdf(outId) {
  const out = $(outId);
  const rows = [];
  out.querySelectorAll("table.breakdown tr").forEach((tr) => {
    const cols = [...tr.querySelectorAll("th,td")].map((c) => c.textContent.replace(/\s+/g, " ").trim());
    if (cols.length > 0) rows.push(cols.join(" | "));
  });
  return rows;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapLine(text, max = 80) {
  const words = String(text).split(/\s+/);
  const out = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) out.push(cur.trim());
      cur = w;
    } else {
      cur = `${cur} ${w}`;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function buildPdfLines(type) {
  const outId = type === "b2c" ? "outB2C" : "outB2B";
  const title = type === "b2c" ? "Reporte B2C" : "Reporte B2B";
  const header = [
    `VPM x LogisticPlus - ${title}`,
    `Generado: ${new Date().toLocaleString("es-CL")}`,
    ""
  ];
  const inputLines = ["Inputs"].concat(
    collectInputsForPdf(type).flatMap((r) => wrapLine(`• ${r.label}: ${r.value}`))
  );
  const resultLines = ["", "Resultados"].concat(
    collectRowsForPdf(outId).flatMap((r) => wrapLine(`• ${r}`))
  );
  return header.concat(inputLines).concat(resultLines);
}

function renderSvgPage(lines, pageIndex, totalPages) {
  const width = 595;
  const height = 842;
  const margin = 34;
  const lineH = 14;
  let y = margin;

  const textNodes = lines.map((line, i) => {
    const w = line === "Inputs" || line === "Resultados" ? "700" : "500";
    const size = line === "Inputs" || line === "Resultados" ? "12" : (i < 2 ? "11" : "10");
    const fill = i === 0 ? "#0f4c81" : "#1e293b";
    const node = `<text x="${margin}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${w}" fill="${fill}">${xmlEscape(line)}</text>`;
    y += lineH;
    return node;
  }).join("");

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  <rect x="${margin - 10}" y="${margin - 18}" width="${width - (margin - 10) * 2}" height="${height - (margin - 18) * 2}" rx="14" fill="#f8fbff" stroke="#d6e2f0"/>
  ${textNodes}
  <text x="${width - margin}" y="${height - 18}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="#64748b">Página ${pageIndex + 1} de ${totalPages}</text>
</svg>`;
}

async function downloadPdf(type) {
  const { jsPDF } = window.jspdf || {};
  const svg2pdfFn = typeof window.svg2pdf === "function" ? window.svg2pdf : window.svg2pdf?.svg2pdf;
  if (!jsPDF || !svg2pdfFn) {
    return;
  }

  showCalcModal();
  $("calcModalText").textContent = "Generando PDF vectorial...";

  try {
    if (type === "b2c") renderB2C();
    else renderB2B();

    const allLines = buildPdfLines(type);
    const linesPerPage = 48;
    const chunks = [];
    for (let i = 0; i < allLines.length; i += linesPerPage) {
      chunks.push(allLines.slice(i, i + linesPerPage));
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) doc.addPage();
      const svgMarkup = renderSvgPage(chunks[i], i, chunks.length);
      const wrap = document.createElement("div");
      wrap.innerHTML = svgMarkup.trim();
      const svgEl = wrap.firstElementChild;
      await svg2pdfFn(svgEl, doc, {
        xOffset: 0,
        yOffset: 0,
        scale: 1,
        removeInvalid: true
      });
    }

    doc.save(`reporte-${type}-vpm-logisticplus.pdf`);
    $("calcModalText").textContent = "Listo";
  } catch (_e) {
    $("calcModalText").textContent = "No se pudo generar el PDF";
  } finally {
    setTimeout(() => {
      const modal = $("calcModal");
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
    }, 520);
  }
}

function setCommonDefaults() {
  setVal("ufValue", 39808);
  setVal("rollosPorCaja", 6);
}

function fillExample() {
  // Supuestos del PDF final + costos de compra inventados para simulación.
  setCommonDefaults();

  // B2C
  setVal("b2cVentaRollos", 720);
  setVal("b2cIngresoTipo", 0.25);
  setVal("b2cCantidadIngreso", 2);
  setVal("b2cVecesIngreso", 1);
  setVal("b2cPosicionesPallet", 2);
  setVal("b2cPickupVecesMes", 20);
  setVal("b2cPrecioBruto", 5490);
  setVal("b2cComisionMeli", 14);
  setVal("b2cPublicidad", 7);
  setVal("b2cEnvio", 4990);
  setVal("b2cCompra", 4760); // 4.000 + IVA
  $("b2cEnvioPagaCliente").checked = true;
  setVal("b2cExtraPalletSuelto", 0);
  setVal("b2cExtraBultosSuelto", 0);
  setVal("b2cExtraTonSobredim", 0);
  setVal("b2cExtraArticulosUnitario", 0);

  // B2B
  setVal("b2bCajasPedido", 2);
  setVal("b2bPedidosMes", 60);
  setVal("b2bIngresoTipo", 0.25);
  setVal("b2bCantidadIngreso", 2);
  setVal("b2bVecesIngreso", 1);
  setVal("b2bPosicionesPallet", 2);
  setVal("b2bPrecioBruto", 4760);
  setVal("b2bComisionCanal", 14);
  setVal("b2bPublicidad", 7);
  setVal("b2bEnvio", 4990);
  setVal("b2bCompra", 4760); // 4.000 + IVA
  $("b2bEnvioPagaCliente").checked = true;
  setVal("b2bExtraPalletSuelto", 0);
  setVal("b2bExtraBultosSuelto", 0);
  setVal("b2bExtraTonSobredim", 0);
  setVal("b2bExtraArticulosUnitario", 0);

  renderB2C();
  renderB2B();
  updateIngresoContext("b2c");
  updateIngresoContext("b2b");
}

function clearB2C() {
  setVal("b2cVentaRollos", 0);
  setVal("b2cIngresoTipo", 0.25);
  setVal("b2cCantidadIngreso", 1);
  setVal("b2cVecesIngreso", 1);
  setVal("b2cPosicionesPallet", 0);
  setVal("b2cPickupVecesMes", 0);
  setVal("b2cPrecioBruto", 0);
  setVal("b2cComisionMeli", 0);
  setVal("b2cPublicidad", 0);
  setVal("b2cEnvio", 0);
  setVal("b2cCompra", 0);
  $("b2cEnvioPagaCliente").checked = true;
  setVal("b2cExtraPalletSuelto", 0);
  setVal("b2cExtraBultosSuelto", 0);
  setVal("b2cExtraTonSobredim", 0);
  setVal("b2cExtraArticulosUnitario", 0);
  renderB2C();
  updateIngresoContext("b2c");
}

function clearB2B() {
  setVal("b2bCajasPedido", 0);
  setVal("b2bPedidosMes", 0);
  setVal("b2bIngresoTipo", 0.25);
  setVal("b2bCantidadIngreso", 1);
  setVal("b2bVecesIngreso", 1);
  setVal("b2bPosicionesPallet", 0);
  setVal("b2bPrecioBruto", 0);
  setVal("b2bComisionCanal", 0);
  setVal("b2bPublicidad", 0);
  setVal("b2bEnvio", 0);
  setVal("b2bCompra", 0);
  $("b2bEnvioPagaCliente").checked = true;
  setVal("b2bExtraPalletSuelto", 0);
  setVal("b2bExtraBultosSuelto", 0);
  setVal("b2bExtraTonSobredim", 0);
  setVal("b2bExtraArticulosUnitario", 0);
  renderB2B();
  updateIngresoContext("b2b");
}

function renderB2C() {
  const ventaRollos = Math.max(0, n("b2cVentaRollos"));
  const precioBruto = Math.max(0, n("b2cPrecioBruto"));
  const comisionMeliPct = Math.max(0, n("b2cComisionMeli"));
  const publicidadPct = Math.max(0, n("b2cPublicidad"));
  const envioUnitRaw = Math.max(0, n("b2cEnvio"));
  const envioPagaCliente = $("b2cEnvioPagaCliente").checked;
  const envioUnit = envioPagaCliente ? 0 : envioUnitRaw;
  const compraUnit = Math.max(0, n("b2cCompra"));
  const posicionesPallet = Math.max(0, n("b2cPosicionesPallet"));
  const pickupVecesMes = Math.min(20, Math.max(0, n("b2cPickupVecesMes")));
  const uf = n("ufValue");

  const recep = recepcionMensualCLP("b2c");
  const almacenajeMensual = posicionesPallet * ALMACENAJE_UF_PALLET * uf;

  const ingresoBrutoMensual = ventaRollos * precioBruto;
  const precioNeto = toNet(precioBruto);
  const ingresoNetoMensual = ventaRollos * precioNeto;

  const meliUnit = precioBruto * (comisionMeliPct / 100);
  const publicidadUnit = precioBruto * (publicidadPct / 100);
  const lpFirstUnit = precioBruto * (LP_B2C_FIRST / 100);
  const lpAfterUnit = precioBruto * (LP_B2C_AFTER / 100);

  const recepUnit = safeDiv(recep.clpMensual, ventaRollos);
  const almacenUnit = safeDiv(almacenajeMensual, ventaRollos);
  const pickupMensualBruto = PICKUP_TARIFA_POR_VEZ * pickupVecesMes;
  const pickupAfterUnit = safeDiv(pickupMensualBruto, ventaRollos);

  const totalUnitFirst = compraUnit + envioUnit + meliUnit + publicidadUnit + lpFirstUnit + recepUnit + almacenUnit;
  const totalUnitAfter = compraUnit + envioUnit + meliUnit + publicidadUnit + lpAfterUnit + recepUnit + almacenUnit + pickupAfterUnit;
  const totalUnitNetFirst = toNet(totalUnitFirst);
  const totalUnitNetAfter = toNet(totalUnitAfter);

  const logisticsUnitFirst = lpFirstUnit + recepUnit + almacenUnit;
  const logisticsUnitAfter = lpAfterUnit + recepUnit + almacenUnit + pickupAfterUnit;
  const logisticsPctFirst = safeDiv(toNet(logisticsUnitFirst), precioNeto) * 100;
  const logisticsPctAfter = safeDiv(toNet(logisticsUnitAfter), precioNeto) * 100;

  const margenUnitFirst = precioNeto - totalUnitNetFirst;
  const margenUnitAfter = precioNeto - totalUnitNetAfter;

  const mgPctFirst = safeDiv(margenUnitFirst, precioNeto) * 100;
  const mgPctAfter = safeDiv(margenUnitAfter, precioNeto) * 100;
  const periodo = $("b2cPeriodo").value;

  const totalMensualFirst = totalUnitFirst * ventaRollos;
  const totalMensualAfter = totalUnitAfter * ventaRollos;
  const totalMensualNetFirst = totalUnitNetFirst * ventaRollos;
  const totalMensualNetAfter = totalUnitNetAfter * ventaRollos;
  const margenNetoFinalTotalFirst = ingresoNetoMensual - totalMensualNetFirst;
  const margenNetoFinalTotalAfter = ingresoNetoMensual - totalMensualNetAfter;

  let kpiTitleMargen = "Margen Unit. Neto (1-3 meses)";
  let kpiMargen = money(margenUnitFirst);
  let kpiMg = pct(mgPctFirst);
  let kpiLog = pct(logisticsPctFirst);
  let kpiTag = "Escenario activo: Primeros 3 meses";
  let firstKpiClass = "active-cell";
  let afterKpiClass = "";

  if (periodo === "after") {
    kpiTitleMargen = "Margen Unit. Neto (desde mes 4)";
    kpiMargen = money(margenUnitAfter);
    kpiMg = pct(mgPctAfter);
    kpiLog = pct(logisticsPctAfter);
    kpiTag = "Escenario activo: Después de 3 meses";
    firstKpiClass = "";
    afterKpiClass = "active-cell";
  } else if (periodo === "compare") {
    kpiTitleMargen = "Margen Unit. Neto (comparativo)";
    kpiMargen = `${money(margenUnitFirst)} / ${money(margenUnitAfter)}`;
    kpiMg = `${pct(mgPctFirst)} / ${pct(mgPctAfter)}`;
    kpiLog = `${pct(logisticsPctFirst)} / ${pct(logisticsPctAfter)}`;
    kpiTag = "Escenario activo: Comparativo";
  }

  $("outB2C").innerHTML = `
    <p class="hint"><strong>${kpiTag}</strong></p>
    <div class="kpi-grid">
      <div class="kpi"><h4>${kpiTitleMargen}</h4><p>${kpiMargen}</p></div>
      <div class="kpi"><h4>MG Neto % (escenario activo)</h4><p>${kpiMg}</p></div>
      <div class="kpi"><h4>% que cobra Logistics</h4><p>${kpiLog}</p></div>
    </div>

    <table class="breakdown">
      <thead>
        <tr><th>B2C</th><th>1-3 meses</th><th>Desde mes 4</th></tr>
      </thead>
      <tbody>
        <tr><td>Ingreso bruto mensual</td><td>${money(ingresoBrutoMensual)}</td><td>${money(ingresoBrutoMensual)}</td></tr>
        <tr><td>Ingreso neto mensual (sin IVA)</td><td>${money(ingresoNetoMensual)}</td><td>${money(ingresoNetoMensual)}</td></tr>
        <tr><td>Compra (unitario)</td><td>${money(compraUnit)}</td><td>${money(compraUnit)}</td></tr>
        <tr><td>Envío (unitario ${envioPagaCliente ? "pagado por cliente" : "pagado por VPM"})</td><td>${money(envioUnit)}</td><td>${money(envioUnit)}</td></tr>
        <tr><td>Comisión Meli (${PCT.format(comisionMeliPct)}%)</td><td>${money(meliUnit)}</td><td>${money(meliUnit)}</td></tr>
        <tr><td>Publicidad (${PCT.format(publicidadPct)}%)</td><td>${money(publicidadUnit)}</td><td>${money(publicidadUnit)}</td></tr>
        <tr><td>Cargo LP sobre precio BRUTO (${LP_B2C_FIRST}% / ${LP_B2C_AFTER}%)</td><td>${money(lpFirstUnit)}</td><td>${money(lpAfterUnit)}</td></tr>
        <tr><td>Recepción mensual (${dec(recep.ufMensual)} UF)</td><td>${money(recepUnit)}</td><td>${money(recepUnit)}</td></tr>
        <tr><td>Almacenaje mensual (${dec(posicionesPallet)} pallets)</td><td>${money(almacenUnit)}</td><td>${money(almacenUnit)}</td></tr>
        <tr><td>Pickup ML (${CLP.format(pickupVecesMes)} días x ${money(PICKUP_TARIFA_POR_VEZ)} por día)</td><td>${money(0)}</td><td>${money(pickupAfterUnit)}</td></tr>
        <tr class="tot"><td>% que cobra Logistics (sobre precio NETO)</td><td class="${firstKpiClass}">${pct(logisticsPctFirst)}</td><td class="${afterKpiClass}">${pct(logisticsPctAfter)}</td></tr>
        <tr class="tot"><td>Costo unitario total BRUTO</td><td class="${firstKpiClass}">${money(totalUnitFirst)}</td><td class="${afterKpiClass}">${money(totalUnitAfter)}</td></tr>
        <tr class="tot"><td>Costo unitario total NETO</td><td class="${firstKpiClass}">${money(totalUnitNetFirst)}</td><td class="${afterKpiClass}">${money(totalUnitNetAfter)}</td></tr>
        <tr class="tot"><td>Margen unitario neto</td><td class="${firstKpiClass}">${money(margenUnitFirst)}</td><td class="${afterKpiClass}">${money(margenUnitAfter)}</td></tr>
        <tr class="tot"><td>MG neto sobre precio neto</td><td class="${firstKpiClass}">${pct(mgPctFirst)}</td><td class="${afterKpiClass}">${pct(mgPctAfter)}</td></tr>
        <tr class="tot"><td>Costo total mensual BRUTO</td><td>${money(totalMensualFirst)}</td><td>${money(totalMensualAfter)}</td></tr>
        <tr class="tot"><td>Costo total mensual NETO</td><td>${money(totalMensualNetFirst)}</td><td>${money(totalMensualNetAfter)}</td></tr>
      </tbody>
    </table>
    <p class="hint">
      Recepción mensual = ((tarifa ingreso UF x cantidad por ingreso) + 0,32 UF servicio) x ingresos en el mes x UF.
      Puedes combinar tipos en el mismo ingreso usando campos \"Extra\" (ej: 1 pallet + 14 bultos).
      Pickup desde mes 4 = (4.500 x días del mes, máximo 20), luego prorrateado por rollo.
      Margen neto = precio neto unitario - costo neto unitario.
    </p>
    <div class="scenario-summaries two-cols">
      <article class="scenario-card ${firstKpiClass}">
        <h5>Escenario &lt; 3 meses</h5>
        <p><span>Ingreso neto total</span><strong>${money(ingresoNetoMensual)}</strong></p>
        <p><span>Costo neto total</span><strong>${money(totalMensualNetFirst)}</strong></p>
        <p><span>Margen neto final</span><strong>${money(margenNetoFinalTotalFirst)}</strong></p>
        <p><span>Margen neto unitario final</span><strong>${money(margenUnitFirst)}</strong></p>
      </article>
      <article class="scenario-card ${afterKpiClass}">
        <h5>Escenario &gt; 3 meses</h5>
        <p><span>Ingreso neto total</span><strong>${money(ingresoNetoMensual)}</strong></p>
        <p><span>Costo neto total</span><strong>${money(totalMensualNetAfter)}</strong></p>
        <p><span>Margen neto final</span><strong>${money(margenNetoFinalTotalAfter)}</strong></p>
        <p><span>Margen neto unitario final</span><strong>${money(margenUnitAfter)}</strong></p>
      </article>
    </div>
  `;
}

function renderB2B() {
  const rollosPorCaja = Math.max(1, n("rollosPorCaja"));
  const cajasPedido = Math.max(1, n("b2bCajasPedido"));
  const pedidosMes = Math.max(1, n("b2bPedidosMes"));
  const ventaRollos = cajasPedido * rollosPorCaja * pedidosMes;

  const precioBruto = Math.max(0, n("b2bPrecioBruto"));
  const precioNeto = toNet(precioBruto);
  const comisionCanalPct = Math.max(0, n("b2bComisionCanal"));
  const publicidadPct = Math.max(0, n("b2bPublicidad"));
  const envioUnitRaw = Math.max(0, n("b2bEnvio"));
  const envioPagaCliente = $("b2bEnvioPagaCliente").checked;
  const envioUnit = envioPagaCliente ? 0 : envioUnitRaw;
  const compraUnit = Math.max(0, n("b2bCompra"));
  const posicionesPallet = Math.max(0, n("b2bPosicionesPallet"));
  const uf = n("ufValue");

  const recep = recepcionMensualCLP("b2b");
  const almacenajeMensual = posicionesPallet * ALMACENAJE_UF_PALLET * uf;

  const ingresoBrutoMensual = ventaRollos * precioBruto;
  const ingresoNetoMensual = ventaRollos * precioNeto;

  const pickingMensual = cajasPedido * pedidosMes * PICKING_BULTO_UF * uf;
  const gestionMensual = pedidosMes * GESTION_ORDEN_UF * uf;
  const comisionCanalMensual = ingresoBrutoMensual * (comisionCanalPct / 100);
  const adsMensual = ingresoBrutoMensual * (publicidadPct / 100);
  const envioMensual = ventaRollos * envioUnit;
  const compraMensual = ventaRollos * compraUnit;

  const totalMensual = compraMensual + envioMensual + comisionCanalMensual + adsMensual + pickingMensual + gestionMensual + almacenajeMensual + recep.clpMensual;
  const totalUnit = safeDiv(totalMensual, ventaRollos);
  const totalUnitNet = toNet(totalUnit);
  const totalMensualNet = toNet(totalMensual);

  const logisticsMensual = pickingMensual + gestionMensual + almacenajeMensual + recep.clpMensual + envioMensual;
  const logisticsUnit = safeDiv(logisticsMensual, ventaRollos);
  const logisticsPct = safeDiv(toNet(logisticsUnit), precioNeto) * 100;

  const margenUnit = precioNeto - totalUnitNet;
  const mgPct = safeDiv(margenUnit, precioNeto) * 100;
  const margenNetoFinalTotal = ingresoNetoMensual - totalMensualNet;

  const totalPedido = safeDiv(totalMensual, pedidosMes);
  const rollosPedido = cajasPedido * rollosPorCaja;

  $("outB2B").innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><h4>Rollos mensuales</h4><p>${CLP.format(ventaRollos)}</p></div>
      <div class="kpi"><h4>Margen Unit. Neto</h4><p>${money(margenUnit)}</p></div>
      <div class="kpi"><h4>% que cobra Logistics</h4><p>${pct(logisticsPct)}</p></div>
    </div>

    <table class="breakdown">
      <thead>
        <tr><th>B2B (mensual)</th><th>Monto CLP</th></tr>
      </thead>
      <tbody>
        <tr><td>Ingreso bruto mensual</td><td>${money(ingresoBrutoMensual)}</td></tr>
        <tr><td>Ingreso neto mensual (sin IVA)</td><td>${money(ingresoNetoMensual)}</td></tr>
        <tr><td>Compra total</td><td>${money(compraMensual)}</td></tr>
        <tr><td>Envío total (${envioPagaCliente ? "pagado por cliente" : "pagado por VPM"})</td><td>${money(envioMensual)}</td></tr>
        <tr><td>Costo canal / marketplace (${PCT.format(comisionCanalPct)}%)</td><td>${money(comisionCanalMensual)}</td></tr>
        <tr><td>Publicidad (${PCT.format(publicidadPct)}%)</td><td>${money(adsMensual)}</td></tr>
        <tr><td>Picking bultos (${cajasPedido} cajas x ${pedidosMes} pedidos)</td><td>${money(pickingMensual)}</td></tr>
        <tr><td>Gestión por orden (${pedidosMes} pedidos)</td><td>${money(gestionMensual)}</td></tr>
        <tr><td>Almacenaje mensual (${dec(posicionesPallet)} pallets)</td><td>${money(almacenajeMensual)}</td></tr>
        <tr><td>Recepción mensual (${dec(recep.ufMensual)} UF)</td><td>${money(recep.clpMensual)}</td></tr>
        <tr class="tot"><td>% que cobra Logistics (sobre precio NETO)</td><td>${pct(logisticsPct)}</td></tr>
        <tr class="tot"><td>Costo total mensual</td><td>${money(totalMensual)}</td></tr>
        <tr class="tot"><td>Costo unitario bruto</td><td>${money(totalUnit)}</td></tr>
        <tr class="tot"><td>Costo unitario neto</td><td>${money(totalUnitNet)}</td></tr>
        <tr class="tot"><td>Margen unitario neto</td><td>${money(margenUnit)}</td></tr>
        <tr class="tot"><td>MG neto sobre precio neto</td><td>${pct(mgPct)}</td></tr>
      </tbody>
    </table>

    <p class="hint">
      Pedido tipo: ${cajasPedido} cajas (${rollosPedido} rollos). Costo por pedido estimado: ${money(totalPedido)}.
      Puedes combinar tipos de recepción en un mismo ingreso con los campos \"Extra\".
      Fórmula de porcentaje: costo unitario bruto / precio unitario bruto.
    </p>
    <div class="scenario-summaries">
      <article class="scenario-card active-cell">
        <h5>Escenario mensual B2B</h5>
        <p><span>Ingreso neto total</span><strong>${money(ingresoNetoMensual)}</strong></p>
        <p><span>Costo neto total</span><strong>${money(totalMensualNet)}</strong></p>
        <p><span>Margen neto final</span><strong>${money(margenNetoFinalTotal)}</strong></p>
        <p><span>Margen neto unitario final</span><strong>${money(margenUnit)}</strong></p>
      </article>
    </div>
  `;
}

$("calcB2C").addEventListener("click", renderB2C);
$("calcB2B").addEventListener("click", renderB2B);
$("b2cPeriodo").addEventListener("change", renderB2C);
$("fillExample").addEventListener("click", fillExample);
$("clearB2C").addEventListener("click", clearB2C);
$("clearB2B").addEventListener("click", clearB2B);
$("pdfB2C").addEventListener("click", () => downloadPdf("b2c"));
$("pdfB2B").addEventListener("click", () => downloadPdf("b2b"));
$("b2cEnvioPagaCliente").addEventListener("change", renderB2C);
$("b2bEnvioPagaCliente").addEventListener("change", renderB2B);
$("b2cPickupVecesMes").addEventListener("change", renderB2C);
$("b2cIngresoTipo").addEventListener("change", () => {
  updateIngresoContext("b2c");
  renderB2C();
});
$("b2bIngresoTipo").addEventListener("change", () => {
  updateIngresoContext("b2b");
  renderB2B();
});
$("refreshUf").addEventListener("click", refreshUfOnline);

fillExample();
updateIngresoContext("b2c");
updateIngresoContext("b2b");
refreshUfOnline();

function showCalcModal() {
  const modal = $("calcModal");
  $("calcModalText").textContent = "Calculando...";
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function showCalcDoneAndHide() {
  const modal = $("calcModal");
  $("calcModalText").textContent = "Listo";
  setTimeout(() => {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }, 420);
}

function calcWithPopup(fn) {
  showCalcModal();
  setTimeout(() => {
    fn();
    showCalcDoneAndHide();
  }, 420);
}

$("calcB2C").removeEventListener("click", renderB2C);
$("calcB2B").removeEventListener("click", renderB2B);

$("calcB2C").addEventListener("click", () => calcWithPopup(renderB2C));
$("calcB2B").addEventListener("click", () => calcWithPopup(renderB2B));

for (const id of CLP_FIELD_IDS) {
  $(id).addEventListener("focus", () => {
    const value = parseClpInput($(id).value);
    $(id).value = value > 0 ? String(value) : "";
  });
  $(id).addEventListener("blur", () => {
    const value = parseClpInput($(id).value);
    $(id).value = formatClpInput(value);
    renderB2C();
    renderB2B();
  });
}
