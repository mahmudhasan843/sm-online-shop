const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true, limit: "3mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data.json");

const ADMIN_USER = process.env.ADMIN_USER || "SMADMIN";
const ADMIN_PASS = process.env.ADMIN_PASS || "SM2728";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET";

/* =========================
   CREATE DATA FILE
========================= */

const DEFAULT_DATA = {
  settings: {
    shopName: "SM Online Shop",
    tagline: "Style • Comfort • Confidence ❤️",
    phone1: "0182787234",
    phone2: "0188995687",
    facebook: "https://www.facebook.com/",
    currency: "BDT"
  },
  products: [],
  orders: []
};

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(DEFAULT_DATA, null, 2),
    "utf8"
  );
}

/* =========================
   DATA FUNCTIONS
========================= */

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("DATA READ ERROR:", error);
    return DEFAULT_DATA;
  }
}

function writeData(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

/* =========================
   COOKIE AUTH
========================= */

function createToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      created: Date.now()
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token) return null;

    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const payload = parts[0];
    const signature = parts[1];

    const expected = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(payload)
      .digest("base64url");

    if (signature.length !== expected.length) return null;

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return null;
    }

    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (!data.username) return null;

    if (data.username !== ADMIN_USER) return null;

    return data;
  } catch (error) {
    return null;
  }
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";

  const parts = cookies.split(";");

  for (const part of parts) {
    const item = part.trim();

    if (item.startsWith(name + "=")) {
      return decodeURIComponent(
        item.substring(name.length + 1)
      );
    }
  }

  return null;
}

function auth(req, res, next) {
  const token = getCookie(req, "sm_admin_session");

  const user = verifyToken(token);

  if (!user) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  req.admin = user;

  next();
}

/* =========================
   STORE API
========================= */

app.get("/api/store", (req, res) => {
  const data = readData();

  res.json({
    settings: data.settings,
    products: data.products
  });
});

/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (
    username !== ADMIN_USER ||
    password !== ADMIN_PASS
  ) {
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  const token = createToken(username);

  res.setHeader(
    "Set-Cookie",
    `sm_admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`
  );

  res.json({
    ok: true,
    message: "Login successful"
  });
});

/* =========================
   CHECK LOGIN
========================= */

app.get("/api/admin/me", auth, (req, res) => {
  res.json({
    ok: true,
    username: req.admin.username
  });
});

/* =========================
   ADMIN LOGOUT
========================= */

app.post("/api/admin/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "sm_admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );

  res.json({
    ok: true
  });
});

/* =========================
   ADMIN ORDERS
========================= */

app.get("/api/admin/orders", auth, (req, res) => {
  const data = readData();

  res.json({
    orders: data.orders || []
  });
});

/* =========================
   ADMIN PRODUCTS
========================= */

app.get("/api/admin/products", auth, (req, res) => {
  const data = readData();

  res.json({
    products: data.products || []
  });
});

/* =========================
   ADD PRODUCT
========================= */

app.post("/api/admin/products", auth, (req, res) => {
  const data = readData();

  const p = req.body || {};

  if (
    !p.name ||
    p.price === undefined ||
    p.price === ""
  ) {
    return res.status(400).json({
      error: "Product name and price are required"
    });
  }

  const product = {
    id: Date.now(),
    name: String(p.name),
    price: Number(p.price),
    oldPrice: Number(p.oldPrice || p.price),
    discount: Number(p.discount || 0),
    stock: Number(p.stock || 0),
    category: String(p.category || "Other"),
    image: String(p.image || "")
  };

  data.products.push(product);

  writeData(data);

  res.json({
    ok: true,
    product
  });
});

/* =========================
   EDIT PRODUCT
========================= */

app.put("/api/admin/products/:id", auth, (req, res) => {
  const data = readData();

  const id = Number(req.params.id);

  const index = data.products.findIndex(
    p => Number(p.id) === id
  );

  if (index === -1) {
    return res.status(404).json({
      error: "Product not found"
    });
  }

  const oldProduct = data.products[index];

  data.products[index] = {
    ...oldProduct,
    ...req.body,
    id: oldProduct.id,
    price:
      req.body.price !== undefined
        ? Number(req.body.price)
        : oldProduct.price,
    oldPrice:
      req.body.oldPrice !== undefined
        ? Number(req.body.oldPrice)
        : oldProduct.oldPrice,
    stock:
      req.body.stock !== undefined
        ? Number(req.body.stock)
        : oldProduct.stock,
    discount:
      req.body.discount !== undefined
        ? Number(req.body.discount)
        : oldProduct.discount
  };

  writeData(data);

  res.json({
    ok: true,
    product: data.products[index]
  });
});

/* =========================
   DELETE PRODUCT
========================= */

app.delete("/api/admin/products/:id", auth, (req, res) => {
  const data = readData();

  const id = Number(req.params.id);

  const oldLength = data.products.length;

  data.products = data.products.filter(
    p => Number(p.id) !== id
  );

  if (data.products.length === oldLength) {
    return res.status(404).json({
      error: "Product not found"
    });
  }

  writeData(data);

  res.json({
    ok: true
  });
});

/* =========================
   STORE SETTINGS
========================= */

app.get("/api/admin/settings", auth, (req, res) => {
  const data = readData();

  res.json({
    settings: data.settings
  });
});

app.put("/api/admin/settings", auth, (req, res) => {
  const data = readData();

  data.settings = {
    ...data.settings,
    ...(req.body || {})
  };

  writeData(data);

  res.json({
    ok: true,
    settings: data.settings
  });
});

/* =========================
   CREATE ORDER
========================= */

app.post("/api/orders", (req, res) => {
  const data = readData();

  const customer = req.body.customer || {};
  const items = Array.isArray(req.body.items)
    ? req.body.items
    : [];

  const paymentMethod =
    req.body.paymentMethod || "cod";

  if (
    !customer.name ||
    !customer.phone ||
    !customer.address ||
    items.length === 0
  ) {
    return res.status(400).json({
      error: "Customer and order information are required"
    });
  }

  let total = 0;

  const cleanItems = [];

  for (const item of items) {
    const product = data.products.find(
      p => Number(p.id) === Number(item.id)
    );

    if (!product) {
      return res.status(400).json({
        error: "Product not found"
      });
    }

    const qty = Math.max(
      1,
      Number(item.qty || 1)
    );

    if (product.stock < qty) {
      return res.status(400).json({
        error: `Out of stock: ${product.name}`
      });
    }

    total += Number(product.price) * qty;

    cleanItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty
    });

    product.stock -= qty;
  }

  const order = {
    id: "SM" + Date.now(),
    createdAt: new Date().toISOString(),
    customer: {
      name: String(customer.name),
      phone: String(customer.phone),
      address: String(customer.address)
    },
    items: cleanItems,
    paymentMethod,
    status: "Pending",
    total
  };

  data.orders.unshift(order);

  writeData(data);

  res.json({
    ok: true,
    orderId: order.id,
    total
  });
});

/* =========================
   PAYMENT
========================= */

app.post("/api/payment/create", (req, res) => {
  const method = req.body.method;

  if (!["bkash", "nagad", "card"].includes(method)) {
    return res.status(400).json({
      error: "Unsupported payment method"
    });
  }

  return res.status(501).json({
    error:
      `${method} payment gateway credentials are not configured.`
  });
});

/* =========================
   ADMIN PAGE
========================= */

app.get("/admin.html", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "admin.html")
  );
});

/* =========================
   STATIC FILES
========================= */

app.use(express.static(PUBLIC_DIR));

/* =========================
   FALLBACK
========================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `SM Online Shop running on port ${PORT}`
  );
});
