const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const SECRET =
  process.env.SESSION_SECRET ||
  "CHANGE_THIS_SECRET_TO_A_LONG_RANDOM_VALUE";

const ADMIN_USER = process.env.ADMIN_USER || "SMADMIN";
const ADMIN_PASS = process.env.ADMIN_PASS || "SM2728";

const DATA = path.join(__dirname, "data.json");

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.json({ limit: "3mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "3mb",
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ======================================================
// DEFAULT DATA
// ======================================================

const DEFAULT_DATA = {
  settings: {
    shopName: "SM Online Shop",
    tagline: "Style • Comfort • Confidence ❤️",
    phone1: "01827872334",
    phone2: "0186995687",
    facebook: "https://www.facebook.com/",
    currency: "BDT",
    products: [
      {
        id: 1,
        name: "Elegant Party Dress",
        category: "Dresses",
        price: 1550,
        oldPrice: 1950,
        discount: 20,
        stock: 20,
        image:
          "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=700&q=85",
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
          "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=700&q=85",
      },
      {
        id: 3,
        name: "Luxury Embroidered Saree",
        category: "Saree",
        price: 1750,
        oldPrice: 2140,
        discount: 18,
        stock: 12,
        image:
          "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=700&q=85",
      },
      {
        id: 4,
        name: "Elegant Hand Bag",
        category: "Bag",
        price: 550,
        oldPrice: 700,
        discount: 22,
        stock: 30,
        image:
          "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=85",
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
          "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=700&q=85",
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
          "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=85",
      },
    ],
    orders: [],
  },
};

// ======================================================
// CREATE DATA FILE
// ======================================================

function createDataFile() {
  if (!fs.existsSync(DATA)) {
    fs.writeFileSync(
      DATA,
      JSON.stringify(DEFAULT_DATA, null, 2),
      "utf8"
    );
  }
}

createDataFile();

// ======================================================
// DATA FUNCTIONS
// ======================================================

function readData() {
  try {
    createDataFile();

    return JSON.parse(
      fs.readFileSync(DATA, "utf8")
    );
  } catch (error) {
    console.error("DATA READ ERROR:", error);

    return JSON.parse(
      JSON.stringify(DEFAULT_DATA)
    );
  }
}

function writeData(data) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// ======================================================
// ADMIN SESSION
// ======================================================

const sessions = new Map();

function makeToken(user) {
  const raw =
    user +
    "." +
    Date.now() +
    "." +
    crypto.randomBytes(24).toString("hex");

  return crypto
    .createHmac("sha256", SECRET)
    .update(raw)
    .digest("hex");
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  const token = header.replace("Bearer ", "");

  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  req.admin = sessions.get(token);

  next();
}

// ======================================================
// STORE API
// ======================================================

app.get("/api/store", (req, res) => {
  const data = readData();

  res.json({
    settings: data.settings,
    products: data.settings.products || [],
    orders: data.settings.orders || [],
  });
});

// ======================================================
// ADMIN LOGIN
// ======================================================

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};

  if (
    username !== ADMIN_USER ||
    password !== ADMIN_PASS
  ) {
    return res.status(401).json({
      error: "Invalid username or password",
    });
  }

  const token = makeToken(username);

  sessions.set(token, {
    username,
    createdAt: Date.now(),
  });

  res.json({
    ok: true,
    token,
  });
});

// ======================================================
// ADMIN LOGOUT
// ======================================================

app.post("/api/admin/logout", auth, (req, res) => {
  const header = req.headers.authorization || "";

  const token = header.replace("Bearer ", "");

  if (token) {
    sessions.delete(token);
  }

  res.json({
    ok: true,
  });
});

// ======================================================
// ADMIN ORDERS
// ======================================================

app.get("/api/admin/orders", auth, (req, res) => {
  const data = readData();

  res.json(
    data.settings.orders || []
  );
});

// ======================================================
// ADMIN PRODUCTS
// ======================================================

app.get("/api/admin/products", auth, (req, res) => {
  const data = readData();

  res.json(
    data.settings.products || []
  );
});

// ======================================================
// ADD PRODUCT
// ======================================================

app.post("/api/admin/products", auth, (req, res) => {
  const data = readData();

  const p = req.body || {};

  if (
    !p.name ||
    p.price === undefined ||
    p.price === ""
  ) {
    return res.status(400).json({
      error: "Product name and price are required",
    });
  }

  const product = {
    id: Date.now(),

    name: String(p.name),

    price: Number(p.price) || 0,

    oldPrice:
      p.oldPrice !== undefined &&
      p.oldPrice !== ""
        ? Number(p.oldPrice)
        : Number(p.price) || 0,

    stock:
      p.stock !== undefined &&
      p.stock !== ""
        ? Number(p.stock)
        : 0,

    discount:
      p.discount !== undefined &&
      p.discount !== ""
        ? Number(p.discount)
        : 0,

    category:
      p.category ||
      "Other",

    image:
      p.image ||
      "",
  };

  if (!Array.isArray(data.settings.products)) {
    data.settings.products = [];
  }

  data.settings.products.push(product);

  writeData(data);

  res.json(product);
});

