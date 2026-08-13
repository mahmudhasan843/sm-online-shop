const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

/* ================= BODY ================= */

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

/* ================= PUBLIC ================= */

app.use(express.static(path.join(__dirname, "public")));

/* ================= DATA ================= */

const DATA = path.join(__dirname, "data.json");

const SECRET =
  process.env.SESSION_SECRET ||
  "SM_ONLINE_SHOP_CHANGE_THIS_SECRET_2026";

const ADMIN_USER =
  process.env.ADMIN_USER ||
  "SMADMIN";

const ADMIN_PASS =
  process.env.ADMIN_PASS ||
  "SM2728";

/* ================= DEFAULT DATA ================= */

const defaultData = {
  settings: {
    shopName: "SM Online Shop",
    tagline: "Style • Comfort • Confidence ♥",
    phone1: "01827872334",
    phone2: "01886995687",
    facebook: "https://www.facebook.com/",
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
      oldPrice: 2130,
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
      name: "Stylish Hand Bag",
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

/* ================= DATA FILE ================= */

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(defaultData, null, 2)
  );
}

function read() {
  try {
    return JSON.parse(
      fs.readFileSync(DATA, "utf8")
    );
  } catch (error) {
    console.error("DATA READ ERROR:", error);
    return defaultData;
  }
}

function write(data) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(data, null, 2)
  );
}

/* ================= SESSION ================= */

const sessions = new Map();

function makeToken(user) {
  const raw =
    user +
    "." +
    Date.now() +
    "." +
    crypto.randomBytes(24).toString("hex");

  const hash = crypto
    .createHmac("sha256", SECRET)
    .update(raw)
    .digest("hex");

  return (
    hash +
    "." +
    Buffer.from(user).toString("base64url")
  );
}

function getToken(req) {
  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return "";
  }

  return header.slice(7);
}

function auth(req, res, next) {
  const token = getToken(req);

  if (
    !token ||
    !sessions.has(token)
  ) {
    return res
      .status(401)
      .json({
        error: "Unauthorized"
      });
  }

  req.admin = sessions.get(token);

  next();
}

/* ================= STORE API ================= */

app.get("/api/store", (req, res) => {
  const data = read();

  res.json({
    settings: data.settings,
    products: data.products
  });
});

/* ================= ADMIN LOGIN ================= */

app.post(
  "/api/admin/login",
  (req, res) => {
    const {
      username,
      password
    } = req.body || {};

    if (
      username !== ADMIN_USER ||
      password !== ADMIN_PASS
    ) {
      return res
        .status(401)
        .json({
          error: "Invalid username or password"
        });
    }

    const token =
      makeToken(username);

    sessions.set(
      token,
      username
    );

    res.json({
      ok: true,
      token
    });
  }
);

/* ================= ADMIN ME ================= */

app.get(
  "/api/admin/me",
  auth,
  (req, res) => {
    res.json({
      ok: true,
      username: req.admin
    });
  }
);

/* ================= LOGOUT ================= */

app.post(
  "/api/admin/logout",
  auth,
  (req, res) => {
    const token = getToken(req);

    sessions.delete(token);

    res.json({
      ok: true
    });
  }
);

/* ================= DASHBOARD ================= */

app.get(
  "/api/admin/dashboard",
  auth,
  (req, res) => {
    const data = read();

    const products =
      data.products.length;

    const orders =
      data.orders.length;

    const pending =
      data.orders.filter(
        order =>
          order.status === "Pending"
      ).length;

    const sales =
      data.orders
        .filter(
          order =>
            order.status !== "Cancelled"
        )
        .reduce(
          (sum, order) =>
            sum +
            Number(order.total || 0),
          0
        );

    res.json({
      products,
      orders,
      pending,
      sales
    });
  }
);

/* ================= PRODUCTS ================= */

app.get(
  "/api/admin/products",
  auth,
  (req, res) => {
    res.json(
      read().products
    );
  }
);

/* ================= ADD PRODUCT ================= */

app.post(
  "/api/admin/products",
  auth,
  (req, res) => {
    const data = read();

    const product = {
      ...req.body
    };

    if (
      !product.name ||
      product.price == null ||
      product.price === ""
    ) {
      return res
        .status(400)
        .json({
          error:
            "Product name and price are required"
        });
    }

    product.id = Date.now();

    product.price =
      Number(product.price);

    product.oldPrice =
      Number(
        product.oldPrice ||
        product.price
      );

    product.stock =
      Number(
        product.stock || 0
      );

    product.discount =
      Number(
        product.discount || 0
      );

    product.category =
      product.category || "";

    product.image =
      product.image || "";

    data.products.push(product);

    write(data);

    res.json(product);
  }
);

