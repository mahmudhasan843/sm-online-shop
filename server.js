const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   BASIC SETTINGS
========================= */

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   DATA FILE
========================= */

const DATA = path.join(__dirname, "data.json");

const defaultData = {
  settings: {
    shopName: "SM Online Shop",
    tagline: "Style • Comfort • Confidence ♥",
    phone1: "01827872334",
    phone2: "01886995687",
    facebook: "https://www.facebook.com/share/1Dr8FEmuoQ/",
    currency: "BDT"
  },

  products: [
    {
      id: 1,
      name: "Elegant Party Dress",
      category: "Dresses",
      price: 1550,
      oldPrice: 1950,
      discount: 20,
      stock: 20,
      image: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=85",
      images: []
    },
    {
      id: 2,
      name: "Floral Long Kurti",
      category: "Tops",
      price: 1450,
      oldPrice: 1930,
      discount: 25,
      stock: 15,
      image: "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=700&q=85",
      images: []
    },
    {
      id: 3,
      name: "Luxury Embroidered Saree",
      category: "Saree",
      price: 1750,
      oldPrice: 2130,
      discount: 18,
      stock: 12,
      image: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=700&q=85",
      images: []
    },
    {
      id: 4,
      name: "Premium Chiffon Hijab",
      category: "Hijab",
      price: 550,
      oldPrice: 700,
      discount: 22,
      stock: 30,
      image: "https://images.unsplash.com/photo-1584187774001-0d7a5c5c0e44?auto=format&fit=crop&w=700&q=85",
      images: []
    },
    {
      id: 5,
      name: "Stylish Hand Bag",
      category: "Bags",
      price: 1350,
      oldPrice: 1730,
      discount: 22,
      stock: 18,
      image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=85",
      images: []
    },
    {
      id: 6,
      name: "Trendy Casual Shoes",
      category: "Shoes",
      price: 1299,
      oldPrice: 1855,
      discount: 30,
      stock: 22,
      image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=700&q=85",
      images: []
    }
  ],

  orders: []
};

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(DATA, JSON.stringify(defaultData, null, 2));
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch (error) {
    return defaultData;
  }
}

function writeData(data) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
}

/* =========================
   ADMIN LOGIN
========================= */

const SECRET =
  process.env.SESSION_SECRET ||
  "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET";

const ADMIN_USER =
  process.env.ADMIN_USER ||
  "SMADMIN";

const ADMIN_PASS =
  process.env.ADMIN_PASS ||
  "SM2728";

const sessions = new Map();

function makeToken(user) {
  const raw =
    user +
    "." +
    Date.now() +
    "." +
    crypto.randomBytes(32).toString("hex");

  const hash = crypto
    .createHmac("sha256", SECRET)
    .update(raw)
    .digest("hex");

  return hash + "." + Buffer.from(user).toString("base64url");
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
  req.sessionToken = token;

  next();
}

/* =========================
   CLOUDINARY
========================= */

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    secure: true
  });
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

/* =========================
   MULTER
   MEMORY STORAGE
========================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 8
  },

  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }

    cb(null, true);
  }
});

/* =========================
   CLOUDINARY UPLOAD HELPER
========================= */

function uploadToCloudinary(buffer, originalName) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "sm-online-shop/products",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false
      },

      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    stream.end(buffer);
  });
}

/* =========================
   PUBLIC STORE API
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

/* =========================
   ADMIN LOGOUT
========================= */

app.post("/api/admin/logout", auth, (req, res) => {
  sessions.delete(req.sessionToken);

  res.json({
    ok: true
  });
});

/* =========================
   ADMIN CHECK
========================= */

app.get("/api/admin/me", auth, (req, res) => {
  res.json({
    ok: true,
    username: req.admin
  });
});

/* =========================
   IMAGE UPLOAD
========================= */