// ======================================================
// EDIT PRODUCT
// ======================================================

app.put(
  "/api/admin/products/:id",
  auth,
  (req, res) => {
    const data = readData();

    const id = Number(req.params.id);

    const index =
      data.settings.products.findIndex(
        (p) => Number(p.id) === id
      );

    if (index < 0) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    const oldProduct =
      data.settings.products[index];

    const update = req.body || {};

    const product = {
      ...oldProduct,
      ...update,
    };

    if (update.price !== undefined) {
      product.price =
        Number(update.price) || 0;
    }

    if (update.oldPrice !== undefined) {
      product.oldPrice =
        Number(update.oldPrice) || 0;
    }

    if (update.stock !== undefined) {
      product.stock =
        Number(update.stock) || 0;
    }

    if (update.discount !== undefined) {
      product.discount =
        Number(update.discount) || 0;
    }

    data.settings.products[index] =
      product;

    writeData(data);

    res.json(product);
  }
);

// ======================================================
// DELETE PRODUCT
// ======================================================

app.delete(
  "/api/admin/products/:id",
  auth,
  (req, res) => {
    const data = readData();

    const id = Number(req.params.id);

    const before =
      data.settings.products.length;

    data.settings.products =
      data.settings.products.filter(
        (p) => Number(p.id) !== id
      );

    if (
      data.settings.products.length ===
      before
    ) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    writeData(data);

    res.json({
      ok: true,
    });
  }
);

// ======================================================
// STORE SETTINGS
// ======================================================

app.put(
  "/api/admin/settings",
  auth,
  (req, res) => {
    const data = readData();

    data.settings = {
      ...data.settings,
      ...(req.body || {}),
    };

    writeData(data);

    res.json(
      data.settings
    );
  }
);

// ======================================================
// CREATE ORDER
// ======================================================

app.post("/api/orders", (req, res) => {
  const data = readData();

  const customer =
    req.body.customer || {};

  const items =
    Array.isArray(req.body.items)
      ? req.body.items
      : [];

  if (
    !customer.name ||
    !customer.phone ||
    !customer.address ||
    items.length === 0
  ) {
    return res.status(400).json({
      error:
        "Customer and order information are required",
    });
  }

  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product =
      data.settings.products.find(
        (p) =>
          Number(p.id) ===
          Number(item.id)
      );

    if (!product) {
      continue;
    }

    const qty =
      Math.max(
        1,
        Number(item.qty) || 1
      );

    if (
      Number(product.stock) < qty
    ) {
      return res.status(400).json({
        error:
          "Out of stock: " +
          product.name,
      });
    }

    const subtotal =
      Number(product.price) * qty;

    total += subtotal;

    orderItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty,
      subtotal,
    });

    product.stock =
      Number(product.stock) - qty;
  }

  if (orderItems.length === 0) {
    return res.status(400).json({
      error: "No valid products",
    });
  }

  const order = {
    id:
      "SM-" +
      Date.now(),

    createdAt:
      new Date().toISOString(),

    customer: {
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
    },

    items: orderItems,

    paymentMethod:
      req.body.paymentMethod ||
      "cod",

    total,
  };

  if (
    !Array.isArray(
      data.settings.orders
    )
  ) {
    data.settings.orders = [];
  }

  data.settings.orders.unshift(
    order
  );

  writeData(data);

  res.json({
    ok: true,
    orderId: order.id,
    total,
  });
});

// ======================================================
// PAYMENT
// ======================================================

app.post(
  "/api/payment/create",
  (req, res) => {
    const method =
      req.body.method;

    const allowed = [
      "bkash",
      "nagad",
      "card",
    ];

    if (!allowed.includes(method)) {
      return res.status(400).json({
        error:
          "Unsupported payment method",
      });
    }

    return res.status(501).json({
      error:
        "Payment gateway credentials are not configured yet.",
    });
  }
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "SM Online Shop",
    time: new Date().toISOString(),
  });
});

// ======================================================
// FRONTEND FALLBACK
// IMPORTANT:
// Express 5 does NOT support app.get("*")
// ======================================================

app.use((req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

// ======================================================
// ERROR HANDLER
// ======================================================

app.use(
  (err, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    res.status(500).json({
      error:
        "Internal server error",
    });
  }
);

// ======================================================
// START SERVER
// ======================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `SM Online Shop running on port ${PORT}`
    );
  }
);
