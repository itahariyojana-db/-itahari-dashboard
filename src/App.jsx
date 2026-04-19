import { useState, useEffect, useMemo, useCallback } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, LabelList,
} from "recharts";
import Papa from "papaparse";

// ═══════════════════════════════════════════════════════════════
//  GOOGLE SHEETS CONFIGURATION
//  Sheet must be published: File → Share → Publish to web → CSV
// ═══════════════════════════════════════════════════════════════
const SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/e/" +
  "2PACX-1vRY2fbQkQA_TKL0_4EGmcJewWzW5IK8HHWXHRMlG60N378KD07AV_GlyG95BBz9rZmjeeJ81BOC3hC1" +
  "/pub";
const SHEET_GID        = "1441701102";   // ← your main sheet GID
const CSV_URL          = `${SHEET_BASE}?gid=${SHEET_GID}&single=true&output=csv`;
const HEADER_ROWS      = 2;              // rows before data begins
const AUTO_REFRESH_MS  = 5 * 60 * 1000; // 5 minutes
const NEAR_EXPIRY_DAYS = 30;

// ═══════════════════════════════════════════════════════════════
//  COLUMN INDEX MAP — default fallback values (0-based)
//  These are overridden at runtime by detectCols() which parses
//  actual CSV header rows so positions never get stale.
// ═══════════════════════════════════════════════════════════════
const C_DEFAULT = {
  SN: 0, BUDGET: 1, SOURCE: 2, TYPE: 3, CONTRACT_ID: 4, NAME: 5,
  INDICATOR: 6, TARGET: 7, ACHIEVEMENT: 8, PHYS_PROG: 9, STATUS: 10,
  ESTIMATE: 11,
  CONTRACTOR: 15, AGR_DATE: 16, AGR_AMT: 17, SAVINGS: 18,
  VO1: 19, VO2: 20, REVISED: 21,
  TOTAL: 26, DUE_DATE: 27, DONE_DATE: 28,
  EVALUATED: 29,                             // प्राविधिक मुल्यांकन स्वीकार रकम
  PAYMENT: 30, REMAINING_RAW: 31, LIABILITY: 32,
  EXPENSE: 33, CARRY: 34, FIN_PROG: 35, DEADLINE_EXT: 36,
  // Insurance: 37=bank(section header), 38=amount, 39=payment-status(NOT ref), 40=issue, 41=expiry
  INS_BANK: 37, INS_AMT: 38, INS_REF: null, INS_ISSUE: 40, INS_EXPIRY: 41,
  // PBG: 42=bank, 43=ref-no, 44=amount, 45=issue, 46=expiry, 47=घटी(extension-skip)
  PBG_BANK: 42, PBG_REF: 43, PBG_AMT: 44, PBG_ISSUE: 45, PBG_EXPIRY: 46,
  // APG: 48=bank, 49=ref-no, 50=amount, 51=issue, 52=expiry  (47 is "घटी PBG" — not APG!)
  APG_BANK: 48, APG_REF: 49, APG_AMT: 50, APG_ISSUE: 51, APG_EXPIRY: 52,
};

// ── Keyword match helper ──────────────────────────────────────
const kwMatch = (text, kws) => {
  const t = String(text || "").toLowerCase();
  return kws.some(k => t.includes(k.toLowerCase()));
};

// ── Dynamic column detection from CSV header rows ─────────────
// Reads row0 (section labels) and row1 (column headers) from the CSV.
// STRATEGY:
//   Pass A — Core columns: scan combined (row0+row1) text per column.
//   Pass B — Guarantee columns: scan row1 directly since this sheet's guarantee
//             headers carry the type name inline (e.g. "PBG नं.", "APG को रकम").
//             Row0 only contains old index numbers ("37","38"…), not keywords.
function detectCols(row0, row1) {
  const cm = { ...C_DEFAULT };
  if (!row0 && !row1) return cm;
  const r0 = row0 || [], r1 = row1 || [];
  const len = Math.max(r0.length, r1.length);

  // ── Pass A: Core column detection via combined row0+row1 text ────────────
  for (let i = 0; i < len; i++) {
    const h0   = String(r0[i] || "").trim();
    const h1   = String(r1[i] || "").trim();
    const hAll = (h0 + " " + h1).toLowerCase();
    if      (kwMatch(hAll, ["योजनाको नाम", "project name"])     && i < 10) cm.NAME         = i;
    else if (kwMatch(hAll, ["कार्यको अवस्था","अवस्था","status"])&& i < 15) cm.STATUS        = i;
    else if (kwMatch(hAll, ["भौतिक प्रगति", "physical progress"]))          cm.PHYS_PROG    = i;
    else if (kwMatch(hAll, ["आर्थिक प्रगति", "financial progress"]))        cm.FIN_PROG     = i;
    else if (kwMatch(hAll, ["ठेकेदार", "contractor"]))                      cm.CONTRACTOR   = i;
    else if (kwMatch(hAll, ["सम्झौता मिति", "agreement date"]))             cm.AGR_DATE     = i;
    else if (kwMatch(hAll, ["सम्झौता रकम", "agreement amount"]))            cm.AGR_AMT      = i;
    else if (kwMatch(hAll, ["कुल रकम", "total amount"])          && i > 20) cm.TOTAL        = i;
    else if (kwMatch(hAll, ["भुक्तानी रकम", "payment amount"])   && i > 25) cm.PAYMENT      = i;
    else if (kwMatch(hAll, ["दायित्व", "liability"])              && i > 28 && !kwMatch(hAll, ["सर्ने"])) cm.LIABILITY = i;
    else if (kwMatch(hAll, ["सर्ने", "carry"])                   && i > 30) cm.CARRY        = i;
    else if (kwMatch(hAll, ["उपलब्धि", "achievement"])           && i < 12) cm.ACHIEVEMENT  = i;
    else if (kwMatch(hAll, ["सूचक", "indicator"])                && i < 10) cm.INDICATOR    = i;
    else if (kwMatch(hAll, ["म्याद थप", "deadline extension"])   && i > 32) cm.DEADLINE_EXT = i;
  }

  // ── Pass B: Guarantee column detection — scan row1 directly ──────────────
  // In this sheet each guarantee column header contains the type name:
  //   "PBG जारी गरेको Bank,ठेगाना", "PBG नं.", "APG को रकम", "बिमा जारी मिति" …
  // "घटी PBG/APG को म्याद" are deadline-extension columns — skip them.
  for (let i = 0; i < len; i++) {
    const h = String(r1[i] || "").trim();
    const L = h.toLowerCase();
    const isGhati = kwMatch(h, ["घटी"]);   // skip extension/घटी columns

    // ── PBG ────────────────────────────────────────────────────────────────
    if (!isGhati && (L.includes("pbg") || kwMatch(h, ["कार्यसम्पादन", "performance bank"]))) {
      if      (kwMatch(h, ["bank","बैंक","वित्तीय","ठेगाना"])) cm.PBG_BANK   = i;
      else if (kwMatch(h, ["नं.","नम्बर","no.","no,","number"])) cm.PBG_REF   = i;
      else if (kwMatch(h, ["रकम","amount"]))                      cm.PBG_AMT   = i;
      else if (kwMatch(h, ["जारी मिति","issue","जारी"]))          cm.PBG_ISSUE = i;
      else if (kwMatch(h, ["म्याद","expiry","valid"]))            cm.PBG_EXPIRY= i;
    }

    // ── APG ────────────────────────────────────────────────────────────────
    if (!isGhati && (L.includes("apg") || kwMatch(h, ["अग्रिम भुक्तानी","advance payment"]))) {
      if      (kwMatch(h, ["bank","बैंक","वित्तीय","ठेगाना"])) cm.APG_BANK   = i;
      else if (kwMatch(h, ["नं.","नम्बर","no.","no,","number"])) cm.APG_REF   = i;
      else if (kwMatch(h, ["रकम","amount"]))                      cm.APG_AMT   = i;
      else if (kwMatch(h, ["जारी मिति","issue","जारी"]))          cm.APG_ISSUE = i;
      else if (kwMatch(h, ["म्याद","expiry","valid"]))            cm.APG_EXPIRY= i;
    }

    // ── Insurance ──────────────────────────────────────────────────────────
    // Section label "बिमा व्यवस्था" at col 37 covers bank+amount (sub-labels in row2).
    // Individual cols 40/41 carry direct labels in row1.
    if (kwMatch(h, ["बिमा व्यवस्था","बीमा व्यवस्था","insurance"])) cm.INS_BANK = i;
    else if (kwMatch(h, ["बिमा जारी मिति","बीमा जारी मिति","insurance issue"])) cm.INS_ISSUE = i;
    else if (kwMatch(h, ["बिमाको म्याद","बीमाको म्याद","insurance expiry"]))    cm.INS_EXPIRY= i;
  }

  console.info("[detectCols] Final mapping →",
    `INS:bank=${cm.INS_BANK} amt=${cm.INS_AMT} issue=${cm.INS_ISSUE} exp=${cm.INS_EXPIRY}`,
    `PBG:bank=${cm.PBG_BANK} ref=${cm.PBG_REF} amt=${cm.PBG_AMT} issue=${cm.PBG_ISSUE} exp=${cm.PBG_EXPIRY}`,
    `APG:bank=${cm.APG_BANK} ref=${cm.APG_REF} amt=${cm.APG_AMT} issue=${cm.APG_ISSUE} exp=${cm.APG_EXPIRY}`
  );
  return cm;
}

// ═══════════════════════════════════════════════════════════════
//  NEPALI NUMERAL FORMATTER
// ═══════════════════════════════════════════════════════════════
const ND = ["०","१","२","३","४","५","६","७","८","९"];
const toNP = (s) => String(s).replace(/[0-9]/g, (d) => ND[+d]);

const fmt = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return "रु. ०";
  if (v >= 1e7) return toNP(`रु. ${(v / 1e7).toFixed(2)} करोड`);
  if (v >= 1e5) return toNP(`रु. ${(v / 1e5).toFixed(2)} लाख`);
  return toNP(`रु. ${Math.round(v).toLocaleString("en-IN")}`);
};
const fmtS = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return "०";
  if (v >= 1e7) return toNP(`${(v / 1e7).toFixed(1)} करोड`);
  if (v >= 1e5) return toNP(`${(v / 1e5).toFixed(0)} लाख`);
  return toNP(Math.round(v));
};
const fmtPct  = (n) => toNP(`${(Number(n) || 0).toFixed(1)}`) + "%";
const fmtInt  = (n) => toNP(Math.round(Number(n) || 0));

// ═══════════════════════════════════════════════════════════════
//  DATE HELPERS  (handles Bikram Sambat yyyy-mm-dd format)
// ═══════════════════════════════════════════════════════════════
/**
 * Roughly converts a BS date string to a JS Date.
 * Accuracy: ±1 month — sufficient for expiry alerts.
 * BS month 1 (Baisakh) ≈ mid-April → shift +3 months, −57 years.
 */
const parseBS = (s) => {
  if (!s || s === "-" || s === "") return null;
  const parts = String(s).split(/[-\/]/);
  if (parts.length < 2) return null;
  let [y, m, d] = parts.map(Number);
  if (!y || !m) return null;
  if (y >= 2040 && y <= 2090) {          // looks like BS year
    let ay = y - 57;
    let am = m + 3;
    if (am > 12) { am -= 12; ay += 1; }
    return new Date(ay, am - 1, d || 15);
  }
  return new Date(y, m - 1, d || 1);    // already AD
};

const expiryStatus = (dateStr) => {
  const exp = parseBS(dateStr);
  if (!exp || isNaN(exp)) return null;
  const diff = Math.floor((exp - Date.now()) / 86400000);
  if (diff < 0)               return "expired";
  if (diff <= NEAR_EXPIRY_DAYS) return "near";
  return "valid";
};

// ═══════════════════════════════════════════════════════════════
//  ROW → PROJECT OBJECT
// ═══════════════════════════════════════════════════════════════
const num = (v) => {
  if (v == null || v === "" || v === "-") return 0;
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) || !isFinite(n) ? 0 : n;
};
const str = (v) => (v == null ? "" : String(v).trim());

const pctNorm = (v) => {
  const n = num(v);
  return n > 1 ? Math.min(n, 100) : Math.round(n * 1000) / 10;
};

