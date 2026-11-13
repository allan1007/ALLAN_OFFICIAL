require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const Stripe = require("stripe");

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});
const stripe = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes("replace_me")
  ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());

// Stripe webhook must receive the raw body.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send("Stripe webhook is not configured");
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await pool.query(
        "UPDATE orders SET status='paid', stripe_payment_intent=$1 WHERE stripe_session_id=$2",
        [session.payment_intent || null, session.id]
      );
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook processing failed", err);
    res.status(500).send("Webhook processing failed");
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev-only-change-this").update(value).digest("hex");
}
function requireAdmin(req, res, next) {
  const raw = req.cookies.allan_admin || "";
  const [expires, signature] = raw.split(".");
  if (!expires || !signature || Number(expires) < Date.now() || !safeEqual(signature, sign(expires))) {
    return res.status(401).json({ error: "Please sign in again." });
  }
  next();
}
function validProduct(p) {
  return p && typeof p.name === "string" && p.name.trim() && Number.isFinite(Number(p.price)) &&
    Number(p.price) >= 0 && Number.isInteger(Number(p.stock)) && Number(p.stock) >= 0;
}
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL,
      image_url TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'T-shirts',
      sizes JSONB NOT NULL DEFAULT '["S","M","L","XL"]'::jsonb,
      stock INTEGER NOT NULL DEFAULT 0, featured BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY, value JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, email TEXT NOT NULL, items JSONB NOT NULL,
      total_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      stripe_session_id TEXT UNIQUE, stripe_payment_intent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM products");
  if (count.rows[0].n === 0) {
    const seed = [
      ["ALLAN CORE TEE","allan-core-tee","Heavyweight boxy-fit essential. Built for everyday rotation.",4500,"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=85","T-shirts",["S","M","L","XL"],40,true],
      ["AFTER HOURS TEE","after-hours-tee","A statement piece for after dark.",5200,"https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1200&q=85","T-shirts",["S","M","L","XL"],25,true],
      ["DAILY UNIFORM","daily-uniform","Relaxed streetwear fit with a clean silhouette.",4800,"https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1200&q=85","T-shirts",["S","M","L","XL"],30,false]
    ];
    for (const p of seed) await pool.query(
      "INSERT INTO products(name,slug,description,price_cents,image_url,category,sizes,stock,featured) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      p
    );
  }
  await pool.query("INSERT INTO site_settings(key,value) VALUES('site', $1) ON CONFLICT(key) DO NOTHING",
    [JSON.stringify({ brandName:"ALLAN", tagline:"BUILT DIFFERENT.", announcement:"FIRST DROP — AVAILABLE NOW", heroTitle:"BUILT DIFFERENT.", heroSubtitle:"Independent streetwear. Made to stand out.", heroImage:"https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=2000&q=90", about:"ALLAN is an independent streetwear label built around self-expression, confidence and everyday essentials.", instagram:"", contactEmail:"hello@allan.store", currency:"SGD" })]);
}
app.get("/health", (req,res)=>res.json({ok:true}));

app.post("/api/admin/login", asyncRoute(async (req,res)=>{
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return res.status(503).json({error:"Admin login is not configured. Add ADMIN_PASSWORD and SESSION_SECRET."});
  if (!safeEqual(req.body.password, process.env.ADMIN_PASSWORD)) return res.status(401).json({error:"Incorrect password."});
  const expires = String(Date.now() + 7*24*60*60*1000);
  res.cookie("allan_admin", `${expires}.${sign(expires)}`, {httpOnly:true, secure:process.env.NODE_ENV==="production", sameSite:"lax", maxAge:7*24*60*60*1000, path:"/"});
  res.json({ok:true});
}));
app.post("/api/admin/logout", (req,res)=>{res.clearCookie("allan_admin",{path:"/"});res.json({ok:true});});
app.get("/api/admin/me", requireAdmin, (req,res)=>res.json({ok:true}));

