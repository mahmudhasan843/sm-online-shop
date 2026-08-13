const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA = path.join(__dirname, "data.json");

const SECRET =
  process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET";

const ADMIN_USER =
  process.env.ADMIN_USER || "SMADMIN";

const ADMIN_PASS =
  process.env.ADMIN_PASS || "SM2728";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const defaultData = {
  settings: {
    shopName: "SM Online Shop",
    tagline: "Style • Comfort • Confidence ♥",
    phone1: "01827872334",
    phone2: "01886995687",
    facebook: "",
    currency: "BDT"
  },
  products: [],
  orders: []
};

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(defaultData, null, 2)
  );
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch {
    return defaultData;
  }
}

function write(data) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(data, null, 2)
  );
}

const sessions = new Map();

function makeToken(user) {
  const raw =
    user +
    "." +
    Date.now() +
    "." +
    crypto.randomBytes(24).toString("hex");

  return (
    crypto
      .createHmac("sha256", SECRET)
      .update(raw)
      .digest("hex") +
    "." +
    Buffer.from(user).toString("base64url")
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");

  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  req.admin = sessions.get(token);
  req.token = token;

  next();
}

/* =========================
   STORE
========================= */

app.get("/api/store", (req, res) => {
  const data = read();

  res.json({
    settings: data.settings,
    products: data.products
  });
});

/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");

  if (
    username !== ADMIN_USER ||
    password !== ADMIN_PASS
  ) {
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  const token = makeToken(username);

  sessions.set(token, username);

  res.json({
    ok: true,
    token
  });
});

app.post("/api/admin/logout", auth, (req, res) => {
  sessions.delete(req.token);

  res.json({
    ok: true
  });
});

/* =========================
   PRODUCTS
========================= */

app.get("/api/admin/products", auth, (req, res) => {
  res.json(read().products);
});

app.post("/api/admin/products", auth, (req, res) => {
  const data = read();
  const body = req.body || {};

  if (!body.name || body.price === undefined) {
    return res.status(400).json({
      error: "Product name and price are required"
    });
  }

  const product = {
    id: Date.now(),
    name: String(body.name),
    category: String(body.category || "General"),
    price: Number(body.price || 0),
    oldPrice: Number(body.oldPrice || body.price || 0),
    discount: Number(body.discount || 0),
    stock: Number(body.stock || 0),
    image: String(body.image || ""),
    createdAt: new Date().toISOString()
  };

  data.products.push(product);
  write(data);

  res.json(product);
});

app.put("/api/admin/products/:id", auth, (req, res) => {
  const data = read();

  const id = Number(req.params.id);

  const index = data.products.findIndex(
    p => Number(p.id) === id
  );

  if (index === -1) {
    return res.status(404).json({
      error: "Product not found"
    });
  }

  const old = data.products[index];
  const body = req.body || {};

  data.products[index] = {
    ...old,
    ...body,
    id
  };

  for (const key of [
    "price",
    "oldPrice",
    "discount",
    "stock"
  ]) {
    if (data.products[index][key] !== undefined) {
      data.products[index][key] =
        Number(data.products[index][key]);
    }
  }

  write(data);

  res.json(data.products[index]);
});

app.delete("/api/admin/products/:id", auth, (req, res) => {
  const data = read();

  const id = Number(req.params.id);

  data.products = data.products.filter(
    p => Number(p.id) !== id
  );

  write(data);

  res.json({
    ok: true
  });
});

/* =========================
   CLOUDINARY IMAGE UPLOAD
========================= */

app.post(
  "/api/admin/upload",
  auth,
  async (req, res) => {
    try {
      const image = req.body?.image;

      if (!image) {
        return res.status(400).json({
          error: "Image is required"
        });
      }

      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({
          error:
            "Cloudinary environment variables are missing"
        });
      }

      const result =
        await cloudinary.uploader.upload(image, {
          folder: "sm-online-shop/products",
          resource_type: "image"
        });

      res.json({
        ok: true,
        url: result.secure_url,
        public_id: result.public_id
      });
    } catch (error) {
      console.error("Cloudinary upload error:", error);

      res.status(500).json({
        error: "Image upload failed"
      });
    }
  }
);

/* =========================
   SETTINGS
========================= */

app.put("/api/admin/settings", auth, (req, res) => {
  const data = read();

  data.settings = {
    ...data.settings,
    ...(req.body || {})
  };

  write(data);

  res.json(data.settings);
});

/* =========================
   ORDERS
========================= */

app.get("/api/admin/orders", auth, (req, res) => {
  res.json(read().orders);
});

app.post("/api/orders", (req, res) => {
  const data = read();

  const {
    customer,
    items,
    paymentMethod
  } = req.body || {};

  if (
    !customer?.name ||
    !customer?.phone ||
    !customer?.address ||
    !Array.isArray(items) ||
    !items.length
  ) {
    return res.status(400).json({
      error: "Customer and order details are required"
    });
  }

  let total = 0;
  const cleanItems = [];

  for (const item of items) {
    const product = data.products.find(
      p => Number(p.id) === Number(item.id)
    );

    const qty = Math.max(
      1,
      Number(item.qty || 1)
    );

    if (!product) {
      return res.status(400).json({
        error: "Product not found"
      });
    }

    if (product.stock < qty) {
      return res.status(400).json({
        error:
          "Out of stock: " +
          product.name
      });
    }

    total += product.price * qty;

    cleanItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty
    });
  }

  const order = {
    id: "SM" + Date.now(),
    createdAt: new Date().toISOString(),
    customer,
    items: cleanItems,
    total,
    paymentMethod: paymentMethod || "cod",
    status: "Pending"
  };

  data.orders.unshift(order);

  cleanItems.forEach(item => {
    const product = data.products.find(
      p => Number(p.id) === Number(item.id)
    );

    if (product) {
      product.stock -= item.qty;
    }
  });

  write(data);

  res.json({
    ok: true,
    orderId: order.id,
    total
  });
});

/* =========================
   PAYMENT ADAPTER
========================= */

app.post("/api/payment/create", (req, res) => {
  const method = req.body?.method;

  if (
    !["bkash", "nagad", "card"].includes(method)
  ) {
    return res.status(400).json({
      error: "Unsupported payment method"
    });
  }

  res.status(501).json({
    error:
      method +
      " gateway credentials are not configured."
  });
});

/* =========================
   SPA FALLBACK
========================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.listen(PORT, () => {
  console.log(
    "SM Online Shop running on port " + PORT
  );
});
