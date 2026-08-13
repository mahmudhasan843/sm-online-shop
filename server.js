const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true, limit: "3mb" }));

const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data.json");

app.use(express.static(PUBLIC));

const ADMIN_USER = process.env.ADMIN_USER || "SMADMIN";
const ADMIN_PASS = process.env.ADMIN_PASS || "CHANGE_THIS_PASSWORD";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET";

/* =========================
   DEFAULT STORE DATA
========================= */

const defaultData = {
  settings: {
    shopName: "SM Online Shop",
    tagline: "Style • Comfort • Confidence",
    phone1: "0127872334",
    phone2: "01886995687",
    facebook: "https://www.facebook.com/",
    currency: "BDT",
    address: "Hazrat Shahjalal Road, Konapara, Demra, Dhaka-1362"
  },

  products: [
    {
      id: 1,
      name: "Elegant Party Dress",
      category: "Dresses",
      price: 1550,
      oldPrice: 1950,
      discount: 20,
      stock: 15,
      image:
        "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=85"
    },
    {
      id: 2,
      name: "Floral Long Kurti",
      category: "Tops",
      price: 1450,
      oldPrice: 1930,
      discount: 25,
      stock: 15,
      image:
        "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=700&q=85"
    },
    {
      id: 3,
      name: "Luxury Embroidered Saree",
      category: "Saree",
      price: 1750,
      oldPrice: 2100,
      discount: 18,
      stock: 12,
      image:
        "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=700&q=85"
    },
    {
      id: 4,
      name: "Premium Chiffon Hijab",
      category: "Hijab",
      price: 550,
      oldPrice: 700,
      discount: 22,
      stock: 30,
      image:
        "https://images.unsplash.com/photo-1584187774001-0d7a5c5c0e44?auto=format&fit=crop&w=700&q=85"
    },
    {
      id: 5,
      name: "Category Bag",
      category: "Bags",
      price: 1350,
      oldPrice: 1730,
      discount: 22,
      stock: 18,
      image:
        "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=85"
    },
    {
      id: 6,
      name: "Trendy Casual Shoes",
      category: "Shoes",
      price: 1299,
      oldPrice: 1855,
      discount: 30,
      stock: 22,
      image:
        "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=700&q=85"
    }
  ],

  orders: []
};

/* =========================
   DATA FILE
========================= */

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(DATA, JSON.stringify(defaultData, null, 2));
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch (error) {
    console.error("DATA READ ERROR:", error);
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function writeData(data) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
}

/* =========================
   ADMIN SESSIONS
========================= */

const sessions = new Map();

function makeToken(user) {
  const raw =
    user +
    "." +
    Date.now() +
    "." +
    crypto.randomBytes(24).toString("hex");

  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(raw)
    .digest("hex");
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const token = header.replace("Bearer ", "").trim();

  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      error: "Session expired"
    });
  }

  const session = sessions.get(token);

  if (session.expires < Date.now()) {
    sessions.delete(token);

    return res.status(401).json({
      error: "Session expired"
    });
  }

  req.admin = session.user;
  req.token = token;

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
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  const token = makeToken(username);

  sessions.set(token, {
    user: username,
    created: Date.now(),
    expires: Date.now() + 1000 * 60 * 60 * 24
  });

  res.json({
    ok: true,
    token: token,
    username: username
  });
});

/* =========================
   ADMIN LOGOUT
========================= */

app.post("/api/admin/logout", auth, (req, res) => {
  sessions.delete(req.token);

  res.json({
    ok: true
  });
});

/* =========================
   ADMIN CHECK
========================= */

app.get("/api/admin/check", auth, (req, res) => {
  res.json({
    ok: true,
    username: req.admin
  });
});

/* =========================
   ADMIN DASHBOARD
========================= */

