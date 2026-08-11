const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

const DATA = path.join(__dirname,"data.json");
const SECRET = process.env.SESSION_SECRET || "CHANGE_THIS_SECRET";
const ADMIN_USER = process.env.ADMIN_USER || "SMADMIN";
const ADMIN_PASS = process.env.ADMIN_PASS || "SM2728";

const defaultData = {
  settings:{
    shopName:"SM Online Shop",
    tagline:"Style • Comfort • Confidence ♥",
    phone1:"01827872334",
    phone2:"01886995687",
    facebook:"https://www.facebook.com/share/1Dr8FEmuoQ/",
    currency:"BDT"
  },
  products:[
    {id:1,name:"Elegant Party Dress",category:"Dresses",price:1550,oldPrice:1950,discount:20,stock:20,image:"https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=85"},
    {id:2,name:"Floral Long Kurti",category:"Tops",price:1450,oldPrice:1930,discount:25,stock:15,image:"https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=700&q=85"},
    {id:3,name:"Luxury Embroidered Saree",category:"Saree",price:1750,oldPrice:2130,discount:18,stock:12,image:"https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=700&q=85"},
    {id:4,name:"Premium Chiffon Hijab",category:"Hijab",price:550,oldPrice:700,discount:22,stock:30,image:"https://images.unsplash.com/photo-1584187774001-0d7a5c5c0e44?auto=format&fit=crop&w=700&q=85"},
    {id:5,name:"Stylish Hand Bag",category:"Bags",price:1350,oldPrice:1730,discount:22,stock:18,image:"https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=85"},
    {id:6,name:"Trendy Casual Shoes",category:"Shoes",price:1299,oldPrice:1855,discount:30,stock:22,image:"https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=700&q=85"}
  ],
  orders:[]
};
if(!fs.existsSync(DATA)) fs.writeFileSync(DATA, JSON.stringify(defaultData,null,2));
function read(){return JSON.parse(fs.readFileSync(DATA,"utf8"))}
function write(d){fs.writeFileSync(DATA,JSON.stringify(d,null,2))}

const sessions = new Map();
function makeToken(user){const raw=user+"."+Date.now()+"."+crypto.randomBytes(24).toString("hex"); return crypto.createHmac("sha256",SECRET).update(raw).digest("hex")+"."+Buffer.from(user).toString("base64url")}
function auth(req,res,next){
  const token=req.headers.authorization?.replace("Bearer ","");
  if(!token || !sessions.has(token)) return res.status(401).json({error:"Unauthorized"});
  req.admin=sessions.get(token); next();
}

app.get("/api/store",(req,res)=>{const d=read(); res.json({settings:d.settings,products:d.products})});

app.post("/api/admin/login",(req,res)=>{
  const {username,password}=req.body||{};
  if(username!==ADMIN_USER || password!==ADMIN_PASS) return res.status(401).json({error:"Invalid login"});
  const token=makeToken(username); sessions.set(token,username); res.json({token});
});
app.post("/api/admin/logout",auth,(req,res)=>{const token=req.headers.authorization.replace("Bearer ","");sessions.delete(token);res.json({ok:true})});

app.get("/api/admin/orders",auth,(req,res)=>res.json(read().orders));
app.get("/api/admin/products",auth,(req,res)=>res.json(read().products));
app.post("/api/admin/products",auth,(req,res)=>{
  const d=read(), p=req.body;
  if(!p.name || !p.price) return res.status(400).json({error:"Name and price required"});
  p.id=Date.now(); p.price=Number(p.price); p.oldPrice=Number(p.oldPrice||p.price); p.stock=Number(p.stock||0); p.discount=Number(p.discount||0);
  d.products.push(p); write(d); res.json(p);
});
app.put("/api/admin/products/:id",auth,(req,res)=>{
  const d=read(), id=Number(req.params.id), i=d.products.findIndex(x=>x.id===id);
  if(i<0)return res.status(404).json({error:"Not found"});
  d.products[i]={...d.products[i],...req.body,id};
  for(const k of ["price","oldPrice","stock","discount"]) if(d.products[i][k]!=null)d.products[i][k]=Number(d.products[i][k]);
  write(d);res.json(d.products[i]);
});
app.delete("/api/admin/products/:id",auth,(req,res)=>{
  const d=read();d.products=d.products.filter(x=>x.id!==Number(req.params.id));write(d);res.json({ok:true});
});
app.put("/api/admin/settings",auth,(req,res)=>{const d=read();d.settings={...d.settings,...req.body};write(d);res.json(d.settings)});

app.post("/api/orders",(req,res)=>{
  const d=read(), {customer,items,paymentMethod}=req.body||{};
  if(!customer?.name || !customer?.phone || !customer?.address || !Array.isArray(items) || !items.length) return res.status(400).json({error:"Customer and order details are required"});
  let total=0, clean=[];
  for(const item of items){
    const p=d.products.find(x=>x.id===Number(item.id));
    const q=Math.max(1,Number(item.qty||1));
    if(!p || p.stock<q) return res.status(400).json({error:`Out of stock: ${p?.name||"product"}`});
    total+=p.price*q; clean.push({id:p.id,name:p.name,price:p.price,qty:q});
  }
  const order={id:"SM"+Date.now(),createdAt:new Date().toISOString(),customer,items:clean,total,paymentMethod,status:"Pending"};
  d.orders.unshift(order);
  clean.forEach(x=>{const p=d.products.find(y=>y.id===x.id);p.stock-=x.qty});
  write(d);
  res.json({ok:true,orderId:order.id,total});
});

/* Payment gateway endpoints are intentionally marked as adapters.
   bKash/Nagad/SSLCommerz require merchant credentials from the respective providers.
   Put credentials in .env and implement/enable the corresponding adapter before live use. */
app.post("/api/payment/create", (req,res)=>{
  const method=req.body?.method;
  if(!["bkash","nagad","card"].includes(method)) return res.status(400).json({error:"Unsupported payment method"});
  res.status(501).json({error:`${method} gateway credentials are not configured. Add provider credentials in .env and enable the adapter in server.js.`});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`SM Online Shop running on http://localhost:${PORT}`));