/* ================= EDIT PRODUCT ================= */

app.put(
  "/api/admin/products/:id",
  auth,
  (req, res) => {
    const data = read();

    const id =
      Number(req.params.id);

    const index =
      data.products.findIndex(
        product =>
          product.id === id
      );

    if (index < 0) {
      return res
        .status(404)
        .json({
          error:
            "Product not found"
        });
    }

    data.products[index] = {
      ...data.products[index],
      ...req.body,
      id
    };

    for (
      const key of [
        "price",
        "oldPrice",
        "stock",
        "discount"
      ]
    ) {
      if (
        data.products[index][key] != null
      ) {
        data.products[index][key] =
          Number(
            data.products[index][key]
          );
      }
    }

    write(data);

    res.json(
      data.products[index]
    );
  }
);

/* ================= DELETE PRODUCT ================= */

app.delete(
  "/api/admin/products/:id",
  auth,
  (req, res) => {
    const data = read();

    const id =
      Number(req.params.id);

    data.products =
      data.products.filter(
        product =>
          product.id !== id
      );

    write(data);

    res.json({
      ok: true
    });
  }
);

/* ================= ORDERS ================= */

app.get(
  "/api/admin/orders",
  auth,
  (req, res) => {
    res.json(
      read().orders
    );
  }
);

/* ================= UPDATE ORDER ================= */

app.put(
  "/api/admin/orders/:id",
  auth,
  (req, res) => {
    const data = read();

    const id =
      String(req.params.id);

    const order =
      data.orders.find(
        item =>
          String(item.id) === id
      );

    if (!order) {
      return res
        .status(404)
        .json({
          error:
            "Order not found"
        });
    }

    const allowed = [
      "Pending",
      "Confirmed",
      "Delivered",
      "Cancelled"
    ];

    if (
      !allowed.includes(
        req.body.status
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid order status"
        });
    }

    order.status =
      req.body.status;

    write(data);

    res.json({
      ok: true,
      order
    });
  }
);

/* ================= STORE SETTINGS ================= */

app.get(
  "/api/admin/settings",
  auth,
  (req, res) => {
    res.json(
      read().settings
    );
  }
);

app.put(
  "/api/admin/settings",
  auth,
  (req, res) => {
    const data = read();

    data.settings = {
      ...data.settings,
      ...req.body
    };

    write(data);

    res.json(
      data.settings
    );
  }
);

/* ================= CREATE CUSTOMER ORDER ================= */

app.post(
  "/api/orders",
  (req, res) => {
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
      return res
        .status(400)
        .json({
          error:
            "Customer and order details are required"
        });
    }

    let total = 0;

    const cleanItems = [];

    for (
      const item of items
    ) {
      const product =
        data.products.find(
          product =>
            product.id ===
            Number(item.id)
        );

      const quantity =
        Math.max(
          1,
          Number(
            item.qty || 1
          )
        );

      if (
        !product ||
        product.stock < quantity
      ) {
        return res
          .status(400)
          .json({
            error:
              `Out of stock: ${
                product?.name ||
                "product"
              }`
          });
      }

      total +=
        product.price *
        quantity;

      cleanItems.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: quantity
      });
    }

    const order = {
      id:
        "SM" +
        Date.now(),

      createdAt:
        new Date().toISOString(),

      customer,

      items:
        cleanItems,

      total,

      paymentMethod:
        paymentMethod ||
        "cod",

      status:
        "Pending"
    };

    data.orders.unshift(
      order
    );

    cleanItems.forEach(
      item => {
        const product =
          data.products.find(
            p =>
              p.id === item.id
          );

        if (product) {
          product.stock -=
            item.qty;
        }
      }
    );

    write(data);

    res.json({
      ok: true,
      orderId: order.id,
      total
    });
  }
);

/* ================= PAYMENT ================= */

app.post(
  "/api/payment/create",
  (req, res) => {
    const method =
      req.body?.method;

    if (
      ![
        "bkash",
        "nagad",
        "card"
      ].includes(method)
    ) {
      return res
        .status(400)
        .json({
          error:
            "Unsupported payment method"
        });
    }

    res.status(501).json({
      error:
        `${method} gateway credentials are not configured.`
    });
  }
);

/* ================= FALLBACK ================= */

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* ================= START ================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `SM Online Shop running on port ${PORT}`
    );
  }
);
