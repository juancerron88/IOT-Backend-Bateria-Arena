import React, { useEffect, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceArea
} from "recharts";

// ⚙️ URL del backend tomada desde client/.env
// Ej: VITE_API_BASE=http://localhost:4000  (en desarrollo)
//     VITE_API_BASE=https://tu-backend.onrender.com  (en producción)
const baseURL = import.meta.env.VITE_API_BASE;

export default function App() {
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
  const spRef = useRef(null);
  const hRef = useRef(null);
  const timerRef = useRef(null);

  // Visibilidad de series
  const [vis, setVis] = useState({
    pv: true, s1: true, s2: true, s3: true, s4: true, sp: true, band: true
  });
  const toggle = (k) => setVis(v => ({ ...v, [k]: !v[k] }));

  const addPoint = (snap) => {
    setData(prev => {
      const next = [...prev, { time: new Date(snap.ts).toLocaleTimeString(), ...snap }];
      return next.length > 180 ? next.slice(next.length - 180) : next; // 3 min a 1 Hz
    });
  };

  // ===== Lectura de estado desde backend local (compat) =====
  const fetchStatus = async () => {
    try {
      setErr("");
      const res = await fetch(`${baseURL}/api/thermo/status`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const js = await res.json();
      const snap = {
        s1: js.s1, s2: js.s2, s3: js.s3, s4: js.s4,
        pv: js.pv, sp: js.sp, h: js.h,
        relays: { r1: !!js.relays?.r1, r2: !!js.relays?.r2 },
        mode: js.mode === "manual" ? "manual" : "auto",
        ts: js.ts || Date.now(),
      };
      setLive(snap);
      addPoint(snap);
    } catch (e) {
      setErr("No se pudo leer /api/thermo/status");
      console.warn("/status failed", e);
    }
  };

  useEffect(() => {
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ===== Envío de comandos al backend local (compat) =====
  const postCmd = async (body) => {
    setPending(true);
    try {
      const res = await fetch(`${baseURL}/api/thermo/cmd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStatus();
    } catch (e) {
      console.error("/cmd failed", e);
      setErr("No se pudo enviar comando /api/thermo/cmd");
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
        .checks{ display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); gap:8px; }
        @media (max-width: 900px){ .checks{ grid-template-columns:repeat(3, minmax(0,1fr)); } }
        .check{ display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); }
      `}</style>

      {/* Header */}
      <div className="header">
        <div className="title">
          <span style={{display:"inline-block",width:10,height:10,borderRadius:999,background:"var(--accent)"}} />
          <span>Prueba de Sensores de Temperatura Tipo K</span>
        </div>

        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <span className="label">Modo:&nbsp;</span>
          <span className={`badge ${live.mode === "auto" ? "on":"off"}`}>
            {live.mode === "auto" ? "AUTO" : "MANUAL"}
          </span>
          <button
            className="btn"
            disabled={pending}
            style={{marginLeft:8}}
            onClick={() => {
              const next = live.mode === "auto" ? "manual" : "auto";
              postCmd({ mode: next });
            }}
          >
            Cambiar a {live.mode === "auto" ? "MANUAL" : "AUTO"}
          </button>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

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

      {/* Controls */}
      <div className="row grid2" style={{marginTop:16}}>
        <div className="panel controls">
          <div className="label">Set Point (°C)</div>
          <div className="field">
            <input ref={spRef} defaultValue={live.sp} type="number" step="0.1" className="input" />
            <button className="btn" disabled={pending} onClick={()=>{
              const v = parseFloat(spRef.current.value);
              if (!Number.isFinite(v)) return;
              postCmd({ sp: v });
            }}>Aplicar</button>
          </div>

          <div className="label">Histéresis (°C)</div>
          <div className="field">
            <input ref={hRef} defaultValue={live.h} type="number" step="0.1" className="input" />
            <button className="btn" disabled={pending} onClick={()=>{
              const v = parseFloat(hRef.current.value);
              if (!Number.isFinite(v) || v <= 0) return;
              postCmd({ h: v });
            }}>Aplicar</button>
          </div>
        </div>

        <div className="panel" style={{display:"grid", gap:12}}>
          <div style={{display:"flex", gap:8}}>
            <button className="btn ok" disabled={pending} onClick={()=>postCmd({ r1:true })}>R1 ON</button>
            <button className="btn danger" disabled={pending} onClick={()=>postCmd({ r1:false })}>R1 OFF</button>
          </div>
          <div style={{display:"flex", gap:8}}>
            <button className="btn ok" disabled={pending} onClick={()=>postCmd({ r2:true })}>R2 ON</button>
            <button className="btn danger" disabled={pending} onClick={()=>postCmd({ r2:false })}>R2 OFF</button>
          </div>
          <div style={{display:"flex", gap:8}}>
            <button className="btn" disabled={pending} onClick={()=>postCmd({ allOn:true })}>ALL ON</button>
            <button className="btn" disabled={pending} onClick={()=>postCmd({ allOff:true })}>ALL OFF</button>
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
        Backend: {baseURL} · 1 Hz
      </div>
    </div>
  );
}