app.get("/api/admin/dashboard", auth, (req, res) => {
  const data = readData();

  const orders = Array.isArray(data.orders) ? data.orders : [];

  const pending = orders.filter(
    (order) => order.status === "Pending"
  ).length;

  const sales = orders.reduce((sum, order) => {
    return sum + Number(order.total || 0);
  }, 0);

  res.json({
    products: data.products.length,
    orders: orders.length,
    pending: pending,
    sales: sales
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
   UPDATE ORDER STATUS
========================= */

app.put("/api/admin/orders/:id", auth, (req, res) => {
  const data = readData();

  const id = String(req.params.id);

  const order = data.orders.find(
    (item) => String(item.id) === id
  );

  if (!order) {
    return res.status(404).json({
      error: "Order not found"
    });
  }

  const status = String(req.body.status || "");

  const allowed = [
    "Pending",
    "Confirmed",
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled"
  ];

  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: "Invalid order status"
    });
  }

  order.status = status;

  writeData(data);

  res.json({
    ok: true,
    order
  });
});

/* =========================
   ADMIN PRODUCTS
========================= */

app.get("/api/admin/products", auth, (req, res) => {
  const data = readData();

  res.json({
    products: data.products
  });
});

/* =========================
   ADD PRODUCT
========================= */

app.post("/api/admin/products", auth, (req, res) => {
  const data = readData();

  const p = req.body || {};

  if (!p.name || p.price === undefined) {
    return res.status(400).json({
      error: "Product name and price are required"
    });
  }

  const product = {
    id: Date.now(),

    name: String(p.name),

    category: String(p.category || "Other"),

    price: Number(p.price) || 0,

    oldPrice:
      p.oldPrice !== undefined
        ? Number(p.oldPrice)
        : Number(p.price) || 0,

    discount: Number(p.discount) || 0,

    stock: Number(p.stock) || 0,

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
    (product) => Number(product.id) === id
  );

  if (index < 0) {
    return res.status(404).json({
      error: "Product not found"
    });
  }

  const oldProduct = data.products[index];

  const update = req.body || {};

  const product = {
    ...oldProduct,

    name:
      update.name !== undefined
        ? String(update.name)
        : oldProduct.name,

    category:
      update.category !== undefined
        ? String(update.category)
        : oldProduct.category,

    price:
      update.price !== undefined
        ? Number(update.price)
        : oldProduct.price,

    oldPrice:
      update.oldPrice !== undefined
        ? Number(update.oldPrice)
        : oldProduct.oldPrice,

    discount:
      update.discount !== undefined
        ? Number(update.discount)
        : oldProduct.discount,

    stock:
      update.stock !== undefined
        ? Number(update.stock)
        : oldProduct.stock,

    image:
      update.image !== undefined
        ? String(update.image)
        : oldProduct.image
  };

  data.products[index] = product;

  writeData(data);

  res.json({
    ok: true,
    product
  });
});

/* =========================
   DELETE PRODUCT
========================= */

app.delete("/api/admin/products/:id", auth, (req, res) => {
  const data = readData();

  const id = Number(req.params.id);

  const before = data.products.length;

  data.products = data.products.filter(
    (product) => Number(product.id) !== id
  );

  if (data.products.length === before) {
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

  const paymentMethod = String(
    req.body.paymentMethod || "cod"
  );

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

  const orderItems = [];

  for (const item of items) {
    const product = data.products.find(
      (p) => Number(p.id) === Number(item.id)
    );

    if (!product) {
      return res.status(400).json({
        error: "Product not found"
      });
    }

    const qty = Math.max(1, Number(item.qty) || 1);

    if (Number(product.stock) < qty) {
      return res.status(400).json({
        error: `Out of stock: ${product.name}`
      });
    }

    const itemTotal = Number(product.price) * qty;

    total += itemTotal;

    orderItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty: qty
    });

    product.stock = Number(product.stock) - qty;
  }

  const order = {
    id: "SM" + Date.now(),
    createdAt: new Date().toISOString(),

    customer: {
      name: String(customer.name),
      phone: String(customer.phone),
      address: String(customer.address)
    },

    items: orderItems,

    paymentMethod: paymentMethod,

    status: "Pending",

    total: total
  };

  data.orders.push(order);

  writeData(data);

  res.json({
    ok: true,
    orderId: order.id,
    total: total
  });
});

/* =========================
   PAYMENT ADAPTER
========================= */

app.post("/api/payment/create", (req, res) => {
  const method = String(req.body.method || "").toLowerCase();

  if (!["bkash", "nagad", "card"].includes(method)) {
    return res.status(400).json({
      error: "Unsupported payment method"
    });
  }

  res.status(501).json({
    error:
      "Payment gateway credentials are not configured. Cash on Delivery is currently active."
  });
});

/* =========================
   ADMIN PAGE
========================= */

app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(PUBLIC, "admin.html"));
});

/* =========================
   FALLBACK
========================= */

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC, "index.html"));
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `SM Online Shop running on port ${PORT}`
  );
});