// cm = column-index map (C_DEFAULT or dynamically detected by detectCols)
function rowToProject(row, cm, idx) {
  const sn   = num(row[cm.SN]);
  const name = str(row[cm.NAME]);
  if (!name || sn === 0) return null;

  const agrAmt   = num(row[cm.AGR_AMT]);
  const totalAmt = num(row[cm.TOTAL]);
  const contract = totalAmt || agrAmt;
  const payment  = num(row[cm.PAYMENT]);
  const status   = str(row[cm.STATUS]);
  // Determine completion early — used in several derived fields below
  const isSampanna = status === "सम्पन्न";

  const finCalc  = contract > 0 ? Math.round((payment / contract) * 1000) / 10 : 0;
  const rawPhys  = num(row[cm.PHYS_PROG]);
  const rawFin   = num(row[cm.FIN_PROG]);

  const physicalProgress  = rawPhys > 1 ? Math.min(rawPhys, 100) : pctNorm(rawPhys);
  const financialProgress = rawFin > 0 ? pctNorm(rawFin) : finCalc;
  const remaining         = Math.max(0, contract - payment);

  const liability = num(row[cm.LIABILITY]);
  const carry     = num(row[cm.CARRY]);

  const projectType = str(row[cm.TYPE]);

  // ── Safe guarantee field reader ─────────────────────────────
  // Bank cells often look like "Bank Name(REF123)" — split them.
  const gua = (bankIdx, refIdx, amtIdx, issueIdx, expiryIdx) => {
    const rawBank = str(row[bankIdx]);
    const rawRef  = refIdx != null ? str(row[refIdx]) : "";
    // Extract embedded ref from parentheses in bank name if dedicated ref col is empty
    const bMatch  = rawBank.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const bank    = bMatch ? bMatch[1].trim() : (rawBank || "—");
    const ref     = rawRef || (bMatch ? bMatch[2].trim() : "—");
    return {
      bank,
      ref,
      amt:    num(row[amtIdx]),
      issue:  str(row[issueIdx])  || "—",
      expiry: str(row[expiryIdx]) || "—",
    };
  };

  return {
    id: `${sn}-${idx}`,
    sn,
    category:      projectType,
    projectType,
    budgetHead:    str(row[cm.BUDGET])       || "अन्य",
    source:        str(row[cm.SOURCE])       || "आन्तरिक",
    contractId:    str(row[cm.CONTRACT_ID]),
    projectName:   name,
    indicator:     str(row[cm.INDICATOR]),
    achievement:   str(row[cm.ACHIEVEMENT]),
    physicalProgress,
    financialProgress,
    workStatus:    status,
    totalEstimate: num(row[cm.ESTIMATE]),
    contractor:    str(row[cm.CONTRACTOR]),
    agreementDate: str(row[cm.AGR_DATE]),
    agreementAmount: agrAmt,
    savings:       num(row[cm.SAVINGS]),
    vo1:           num(row[cm.VO1]),
    vo2:           num(row[cm.VO2]),
    revisedAmount: num(row[cm.REVISED]),
    totalAmount:   contract,
    dueDate:          str(row[cm.DUE_DATE]),
    doneDate:         str(row[cm.DONE_DATE]),
    evaluatedAmount:  num(row[cm.EVALUATED]),         // col 29: प्राविधिक मुल्यांकन स्वीकार रकम
    paymentAmount:    payment,                         // col 30: भुक्तानी रकम
    billingBalance:   num(row[cm.REMAINING_RAW]),      // col 31 AF: भुक्तानी हुन बाँकी (eval − paid)
    remainingAmount:  remaining,                       // computed: कुल − paid (cross-check for दायित्व)
    liability082:     liability,                       // col 32: दायित्व = total − paid
    expense082:       num(row[cm.EXPENSE]),
    carry083:         carry,
    isSampanna,       // expose for modal conditions
    deadlineExt:   str(row[cm.DEADLINE_EXT]),
    // ── Guarantees (correctly mapped via dynamic cm) ──────────
    ins: gua(cm.INS_BANK, cm.INS_REF,  cm.INS_AMT, cm.INS_ISSUE, cm.INS_EXPIRY),
    pbg: gua(cm.PBG_BANK, cm.PBG_REF,  cm.PBG_AMT, cm.PBG_ISSUE, cm.PBG_EXPIRY),
    apg: gua(cm.APG_BANK, cm.APG_REF,  cm.APG_AMT, cm.APG_ISSUE, cm.APG_EXPIRY),
    ward: (() => { const m = name.match(/[Ii]tahari[-\s]*(\d+)/); return m ? +m[1] : 0; })(),
  };
}

// ═══════════════════════════════════════════════════════════════
//  THEME  (Government of Nepal colours)
// ═══════════════════════════════════════════════════════════════
const T = {
  darkRed:  "#A50E2D",
  red:      "#DC143C",
  blue:     "#003893",
  lb:       "#1565C0",
  sky:      "#E8EEF8",
  white:    "#FFFFFF",
  bg:       "#F2F5FA",
  text:     "#1A2332",
  muted:    "#5A6A7E",
  border:   "#D8E0EC",
  gold:     "#C9952A",
  green:    "#1A7A45",
  orange:   "#D4620A",
  purple:   "#6A1F8E",
  expired:  "#B71C1C",
  near:     "#E65100",
  valid:    "#1A7A45",
};

const STATUS_COL = {
  "कार्य प्रगतिमा":   T.green,
  "सम्पन्न":           T.blue,
  "कार्य रोकिएको":    "#E53935",
  "कार्य सुरु नभएको": "#78909C",
  "म्याद थप हुन बाँकी": T.orange,
  "म्याद थप भएको":    "#FF7043",
  "सम्झौता भएको":     T.purple,
  "सम्झौता प्रक्रियामा रहेको": "#AB47BC",
  "लागत अनुमान तयार भई स्वीकृतिको प्रक्रियामा": "#90A4AE",
  "बोलपत्र खुल्न बाकि": "#607D8B",
  "मुल्यांकनको चरणमा": "#8D6E63",
  "प्रथम पटकको सूचनामा कुनै पनि बोलपत्र पेश नभएको": "#E53935",
  "कुनै पनि सिलबन्दी दरभाउपत्र पेश नभएको": "#C62828",
};

const SEC_COL = {
  "भवन पूर्वाधार":               T.blue,
  "सडक तथा यातायात  पूर्वाधार": T.gold,
  "व्यावसायिक/कृषि पूर्वाधार": T.green,
  "शहरी पूर्वाधार":              T.purple,
  "नदी नियन्त्रण तथा संरक्षण": "#0288D1",
  "भवन मर्मत तथा सुधार":        T.orange,
  "परामर्श सेवा":                "#5C6BC0",
  "अन्य":                        "#78909C",
};
const SEC_SH = {
  "भवन पूर्वाधार": "भवन",
  "सडक तथा यातायात  पूर्वाधार": "सडक",
  "व्यावसायिक/कृषि पूर्वाधार": "कृषि",
  "शहरी पूर्वाधार": "शहरी",
  "नदी नियन्त्रण तथा संरक्षण": "नदी",
  "भवन मर्मत तथा सुधार": "मर्मत",
  "परामर्श सेवा": "परामर्श",
  "अन्य": "अन्य",
};
// Medium names for charts with more horizontal space
const SEC_MED = {
  "भवन पूर्वाधार":               "भवन पूर्वाधार",
  "सडक तथा यातायात  पूर्वाधार": "सडक/यातायात",
  "व्यावसायिक/कृषि पूर्वाधार": "कृषि पूर्वाधार",
  "शहरी पूर्वाधार":              "शहरी पूर्वाधार",
  "नदी नियन्त्रण तथा संरक्षण": "नदी नियन्त्रण",
  "भवन मर्मत तथा सुधार":        "भवन मर्मत",
  "परामर्श सेवा":                "परामर्श सेवा",
  "अन्य":                        "अन्य",
};

// योजना प्रकार filter options
const TYPE_FILTERS = [
  { key: "सबै",              match: null },
  { key: "पुराना सम्झौता",   match: "पुराना" },
  { key: "नयाँ चालु आ.व.", match: "नयाँ" },
];

// ═══════════════════════════════════════════════════════════════
//  SHARED UI HELPERS
// ═══════════════════════════════════════════════════════════════
const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "rgba(0,56,147,.97)", border: `2px solid ${T.gold}`, borderRadius: 8, padding: "9px 13px", color: "#fff", fontSize: 12, maxWidth: 260 }}>
      {label && <div style={{ fontWeight: 700, marginBottom: 4, color: T.gold }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || p.fill, flexShrink: 0 }} />
          <span>{p.name}: {typeof p.value === "number" && p.value > 1000 ? fmt(p.value) : fmtPct(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

const GanttTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <div style={{ background: "rgba(0,56,147,.97)", border: `2px solid ${T.gold}`, borderRadius: 8, padding: "9px 13px", color: "#fff", fontSize: 12, maxWidth: 320 }}>
      <div style={{ fontWeight: 700, marginBottom: 5, color: T.gold, fontSize: 11, lineHeight: 1.4 }}>{p?.fullName}</div>
      {payload.map((e, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 11 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: e.fill, flexShrink: 0 }} />
          <span>{e.name}: {toNP(e.value)}%</span>
        </div>
      ))}
      {p?.status && <div style={{ marginTop: 5, fontSize: 10, opacity: .85, borderTop: "1px solid rgba(255,255,255,.2)", paddingTop: 4 }}>अवस्था: {p.status}</div>}
      {p?.dueDate && <div style={{ fontSize: 10, opacity: .8 }}>म्याद: {p.dueDate}</div>}
      {p?.totalAmount > 0 && <div style={{ fontSize: 10, opacity: .8 }}>रकम: {fmt(p.totalAmount)}</div>}
    </div>
  );
};

const GSTATUS_STYLE = {
  expired: { bg: "#FFEBEE", color: T.expired, label: "म्याद सकियो", icon: "🔴" },
  near:    { bg: "#FFF3E0", color: T.near,    label: "म्याद नजिकिँदै", icon: "🟠" },
  valid:   { bg: "#E8F5E9", color: T.valid,   label: "मान्य",       icon: "🟢" },
};

