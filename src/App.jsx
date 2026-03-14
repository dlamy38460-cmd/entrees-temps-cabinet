import { useState, useRef, useEffect } from "react";

// ─── Constantes ───────────────────────────────────────────────────────────────
const STORAGE_KEY    = "je-entries-v2";
const AVOCATS_KEY    = "je-avocats-v2";
const CONFIG_KEY     = "je-config-v2";
const TODAY          = () => new Date().toISOString().split("T")[0];
const GOLD           = "#C9A84C";
const GOLD_DIM       = "rgba(201,168,76,0.15)";
const BG             = "#0D1117";
const CARD           = "rgba(255,255,255,0.035)";
const BORDER         = "rgba(201,168,76,0.18)";

const DEFAULT_AVOCATS = [
  "Me Dupont",
  "Me Tremblay",
  "Me Leblanc",
  "Me Gagnon",
  "Me Roy",
];

// ─── Utilitaires ──────────────────────────────────────────────────────────────
const fmt     = (n) => (isNaN(n) ? "0.00" : parseFloat(n).toFixed(2));
const montant = (e) => fmt(parseFloat(e.tauxHoraire || 0) * parseFloat(e.heures || 0));
const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ─── Composant principal ──────────────────────────────────────────────────────
export default function App() {
  const [view,        setView]        = useState("saisie");
  const [entries,     setEntries]     = useState([]);
  const [avocats,     setAvocats]     = useState(DEFAULT_AVOCATS);
  const [config,      setConfig]      = useState({ email: "", jurisUrl: "", jurisToken: "" });
  const [status,      setStatus]      = useState({ msg: "", type: "ok" });
  const [form,        setForm]        = useState({
    avocat: "", dossier: "", date: TODAY(),
    tauxHoraire: "", heures: "", description: "",
  });
  const [listening,   setListening]   = useState(false);
  const [activeField, setActiveField] = useState(null);
  const [liveText,    setLiveText]    = useState("");
  const [aiLoading,   setAiLoading]   = useState(false);
  const [newAvocat,   setNewAvocat]   = useState("");
  const [filterAv,    setFilterAv]    = useState("tous");
  const [filterDate,  setFilterDate]  = useState("");

  const recRef = useRef(null);
  const stRef  = useRef(null);

  // ─── Chargement initial ───────────────────────────────────────────────────
  useEffect(() => {
    try {
      const e = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const a = JSON.parse(localStorage.getItem(AVOCATS_KEY) || JSON.stringify(DEFAULT_AVOCATS));
      const c = JSON.parse(localStorage.getItem(CONFIG_KEY)  || "{}");
      setEntries(e);
      setAvocats(a);
      setConfig(x => ({ ...x, ...c }));
      if (a.length) setForm(f => ({ ...f, avocat: a[0] }));
    } catch {}
  }, []);

  // ─── Persistance ─────────────────────────────────────────────────────────
  const saveEntries = (u) => { setEntries(u); localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); };
  const saveAvocats = (a) => { setAvocats(a); localStorage.setItem(AVOCATS_KEY, JSON.stringify(a)); };
  const saveConfig  = (c) => { setConfig(c);  localStorage.setItem(CONFIG_KEY,  JSON.stringify(c)); };

  // ─── Toast ────────────────────────────────────────────────────────────────
  const toast = (msg, type = "ok", ms = 3500) => {
    setStatus({ msg, type });
    clearTimeout(stRef.current);
    stRef.current = setTimeout(() => setStatus({ msg: "", type: "ok" }), ms);
  };

  // ─── Reconnaissance vocale champ par champ ────────────────────────────────
  const SR = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const startVoice = (field) => {
    if (!SR) { toast("Reconnaissance vocale non disponible sur ce navigateur", "warn"); return; }
    recRef.current?.abort();
    const rec = new SR();
    rec.lang            = "fr-CA";
    rec.continuous      = false;
    rec.interimResults  = true;

    rec.onstart  = () => { setListening(true); setActiveField(field); setLiveText(""); };
    rec.onresult = (ev) => {
      const t = Array.from(ev.results).map(r => r[0].transcript).join("");
      setLiveText(t);
      if (ev.results[ev.results.length - 1].isFinal) {
        setForm(f => ({
          ...f,
          [field]: field === "description"
            ? (f.description ? f.description + " " + t : t)
            : t.trim(),
        }));
        setListening(false); setActiveField(null); setLiveText("");
      }
    };
    rec.onerror = rec.onend = () => { setListening(false); setActiveField(null); };
    recRef.current = rec;
    rec.start();
  };

  // ─── Dictée complète IA ───────────────────────────────────────────────────
  const liveRef = useRef("");

  const startDicteeIA = () => {
    if (!SR) { toast("Reconnaissance vocale non disponible", "warn"); return; }
    recRef.current?.abort();
    liveRef.current = "";
    const rec = new SR();
    rec.lang           = "fr-CA";
    rec.continuous     = false;
    rec.interimResults = true;

    rec.onstart  = () => { setListening(true); setActiveField("ia"); setLiveText(""); };
    rec.onresult = (ev) => {
      const t = Array.from(ev.results).map(r => r[0].transcript).join("");
      liveRef.current = t;
      setLiveText(t);
    };
    rec.onend = async () => {
      setListening(false); setActiveField(null);
      const texte = liveRef.current;
      if (!texte.trim()) return;
      setAiLoading(true);
      toast("🤖 Analyse IA en cours…", "ok", 10000);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 600,
            messages: [{
              role: "user",
              content: `Tu es un assistant pour un cabinet d'avocats québécois.
Extrait les informations de cette dictée: "${texte}"

Réponds UNIQUEMENT avec ce JSON valide (sans markdown ni backticks):
{"dossier":"","date":"${TODAY()}","tauxHoraire":"","heures":"","description":""}

Règles:
- date: format YYYY-MM-DD, aujourd'hui si non mentionnée
- tauxHoraire: nombre seulement (ex: 300)
- heures: décimal (ex: 1.5 pour 1h30, 0.25 pour 15 minutes)
- description: travail juridique réalisé, phraser de façon professionnelle`,
            }],
          }),
        });
        const data = await res.json();
        const raw  = data.content.map(b => b.text || "").join("").trim()
          .replace(/```json|```/g, "").trim();
        const p = JSON.parse(raw);
        setForm(f => ({
          ...f,
          dossier:     p.dossier     || f.dossier,
          date:        p.date        || f.date,
          tauxHoraire: p.tauxHoraire || f.tauxHoraire,
          heures:      p.heures      || f.heures,
          description: p.description || f.description,
        }));
        toast("✅ Champs remplis automatiquement — vérifiez et sauvegardez", "ok");
      } catch {
        toast("⚠️ Erreur d'analyse — remplissez manuellement", "warn");
      }
      setAiLoading(false);
      setLiveText("");
    };
    recRef.current = rec;
    rec.start();
  };

  // ─── Sauvegarder une entrée ───────────────────────────────────────────────
  const sauvegarder = async () => {
    if (!form.dossier || !form.heures || !form.description) {
      toast("⚠️ Champs obligatoires : Dossier, Heures et Description", "warn");
      return;
    }
    const entry = { ...form, id: Date.now(), createdAt: new Date().toISOString() };
    saveEntries([entry, ...entries]);

    // Envoi vers Juris Évolution si configuré
    if (config.jurisUrl && config.jurisToken) {
      try {
        await fetch(`${config.jurisUrl}/api/temps`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.jurisToken}`,
          },
          body: JSON.stringify({
            numeroDossier: entry.dossier,
            date:          entry.date,
            heures:        parseFloat(entry.heures),
            tauxHoraire:   parseFloat(entry.tauxHoraire),
            description:   entry.description,
            avocat:        entry.avocat,
          }),
        });
        toast("✅ Entrée sauvegardée et envoyée à Juris Évolution !", "ok");
      } catch {
        toast("✅ Entrée sauvegardée (Juris Évolution hors ligne)", "ok");
      }
    } else {
      toast("✅ Entrée sauvegardée avec succès", "ok");
    }

    setForm(f => ({
      avocat: f.avocat,
      dossier: "",
      date: TODAY(),
      tauxHoraire: f.tauxHoraire,
      heures: "",
      description: "",
    }));
  };

  // ─── Export CSV ───────────────────────────────────────────────────────────
  const exportCSV = (date) => {
    const list = entries.filter(e => !date || e.date === date);
    if (!list.length) { toast("Aucune entrée à exporter pour cette période", "warn"); return; }
    const hdr  = ["Avocat", "Dossier", "Date", "Taux horaire ($)", "Heures", "Montant ($)", "Description"];
    const rows = list.map(e => [
      e.avocat, e.dossier, e.date,
      e.tauxHoraire, e.heures, montant(e),
      `"${(e.description || "").replace(/"/g, '""')}"`,
    ]);
    const csv  = "\uFEFF" + [hdr, ...rows].map(r => r.join(",")).join("\r\n");
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })),
      download: `entrees-temps-${date || "complet"}.csv`,
    });
    a.click();
    toast(`✅ CSV exporté (${list.length} entrée${list.length > 1 ? "s" : ""})`);
  };

  // ─── Données filtrées ─────────────────────────────────────────────────────
  const filtered     = entries.filter(e =>
    (filterAv === "tous" || e.avocat === filterAv) &&
    (!filterDate || e.date === filterDate)
  );
  const todayEntries = entries.filter(e => e.date === TODAY());
  const totalH       = todayEntries.reduce((s, e) => s + parseFloat(e.heures || 0), 0);
  const totalM       = todayEntries.reduce((s, e) => s + parseFloat(montant(e)), 0);

  // ─── Styles ───────────────────────────────────────────────────────────────
  const inp = {
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${BORDER}`,
    borderRadius: 7,
    padding: "10px 13px",
    color: "#e8dfc8",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
  const btnPrimary = {
    background: `linear-gradient(135deg,${GOLD},#a8842a)`,
    color: "#0D1117",
    border: "none",
    borderRadius: 8,
    padding: "11px 22px",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "inherit",
    fontWeight: 700,
  };
  const btnSec = {
    background: "rgba(255,255,255,0.06)",
    color: "#e8dfc8",
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    padding: "11px 22px",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "inherit",
  };
  const labelStyle = {
    display: "block",
    fontSize: 11,
    color: GOLD,
    letterSpacing: "1.2px",
    marginBottom: 6,
    textTransform: "uppercase",
  };

  // ─── Micro bouton ─────────────────────────────────────────────────────────
  const VoiceBtn = ({ field }) => (
    <button
      onClick={() =>
        listening && activeField === field
          ? recRef.current?.abort()
          : startVoice(field)
      }
      style={{
        background: listening && activeField === field ? "#ef4444" : GOLD_DIM,
        color:      listening && activeField === field ? "#fff"    : GOLD,
        border:     `1px solid ${BORDER}`,
        borderRadius: 6,
        padding: "8px 11px",
        cursor: "pointer",
        fontSize: 16,
        flexShrink: 0,
      }}
      title="Saisie vocale"
    >
      {listening && activeField === field ? "⏹" : "🎙️"}
    </button>
  );

  // ─── Rendu ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: BG,
      color: "#e8dfc8",
      fontFamily: "'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif",
    }}>
      <link
        href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap"
        rel="stylesheet"
      />

      {/* ── EN-TÊTE ────────────────────────────────────────────────────────── */}
      <header style={{
        background: "rgba(0,0,0,0.55)",
        borderBottom: `1px solid ${BORDER}`,
        backdropFilter: "blur(14px)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 60,
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div>
          <span style={{ fontFamily: "'EB Garamond',serif", fontSize: 19, color: GOLD, letterSpacing: 2 }}>
            ⚖ ENTRÉES DE TEMPS
          </span>
          <span style={{ fontSize: 11, color: "rgba(201,168,76,.4)", marginLeft: 12, letterSpacing: 1 }}>
            Juris Évolution · Cabinet
          </span>
        </div>
        <nav style={{ display: "flex", gap: 6 }}>
          {[["saisie", "✏️ Saisie"], ["historique", "📋 Historique"], ["config", "⚙️ Config"]].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: view === v ? GOLD : "transparent",
                color:      view === v ? "#0D1117" : "rgba(201,168,76,.7)",
                border:     `1px solid ${view === v ? GOLD : BORDER}`,
                borderRadius: 6,
                padding: "6px 14px",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >{l}</button>
          ))}
        </nav>
      </header>

      {/* ── TOAST ──────────────────────────────────────────────────────────── */}
      {status.msg && (
        <div style={{
          background:   status.type === "warn" ? "rgba(239,68,68,.15)" : GOLD_DIM,
          borderBottom: `1px solid ${status.type === "warn" ? "rgba(239,68,68,.35)" : BORDER}`,
          color:        status.type === "warn" ? "#fca5a5" : GOLD,
          padding: "9px 24px",
          fontSize: 13,
          textAlign: "center",
        }}>{status.msg}</div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          VUE SAISIE
      ══════════════════════════════════════════════════════════════════════ */}
      {view === "saisie" && (
        <main style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px" }}>

          {/* Résumé du jour */}
          {todayEntries.length > 0 && (
            <div style={{
              background: GOLD_DIM,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "12px 18px",
              marginBottom: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}>
              <span style={{ color: GOLD, fontFamily: "'EB Garamond',serif", fontSize: 17 }}>
                Aujourd'hui &nbsp;·&nbsp; {todayEntries.length} entrée{todayEntries.length > 1 ? "s" : ""}&nbsp;
                ·&nbsp; {totalH.toFixed(1)}h &nbsp;·&nbsp; <strong>${fmt(totalM)}</strong>
              </span>
              <button onClick={() => exportCSV(TODAY())} style={{ ...btnSec, fontSize: 12, padding: "7px 14px" }}>
                📊 Exporter aujourd'hui (CSV)
              </button>
            </div>
          )}

          {/* Bouton dictée IA */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <button
              onClick={startDicteeIA}
              disabled={listening || aiLoading}
              style={{
                background: listening && activeField === "ia"
                  ? "rgba(239,68,68,.25)"
                  : `linear-gradient(135deg,${GOLD},#a8842a)`,
                color:  listening && activeField === "ia" ? "#fca5a5" : "#0D1117",
                border: "none",
                borderRadius: 50,
                padding: "14px 40px",
                fontSize: 16,
                fontFamily: "'EB Garamond',serif",
                fontWeight: 600,
                cursor: listening || aiLoading ? "default" : "pointer",
                boxShadow: `0 4px 24px rgba(201,168,76,.25)`,
                letterSpacing: 1,
              }}
            >
              {aiLoading
                ? "🤖 Analyse en cours…"
                : listening && activeField === "ia"
                  ? "🔴 Dictez votre entrée…"
                  : "🎙️  DICTÉE COMPLÈTE — INTELLIGENTE"}
            </button>
            <div style={{ fontSize: 11, color: "rgba(232,224,208,.35)", marginTop: 7 }}>
              Dites par ex. « Dossier 2024-001, deux heures, taux trois cents, révision du contrat de vente »
            </div>
            {(listening && activeField === "ia") || liveText ? (
              <div style={{
                background: "rgba(0,0,0,.3)",
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                padding: "10px 16px",
                marginTop: 12,
                fontSize: 13,
                fontStyle: "italic",
                color: "rgba(232,224,208,.6)",
                maxWidth: 560,
                margin: "12px auto 0",
              }}>
                « {liveText || "…"} »
              </div>
            ) : null}
          </div>

          {/* Formulaire */}
          <div style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 24,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>

              {/* Avocat */}
              <div>
                <label style={labelStyle}>👤 Avocat</label>
                <select
                  value={form.avocat}
                  onChange={e => setForm(f => ({ ...f, avocat: e.target.value }))}
                  style={inp}
                >
                  {avocats.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* N° Dossier */}
              <div>
                <label style={labelStyle}>📁 N° Dossier *</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={form.dossier}
                    onChange={e => setForm(f => ({ ...f, dossier: e.target.value }))}
                    placeholder="Ex: 2024-001"
                    style={inp}
                  />
                  <VoiceBtn field="dossier" />
                </div>
                {listening && activeField === "dossier" && (
                  <div style={{ fontSize: 11, color: GOLD, marginTop: 4, fontStyle: "italic" }}>
                    🔴 {liveText || "Écoute…"}
                  </div>
                )}
              </div>

              {/* Date */}
              <div>
                <label style={labelStyle}>📅 Date *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  style={inp}
                />
              </div>

              {/* Taux horaire */}
              <div>
                <label style={labelStyle}>💰 Taux horaire ($/h)</label>
                <input
                  type="number"
                  value={form.tauxHoraire}
                  onChange={e => setForm(f => ({ ...f, tauxHoraire: e.target.value }))}
                  placeholder="Ex: 300"
                  style={inp}
                />
              </div>

              {/* Heures */}
              <div>
                <label style={labelStyle}>⏱ Heures *</label>
                <input
                  type="number"
                  step="0.25"
                  value={form.heures}
                  onChange={e => setForm(f => ({ ...f, heures: e.target.value }))}
                  placeholder="Ex: 1.5"
                  style={inp}
                />
              </div>

              {/* Montant calculé */}
              <div>
                <label style={labelStyle}>💵 Montant calculé</label>
                <div style={{
                  ...inp,
                  color: GOLD,
                  fontWeight: 700,
                  fontSize: 20,
                  borderColor: GOLD_DIM,
                  width: "auto",
                }}>
                  {form.tauxHoraire && form.heures
                    ? `$${fmt(parseFloat(form.tauxHoraire) * parseFloat(form.heures))}`
                    : "—"}
                </div>
              </div>
            </div>

            {/* Description */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>📝 Description du travail *</label>
              <div style={{ display: "flex", gap: 6 }}>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Ex: Rédaction du contrat de vente d'immeuble, révision des clauses de garantie…"
                  rows={3}
                  style={{ ...inp, resize: "vertical", lineHeight: 1.55 }}
                />
                <VoiceBtn field="description" />
              </div>
              {listening && activeField === "description" && (
                <div style={{ fontSize: 11, color: GOLD, marginTop: 4, fontStyle: "italic" }}>
                  🔴 {liveText || "Écoute…"}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={sauvegarder} style={{ ...btnPrimary, flex: 1, fontSize: 15, padding: 13 }}>
                ✅ SAUVEGARDER L'ENTRÉE
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, dossier: "", heures: "", description: "" }))}
                style={btnSec}
              >
                🗑 Effacer
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          VUE HISTORIQUE
      ══════════════════════════════════════════════════════════════════════ */}
      {view === "historique" && (
        <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>

          {/* Filtres */}
          <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ ...labelStyle, display: "block", marginBottom: 4 }}>Avocat</label>
              <select
                value={filterAv}
                onChange={e => setFilterAv(e.target.value)}
                style={{ ...inp, width: 180 }}
              >
                <option value="tous">Tous les avocats</option>
                {avocats.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={{ ...labelStyle, display: "block", marginBottom: 4 }}>Date</label>
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                style={{ ...inp, width: 170 }}
              />
            </div>
            <button onClick={() => { setFilterAv("tous"); setFilterDate(""); }} style={{ ...btnSec, fontSize: 12, padding: "8px 14px" }}>
              Réinitialiser
            </button>
            <button onClick={() => exportCSV(filterDate || undefined)} style={{ ...btnPrimary, padding: "8px 16px", fontSize: 12 }}>
              📊 Exporter la sélection (CSV)
            </button>
          </div>

          {/* Totaux sélection */}
          {filtered.length > 0 && (
            <div style={{
              background: GOLD_DIM,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: "10px 16px",
              marginBottom: 14,
              fontSize: 13,
              color: GOLD,
            }}>
              {filtered.length} entrée{filtered.length > 1 ? "s" : ""}&nbsp;·&nbsp;
              {filtered.reduce((s, e) => s + parseFloat(e.heures || 0), 0).toFixed(1)}h&nbsp;·&nbsp;
              <strong>${fmt(filtered.reduce((s, e) => s + parseFloat(montant(e)), 0))}</strong>
            </div>
          )}

          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", color: "rgba(232,224,208,.2)", padding: 60, fontSize: 20 }}>
              Aucune entrée
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map(e => (
                <div key={e.id} style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 9,
                  padding: "13px 16px",
                  display: "grid",
                  gridTemplateColumns: "90px 110px 1fr 58px 88px 34px",
                  gap: 10,
                  alignItems: "center",
                }}>
                  <div style={{
                    background: GOLD_DIM,
                    borderRadius: 6,
                    padding: "4px 8px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 9, color: "rgba(201,168,76,.5)", letterSpacing: 1 }}>DOSSIER</div>
                    <div style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>{e.dossier}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(232,224,208,.45)", lineHeight: 1.6 }}>
                    <div>{e.avocat}</div>
                    <div>{fmtDate(e.date)}</div>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>{e.description}</div>
                  <div style={{ textAlign: "right", fontSize: 13, color: "rgba(232,224,208,.5)" }}>
                    {e.heures}h
                  </div>
                  <div style={{ textAlign: "right", color: GOLD, fontWeight: 700 }}>
                    ${montant(e)}
                  </div>
                  <button
                    onClick={() => saveEntries(entries.filter(x => x.id !== e.id))}
                    style={{
                      background: "rgba(239,68,68,.12)",
                      color: "#fca5a5",
                      border: "1px solid rgba(239,68,68,.22)",
                      borderRadius: 6,
                      padding: "5px 8px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          VUE CONFIG
      ══════════════════════════════════════════════════════════════════════ */}
      {view === "config" && (
        <main style={{ maxWidth: 660, margin: "0 auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Gestion des avocats */}
          <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 22 }}>
            <h3 style={{ color: GOLD, fontFamily: "'EB Garamond',serif", fontWeight: 400, margin: "0 0 14px", fontSize: 18 }}>
              👤 Gestion des avocats
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {avocats.map(a => (
                <span key={a} style={{
                  background: GOLD_DIM,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 20,
                  padding: "5px 14px",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}>
                  {a}
                  <button
                    onClick={() => saveAvocats(avocats.filter(x => x !== a))}
                    style={{ background: "none", border: "none", color: "rgba(232,224,208,.4)", cursor: "pointer", fontSize: 14, padding: 0 }}
                  >✕</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newAvocat}
                onChange={e => setNewAvocat(e.target.value)}
                placeholder="Me Nom Prénom"
                style={{ ...inp, flex: 1 }}
                onKeyDown={e => {
                  if (e.key === "Enter" && newAvocat.trim()) {
                    saveAvocats([...avocats, newAvocat.trim()]);
                    setNewAvocat("");
                  }
                }}
              />
              <button
                onClick={() => {
                  if (newAvocat.trim()) {
                    saveAvocats([...avocats, newAvocat.trim()]);
                    setNewAvocat("");
                  }
                }}
                style={btnPrimary}
              >Ajouter</button>
            </div>
          </section>

          {/* Envoi courriel */}
          <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 22 }}>
            <h3 style={{ color: GOLD, fontFamily: "'EB Garamond',serif", fontWeight: 400, margin: "0 0 6px", fontSize: 18 }}>
              📧 Envoi automatique par courriel à 20h
            </h3>
            <p style={{ fontSize: 12, color: "rgba(232,224,208,.4)", margin: "0 0 14px", lineHeight: 1.65 }}>
              Configurez un scénario Make.com ou Zapier pour envoyer automatiquement le CSV chaque soir.
              Entrez l'adresse courriel de destination ci-dessous et transmettez cette info à votre IT.
            </p>
            <label style={labelStyle}>Adresse courriel de destination</label>
            <input
              value={config.email}
              onChange={e => setConfig(c => ({ ...c, email: e.target.value }))}
              placeholder="comptabilite@cabinet.com"
              style={{ ...inp, marginBottom: 12 }}
            />
            <button onClick={() => { saveConfig(config); toast("✅ Configuration sauvegardée"); }} style={btnPrimary}>
              Sauvegarder
            </button>
          </section>

          {/* Juris Évolution */}
          <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 22 }}>
            <h3 style={{ color: GOLD, fontFamily: "'EB Garamond',serif", fontWeight: 400, margin: "0 0 6px", fontSize: 18 }}>
              🔗 Intégration Juris Évolution
            </h3>
            <div style={{
              background: "rgba(201,168,76,.07)",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 16,
              fontSize: 12,
              lineHeight: 1.75,
              color: "rgba(232,224,208,.6)",
            }}>
              <strong style={{ color: GOLD }}>Comment activer l'API Juris Évolution :</strong><br />
              1. Appelez Juris Concept : <strong style={{ color: "#e8dfc8" }}>1-800-363-8304</strong><br />
              2. Demandez l'activation du <strong style={{ color: "#e8dfc8" }}>module API / intégration tierce</strong><br />
              3. Obtenez votre URL de serveur et votre jeton d'accès<br />
              4. Entrez ces informations ci-dessous — les entrées seront envoyées automatiquement à chaque sauvegarde
            </div>
            <label style={labelStyle}>URL du serveur Juris Évolution</label>
            <input
              value={config.jurisUrl}
              onChange={e => setConfig(c => ({ ...c, jurisUrl: e.target.value }))}
              placeholder="https://votrecabinet.jurisconcept.ca"
              style={{ ...inp, marginBottom: 14 }}
            />
            <label style={labelStyle}>Jeton d'authentification (Bearer Token)</label>
            <input
              type="password"
              value={config.jurisToken}
              onChange={e => setConfig(c => ({ ...c, jurisToken: e.target.value }))}
              placeholder="eyJhbGci…"
              style={{ ...inp, marginBottom: 14 }}
            />
            <button onClick={() => { saveConfig(config); toast("✅ Configuration Juris sauvegardée"); }} style={btnPrimary}>
              Sauvegarder
            </button>
          </section>

          {/* Danger zone */}
          <section style={{ background: CARD, border: "1px solid rgba(239,68,68,.18)", borderRadius: 12, padding: 20 }}>
            <h3 style={{ color: "#fca5a5", fontWeight: 400, margin: "0 0 12px", fontSize: 16 }}>
              🗑 Zone de danger
            </h3>
            <button
              onClick={() => {
                if (confirm("Supprimer toutes les entrées ? Cette action est irréversible.")) {
                  saveEntries([]);
                  toast("Toutes les entrées ont été supprimées", "warn");
                }
              }}
              style={{
                background: "rgba(239,68,68,.12)",
                color: "#fca5a5",
                border: "1px solid rgba(239,68,68,.22)",
                borderRadius: 7,
                padding: "9px 20px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Supprimer toutes les entrées
            </button>
          </section>
        </main>
      )}
    </div>
  );
}
