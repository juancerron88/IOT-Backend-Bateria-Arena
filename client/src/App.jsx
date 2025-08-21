import React, { useEffect, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceArea
} from "recharts";

// Backend base URL (desde client/.env)
const API = import.meta.env.VITE_API_BASE;

// Puedes dejar este por defecto o hacerlo editable en la UI
const DEFAULT_DEVICE_ID = "heltec-v3-01";

export default function App() {
  const [deviceId, setDeviceId] = useState(
    localStorage.getItem("deviceId") || DEFAULT_DEVICE_ID
  );
  const [token, setToken] = useState(localStorage.getItem("jwt") || "");

  const [data, setData] = useState([]);
  const [live, setLive] = useState({
    s1: NaN, s2: NaN, s3: NaN, s4: NaN,
    pv: NaN, sp: 60, h: 2,
    relays: { r1: false, r2: false },
    mode: "auto",
    ts: Date.now()
  });

  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const spRef = useRef(null);
  const hRef = useRef(null);
  const timerRef = useRef(null);

  // Visibilidad de series
  const [vis, setVis] = useState({
    pv: true, s1: true, s2: true, s3: true, s4: true, sp: true, band: true
  });
  const toggle = (k) => setVis(v => ({ ...v, [k]: !v[k] }));

  // Helpers
  const addPoint = (snap) => {
    setData(prev => {
      const next = [...prev, { time: new Date(snap.ts).toLocaleTimeString(), ...snap }];
      return next.length > 180 ? next.slice(next.length - 180) : next; // 3 min a 1 Hz
    });
  };

  const authHeaders = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  // ===== Lectura de estado =====
  const fetchStatus = async () => {
    try {
      setErr("");
      // Si tengo JWT → uso endpoint completo (incluye sensores y PV)
      if (token) {
        const res = await fetch(`${API}/api/status/${deviceId}`, {
          headers: { ...authHeaders, "Cache-Control": "no-store" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const js = await res.json();
        const last = js?.last || {};
        const snap = {
          s1: last.s1, s2: last.s2, s3: last.s3, s4: last.s4,
          pv: last.pv,
          sp: js.sp, h: js.h,
          relays: {
            r1: !!last.desiredR1,
            r2: !!last.desiredR2
          },
          mode: js.mode === "manual" ? "manual" : "auto",
          ts: last.ts ? new Date(last.ts).getTime() : Date.now(),
        };
        setLive(snap);
        addPoint(snap);
        setInfo("");
        return;
      }

      // Sin JWT → fallback (sólo SP/H/modo/relés; sin sensores)
      const res2 = await fetch(`${API}/api/thermo/status?deviceId=${encodeURIComponent(deviceId)}`, {
        cache: "no-store"
      });
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      const js2 = await res2.json();
      const snap2 = {
        s1: NaN, s2: NaN, s3: NaN, s4: NaN,
        pv: NaN,
        sp: js2.sp, h: js2.h,
        relays: { r1: !!js2.relays?.r1, r2: !!js2.relays?.r2 },
        mode: js2.mode === "manual" ? "manual" : "auto",
        ts: Date.now(),
      };
      setLive(snap2);
      addPoint(snap2);
      setInfo("Sugerencia: pega tu JWT para ver sensores y PV en vivo.");
    } catch (e) {
      setErr("No se pudo leer el estado del backend.");
      console.warn("fetchStatus failed", e);
    }
  };

  useEffect(() => {
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, token]);

  // ===== Envío de comandos (SP/H/Modo) =====
  // Requiere JWT. Se hace PATCH /api/config/:deviceId
  const patchConfig = async (patchBody) => {
    setPending(true);
    try {
      if (!token) {
        setErr("Necesitas pegar tu JWT para poder modificar la configuración.");
        return;
      }
      const res = await fetch(`${API}/api/config/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStatus();
    } catch (e) {
      console.error("PATCH /config failed", e);
      setErr("No se pudo actualizar la configuración.");
    } finally { setPending(false); }
  };

  // Cálculos para la gráfica
  const spValid = Number.isFinite(live.sp);
  const hValid  = Number.isFinite(live.h) && live.h > 0;
  const onThr   = spValid && hValid ? (live.sp - live.h/2) : null;
  const offThr  = spValid && hValid ? (live.sp + live.h/2) : null;

  return (
    <div className="wrap">
      <style>{`
        :root{ --bg:#0b1220; --panel:#111827; --muted:#94a3b8; --text:#e5e7eb; --line:#1f2937; --accent:#00c2ff; --ok:#10b981; --warn:#f59e0b; --danger:#ef4444; }
        *{ box-sizing:border-box; }
        html, body, #root { height: 100%; }
        body{ margin:0; background:linear-gradient(180deg,#0b1220,#0a0f1a); }
        .wrap{ min-height:100vh; width:100vw; padding:24px; color:var(--text); font-family: Inter, system-ui, Arial, sans-serif; }
        .row{ display:grid; gap:16px; }
        .grid4{ grid-template-columns: repeat(4, minmax(0,1fr)); }
        .grid2{ grid-template-columns: repeat(2, minmax(0,1fr)); }
        @media (max-width: 900px){ .grid4{ grid-template-columns:1fr 1fr;} }
        @media (max-width: 600px){ .grid4,.grid2{ grid-template-columns:1fr;} }
        .header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px; }
        .title{ display:flex; gap:12px; align-items:center; font-weight:600; font-size:20px; }
        .panel{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
        .kpi{ display:flex; align-items:flex-end; gap:8px; font-size:28px; font-weight:700; }
        .kpi .unit{ font-size:14px; color:var(--muted); font-weight:500; }
        .label{ color:var(--muted); font-size:12px; margin-bottom:6px; }
        .badge{ padding:2px 8px; border-radius:999px; font-size:12px; border:1px solid var(--line); color:var(--muted); }
        .badge.on{ background:#052e1e; color:#a7f3d0; border-color:#065f46; }
        .badge.off{ background:#1f2937; color:#cbd5e1; }
        .controls{ display:grid; gap:16px; }
        .field{ display:flex; gap:8px; }
        .input{ flex:1; background:#0f172a; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
        .btn{ cursor:pointer; background:#192338; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:10px 12px; font-weight:600; }
        .btn:hover{ border-color:#31425f; }
        .btn.ok{ background:#0a3a2b; border-color:#0f5132; }
        .btn.danger{ background:#3a0a0a; border-color:#512828; }
        .sensors{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
        .sensorCard{ background:#0c1426; border:1px solid var(--line); border-radius:10px; padding:12px; }
        .sensorCard .name{ color:var(--muted); font-size:12px; margin-bottom:4px; }
        .sensorCard .val{ font-size:22px; font-weight:700; }
        .err{ margin:8px 0; color:#ffb4b4; font-size:12px; }
        .info{ margin:8px 0; color:#a7f3d0; font-size:12px; }
        .checks{ display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); gap:8px; }
        @media (max-width: 900px){ .checks{ grid-template-columns:repeat(3, minmax(0,1fr)); } }
        .check{ display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); }
        .topControls{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        .small{ font-size:12px; color:#9ca3af; }
      `}</style>

      {/* Header */}
      <div className="header">
        <div className="title">
          <span style={{display:"inline-block",width:10,height:10,borderRadius:999,background:"var(--accent)"}} />
          <span>Prueba de Sensores de Temperatura Tipo K</span>
        </div>

        {/* Panel JWT + Device */}
        <div className="panel" style={{display:"flex", gap:8, alignItems:"center"}}>
          <input
            className="input"
            placeholder="Device ID"
            defaultValue={deviceId}
            onBlur={(e)=>{ const v=e.target.value.trim(); setDeviceId(v); localStorage.setItem("deviceId", v); }}
            style={{minWidth:160}}
          />
          <input
            className="input"
            placeholder="Pega tu JWT (opcional para leer sensores)"
            defaultValue={token}
            onBlur={(e)=>{ const v=e.target.value.trim(); setToken(v); localStorage.setItem("jwt", v); }}
            style={{minWidth:320}}
          />
          <button className="btn" onClick={()=>{ fetchStatus(); }}>Refrescar</button>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {info && <div className="info">{info}</div>}

      {/* KPIs */}
      <div className="row grid4">
        <div className="panel">
          <div className="label">PV (Promedio)</div>
          <div className="kpi">
            {Number.isFinite(live.pv) ? live.pv.toFixed(1) : "--"}<span className="unit">°C</span>
          </div>
        </div>
        <div className="panel">
          <div className="label">SP (Set Point)</div>
          <div className="kpi">{Number.isFinite(live.sp) ? live.sp.toFixed(1) : "--"}<span className="unit">°C</span></div>
        </div>
        <div className="panel">
          <div className="label">H (Histéresis)</div>
          <div className="kpi">{Number.isFinite(live.h) ? live.h.toFixed(1) : "--"}<span className="unit">°C</span></div>
        </div>
        <div className="panel" style={{display:"flex",alignItems:"center",gap:12}}>
          <div>Relé 1 <span className={`badge ${live.relays.r1 ? "on":"off"}`}>{live.relays.r1 ? "ON" : "OFF"}</span></div>
          <div>Relé 2 <span className={`badge ${live.relays.r2 ? "on":"off"}`}>{live.relays.r2 ? "ON" : "OFF"}</span></div>
        </div>
      </div>

      {/* Visibilidad */}
      <div className="panel" style={{marginTop:16}}>
        <div className="label" style={{marginBottom:6}}>Visibilidad</div>
        <div className="checks">
          {[
            ["PV","pv"],["S1","s1"],["S2","s2"],["S3","s3"],["S4","s4"],["SP","sp"],["Banda H","band"]
          ].map(([label,key])=>(
            <label key={key} className="check">
              <input type="checkbox" checked={vis[key]} onChange={()=>toggle(key)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="panel" style={{marginTop:16}}>
        <div className="label" style={{marginBottom:6}}>Trend en tiempo real</div>
        <div style={{height:300}}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" stroke="#94a3b8" tick={{ fill: "#94a3b8" }} />
              <YAxis stroke="#94a3b8" tick={{ fill: "#94a3b8" }} domain={["auto","auto"]} />
              <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid #1f2937", color: "#e5e7eb" }} />
              <Legend wrapperStyle={{ color: "#94a3b8" }} />

              {/* Banda de histéresis */}
              {vis.band && spValid && hValid && (
                <ReferenceArea
                  y1={onThr}
                  y2={offThr}
                  strokeOpacity={0}
                  fill="#ef4444"
                  fillOpacity={0.10}
                />
              )}

              {/* Series */}
              {vis.pv && <Line type="monotone" dataKey="pv" stroke="#22d3ee" dot={false} name="PV" />}
              {vis.s1 && <Line type="monotone" dataKey="s1" stroke="#60a5fa" dot={false} name="S1" />}
              {vis.s2 && <Line type="monotone" dataKey="s2" stroke="#34d399" dot={false} name="S2" />}
              {vis.s3 && <Line type="monotone" dataKey="s3" stroke="#fbbf24" dot={false} name="S3" />}
              {vis.s4 && <Line type="monotone" dataKey="s4" stroke="#f472b6" dot={false} name="S4" />}

              {/* Línea de Set Point */}
              {vis.sp && spValid && (
                <Line
                  type="monotone"
                  dataKey={() => live.sp}
                  stroke="#ef4444"
                  dot={false}
                  isAnimationActive={false}
                  name="SP"
                  strokeDasharray="6 3"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Controls (SP/H/Modo) */}
      <div className="row grid2" style={{marginTop:16}}>
        <div className="panel controls">
          <div className="label">Set Point (°C)</div>
          <div className="field">
            <input ref={spRef} defaultValue={live.sp} type="number" step="0.1" className="input" />
            <button className="btn" disabled={pending} onClick={()=>{
              const v = parseFloat(spRef.current.value);
              if (!Number.isFinite(v)) return;
              patchConfig({ sp: v });
            }}>Aplicar</button>
          </div>

          <div className="label">Histéresis (°C)</div>
          <div className="field">
            <input ref={hRef} defaultValue={live.h} type="number" step="0.1" className="input" />
            <button className="btn" disabled={pending} onClick={()=>{
              const v = parseFloat(hRef.current.value);
              if (!Number.isFinite(v) || v <= 0) return;
              patchConfig({ h: v });
            }}>Aplicar</button>
          </div>
        </div>

        <div className="panel" style={{display:"grid", gap:12}}>
          <div className="label">Modo</div>
          <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
            <button
              className={`btn ${live.mode==="auto"?"ok":""}`}
              disabled={pending || live.mode==="auto"}
              onClick={()=>patchConfig({ mode:"auto" })}
            >
              AUTO
            </button>
            <button
              className={`btn ${live.mode==="manual"?"ok":""}`}
              disabled={pending || live.mode==="manual"}
              onClick={()=>patchConfig({ mode:"manual" })}
            >
              MANUAL
            </button>
          </div>

          <div className="small">
            * En modo <b>AUTO</b> los relés siguen la banda SP±H/2 (con tiempos mínimos 5min ON / 3min OFF definidos en el firmware).
          </div>
        </div>
      </div>

      {/* Sensors quick view */}
      <div className="sensors" style={{marginTop:16}}>
        {[
          {k:"S1",v:live.s1}, {k:"S2",v:live.s2}, {k:"S3",v:live.s3}, {k:"S4",v:live.s4}
        ].map(s => (
          <div key={s.k} className="sensorCard">
            <div className="name">{s.k}</div>
            <div className="val">{Number.isFinite(s.v) ? s.v.toFixed(2) : "--"} °C</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{textAlign:"center", color:"var(--muted)", fontSize:12, marginTop:16}}>
        Backend: {API} · Device: {deviceId} · 1 Hz
      </div>
    </div>
  );
}