const GuaranteeBadge = ({ title, g, showRef = false }) => {
  const st = expiryStatus(g.expiry);
  const gs = st ? GSTATUS_STYLE[st] : null;
  // Show ref if explicitly requested OR if the insurance badge itself has a ref number
  const hasRef = (showRef || (g.ref && g.ref !== "—")) && g.ref && g.ref !== "—";
  const hasData =
    (g.bank   && g.bank   !== "—") ||
    (g.ref    && g.ref    !== "—") ||
    (g.issue  && g.issue  !== "—") ||
    (g.expiry && g.expiry !== "—") ||
    g.amt > 0;
  if (!hasData) return null;

  const exp = parseBS(g.expiry);
  const daysLeft = exp && !isNaN(exp) ? Math.floor((exp - Date.now()) / 86400000) : null;
  const daysLabel = daysLeft === null ? null
    : daysLeft < 0  ? `${toNP(Math.abs(daysLeft))} दिन अघि म्याद सकियो`
    : daysLeft === 0 ? "आज म्याद सकिँदैछ"
    : `${toNP(daysLeft)} दिन बाँकी`;

  const fields = [
    ["बैंक/वित्तीय संस्था", g.bank || "—"],
    ...(hasRef ? [["जमानत पत्र नं.", g.ref]] : []),
    ["जमानत रकम", g.amt > 0 ? fmt(g.amt) : "—"],
    ["जारी मिति", g.issue || "—"],
    ["म्याद सकिने मिति", g.expiry || "—"],
    ...(daysLabel ? [["समय स्थिति", daysLabel]] : []),
  ];

  return (
    <div style={{ border: `1.5px solid ${gs ? gs.color : T.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 8, background: gs ? gs.bg : T.sky }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: T.blue }}>{title}</span>
        {gs && (
          <span style={{ fontSize: 10, fontWeight: 700, color: gs.color, background: "#fff", padding: "2px 8px", borderRadius: 4, border: `1px solid ${gs.color}` }}>
            {gs.icon} {gs.label}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 16px", fontSize: 11 }}>
        {fields.map(([l, v]) => (
          <div key={l} style={{ gridColumn: l === "बैंक/वित्तीय संस्था" ? "1/-1" : undefined }}>
            <span style={{ color: T.muted }}>{l}: </span>
            <span style={{ fontWeight: 600, color: l === "म्याद सकिने मिति" && gs ? gs.color : T.text }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ProgressBar = ({ value = 0, color, height = 8 }) => (
  <div style={{ height, background: T.border, borderRadius: height, overflow: "hidden", flex: 1 }}>
    <div style={{ height: "100%", width: `${Math.min(Math.max(value, 0), 100)}%`, background: color, borderRadius: height, transition: "width .5s ease" }} />
  </div>
);

// ═══════════════════════════════════════════════════════════════
//  MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════
export default function Dashboard() {
  const [projects,   setProjects]   = useState([]);
  const [colMap,     setColMap]     = useState(C_DEFAULT);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState(null);
  const [lastSync,   setLastSync]   = useState(null);
  const [tab,        setTab]        = useState("overview");
  const [typeFilter, setTypeFilter] = useState("सबै");
  const [fStatus,    setFStatus]    = useState("सबै");
  const [fSector,    setFSector]    = useState("सबै");
  const [fGuarantee, setFGuarantee] = useState("सबै");   // guarantee expiry filter
  const [gTabFilter, setGTabFilter] = useState("सबै");   // guarantee tab status filter
  const [gTypeFilter, setGTypeFilter] = useState("सबै"); // guarantee tab type filter
  const [search,     setSearch]     = useState("");
  const [sel,        setSel]        = useState(null);
  const [sKey,       setSKey]       = useState("totalAmount");
  const [sDir,       setSDir]       = useState("desc");
  const [alertOpen,  setAlertOpen]  = useState(false);

  // ── RESPONSIVE CHART CONFIG ────────────────────────────────
  const [winW, setWinW] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isMobile = winW <= 640;
  const isTablet = winW <= 900;
  // Shared font for all chart ticks — ensures Devanagari renders correctly
  const CHART_FONT = "'Noto Sans Devanagari','Mukta',sans-serif";
  // Responsive chart values
  const CK = {
    tickSm:   isMobile ? 8.5  : isTablet ? 9.5  : 10.5,  // small axis label size
    tickMd:   isMobile ? 9    : isTablet ? 10   : 11,     // medium label
    yWidthLg: isMobile ? 110  : isTablet ? 150  : 168,    // vertical chart Y-axis
    yWidthGt: isMobile ? 120  : isTablet ? 160  : 210,    // gantt Y-axis
    barSz:    isMobile ? 14   : isTablet ? 18   : 24,     // bar thickness
    ganttBar: isMobile ? 16   : isTablet ? 18   : 22,     // gantt bar thickness
    rightMg:  isMobile ? 52   : 80,                       // right margin for labels
  };

  // ── FETCH ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      console.info("[Dashboard] Fetching:", CSV_URL);
      const res = await fetch(CSV_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      const csv = await res.text();
      if (!csv || csv.length < 100) throw new Error("CSV रिक्त छ");

      const { data, errors } = Papa.parse(csv, { skipEmptyLines: true });
      if (errors.length) console.warn("[Dashboard] CSV parse warnings:", errors);
      if (!data || data.length <= HEADER_ROWS) throw new Error("पर्याप्त पङ्क्ति छैन");

      // ── Detect column positions from actual headers ──────────
      const cm = detectCols(data[0], data[1]);
      setColMap(cm);

      const parsed = data
        .slice(HEADER_ROWS)
        .map((row, i) => {
          try { return rowToProject(row, cm, i); }
          catch (e) { console.warn(`Row ${i + HEADER_ROWS}: skip —`, e.message); return null; }
        })
        .filter(Boolean);

      if (parsed.length === 0) throw new Error("डेटा पार्स गर्न सकिएन");

      // Deduplicate by contractId (keep highest totalAmount)
      const seen = new Map();
      parsed.forEach((p) => {
        const key = p.contractId || `${p.sn}|${p.projectName.slice(0, 20)}`;
        if (!seen.has(key) || p.totalAmount > (seen.get(key).totalAmount || 0)) seen.set(key, p);
      });

      const deduped = Array.from(seen.values());
      console.info(`[Dashboard] Loaded ${deduped.length} projects.`);
      setProjects(deduped);
      setLastSync(new Date());
    } catch (e) {
      console.error("[Dashboard] Fetch error:", e);
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, AUTO_REFRESH_MS);
    return () => clearInterval(iv);
  }, [fetchData]);

  // ── DERIVED DATA ───────────────────────────────────────────
  const statuses  = useMemo(() => ["सबै", ...new Set(projects.map(p => p.workStatus).filter(Boolean))], [projects]);
  const sectors   = useMemo(() => ["सबै", ...new Set(projects.map(p => p.budgetHead).filter(Boolean))], [projects]);

  // ── Per-project worst guarantee status ────────────────────
  const projectGuaranteeStatus = useCallback((p) => {
    const ss = [
      expiryStatus(p.ins?.expiry),
      expiryStatus(p.pbg?.expiry),
      expiryStatus(p.apg?.expiry),
    ].filter(Boolean);
    if (ss.includes("expired")) return "expired";
    if (ss.includes("near"))    return "near";
    if (ss.length > 0)          return "valid";
    return null;
  }, []);

  const filtered = useMemo(() => {
    const tf = TYPE_FILTERS.find(f => f.key === typeFilter);
    let d = projects;
    if (tf?.match)        d = d.filter(p => p.projectType.includes(tf.match));
    if (fStatus !== "सबै") d = d.filter(p => p.workStatus === fStatus);
    if (fSector !== "सबै") d = d.filter(p => p.budgetHead === fSector);
    if (fGuarantee !== "सबै") {
      d = d.filter(p => {
        const gs = projectGuaranteeStatus(p);
        if (fGuarantee === "म्याद सकियो") return gs === "expired";
        if (fGuarantee === "म्याद नजिक")  return gs === "near";
        if (fGuarantee === "मान्य")        return gs === "valid";
        if (fGuarantee === "ग्यारेन्टी छैन") return gs === null;
        return true;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      d = d.filter(p =>
        p.projectName.toLowerCase().includes(q) ||
        p.contractId.toLowerCase().includes(q)  ||
        p.contractor.toLowerCase().includes(q)  ||
        p.workStatus.toLowerCase().includes(q)  ||
        p.budgetHead.toLowerCase().includes(q)
      );
    }
    return [...d].sort((a, b) =>
      sDir === "desc" ? (b[sKey] || 0) - (a[sKey] || 0) : (a[sKey] || 0) - (b[sKey] || 0)
    );
  }, [projects, typeFilter, fStatus, fSector, fGuarantee, search, sKey, sDir, projectGuaranteeStatus]);

  const S = useMemo(() => {
    const wb = projects.filter(x => x.totalAmount > 0);
    return {
      n:      projects.length,
      budget: projects.reduce((s, x) => s + x.totalAmount,   0),
      paid:   projects.reduce((s, x) => s + x.paymentAmount, 0),
      liab:   projects.reduce((s, x) => s + x.liability082,  0),
      exp:    projects.reduce((s, x) => s + x.expense082,    0),
      carry:  projects.reduce((s, x) => s + x.carry083,      0),
      avgP:   wb.length ? wb.reduce((s, x) => s + x.physicalProgress, 0) / wb.length : 0,
      done:   projects.filter(x => x.workStatus === "सम्पन्न").length,
      active: projects.filter(x => x.workStatus === "कार्य प्रगतिमा").length,
    };
  }, [projects]);

  const statusData = useMemo(() => {
    const m = {};
    projects.forEach(p => { if (p.workStatus) m[p.workStatus] = (m[p.workStatus] || 0) + 1; });
    return Object.entries(m)
      .map(([name, value]) => ({ name, value, color: STATUS_COL[name] || "#78909C" }))
      .sort((a, b) => b.value - a.value);
  }, [projects]);

  const secBudget = useMemo(() => {
    const m = {};
    projects.forEach(p => { if (p.budgetHead) m[p.budgetHead] = (m[p.budgetHead] || 0) + p.totalAmount; });
    return Object.entries(m)
      .filter(([, v]) => v > 0)
      .map(([n, v]) => ({ name: n, fullName: n, value: v, color: SEC_COL[n] || "#78909C" }))
      .sort((a, b) => b.value - a.value);
  }, [projects]);

  const secProg = useMemo(() => {
    const m = {};
    projects.forEach(p => {
      if (!p.budgetHead || p.totalAmount <= 0) return;
      if (!m[p.budgetHead]) m[p.budgetHead] = { t: 0, pd: 0, c: 0, ps: 0 };
      m[p.budgetHead].t  += p.totalAmount;
      m[p.budgetHead].pd += p.paymentAmount;
      m[p.budgetHead].c++;
      m[p.budgetHead].ps += p.physicalProgress;
    });
    return Object.entries(m).map(([n, d]) => ({
      name:   SEC_MED[n] || n,
      भौतिक: Math.round(d.ps / d.c),
      आर्थिक: d.t > 0 ? Math.round((d.pd / d.t) * 100) : 0,
    }));
  }, [projects]);

  const topP = useMemo(() =>
    projects.filter(p => p.totalAmount > 1e7).sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10),
  [projects]);

  const ganttData = useMemo(() => {
    const base = filtered.length > 0 ? filtered : projects;
    return [...base]
      .filter(p => p.physicalProgress > 0 || p.totalAmount > 0)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 20)
      .map(p => ({
        name: p.projectName.length > 26 ? p.projectName.slice(0, 24) + "…" : p.projectName,
        fullName: p.projectName,
        भौतिक: Math.round(p.physicalProgress),
        बाँकी: Math.max(0, 100 - Math.round(p.physicalProgress)),
        status: p.workStatus,
        totalAmount: p.totalAmount,
        dueDate: p.dueDate,
        id: p.id,
      }));
  }, [filtered, projects]);

  // ── All guarantee entries (every project × 3 types) ─────────
  const guaranteeData = useMemo(() => {
    const list = [];
    const G_TYPES = [
      { key: "ins", label: "बीमा (Insurance)" },
      { key: "pbg", label: "कार्यसम्पादन जमानत (PBG)" },
      { key: "apg", label: "अग्रिम भुक्तानी जमानत (APG)" },
    ];
    projects.forEach(p => {
      G_TYPES.forEach(({ key, label }) => {
        const g  = p[key];
        if (!g) return;
        const st = expiryStatus(g.expiry);
        // Only include rows that have at least one real field
        const hasData = (g.bank && g.bank !== "—") || g.amt > 0 ||
                        (g.expiry && g.expiry !== "—");
        if (hasData) list.push({ project: p, key, label, g, st });
      });
    });
    // Sort: expired first, then near, then valid
    const ORDER = { expired: 0, near: 1, valid: 2, null: 3 };
    list.sort((a, b) => (ORDER[a.st] ?? 3) - (ORDER[b.st] ?? 3));
    return list;
  }, [projects]);

  // Quick counts for badges and summary cards
  const gExpiredCount = useMemo(() => guaranteeData.filter(g => g.st === "expired").length, [guaranteeData]);
  const gNearCount    = useMemo(() => guaranteeData.filter(g => g.st === "near").length,    [guaranteeData]);
  const gValidCount   = useMemo(() => guaranteeData.filter(g => g.st === "valid").length,   [guaranteeData]);
  // Total guaranteed amount across all active guarantees
  const gTotalAmt     = useMemo(() => guaranteeData.reduce((s, g) => s + (g.g.amt || 0), 0), [guaranteeData]);

  // Header alert list (expired + near only, for the bell badge)
  const alerts = useMemo(() =>
    guaranteeData.filter(g => g.st === "expired" || g.st === "near"),
  [guaranteeData]);

  // ── SHARED STYLES ─────────────────────────────────────────
  const card = {
    background: T.white,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    boxShadow: "0 2px 10px rgba(0,56,147,.06)",
  };

  const hdrTitle = {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: 0.3,
    lineHeight: 1.2,
  };

  // ── COL WIDTHS (table-layout:fixed) ───────────────────────
  const COL_W = ["42px","30%","90px","130px","110px","110px","95px","95px"];
  const COL_KEYS = ["sn","projectName","budgetHead","workStatus","totalAmount","paymentAmount","physicalProgress","financialProgress"];
  const COL_LABELS = ["क्र.","योजनाको नाम","क्षेत्र","अवस्था","कुल रकम","भुक्तानी","भौतिक %","आर्थिक %"];

  // ── LOADING SCREEN ────────────────────────────────────────
  if (loading && projects.length === 0) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans Devanagari','Mukta',sans-serif" }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ width: 56, height: 56, border: `5px solid ${T.border}`, borderTop: `5px solid ${T.red}`, borderRadius: "50%", animation: "spin .8s linear infinite", marginBottom: 20 }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: T.blue, marginBottom: 6 }}>इटहरी उपमहानगरपालिका</div>
        <div style={{ fontSize: 13, color: T.muted }}>Google Sheets बाट डेटा लोड हुँदैछ…</div>
      </div>
    );
  }

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.text, fontFamily: "'Noto Sans Devanagari','Mukta',sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Mukta:wght@400;600;700;800&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

        /* ── Reset & base ── */
        *{box-sizing:border-box}
        html,body{overflow-x:hidden;max-width:100vw}

        /* ── Global font: Noto Sans Devanagari for crisp Nepali ── */
        html{font-family:'Noto Sans Devanagari','Mukta',sans-serif}
        body,*{
          font-family:'Noto Sans Devanagari','Mukta',sans-serif;
          -webkit-font-smoothing:antialiased;
          -moz-osx-font-smoothing:grayscale;
          text-rendering:optimizeLegibility
        }

        /* ── SVG text (Recharts labels): crisp Devanagari ── */
        svg text{
          font-family:'Noto Sans Devanagari','Mukta',sans-serif!important;
          text-rendering:geometricPrecision;
          -webkit-font-smoothing:antialiased
        }
        /* SVG shapes: pixel-crisp lines/axes */
        svg .recharts-cartesian-axis-line,
        svg .recharts-cartesian-grid-horizontal line,
        svg .recharts-cartesian-grid-vertical line{
          shape-rendering:crispEdges
        }

        .ca{animation:fadeUp .4s ease both}
        .hov:hover{background:${T.sky}!important;cursor:pointer}
        .card-hov:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,56,147,.13)!important}
        select,input{font-family:inherit;max-width:100%}
        *::-webkit-scrollbar{width:5px;height:5px}
        *::-webkit-scrollbar-thumb{background:${T.lb};border-radius:3px}

        /* ── Safe word-wrap everywhere ── */
        h1,h2,h3,h4,p,span,li{word-wrap:break-word;overflow-wrap:break-word}

        /* ── Table base ── */
        .tbl{table-layout:fixed;width:100%;border-collapse:collapse;font-size:11.5px}
        .tbl th,.tbl td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

        /* ── Tab bar: always horizontal-scroll, no wrap ── */
        .tab-bar{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex-wrap:nowrap!important;display:flex}
        .tab-bar::-webkit-scrollbar{display:none}
        .tab-bar button{white-space:nowrap!important;flex-shrink:0;touch-action:manipulation}

        /* ── Charts: scroll wrapper ── */
        .chart-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%}
        .chart-min{min-width:420px}

        /* ── Mobile cards: hidden on desktop ── */
        .mobile-cards,.gmobile-cards{display:none}

        /* ── Touch-friendly buttons ── */
        button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}

        /* ── Inputs & selects: consistent compact height, no iOS zoom ── */
        input,select{
          -webkit-appearance:none;appearance:none;
          font-size:14px;           /* ≥14px prevents iOS auto-zoom */
          height:38px;line-height:1;
          padding:0 10px;
          border-radius:8px;
          outline:none
        }
        input::placeholder{font-size:13px;color:#8A9BB0}
        select{padding-right:28px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%235A6A7E'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:10px}

        /* ════════════════════════════════════
           TABLET  769px → 1024px
        ════════════════════════════════════ */
        @media(max-width:1024px){
          .kpi-grid{grid-template-columns:repeat(3,1fr)!important}
          .overview-grid{grid-template-columns:1fr!important}
        }

        /* ════════════════════════════════════
           MOBILE LARGE  481px → 768px
        ════════════════════════════════════ */
        @media(max-width:768px){
          .hdr-title{font-size:16px!important}
          .hdr-sub{font-size:10px!important}
          .kpi-grid{grid-template-columns:repeat(2,1fr)!important;gap:8px!important}
          .overview-grid,.finance-grid{grid-template-columns:1fr!important;gap:10px!important}
          .main-pad{padding:12px!important}
          .modal-box{padding:16px!important;max-height:93vh!important}
          .modal-3col{grid-template-columns:1fr 1fr!important}
          .tab-bar button{font-size:11.5px!important;padding:7px 12px!important}
          .tbl-wrap{display:none!important}
          .mobile-cards{display:block!important}
          .gtbl-wrap{display:none!important}
          .gmobile-cards{display:block!important}
          .chart-min{min-width:400px}
        }

        /* ════════════════════════════════════
           MOBILE SMALL  ≤ 480px
        ════════════════════════════════════ */
        @media(max-width:480px){
          .hdr-row{flex-direction:column!important;align-items:flex-start!important;gap:6px!important;padding:8px 0!important}
          .hdr-title{font-size:clamp(13px,3.8vw,16px)!important;line-height:1.2!important}
          .hdr-sub{font-size:9px!important;opacity:.8}
          .hdr-logo{width:32px!important;height:32px!important;font-size:14px!important}
          .hdr-actions{width:100%!important;justify-content:flex-start!important;gap:5px!important}
          .tab-bar button{font-size:10.5px!important;padding:6px 9px!important}
          .kpi-grid{grid-template-columns:repeat(2,1fr)!important;gap:7px!important}
          .kpi-val{font-size:17px!important}
          .kpi-label{font-size:8.5px!important;letter-spacing:.3px!important}
          .main-pad{padding:8px!important}
          .alert-panel{max-height:55vh!important;overflow-y:auto!important}
          .alert-grid{grid-template-columns:1fr!important}
          .modal-overlay{padding:0!important;align-items:flex-end!important}
          .modal-box{border-radius:18px 18px 0 0!important;max-height:90vh!important;padding:14px!important;max-width:100vw!important}
          .modal-2col{grid-template-columns:1fr!important}
          .modal-3col{grid-template-columns:1fr 1fr!important}
          .filter-row{flex-direction:column!important;gap:6px!important}
          .filter-row select,.filter-row input{width:100%!important}
          .chart-min{min-width:360px}
        }

        /* ════════════════════════════════════
           VERY SMALL  ≤ 360px
        ════════════════════════════════════ */
        @media(max-width:360px){
          .hdr-title{font-size:12px!important}
          .tab-bar button{font-size:10px!important;padding:5px 7px!important}
          .kpi-grid{grid-template-columns:repeat(2,1fr)!important}
          .modal-3col{grid-template-columns:1fr!important}
          .kpi-val{font-size:15px!important}
        }
      `}</style>

      {/* ══════════════ HEADER ══════════════ */}
      <header style={{ background: T.red, color: "#fff", boxShadow: "0 3px 16px rgba(0,0,0,.2)", position: "sticky", top: 0, zIndex: 100, width: "100%" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 clamp(10px,3vw,20px)" }}>
          {/* Top row */}
          <div className="hdr-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 0 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Nepal govt emblem placeholder */}
              <div className="hdr-logo" style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,.18)", border: "2px solid rgba(255,255,255,.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, flexShrink: 0 }}>🏛</div>
              <div>
                <h1 className="hdr-title" style={hdrTitle}>इटहरी उपमहानगरपालिका</h1>
                <p className="hdr-sub" style={{ margin: 0, fontSize: 11, opacity: .85 }}>ठेक्का तथा योजना अनुगमन ड्यासबोर्ड — आ.व. ०८२/०८३</p>
              </div>
            </div>
            <div className="hdr-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* Alert bell */}
              {alerts.length > 0 && (
                <button onClick={() => setAlertOpen(v => !v)}
                  style={{ position: "relative", padding: "5px 12px", borderRadius: 8, border: "2px solid rgba(255,255,255,.4)", background: alerts.some(a => a.st === "expired") ? "rgba(220,0,0,.3)" : "rgba(230,81,0,.3)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  🔔 {toNP(alerts.length)} सचेतना
                  <span style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: "#FF1744", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{toNP(alerts.length)}</span>
                </button>
              )}
              {lastSync && (
                <span style={{ fontSize: 10, opacity: .75, background: "rgba(0,0,0,.15)", padding: "4px 9px", borderRadius: 6 }}>
                  🕐 {toNP(lastSync.toLocaleTimeString("ne-NP"))}
                  {loading && <span style={{ animation: "pulse 1s infinite", marginLeft: 5 }}>⟳</span>}
                </span>
              )}
              <button onClick={fetchData} disabled={loading}
                style={{ padding: "5px 14px", borderRadius: 8, border: "2px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.12)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: "inherit" }}>
                {loading ? "लोड…" : "🔄 रिफ्रेश"}
              </button>
            </div>
          </div>
          {/* Nav tabs */}
          <div className="tab-bar" style={{ display: "flex", gap: 2, paddingBottom: 0, borderBottom: "none" }}>
            {[["overview","📊 अवलोकन"],["projects","📋 योजनाहरू"],["finance","💰 वित्तीय"],["gantt","📅 समयरेखा"],["guarantee","🔒 ग्यारेन्टी"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                style={{ padding: "8px 18px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", transition: "all .2s", background: tab === k ? T.white : "rgba(255,255,255,.15)", color: tab === k ? T.red : "rgba(255,255,255,.9)" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ══════════════ ALERTS PANEL ══════════════ */}
      {alertOpen && alerts.length > 0 && (
        <div className="alert-panel" style={{ background: "#FFF8E1", borderBottom: `2px solid ${T.orange}`, maxHeight: 320, overflowY: "auto", overflowX: "hidden" }}>
          <div style={{ maxWidth: 1440, margin: "0 auto", padding: "8px clamp(10px,3vw,20px)" }}>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: T.orange, flexShrink: 0 }}>🔔 ग्यारेन्टी म्याद सचेतना</span>
                {gExpiredCount > 0 && (
                  <span style={{ background: T.expired, color: "#fff", borderRadius: 20, padding: "2px 8px", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                    🔴 सकिएको: {toNP(gExpiredCount)}
                  </span>
                )}
                {gNearCount > 0 && (
                  <span style={{ background: T.near, color: "#fff", borderRadius: 20, padding: "2px 8px", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                    🟠 नजिक: {toNP(gNearCount)}
                  </span>
                )}
              </div>
              <button onClick={() => setAlertOpen(false)}
                style={{ background: "rgba(0,0,0,.08)", border: "none", borderRadius: 6, width: 28, height: 28, fontSize: 14, cursor: "pointer", color: T.muted, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            {/* Alert cards — always 1 col on mobile, auto-fill on desktop */}
            <div className="alert-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(280px,100%),1fr))", gap: 7 }}>
              {alerts.map((a, i) => {
                const gs = GSTATUS_STYLE[a.st];
                const exp = parseBS(a.g.expiry);
                const days = exp && !isNaN(exp) ? Math.floor((exp - Date.now()) / 86400000) : null;
                return (
                  <div key={i} onClick={() => { setSel(a.project); setAlertOpen(false); }}
                    style={{ background: gs.bg, border: `1.5px solid ${gs.color}`, borderLeft: `4px solid ${gs.color}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", overflow: "hidden" }}>
                    {/* Project name — wraps on mobile */}
                    <div style={{ fontWeight: 700, fontSize: 11, color: T.text, marginBottom: 4, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {a.project.projectName}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                      <span style={{ fontSize: 10.5, color: gs.color, fontWeight: 600 }}>{gs.icon} {a.label}</span>
                      {days !== null && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: gs.color, background: "#fff", padding: "1px 6px", borderRadius: 4, border: `1px solid ${gs.color}`, flexShrink: 0 }}>
                          {days < 0 ? `${toNP(Math.abs(days))} दिन अघि` : `${toNP(days)} दिन बाँकी`}
                        </span>
                      )}
                    </div>
                    {a.g.expiry && a.g.expiry !== "—" && (
                      <div style={{ fontSize: 9.5, color: T.muted, marginTop: 3 }}>म्याद: {a.g.expiry}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ ERROR BANNER ══════════════ */}
      {err && (
        <div style={{ background: "#FFEBEE", borderBottom: `1px solid #EF9A9A`, padding: "10px 20px", textAlign: "center", fontSize: 12.5, color: T.expired, fontWeight: 600 }}>
          ⚠️ {err} &nbsp;
          <button onClick={fetchData} style={{ marginLeft: 8, padding: "3px 10px", borderRadius: 6, border: `1px solid ${T.expired}`, background: "#fff", color: T.expired, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>पुनः प्रयास</button>
        </div>
      )}

      <main className="main-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "18px 20px" }}>

        {/* ══════════════ KPI CARDS ══════════════ */}
        {(tab === "overview" || tab === "finance") && (
          <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { l: "कुल योजना",      v: fmtInt(S.n),           s: "सबै श्रेणी",     i: "📋", a: T.blue,   bg: T.sky },
              { l: "कुल बजेट",       v: fmt(S.budget),         s: `${toNP((S.budget/1e7).toFixed(1))} करोड`, i: "💰", a: T.gold,   bg: "#FFF8E7" },
              { l: "भुक्तानी",       v: fmt(S.paid),           s: S.budget > 0 ? toNP(((S.paid/S.budget)*100).toFixed(1))+"% खर्च" : "—", i: "✅", a: T.green,  bg: "#EDF7EF" },
              { l: "औसत भौतिक",     v: fmtPct(S.avgP),        s: "प्रगति",          i: "🏗️", a: T.orange, bg: "#FFF3EA" },
              { l: "प्रगतिमा",       v: fmtInt(S.active),      s: "सक्रिय",          i: "⚡", a: T.red,    bg: "#FFECEE" },
              { l: "सम्पन्न",        v: fmtInt(S.done),        s: "पूरा",            i: "🏆", a: T.blue,   bg: T.sky },
            ].map((k, i) => (
              <div key={i} className="ca card-hov" style={{ ...card, padding: "12px 14px", overflow: "hidden", transition: "all .3s", animationDelay: `${i*60}ms`, background: `linear-gradient(135deg,${T.white},${k.bg})` }}>
                <p className="kpi-label" style={{ margin: 0, fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{k.l}</p>
                <p className="kpi-val" style={{ margin: "4px 0 2px", fontSize: 22, fontWeight: 800, color: k.a }}>{k.v}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: T.muted }}>{k.s}</span>
                  <span style={{ fontSize: 18 }}>{k.i}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════════════ OVERVIEW TAB ══════════════ */}
        {tab === "overview" && (
          <div className="overview-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {/* ── Row 1: Sector budget bar — FULL WIDTH, prominent ── */}
            <div className="ca" style={{ ...card, padding: "18px 22px", gridColumn: "1/-1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: T.blue, borderBottom: `3px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>क्षेत्रगत बजेट वितरण</h3>
                <span style={{ fontSize: 10.5, color: T.muted, background: T.sky, padding: "3px 10px", borderRadius: 6, fontWeight: 600 }}>
                  कुल: {fmt(secBudget.reduce((s, x) => s + x.value, 0))}
                </span>
              </div>
              {secBudget.length > 0 ? (
                <div className="chart-scroll"><div className="chart-min">
                <ResponsiveContainer width="100%" height={Math.max(260, secBudget.length * 44)}>
                  <BarChart data={secBudget} layout="vertical" margin={{ left: 0, right: CK.rightMg, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtS} axisLine={false} tickLine={false}
                      tick={{ fill: T.muted, fontSize: CK.tickSm, fontFamily: CHART_FONT }} />
                    <YAxis type="category" dataKey="name" width={CK.yWidthLg} axisLine={false} tickLine={false}
                      tick={{ fill: T.text, fontSize: CK.tickMd, fontWeight: 500, fontFamily: CHART_FONT }} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="value" name="बजेट (करोड)" radius={[0, 8, 8, 0]} barSize={26}>
                      {secBudget.map((e, i) => <Cell key={i} fill={e.color} />)}
                      <LabelList dataKey="value" position="right" formatter={v => fmtS(v)} style={{ fill: T.muted, fontSize: CK.tickSm, fontWeight: 700, fontFamily: CHART_FONT }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                </div></div>
              ) : <EmptyState />}
            </div>

            {/* ── Row 2 col 1: Status donut ── */}
            <div className="ca" style={{ ...card, padding: 18, animationDelay: "60ms" }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>कार्य अवस्था वितरण</h3>
              {statusData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" outerRadius={88} innerRadius={44} paddingAngle={2} dataKey="value" stroke="none">
                        {statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                    {statusData.map((s, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: T.muted, background: T.sky, padding: "2px 7px", borderRadius: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                        {s.name} ({toNP(s.value)})
                      </span>
                    ))}
                  </div>
                </>
              ) : <EmptyState />}
            </div>

            {/* ── Row 2 col 2: Sector progress comparison ── */}
            <div className="ca" style={{ ...card, padding: 18, animationDelay: "120ms" }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>क्षेत्रगत प्रगति तुलना</h3>
              {secProg.length > 0 ? (
                <div className="chart-scroll"><div className="chart-min" style={{ minWidth: 320 }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={secProg} margin={{ left: 0, right: 8, top: 4, bottom: 55 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                    <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0}
                      tick={{ fill: T.text, fontSize: CK.tickSm, fontFamily: CHART_FONT }} />
                    <YAxis domain={[0, 100]} tickFormatter={v => toNP(v) + "%"} width={38}
                      tick={{ fill: T.muted, fontSize: CK.tickSm, fontFamily: CHART_FONT }} />
                    <Tooltip content={<ChartTip />} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4, fontFamily: CHART_FONT }} />
                    <Bar dataKey="भौतिक" name="भौतिक %" fill={T.red}   radius={[4,4,0,0]} barSize={12} />
                    <Bar dataKey="आर्थिक" name="आर्थिक %" fill={T.blue} radius={[4,4,0,0]} barSize={12} />
                  </BarChart>
                </ResponsiveContainer>
                </div></div>
              ) : <EmptyState />}
            </div>

            {/* ── Row 3: Top projects — full width ── */}
            <div className="ca" style={{ ...card, padding: 18, gridColumn: "1/-1", animationDelay: "180ms" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>ठूला योजनाहरू (शीर्ष रकमका)</h3>
              {topP.length === 0 ? <EmptyState /> : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 10 }}>
                  {topP.map((p, i) => (
                    <div key={p.id} onClick={() => setSel(p)} className="hov"
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${T.border}`, borderLeft: `4px solid ${SEC_COL[p.budgetHead] || T.muted}`, borderRadius: 8, cursor: "pointer", background: T.white, transition: "all .2s" }}>
                      <div style={{ width: 26, height: 26, borderRadius: 7, background: T.sky, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: T.blue, flexShrink: 0 }}>{toNP(i + 1)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.projectName}</p>
                        <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: T.muted, flexShrink: 0, minWidth: 90 }}>{fmt(p.totalAmount)}</span>
                          <ProgressBar value={p.physicalProgress} color={p.physicalProgress >= 75 ? T.green : p.physicalProgress >= 50 ? T.gold : p.physicalProgress >= 25 ? T.orange : T.red} height={6} />
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: T.blue, flexShrink: 0 }}>{fmtPct(p.physicalProgress)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ══════════════ PROJECTS TABLE ══════════════ */}
        {tab === "projects" && (
          <div>
            {/* Filter bar */}
            <div style={{ ...card, padding: "10px 12px", marginBottom: 12 }}>
              {/* Type filter buttons */}
              <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: T.muted, fontWeight: 600, flexShrink: 0 }}>प्रकार:</span>
                {TYPE_FILTERS.map(f => (
                  <button key={f.key} onClick={() => setTypeFilter(f.key)}
                    style={{ padding: "4px 11px", height: 30, borderRadius: 20, border: `1.5px solid ${typeFilter === f.key ? T.red : T.border}`, background: typeFilter === f.key ? T.red : T.white, color: typeFilter === f.key ? "#fff" : T.text, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                    {f.key}
                  </button>
                ))}
              </div>
              {/* Guarantee expiry filter */}
              <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: T.muted, fontWeight: 600, flexShrink: 0 }}>ग्यारेन्टी:</span>
                {[
                  { key: "सबै",           color: T.muted   },
                  { key: "म्याद सकियो",   color: T.expired },
                  { key: "म्याद नजिक",    color: T.near    },
                  { key: "मान्य",         color: T.valid   },
                  { key: "ग्यारेन्टी छैन", color: T.muted  },
                ].map(f => (
                  <button key={f.key} onClick={() => setFGuarantee(f.key)}
                    style={{ padding: "3px 10px", height: 28, borderRadius: 20, border: `1.5px solid ${fGuarantee === f.key ? f.color : T.border}`, background: fGuarantee === f.key ? f.color : T.white, color: fGuarantee === f.key ? "#fff" : T.text, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                    {f.key}
                  </button>
                ))}
              </div>
              {/* Search + dropdowns */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 खोज्नुहोस्…"
                  style={{ flex: "1 1 180px", minWidth: 0, height: 36, padding: "0 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.sky, color: T.text, fontSize: 14 }} />
                <select value={fStatus} onChange={e => setFStatus(e.target.value)}
                  style={{ flex: "1 1 120px", minWidth: 0, height: 36, padding: "0 28px 0 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, cursor: "pointer", background: T.white }}>
                  {statuses.map(o => <option key={o}>{o}</option>)}
                </select>
                <select value={fSector} onChange={e => setFSector(e.target.value)}
                  style={{ flex: "1 1 120px", minWidth: 0, height: 36, padding: "0 28px 0 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, cursor: "pointer", background: T.white }}>
                  {sectors.map(o => <option key={o}>{o}</option>)}
                </select>
                <span style={{ fontSize: 11, color: T.muted, fontWeight: 700, background: T.sky, padding: "5px 10px", borderRadius: 7, flexShrink: 0, whiteSpace: "nowrap" }}>
                  {toNP(filtered.length)} योजना
                </span>
              </div>
            </div>

            {/* Table — hidden on mobile, replaced by cards */}
            <div className="tbl-wrap" style={{ ...card, overflow: "clip" }}>
              <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "68vh" }}>
                <table className="tbl">
                  <colgroup>
                    {COL_W.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                    <tr style={{ background: `linear-gradient(135deg,${T.blue},${T.lb})` }}>
                      {COL_KEYS.map((k, i) => (
                        <th key={k} onClick={() => { setSKey(k); setSDir(d => d === "desc" ? "asc" : "desc"); }}
                          style={{ padding: "10px 8px", textAlign: "left", color: "#fff", fontWeight: 700, cursor: "pointer", borderBottom: `2px solid ${T.gold}`, fontSize: 11, userSelect: "none" }}>
                          {COL_LABELS[i]} {sKey === k ? (sDir === "desc" ? "▼" : "▲") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={COL_KEYS.length} style={{ padding: 36, textAlign: "center", color: T.muted }}>कुनै योजना फेला परेन</td></tr>
                    ) : filtered.map((p, i) => {
                      const hasAlert = expiryStatus(p.ins?.expiry) || expiryStatus(p.pbg?.expiry) || expiryStatus(p.apg?.expiry);
                      return (
                        <tr key={p.id} onClick={() => setSel(p)} className="hov"
                          style={{ background: i % 2 === 0 ? T.white : "#F7FAFD", borderLeft: hasAlert ? `3px solid ${hasAlert === "expired" ? T.expired : T.near}` : "none" }}>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}`, color: T.muted, fontWeight: 600 }}>{toNP(p.sn)}</td>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}` }}>
                            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.projectName}</div>
                            <div style={{ fontSize: 10, color: T.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{p.contractId || "—"} • {p.contractor || "—"}</div>
                          </td>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}` }}>
                            <span style={{ padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600, background: `${SEC_COL[p.budgetHead] || "#78909C"}18`, color: SEC_COL[p.budgetHead] || "#78909C", display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {SEC_SH[p.budgetHead] || p.budgetHead}
                            </span>
                          </td>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}` }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600, background: `${STATUS_COL[p.workStatus] || "#78909C"}18`, color: STATUS_COL[p.workStatus] || "#78909C", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <span style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COL[p.workStatus] || "#78909C", flexShrink: 0 }} />
                              {p.workStatus || "—"}
                            </span>
                          </td>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{p.totalAmount ? fmt(p.totalAmount) : "—"}</td>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}`, color: T.green, fontWeight: 600 }}>{p.paymentAmount ? fmt(p.paymentAmount) : "—"}</td>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <ProgressBar value={p.physicalProgress} color={p.physicalProgress >= 75 ? T.green : p.physicalProgress >= 50 ? T.gold : p.physicalProgress >= 25 ? T.orange : T.red} />
                              <span style={{ fontSize: 10.5, fontWeight: 700, minWidth: 30, textAlign: "right", flexShrink: 0 }}>{fmtPct(p.physicalProgress)}</span>
                            </div>
                          </td>
                          <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <ProgressBar value={p.financialProgress} color={T.lb} />
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: T.blue, minWidth: 30, textAlign: "right", flexShrink: 0 }}>{fmtPct(p.financialProgress)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile project cards — shown only on small screens via CSS */}
            <div className="mobile-cards">
              {filtered.length === 0 ? (
                <div style={{ padding: 28, textAlign: "center", color: T.muted, fontSize: 13 }}>कुनै योजना फेला परेन</div>
              ) : filtered.map((p) => {
                const hasAlert = expiryStatus(p.ins?.expiry) || expiryStatus(p.pbg?.expiry) || expiryStatus(p.apg?.expiry);
                const alertCol = hasAlert === "expired" ? T.expired : hasAlert === "near" ? T.near : null;
                const barCol = p.physicalProgress >= 75 ? T.green : p.physicalProgress >= 50 ? T.gold : p.physicalProgress >= 25 ? T.orange : T.red;
                return (
                  <div key={p.id} onClick={() => setSel(p)}
                    style={{ background: T.white, border: `1px solid ${alertCol || T.border}`, borderLeft: `4px solid ${alertCol || SEC_COL[p.budgetHead] || T.muted}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10, cursor: "pointer" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.4, marginBottom: 5 }}>{p.projectName}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 4 }}>
                      <span style={{ fontSize: 10, color: T.muted }}>{p.contractId || "—"}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: `${STATUS_COL[p.workStatus] || "#78909C"}18`, color: STATUS_COL[p.workStatus] || "#78909C" }}>● {p.workStatus || "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 10 }}>
                      <span style={{ color: T.muted }}>कुल: <strong style={{ color: T.text }}>{fmt(p.totalAmount)}</strong></span>
                      <span style={{ color: T.muted }}>भुक्तानी: <strong style={{ color: T.green }}>{fmt(p.paymentAmount)}</strong></span>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginBottom: 3 }}>
                        <span>भौतिक प्रगति</span><span style={{ fontWeight: 700, color: barCol }}>{fmtPct(p.physicalProgress)}</span>
                      </div>
                      <ProgressBar value={p.physicalProgress} color={barCol} height={7} />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginBottom: 3 }}>
                        <span>आर्थिक प्रगति</span><span style={{ fontWeight: 700, color: T.blue }}>{fmtPct(p.financialProgress)}</span>
                      </div>
                      <ProgressBar value={p.financialProgress} color={T.lb} height={7} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════════════ GANTT TAB ══════════════ */}
        {tab === "gantt" && (
          <div>
            {/* Filter bar */}
            <div style={{ ...card, padding: "10px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, color: T.muted, fontWeight: 600, marginRight: 4 }}>योजना प्रकार:</span>
                {TYPE_FILTERS.map(f => (
                  <button key={f.key} onClick={() => setTypeFilter(f.key)}
                    style={{ padding: "5px 14px", borderRadius: 20, border: `1.5px solid ${typeFilter === f.key ? T.red : T.border}`, background: typeFilter === f.key ? T.red : T.white, color: typeFilter === f.key ? "#fff" : T.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                    {f.key}
                  </button>
                ))}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.muted, fontWeight: 700, background: T.sky, padding: "5px 10px", borderRadius: 7, flexShrink: 0 }}>
                  शीर्ष {toNP(ganttData.length)} योजना (रकमअनुसार)
                </span>
              </div>
            </div>

            {/* Horizontal progress / Gantt chart */}
            <div style={{ ...card, padding: 18, marginBottom: 16 }} className="ca">
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>भौतिक प्रगति समयरेखा</h3>
              {ganttData.length === 0 ? <EmptyState /> : (
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <div style={{ minWidth: isMobile ? 380 : 560 }}>
                    <ResponsiveContainer width="100%" height={Math.max(300, ganttData.length * (isMobile ? 36 : 42))}>
                      <BarChart data={ganttData} layout="vertical" margin={{ left: 0, right: isMobile ? 42 : 68, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={T.border} />
                        <XAxis type="number" domain={[0, 100]} tickFormatter={v => toNP(v) + "%"}
                          tick={{ fill: T.muted, fontSize: CK.tickSm, fontFamily: CHART_FONT }}
                          tickCount={isMobile ? 4 : 6} />
                        <YAxis type="category" dataKey="name" width={CK.yWidthGt}
                          tick={{ fill: T.text, fontSize: isMobile ? 8 : 10, fontFamily: CHART_FONT }}
                          tickLine={false} />
                        <Tooltip content={<GanttTip />} />
                        <Bar dataKey="भौतिक" stackId="prog" name="सम्पन्न" barSize={CK.ganttBar}>
                          {ganttData.map((e, i) => <Cell key={i} fill={STATUS_COL[e.status] || T.blue} />)}
                          <LabelList dataKey="भौतिक" position="insideRight"
                            formatter={v => v >= 15 ? toNP(v) + "%" : ""}
                            style={{ fill: "#fff", fontSize: isMobile ? 8 : 9, fontWeight: 700, fontFamily: CHART_FONT }} />
                        </Bar>
                        <Bar dataKey="बाँकी" stackId="prog" name="बाँकी" fill="#DDE3EF" barSize={CK.ganttBar} radius={[0, 4, 4, 0]}>
                          <LabelList dataKey="बाँकी" position="right"
                            formatter={(v) => {
                              const row = ganttData.find(g => g.बाँकी === v);
                              return row ? toNP(row.भौतिक) + "%" : "";
                            }}
                            style={{ fill: T.muted, fontSize: isMobile ? 8 : 9.5, fontWeight: 700, fontFamily: CHART_FONT }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {/* Status legend */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {Object.entries(STATUS_COL).filter(([s]) => ganttData.some(g => g.status === s)).map(([s, c]) => (
                  <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: T.muted, background: T.sky, padding: "2px 8px", borderRadius: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Timeline cards grid */}
            <div style={{ ...card, padding: 18 }} className="ca">
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>योजना म्याद विवरण</h3>
              {ganttData.length === 0 ? <EmptyState /> : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 10 }}>
                  {ganttData.map((g, i) => {
                    const proj = (filtered.length > 0 ? filtered : projects).find(p => p.id === g.id);
                    if (!proj) return null;
                    const progColor = STATUS_COL[g.status] || T.blue;
                    return (
                      <div key={g.id} onClick={() => setSel(proj)} className="hov card-hov"
                        style={{ border: `1px solid ${T.border}`, borderLeft: `4px solid ${progColor}`, borderRadius: 10, padding: "10px 13px", cursor: "pointer", background: T.white, transition: "all .3s" }}>
                        <p style={{ margin: "0 0 5px", fontSize: 11, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: T.muted, marginRight: 4 }}>{toNP(i + 1)}.</span>{proj.projectName}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                          <ProgressBar value={g.भौतिक} color={progColor} height={7} />
                          <span style={{ fontSize: 12, fontWeight: 800, color: progColor, flexShrink: 0 }}>{toNP(g.भौतिक)}%</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted }}>
                          <span style={{ fontWeight: 600 }}>{fmt(proj.totalAmount)}</span>
                          {proj.dueDate && <span>म्याद: {proj.dueDate}</span>}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <span style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 4, background: `${progColor}18`, color: progColor, fontWeight: 600 }}>{g.status || "—"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════ GUARANTEE TAB ══════════════ */}
        {tab === "guarantee" && (() => {
          const G_STATUS_FILTERS = [
            { key: "सबै",           color: T.muted,   count: guaranteeData.length },
            { key: "म्याद सकियो",   color: T.expired, count: gExpiredCount },
            { key: "म्याद नजिक",    color: T.near,    count: gNearCount    },
            { key: "मान्य",         color: T.valid,   count: gValidCount   },
          ];
          const G_TYPE_FILTERS = [
            { key: "सबै",  color: T.muted,  count: guaranteeData.length },
            { key: "बीमा", color: T.blue,   count: guaranteeData.filter(g => g.key === "ins").length },
            { key: "PBG",  color: T.green,  count: guaranteeData.filter(g => g.key === "pbg").length },
            { key: "APG",  color: T.orange, count: guaranteeData.filter(g => g.key === "apg").length },
          ];
          const visibleG = guaranteeData.filter(g => {
            const stMatch =
              gTabFilter === "सबै"         ? true :
              gTabFilter === "म्याद सकियो" ? g.st === "expired" :
              gTabFilter === "म्याद नजिक"  ? g.st === "near"    :
              gTabFilter === "मान्य"        ? g.st === "valid"   : true;
            const typeMatch =
              gTypeFilter === "सबै"  ? true :
              gTypeFilter === "बीमा" ? g.key === "ins" :
              gTypeFilter === "PBG"  ? g.key === "pbg" :
              gTypeFilter === "APG"  ? g.key === "apg" : true;
            return stMatch && typeMatch;
          });
          return (
            <div>
              {/* Summary KPI cards */}
              <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 12, marginBottom: 18 }}>
                {[
                  { l: "कुल ग्यारेन्टी",    v: toNP(guaranteeData.length), c: T.blue,    bg: T.sky,      sub: `${toNP(projects.length)} योजना` },
                  { l: "कुल जमानत रकम",      v: fmtS(gTotalAmt),            c: T.gold,    bg: "#FFF8E7",  sub: "सबै प्रकार" },
                  { l: "म्याद सकिएका",       v: toNP(gExpiredCount),        c: T.expired, bg: "#FFEBEE",  sub: "तत्काल नवीकरण" },
                  { l: "म्याद नजिकिएका",     v: toNP(gNearCount),           c: T.near,    bg: "#FFF3E0",  sub: `${toNP(NEAR_EXPIRY_DAYS)} दिनभित्र` },
                  { l: "मान्य",              v: toNP(gValidCount),          c: T.valid,   bg: "#E8F5E9",  sub: "सक्रिय" },
                ].map((k, i) => (
                  <div key={i} className="ca" style={{ ...card, padding: "12px 16px", background: `linear-gradient(135deg,${T.white},${k.bg})`, animationDelay: `${i*55}ms` }}>
                    <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: .8 }}>{k.l}</p>
                    <p style={{ margin: "4px 0 2px", fontSize: 24, fontWeight: 800, color: k.c }}>{k.v}</p>
                    <p style={{ margin: 0, fontSize: 10, color: T.muted }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* Filter bar */}
              <div style={{ ...card, padding: "10px 14px", marginBottom: 14 }}>
                {/* Status filter */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: T.muted, fontWeight: 600, minWidth: 52 }}>अवस्था:</span>
                  {G_STATUS_FILTERS.map(f => (
                    <button key={f.key} onClick={() => setGTabFilter(f.key)}
                      style={{ padding: "4px 12px", borderRadius: 20, border: `1.5px solid ${gTabFilter === f.key ? f.color : T.border}`, background: gTabFilter === f.key ? f.color : T.white, color: gTabFilter === f.key ? "#fff" : T.text, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                      {f.key}{f.count > 0 ? ` (${toNP(f.count)})` : ""}
                    </button>
                  ))}
                </div>
                {/* Type filter */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: T.muted, fontWeight: 600, minWidth: 52 }}>प्रकार:</span>
                  {G_TYPE_FILTERS.map(f => (
                    <button key={f.key} onClick={() => setGTypeFilter(f.key)}
                      style={{ padding: "4px 12px", borderRadius: 20, border: `1.5px solid ${gTypeFilter === f.key ? f.color : T.border}`, background: gTypeFilter === f.key ? f.color : T.white, color: gTypeFilter === f.key ? "#fff" : T.text, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                      {f.key}{f.count > 0 ? ` (${toNP(f.count)})` : ""}
                    </button>
                  ))}
                  <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.muted, fontWeight: 700, background: T.sky, padding: "4px 10px", borderRadius: 7 }}>
                    {toNP(visibleG.length)} प्रविष्टि
                  </span>
                </div>
              </div>

              {/* Guarantee table — hidden on mobile */}
              <div className="gtbl-wrap ca" style={{ ...card, overflow: "clip" }}>
                <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "65vh" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "22%" }} />  {/* योजना */}
                      <col style={{ width: "6%" }}  />  {/* प्रकार */}
                      <col style={{ width: "9%" }}  />  {/* अवस्था */}
                      <col style={{ width: "13%" }} />  {/* बैंक */}
                      <col style={{ width: "11%" }} />  {/* जमानत नं. */}
                      <col style={{ width: "9%" }}  />  {/* रकम */}
                      <col style={{ width: "9%" }}  />  {/* जारी मिति */}
                      <col style={{ width: "9%" }}  />  {/* म्याद */}
                      <col style={{ width: "8%" }}  />  {/* दिन बाँकी */}
                      <col style={{ width: "4%" }}  />  {/* विवरण */}
                    </colgroup>
                    <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                      <tr style={{ background: `linear-gradient(135deg,${T.blue},${T.lb})` }}>
                        {["योजनाको नाम","प्रकार","अवस्था","बैंक/वित्तीय संस्था","जमानत पत्र नं.","रकम","जारी मिति","म्याद","दिन बाँकी",""].map((h, i) => (
                          <th key={i} style={{ padding: "9px 8px", color: "#fff", fontWeight: 700, fontSize: 10.5, textAlign: "left", borderBottom: `2px solid ${T.gold}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleG.length === 0 ? (
                        <tr><td colSpan={10} style={{ padding: 36, textAlign: "center", color: T.muted }}>कुनै ग्यारेन्टी फेला परेन</td></tr>
                      ) : visibleG.map((item, i) => {
                        const { project: p, key: gKey, label, g, st } = item;
                        const gs = st ? GSTATUS_STYLE[st] : null;
                        const exp = parseBS(g.expiry);
                        const daysLeft = exp && !isNaN(exp)
                          ? Math.floor((exp - Date.now()) / 86400000)
                          : null;
                        const gTypeColor = gKey === "ins" ? T.blue : gKey === "pbg" ? T.green : T.orange;
                        const hasRef = gKey !== "ins" && g.ref && g.ref !== "—";
                        return (
                          <tr key={`${p.id}-${gKey}`} onClick={() => setSel(p)} className="hov"
                            style={{ background: gs ? gs.bg : (i % 2 === 0 ? T.white : "#F7FAFD"), cursor: "pointer", borderLeft: gs ? `3px solid ${gs.color}` : "none" }}>
                            {/* योजना */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, overflow: "hidden" }}>
                              <div style={{ fontWeight: 600, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.projectName}</div>
                              <div style={{ fontSize: 9.5, color: T.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.contractId || "—"}</div>
                            </td>
                            {/* प्रकार */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}` }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: `${gTypeColor}18`, color: gTypeColor }}>
                                {gKey === "ins" ? "बीमा" : gKey === "pbg" ? "PBG" : "APG"}
                              </span>
                            </td>
                            {/* अवस्था */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}` }}>
                              {gs
                                ? <span style={{ fontSize: 10, fontWeight: 700, color: gs.color }}>{gs.icon} {gs.label}</span>
                                : <span style={{ color: T.muted, fontSize: 10 }}>—</span>}
                            </td>
                            {/* बैंक */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.bank}</td>
                            {/* जमानत नं. */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: hasRef ? 700 : 400, color: hasRef ? T.blue : T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {gKey === "ins" ? <span style={{ color: T.muted, fontSize: 10 }}>—</span> : (hasRef ? g.ref : "—")}
                            </td>
                            {/* रकम */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 600, fontSize: 11 }}>{g.amt > 0 ? fmt(g.amt) : "—"}</td>
                            {/* जारी मिति */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, fontSize: 11 }}>{g.issue}</td>
                            {/* म्याद */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 700, fontSize: 11, color: gs ? gs.color : T.text }}>{g.expiry}</td>
                            {/* दिन बाँकी */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, fontWeight: 700, fontSize: 11,
                              color: daysLeft === null ? T.muted : daysLeft < 0 ? T.expired : daysLeft <= NEAR_EXPIRY_DAYS ? T.near : T.valid }}>
                              {daysLeft === null ? "—"
                                : daysLeft < 0 ? toNP(Math.abs(daysLeft)) + " दिन अघि"
                                : toNP(daysLeft) + " दिन"}
                            </td>
                            {/* detail arrow */}
                            <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.border}`, textAlign: "center", color: T.muted, fontSize: 12 }}>›</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile guarantee cards — shown only on small screens via CSS */}
              <div className="gmobile-cards">
                {visibleG.length === 0 ? (
                  <div style={{ padding: 28, textAlign: "center", color: T.muted, fontSize: 13 }}>कुनै ग्यारेन्टी फेला परेन</div>
                ) : visibleG.map((item) => {
                  const { project: p, key: gKey, g, st } = item;
                  const gs = st ? GSTATUS_STYLE[st] : null;
                  const exp = parseBS(g.expiry);
                  const daysLeft = exp && !isNaN(exp) ? Math.floor((exp - Date.now()) / 86400000) : null;
                  const gTypeColor = gKey === "ins" ? T.blue : gKey === "pbg" ? T.green : T.orange;
                  const hasRef = gKey !== "ins" && g.ref && g.ref !== "—";
                  return (
                    <div key={`${p.id}-${gKey}`} onClick={() => setSel(p)}
                      style={{ background: gs ? gs.bg : T.white, border: `1px solid ${gs ? gs.color : T.border}`, borderLeft: `4px solid ${gs ? gs.color : gTypeColor}`, borderRadius: 12, padding: "12px 14px", marginBottom: 9, cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, flex: 1, marginRight: 8, lineHeight: 1.4 }}>{p.projectName}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: `${gTypeColor}18`, color: gTypeColor, flexShrink: 0 }}>
                          {gKey === "ins" ? "बीमा" : gKey.toUpperCase()}
                        </span>
                      </div>
                      {gs && <div style={{ fontSize: 11.5, fontWeight: 700, color: gs.color, marginBottom: 7 }}>{gs.icon} {gs.label}</div>}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 11.5 }}>
                        <div><span style={{ color: T.muted }}>बैंक: </span><span style={{ fontWeight: 600 }}>{g.bank || "—"}</span></div>
                        <div><span style={{ color: T.muted }}>रकम: </span><span style={{ fontWeight: 600 }}>{g.amt > 0 ? fmt(g.amt) : "—"}</span></div>
                        {hasRef && <div style={{ gridColumn: "1/-1" }}><span style={{ color: T.muted }}>जमानत नं.: </span><span style={{ fontWeight: 700, color: T.blue }}>{g.ref}</span></div>}
                        <div><span style={{ color: T.muted }}>जारी: </span><span>{g.issue || "—"}</span></div>
                        <div><span style={{ color: T.muted }}>म्याद: </span><span style={{ fontWeight: 700, color: gs ? gs.color : T.text }}>{g.expiry || "—"}</span></div>
                      </div>
                      {daysLeft !== null && (
                        <div style={{ marginTop: 7, fontSize: 11, fontWeight: 700, color: gs ? gs.color : T.muted }}>
                          {daysLeft < 0 ? `${toNP(Math.abs(daysLeft))} दिन अघि म्याद सकियो` : `${toNP(daysLeft)} दिन बाँकी`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ══════════════ FINANCE TAB ══════════════ */}
        {tab === "finance" && (
          <div className="finance-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {/* Budget vs Payment grouped bar — full width */}
            <div style={{ ...card, padding: 18, gridColumn: "1/-1" }} className="ca">
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>बजेट विरुद्ध भुक्तानी विरुद्ध दायित्व</h3>
              {(() => {
                const m = {};
                projects.forEach(p => {
                  if (!p.budgetHead) return;
                  if (!m[p.budgetHead]) m[p.budgetHead] = { b: 0, p: 0, l: 0 };
                  m[p.budgetHead].b += p.totalAmount;
                  m[p.budgetHead].p += p.paymentAmount;
                  m[p.budgetHead].l += p.liability082;
                });
                const d = Object.entries(m).filter(([, v]) => v.b > 0)
                  .map(([n, v]) => ({ name: SEC_MED[n] || n, बजेट: v.b, भुक्तानी: v.p, दायित्व: v.l }))
                  .sort((a, b) => b.बजेट - a.बजेट);
                return d.length === 0 ? <EmptyState /> : (
                  <div className="chart-scroll"><div className="chart-min" style={{ minWidth: 340 }}>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={d} margin={{ left: 0, right: 8, top: 4, bottom: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                      <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} height={55}
                        tick={{ fill: T.text, fontSize: CK.tickSm, fontFamily: CHART_FONT }} />
                      <YAxis tickFormatter={fmtS} width={46}
                        tick={{ fill: T.muted, fontSize: CK.tickSm, fontFamily: CHART_FONT }} />
                      <Tooltip content={<ChartTip />} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: CHART_FONT }} />
                      <Bar dataKey="बजेट"    fill={T.blue}   radius={[4,4,0,0]} barSize={10} />
                      <Bar dataKey="भुक्तानी" fill={T.green}  radius={[4,4,0,0]} barSize={10} />
                      <Bar dataKey="दायित्व"  fill={T.orange} radius={[4,4,0,0]} barSize={10} />
                    </BarChart>
                  </ResponsiveContainer>
                  </div></div>
                );
              })()}
            </div>

            {/* Liability analysis */}
            <div style={{ ...card, padding: 18 }} className="ca">
              <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>दायित्व विश्लेषण ०८२/०८३</h3>
              {S.liab === 0 ? <EmptyState label="दायित्व डेटा उपलब्ध छैन" /> : (
                [{ l: "कुल दायित्व", v: S.liab, c: T.red }, { l: "यस आ.व. खर्च", v: S.exp, c: T.orange }, { l: "अर्को आ.व. सर्ने", v: S.carry, c: T.blue }].map((x, i) => (
                  <div key={i} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 12 }}>
                      <span style={{ color: T.muted }}>{x.l}</span>
                      <span style={{ fontWeight: 700, color: x.c }}>{fmt(x.v)}</span>
                    </div>
                    <div style={{ height: 10, background: T.border, borderRadius: 5 }}>
                      <div style={{ height: "100%", borderRadius: 5, background: x.c, width: `${S.liab > 0 ? (x.v / S.liab) * 100 : 0}%`, transition: "width .5s" }} />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Payment efficiency donut */}
            <div className="ca" style={{ ...card, padding: 18, animationDelay: "80ms" }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: T.blue, borderBottom: `2px solid ${T.red}`, paddingBottom: 5, display: "inline-block" }}>भुक्तानी दक्षता</h3>
              {S.budget > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={[{ name: "भुक्तानी", value: S.paid }, { name: "बाँकी", value: Math.max(0, S.budget - S.paid) }]}
                        cx="50%" cy="50%" outerRadius={72} innerRadius={44} paddingAngle={3} dataKey="value" stroke="none">
                        <Cell fill={T.green} />
                        <Cell fill={T.border} />
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ textAlign: "center" }}>
                    <span style={{ fontSize: 26, fontWeight: 800, color: T.green }}>{toNP(((S.paid / S.budget) * 100).toFixed(1))}%</span>
                    <p style={{ fontSize: 11, color: T.muted, margin: "3px 0 0" }}>कुल भुक्तानी दर</p>
                  </div>
                </>
              ) : <EmptyState label="बजेट डेटा उपलब्ध छैन" />}
            </div>
          </div>
        )}

      </main>

      {/* ══════════════ DETAIL MODAL ══════════════ */}
      {sel && (
        <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,56,147,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}
          onClick={() => setSel(null)}>
          <div className="modal-box" style={{ ...card, maxWidth: 680, width: "100%", maxHeight: "90vh", overflow: "auto", padding: 24, borderTop: `4px solid ${T.red}` }}
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.blue, lineHeight: 1.3 }}>{sel.projectName}</h2>
                <p style={{ margin: "5px 0 0", fontSize: 11, color: T.muted }}>{sel.contractId || "—"} • {sel.budgetHead} • {sel.projectType}</p>
              </div>
              <button onClick={() => setSel(null)}
                style={{ background: T.sky, border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: T.blue, fontSize: 15, fontWeight: 700, flexShrink: 0, marginLeft: 12 }}>✕</button>
            </div>

            {/* Status badge */}
            <div style={{ marginBottom: 14 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: `${STATUS_COL[sel.workStatus] || "#78909C"}18`, color: STATUS_COL[sel.workStatus] || "#78909C", border: `1px solid ${STATUS_COL[sel.workStatus] || "#78909C"}40` }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COL[sel.workStatus] || "#78909C" }} />
                {sel.workStatus || "—"}
              </span>
            </div>

            {/* ── वित्तीय विश्लेषण ─────────────────────────────── */}
            {(() => {
              const ev   = sel.evaluatedAmount  || 0;
              const paid = sel.paymentAmount    || 0;
              // billingBalance = col 31 AF = eval − paid (sheet formula, exact)
              const bb   = sel.billingBalance   || 0;  // भुक्तानी हुन बाँकी (AF)
              const liab = sel.liability082     || 0;  // col 32: दायित्व = total − paid
              const exp  = sel.expense082       || 0;  // col 33: यस आ.व. खर्च
              const cry  = sel.carry083         || 0;  // col 34: सर्ने दायित्व
              const done = sel.isSampanna;
              const paidRate = sel.totalAmount > 0
                ? Math.min(100, (paid / sel.totalAmount) * 100) : 0;
              const evalRate = sel.totalAmount > 0
                ? Math.min(100, (ev / sel.totalAmount) * 100) : 0;

              // Conditions (mirror the sheet's AF formula logic)
              const noPayment   = paid === 0 && ev === 0;
              const bbPending   = bb > 0;               // eval done, payment pending (AF > 0)
              const fullyPaid   = ev > 0 && bb === 0;   // eval == paid (AF = 0)

              const FC = ({ l, v, c, bg, sub }) => (
                <div style={{ background: bg || T.white, borderRadius: 8, padding: "8px 11px" }}>
                  <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600 }}>{l}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: c || T.text }}>{v}</p>
                  {sub && <p style={{ margin: "2px 0 0", fontSize: 9.5, color: T.muted }}>{sub}</p>}
                </div>
              );
              return (
                <div style={{ marginBottom: 14 }}>
                  {/* ── ठेकेदार / मिति / रकम ── */}
                  <div className="modal-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div style={{ background: T.sky, borderRadius: 8, padding: "8px 11px", gridColumn: "1/-1" }}>
                      <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600 }}>ठेकेदार</p>
                      <p style={{ margin: "3px 0 0", fontSize: 12, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.contractor || "—"}</p>
                    </div>
                    <div style={{ background: T.sky, borderRadius: 8, padding: "8px 11px" }}>
                      <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600 }}>सम्झौता मिति</p>
                      <p style={{ margin: "3px 0 0", fontSize: 12, fontWeight: 600, color: T.text }}>{sel.agreementDate || "—"}</p>
                    </div>
                    <div style={{ background: T.sky, borderRadius: 8, padding: "8px 11px" }}>
                      <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600 }}>सम्झौता रकम</p>
                      <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: T.text }}>{fmt(sel.agreementAmount)}</p>
                    </div>
                    <div style={{ background: T.sky, borderRadius: 8, padding: "8px 11px" }}>
                      <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600 }}>कुल रकम (मूल्यसमायोजन सहित)</p>
                      <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: T.blue }}>{fmt(sel.totalAmount)}</p>
                    </div>
                  </div>

                  {/* ── भुक्तानी विवरण ── */}
                  <div style={{ border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
                    <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 800, color: T.blue }}>भुक्तानी विवरण</p>

                    {/* Dual progress: eval bar below paid bar */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: T.muted, marginBottom: 3 }}>
                        <span>मूल्यांकन ({toNP(evalRate.toFixed(1))}%)</span>
                        <span style={{ color: T.text, fontWeight: 700 }}>{ev > 0 ? fmt(ev) : "—"}</span>
                      </div>
                      <div style={{ height: 7, background: T.border, borderRadius: 4, marginBottom: 5 }}>
                        <div style={{ height: "100%", borderRadius: 4, background: T.gold, width: `${evalRate}%`, transition: "width .5s" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: T.muted, marginBottom: 3 }}>
                        <span>भुक्तानी ({toNP(paidRate.toFixed(1))}%)</span>
                        <span style={{ color: T.green, fontWeight: 700 }}>{paid > 0 ? fmt(paid) : "—"}</span>
                      </div>
                      <div style={{ height: 7, background: T.border, borderRadius: 4 }}>
                        <div style={{ height: "100%", borderRadius: 4, background: done ? T.green : T.lb, width: `${paidRate}%`, transition: "width .5s" }} />
                      </div>
                    </div>

                    {/* 3 key boxes: col 29 | col 30 | col 31 (AF) */}
                    <div className="modal-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                      <FC l="प्राविधिक मूल्यांकन"
                          v={ev > 0 ? fmt(ev) : "—"}
                          c={T.gold}
                          sub="Running Bill स्वीकृत" />
                      <FC l="भुक्तानी रकम"
                          v={paid > 0 ? fmt(paid) : "—"}
                          c={T.green}
                          sub="भुक्तानी भएको" />
                      <FC l="भुक्तानी हुन बाँकी"
                          v={bb > 0 ? fmt(bb) : "रु. ०"}
                          c={bb > 0 ? T.orange : T.green}
                          bg={bb > 0 ? "#FFF3E0" : "#E8F5E9"}
                          sub={bb > 0 ? "मूल्यांकन−भुक्तानी" : "बाँकी छैन"} />
                    </div>

                    {/* Condition badge */}
                    {bbPending && (
                      <div style={{ padding: "6px 12px", borderRadius: 7, background: "#FFF3E0", color: T.orange, fontSize: 11.5, fontWeight: 700 }}>
                        ⚠️ मूल्यांकन भएको तर भुक्तानी बाँकी — {fmt(bb)} भुक्तानी दिनुपर्छ
                      </div>
                    )}
                    {!bbPending && done && (
                      <div style={{ padding: "6px 12px", borderRadius: 7, background: "#E8F5E9", color: T.green, fontSize: 11.5, fontWeight: 700 }}>
                        ✅ भुक्तानी सम्पन्न — बाँकी रकम छैन
                      </div>
                    )}
                    {!bbPending && !done && fullyPaid && (
                      <div style={{ padding: "6px 12px", borderRadius: 7, background: "#E8F5E9", color: T.green, fontSize: 11.5, fontWeight: 700 }}>
                        ✅ मूल्यांकन रकम सम्म भुक्तानी भएको — थप काम मूल्यांकन बाँकी
                      </div>
                    )}
                    {noPayment && (
                      <div style={{ padding: "6px 12px", borderRadius: 7, background: T.sky, color: T.muted, fontSize: 11.5, fontWeight: 600 }}>
                        — अहिलेसम्म मूल्यांकन वा भुक्तानी भएको छैन
                      </div>
                    )}
                  </div>

                  {/* ── दायित्व विवरण (col 32/33/34) ── */}
                  {(liab > 0 || exp > 0 || cry > 0) && (
                    <div style={{ border: `1.5px solid #FFCDD2`, borderRadius: 10, padding: "12px 14px" }}>
                      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: T.red }}>
                        दायित्व विवरण — आ.व. ०८२/०८३
                        <span style={{ fontSize: 10, fontWeight: 400, color: T.muted, marginLeft: 8 }}>(कुल रकम − भुक्तानी)</span>
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {liab > 0 && <FC l="जम्मा दायित्व"             v={fmt(liab)} c={T.red}    sub="कुल−भुक्तानी" />}
                        {exp  > 0 && <FC l="यस आ.व. खर्च (अनुमानित)" v={fmt(exp)}  c={T.orange} sub="०८२/०८३ मा" />}
                        {cry  > 0 && <FC l="०८३/०८४ सर्ने दायित्व"     v={fmt(cry)}  c={T.muted}  sub="अर्को आ.व." />}
                        {exp > 0 && liab > 0 && (
                          <div style={{ gridColumn: "1/-1" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 10, color: T.muted }}>
                              <span>यस आ.व. खर्च अनुपात</span>
                              <span style={{ fontWeight: 700 }}>{toNP(Math.min(100,(exp/liab)*100).toFixed(0))}%</span>
                            </div>
                            <div style={{ display: "flex", height: 8, background: T.border, borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(100,(exp/liab)*100)}%`, background: T.orange }} />
                              <div style={{ flex: 1, background: "#EF9A9A" }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.muted, marginTop: 2 }}>
                              <span style={{ color: T.orange }}>■ यस आ.व. खर्च</span>
                              <span style={{ color: "#E57373" }}>■ सर्ने दायित्व</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Dates */}
            {(sel.dueDate || sel.doneDate || sel.deadlineExt) && (
              <div className="modal-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[["सम्पन्न गर्नुपर्ने", sel.dueDate], ["सम्पन्न मिति", sel.doneDate], ["म्याद थप", sel.deadlineExt]].map(([l, v]) => v ? (
                  <div key={l} style={{ background: T.sky, borderRadius: 9, padding: "8px 12px" }}>
                    <p style={{ margin: 0, fontSize: 10, color: T.muted }}>{l}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, fontWeight: 600, color: T.text }}>{v}</p>
                  </div>
                ) : null)}
              </div>
            )}

            {/* Progress */}
            <div style={{ background: T.sky, borderRadius: 11, padding: 14, marginBottom: 14 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13, color: T.blue, fontWeight: 700 }}>प्रगति</h4>
              {[
                { l: "भौतिक प्रगति",  v: sel.physicalProgress,  c: T.red  },
                { l: "आर्थिक प्रगति", v: sel.financialProgress, c: T.blue },
              ].map((b, i) => (
                <div key={i} style={{ marginBottom: i === 0 ? 12 : 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: T.muted, fontWeight: 600 }}>{b.l}</span>
                    <span style={{ fontWeight: 800, color: b.c }}>{fmtPct(b.v)}</span>
                  </div>
                  <div style={{ height: 12, background: T.border, borderRadius: 6 }}>
                    <div style={{ height: "100%", borderRadius: 6, background: `linear-gradient(90deg,${b.c},${b.c}bb)`, width: `${Math.min(b.v, 100)}%`, transition: "width .6s", boxShadow: `0 0 8px ${b.c}30` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Indicator / Achievement */}
            {(sel.indicator || sel.achievement) && (
              <div style={{ background: T.sky, borderRadius: 11, padding: 14, marginBottom: 14 }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 13, color: T.blue, fontWeight: 700 }}>उपलब्धि तथा सूचक</h4>
                {sel.indicator && (
                  <div style={{ marginBottom: sel.achievement ? 10 : 0 }}>
                    <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>सूचक (Indicator)</p>
                    <p style={{ margin: "4px 0 0", fontSize: 12.5, color: T.text, lineHeight: 1.55 }}>{sel.indicator}</p>
                  </div>
                )}
                {sel.achievement && (
                  <div>
                    <p style={{ margin: 0, fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>उपलब्धि (Achievement)</p>
                    <p style={{ margin: "4px 0 0", fontSize: 12.5, color: T.green, fontWeight: 600, lineHeight: 1.55 }}>{sel.achievement}</p>
                  </div>
                )}
              </div>
            )}

            {/* Guarantees */}
            {(
              sel.ins?.bank  !== "—" || sel.ins?.expiry  !== "—" || (sel.ins?.amt  > 0) || sel.ins?.ref  !== "—" ||
              sel.pbg?.bank  !== "—" || sel.pbg?.expiry  !== "—" || (sel.pbg?.amt  > 0) || sel.pbg?.ref  !== "—" ||
              sel.apg?.bank  !== "—" || sel.apg?.expiry  !== "—" || (sel.apg?.amt  > 0) || sel.apg?.ref  !== "—"
            ) && (
              <div>
                <h4 style={{ margin: "0 0 10px", fontSize: 13, color: T.blue, fontWeight: 700, borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>ग्यारेन्टी विवरण</h4>
                <GuaranteeBadge title="बीमा (Insurance)"                  g={sel.ins} showRef={true} />
                <GuaranteeBadge title="कार्यसम्पादन जमानत (PBG)"          g={sel.pbg} showRef={true}  />
                <GuaranteeBadge title="अग्रिम भुक्तानी जमानत (APG)"       g={sel.apg} showRef={true}  />
              </div>
            )}

          </div>
        </div>
      )}

      {/* ══════════════ FOOTER ══════════════ */}
      <footer style={{ borderTop: `2px solid ${T.red}`, marginTop: 40, background: `linear-gradient(180deg,${T.white},${T.sky})` }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "14px 20px 12px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {/* Left — org info */}
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: T.blue }}>
              इटहरी उपमहानगरपालिका — पूर्वाधार शाखा
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 10.5, color: T.muted }}>
              आ.व. {toNP("2082")}/{toNP("83")} • ठेक्का तथा योजना अनुगमन ड्यासबोर्ड
            </p>
          </div>
          {/* Right — last sync */}
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 10.5, color: T.muted, fontWeight: 600 }}>अन्तिम अद्यावधिक मिति</p>
            {lastSync ? (
              <p style={{ margin: "2px 0 0", fontSize: 11, color: T.blue, fontWeight: 700 }}>
                {(() => {
                  const d = lastSync;
                  const yy  = toNP(d.getFullYear());
                  const mm  = toNP(String(d.getMonth() + 1).padStart(2, "0"));
                  const dd  = toNP(String(d.getDate()).padStart(2, "0"));
                  let   h   = d.getHours();
                  const min = toNP(String(d.getMinutes()).padStart(2, "0"));
                  const ampm = h >= 12 ? "PM" : "AM";
                  h = h % 12 || 12;
                  return `${yy}-${mm}-${dd} • ${toNP(h)}:${min} ${ampm}`;
                })()}
              </p>
            ) : (
              <p style={{ margin: "2px 0 0", fontSize: 11, color: T.muted }}>—</p>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── tiny helper ──────────────────────────────────────────────
function EmptyState({ label = "डेटा उपलब्ध छैन" }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 0", color: "#90A4AE", fontSize: 13 }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
      {label}
    </div>
  );
}
