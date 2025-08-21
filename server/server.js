// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Papa from "papaparse";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

/* -------------------- CORS (multi‑origen, preflight) -------------------- */
function parseOrigins(str) {
  if (!str || str === "*") return "*";
  return String(str)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}
const allowedOrigins = parseOrigins(process.env.CORS_ORIGIN);

// Si es "*", permitimos todo. Si es lista, validamos cada request.
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / firmware
    if (allowedOrigins === "*" || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked: ${origin}`), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "x-device-token"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // preflight

/* ----------------------------- Middlewares ------------------------------ */
app.set("trust proxy", 1); // Render/Reverse proxy
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

/* --------------------------- Conexión a Mongo --------------------------- */
try {
  await mongoose.connect(process.env.MONGO_URI, { dbName: "onoff" });
  console.log("✅ MongoDB conectado");
} catch (err) {
  console.error("❌ Error conectando a MongoDB:", err?.message || err);
  process.exit(1);
}

/* -------------------------------- Schemas -------------------------------- */
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, enum: ["admin", "viewer"], default: "viewer" }
});

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, unique: true },
  name: String,
  token: String,
  enabled: { type: Boolean, default: true }
});

const ConfigSchema = new mongoose.Schema({
  deviceId: { type: String, unique: true },
  sp: { type: Number, default: 60 },
  h:  { type: Number, default: 2 },
  mode: { type: String, enum: ["auto", "manual"], default: "auto" }
}, { timestamps: true });

const ReadingSchema = new mongoose.Schema({
  deviceId: String,
  s1: Number, s2: Number, s3: Number, s4: Number,
  pv: Number,
  desiredR1: Boolean, desiredR2: Boolean,
  r1: Boolean, r2: Boolean, // opcional: estado físico final si quieres guardarlo
  ts: { type: Date, default: Date.now }
}, { timestamps: true });
ReadingSchema.index({ deviceId: 1, ts: -1 });

const User   = mongoose.model("User", UserSchema);
const Device = mongoose.model("Device", DeviceSchema);
const Config = mongoose.model("Config", ConfigSchema);
const Reading= mongoose.model("Reading", ReadingSchema);

/* ------------------------------- Utils/Auth ------------------------------ */
const clamp = (n,a,b)=>Math.min(Math.max(n,a),b);
const signJWT = (p,exp="7d") => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: exp });
const verifyJWT = (t)=> jwt.verify(t, process.env.JWT_SECRET);

function userAuth(req,res,next){
  const h = req.header("authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).send("No token");
  try { req.user = verifyJWT(t); next(); }
  catch { return res.status(401).send("Invalid token"); }
}

async function deviceAuth(req,res,next){
  const tok = req.header("x-device-token");
  if (!tok) return res.status(401).send("No device token");
  const dev = await Device.findOne({ token: tok, enabled: true });
  if (!dev) return res.status(403).send("Forbidden");
  req.device = dev; next();
}

/* ------------------------------- Rutas API ------------------------------- */
// Seed admin (ejecutar una sola vez)
app.post("/api/seed/admin", async (req,res)=>{
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:"email/password" });
  const exists = await User.findOne({ email });
  if (exists) return res.json({ ok:true, note:"user exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ email, passwordHash, role: "admin" });
  res.json({ ok:true });
});

// Auth usuarios
app.post("/api/auth/login", async (req,res)=>{
  const { email, password } = req.body || {};
  const u = await User.findOne({ email });
  if (!u) return res.status(401).send("Bad creds");
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).send("Bad creds");
  const token = signJWT({ uid: u._id, email: u.email, role: u.role });
  res.json({ token, role: u.role });
});

// Dispositivos (admin)
app.post("/api/devices", userAuth, async (req,res)=>{
  if (req.user.role !== "admin") return res.sendStatus(403);
  const { deviceId, name, token } = req.body || {};
  if (!deviceId || !token) return res.status(400).json({ ok:false, error:"deviceId & token required" });
  const dev = await Device.create({ deviceId, name, token });
  await Config.create({ deviceId }); // config por defecto
  res.status(201).json(dev);
});
app.get("/api/devices", userAuth, async (req,res)=> {
  const list = await Device.find().lean();
  res.json(list);
});

// Status para dashboard (usuarios autenticados)
app.get("/api/status/:deviceId", userAuth, async (req,res)=>{
  const { deviceId } = req.params;
  const cfg = await Config.findOne({ deviceId }).lean();
  if (!cfg) return res.status(404).send("No config");
  const last = await Reading.findOne({ deviceId }).sort({ ts: -1 }).lean();
  res.json({ deviceId, sp: cfg.sp, h: cfg.h, mode: cfg.mode, last });
});

// Actualizar SP/H/Modo (usuarios)
app.patch("/api/config/:deviceId", userAuth, async (req,res)=>{
  const { deviceId } = req.params;
  const { sp, h, mode } = req.body || {};
  const patch = {};
  if (typeof sp === "number") patch.sp = clamp(sp, -1000, 2000);
  if (typeof h  === "number" && h > 0) patch.h  = clamp(h, 0.1, 500);
  if (mode === "auto" || mode === "manual") patch.mode = mode;
  const cfg = await Config.findOneAndUpdate({ deviceId }, patch, { new: true, upsert: true });
  res.json(cfg);
});

// Push lecturas desde el dispositivo (firmware con x-device-token)
app.post("/api/thermo/push", deviceAuth, async (req,res)=>{
  const { deviceId } = req.device;
  const { s1, s2, s3, s4, ts } = req.body || {};
  if (![s1,s2,s3,s4].every(v=>typeof v==="number")) {
    return res.status(400).json({ ok:false, error:"s1..s4 numéricos" });
  }

  const cfg = await Config.findOne({ deviceId }) || await Config.create({ deviceId });
  const vals = [s1,s2,s3,s4].filter(Number.isFinite);
  const pv = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : NaN;

  const onThr  = cfg.sp - cfg.h/2;
  const offThr = cfg.sp + cfg.h/2;

  const last = await Reading.findOne({ deviceId }).sort({ ts: -1 }).lean();
  const wasOn = last ? (last.desiredR1 && last.desiredR2) : false;

  let desiredR1 = wasOn, desiredR2 = wasOn;
  if (cfg.mode === "auto" && Number.isFinite(pv)) {
    if (!wasOn && pv < onThr) { desiredR1 = desiredR2 = true; }
    if ( wasOn && pv > offThr){ desiredR1 = desiredR2 = false; }
  }

  const reading = await Reading.create({
    deviceId, s1, s2, s3, s4, pv,
    desiredR1, desiredR2,
    ts: ts ? new Date(ts) : new Date()
  });

  res.json({
    ok:true,
    desired:{ r1:desiredR1, r2:desiredR2 },
    pv, sp: cfg.sp, h: cfg.h, mode: cfg.mode,
    readingId: reading._id
  });
});

// Estado lógico actual (firmware/cliente)
app.get("/api/thermo/status", async (req,res)=>{
  const { deviceId } = req.query;
  if (!deviceId) return res.status(400).send("deviceId required");
  const cfg = await Config.findOne({ deviceId }).lean();
  if (!cfg) return res.status(404).send("No config");
  const last = await Reading.findOne({ deviceId }).sort({ ts: -1 }).lean(); // <-- añade esto
  const relays = last ? { r1: !!last.desiredR1, r2: !!last.desiredR2 } : { r1:false, r2:false };
  // incluir last en la respuesta:
  res.json({ deviceId, sp: cfg.sp, h: cfg.h, mode: cfg.mode, relays, last });
});


// Históricos (JSON)
app.get("/api/readings", userAuth, async (req,res)=>{
  const { deviceId, from, to, limit=1000 } = req.query;
  if (!deviceId) return res.status(400).send("deviceId required");
  const q = { deviceId };
  if (from || to) {
    q.ts = {};
    if (from) q.ts.$gte = new Date(from);
    if (to)   q.ts.$lte = new Date(to);
  }
  const data = await Reading.find(q).sort({ ts: 1 }).limit(parseInt(limit)).lean();
  res.json(data);
});

// Históricos (CSV)
app.get("/api/readings.csv", userAuth, async (req,res)=>{
  const { deviceId, from, to, limit=100000 } = req.query;
  if (!deviceId) return res.status(400).send("deviceId required");
  const q = { deviceId };
  if (from || to) {
    q.ts = {};
    if (from) q.ts.$gte = new Date(from);
    if (to)   q.ts.$lte = new Date(to);
  }
  const data = await Reading.find(q).sort({ ts: 1 }).limit(parseInt(limit)).lean();
  const csv = Papa.unparse(
    data.map(d=>({
      ts: new Date(d.ts).toISOString(),
      s1:d.s1, s2:d.s2, s3:d.s3, s4:d.s4,
      pv:d.pv, desiredR1:d.desiredR1, desiredR2:d.desiredR2
    }))
  );
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${deviceId}_readings.csv"`);
  res.send(csv);
});

// Salud
app.get("/health", (req,res)=>res.json({ ok:true }));

/* ------------------------------- Arranque ------------------------------- */
app.listen(PORT, ()=>{
  console.log(`🚀 Backend ON/OFF escuchando en puerto ${PORT}`);
  console.log(`🌍 CORS_ORIGIN: ${process.env.CORS_ORIGIN || "*"}`);
});