app.get("/api/products", asyncRoute(async (req,res)=>{
  const {rows}=await pool.query("SELECT id,name,slug,description,price_cents,image_url,category,sizes,stock,featured FROM products WHERE active=true ORDER BY featured DESC, created_at DESC");
  res.json(rows);
}));
app.get("/api/site", asyncRoute(async(req,res)=>{
  const {rows}=await pool.query("SELECT value FROM site_settings WHERE key='site'");
  res.json(rows[0]?.value || {});
}));
app.get("/api/admin/products", requireAdmin, asyncRoute(async(req,res)=>{
  const {rows}=await pool.query("SELECT * FROM products ORDER BY created_at DESC");res.json(rows);
}));
app.post("/api/admin/products", requireAdmin, asyncRoute(async(req,res)=>{
  const p=req.body;if(!validProduct(p))return res.status(400).json({error:"Enter a product name, valid price and whole-number stock."});
  const slug=(p.slug||p.name).toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now().toString().slice(-5);
  const {rows}=await pool.query(`INSERT INTO products(name,slug,description,price_cents,image_url,category,sizes,stock,featured,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [p.name.trim(),slug,p.description||"",Math.round(Number(p.price)*100),p.image_url||"",p.category||"T-shirts",JSON.stringify(p.sizes||["S","M","L","XL"]),Number(p.stock),!!p.featured,p.active!==false]);
  res.json(rows[0]);
}));
app.put("/api/admin/products/:id", requireAdmin, asyncRoute(async(req,res)=>{
  const p=req.body;if(!validProduct(p))return res.status(400).json({error:"Enter a product name, valid price and whole-number stock."});
  const {rows}=await pool.query(`UPDATE products SET name=$1,description=$2,price_cents=$3,image_url=$4,category=$5,sizes=$6,stock=$7,featured=$8,active=$9 WHERE id=$10 RETURNING *`,
    [p.name.trim(),p.description||"",Math.round(Number(p.price)*100),p.image_url||"",p.category||"T-shirts",JSON.stringify(p.sizes||["S","M","L","XL"]),Number(p.stock),!!p.featured,p.active!==false,req.params.id]);
  if(!rows[0])return res.status(404).json({error:"Product not found."});res.json(rows[0]);
}));
app.delete("/api/admin/products/:id", requireAdmin, asyncRoute(async(req,res)=>{
  await pool.query("DELETE FROM products WHERE id=$1",[req.params.id]);res.json({ok:true});
}));
app.put("/api/admin/site", requireAdmin, asyncRoute(async(req,res)=>{
  await pool.query("INSERT INTO site_settings(key,value) VALUES('site',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(req.body)]);res.json({ok:true});
}));
app.get("/api/admin/orders", requireAdmin, asyncRoute(async(req,res)=>{
  const {rows}=await pool.query("SELECT id,email,items,total_cents,status,created_at FROM orders ORDER BY created_at DESC LIMIT 200");res.json(rows);
}));

app.post("/api/checkout", asyncRoute(async(req,res)=>{
  if(!stripe)return res.status(503).json({error:"Payments are not configured yet. Add your Stripe test secret key in Render."});
  const cart=Array.isArray(req.body.items)?req.body.items:[];
  if(!cart.length || cart.length>30)return res.status(400).json({error:"Your cart is empty or invalid."});
  const ids=cart.map(x=>Number(x.id));
  const {rows}=await pool.query("SELECT * FROM products WHERE id=ANY($1::int[]) AND active=true", [ids]);
  const lookup=new Map(rows.map(p=>[p.id,p]));
  const lineItems=[], orderItems=[];let total=0;
  for(const item of cart){
    const p=lookup.get(Number(item.id)), qty=Number(item.quantity);
    if(!p || !Number.isInteger(qty) || qty<1 || qty>10)return res.status(400).json({error:"A product or quantity in your cart is invalid."});
    if(p.stock<qty)return res.status(400).json({error:`Not enough stock for ${p.name}.`});
    const size=String(item.size||"M");
    if(!p.sizes.includes(size))return res.status(400).json({error:`Invalid size for ${p.name}.`});
    lineItems.push({price_data:{currency:"sgd",product_data:{name:`${p.name} — ${size}`,images:p.image_url.startsWith("https://")?[p.image_url]:[]},unit_amount:p.price_cents},quantity:qty});
    orderItems.push({id:p.id,name:p.name,size,quantity:qty,unit_price_cents:p.price_cents});
    total+=p.price_cents*qty;
  }
  const email=String(req.body.email||"").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Enter a valid email address."});
  const order=await pool.query("INSERT INTO orders(email,items,total_cents) VALUES($1,$2,$3) RETURNING id",[email,JSON.stringify(orderItems),total]);
  const base=(process.env.SITE_URL||`${req.protocol}://${req.get("host")}`).replace(/\/$/,"");
  try{
    const session=await stripe.checkout.sessions.create({
      mode:"payment",customer_email:email,line_items:lineItems,
      success_url:`${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${base}/?checkout=cancelled`,
      metadata:{order_id:String(order.rows[0].id)}
    });
    await pool.query("UPDATE orders SET stripe_session_id=$1 WHERE id=$2",[session.id,order.rows[0].id]);
    res.json({url:session.url});
  }catch(e){await pool.query("UPDATE orders SET status='checkout_error' WHERE id=$1",[order.rows[0].id]);throw e;}
}));

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Something went wrong. Please try again."});});

initDb().then(()=>app.listen(port,()=>console.log(`ALLAN store running on ${port}`))).catch(err=>{console.error("Database setup failed",err);process.exit(1);});