app.post(
  "/api/admin/upload",
  auth,
  upload.array("images", 8),
  async (req, res) => {
    try {
      if (!req.files || !req.files.length) {
        return res.status(400).json({
          error: "No image selected"
        });
      }

      const results = [];

      for (const file of req.files) {
        const result = await uploadToCloudinary(
          file.buffer,
          file.originalname
        );

        results.push({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height
        });
      }

      res.json({
        ok: true,
        images: results
      });
    } catch (error) {
      console.error("Cloudinary upload error:", error);

      res.status(500).json({
        error:
          "Image upload failed. Check Cloudinary settings."
      });
    }
  }
);

/* =========================
   PRODUCTS
========================= */

app.get("/api/admin/products", auth, (req, res) => {
  res.json(readData().products);
});

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

    price: Number(p.price || 0),

    oldPrice: Number(p.oldPrice || p.price || 0),

    discount: Number(p.discount || 0),

    stock: Number(p.stock || 0),

    image: String(p.image || ""),

    images: Array.isArray(p.images)
      ? p.images
      : []
  };

  data.products.push(product);

  writeData(data);

  res.json(product);
});

app.put("/api/admin/products/:id", auth, (req, res) => {
  const data = readData();

  const id = Number(req.params.id);

  const index = data.products.findIndex(
    item => Number(item.id) === id
  );

  if (index < 0) {
    return res.status(404).json({
      error: "Product not found"
    });
  }

  const oldProduct = data.products[index];

  const updated = {
    ...oldProduct,
    ...req.body,
    id
  };

  updated.price = Number(updated.price || 0);
  updated.oldPrice = Number(
    updated.oldPrice || updated.price
  );
  updated.stock = Number(updated.stock || 0);
  updated.discount = Number(updated.discount || 0);

  if (!Array.isArray(updated.images)) {
    updated.images = [];
  }

  data.products[index] = updated;

  writeData(data);

  res.json(updated);
});

app.delete("/api/admin/products/:id", auth, (req, res) => {
  const data = readData();

  const id = Number(req.params.id);

  data.products = data.products.filter(
    item => Number(item.id) !== id
  );

  writeData(data);

  res.json({
    ok: true
  });
});

/* =========================
   ORDERS
========================= */

app.get("/api/admin/orders", auth, (req, res) => {
  res.json(readData().orders);
});

app.put("/api/admin/orders/:id", auth, (req, res) => {
  const data = readData();

  const order = data.orders.find(
    item => item.id === req.params.id
  );

  if (!order) {
    return res.status(404).json({
      error: "Order not found"
    });
  }

  if (req.body.status) {
    order.status = req.body.status;
  }

  writeData(data);

  res.json(order);
});

/* =========================
   STORE SETTINGS
========================= */

app.put("/api/admin/settings", auth, (req, res) => {
  const data = readData();

  data.settings = {
    ...data.settings,
    ...req.body
  };

  writeData(data);

  res.json(data.settings);
});

/* =========================
   CUSTOMER ORDERS
========================= */

app.post("/api/orders", (req, res) => {
  const data = readData();

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

    const quantity = Math.max(
      1,
      Number(item.qty || 1)
    );

    if (!product) {
      return res.status(400).json({
        error: "Product not found"
      });
    }

    if (product.stock < quantity) {
      return res.status(400).json({
        error:
          "Out of stock: " +
          product.name
      });
    }

    total += product.price * quantity;

    cleanItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty: quantity
    });
  }

  const order = {
    id: "SM" + Date.now(),

    createdAt:
      new Date().toISOString(),

    customer,

    items: cleanItems,

    total,

    paymentMethod:
      paymentMethod || "cod",

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

  writeData(data);

  res.json({
    ok: true,
    orderId: order.id,
    total
  });
});

/* =========================
   PAYMENT PLACEHOLDER
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
      "Payment gateway credentials are not configured."
  });
});

/* =========================
   ADMIN PAGE
========================= */

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

/* =========================
   STORE FALLBACK
========================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================
   ERROR HANDLER
========================= */

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    error:
      error.message ||
      "Server error"
  });
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `SM Online Shop running on port ${PORT}`
  );
});
