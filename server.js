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

const DATA_FILE = path.join(__dirname, "data.json");

const SESSION_SECRET =
  process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET";

const ADMIN_USER =
  process.env.ADMIN_USER || "SMADMIN";

const ADMIN_PASS =
  process.env.ADMIN_PASS || "SM2728";

/* =========================
   CLOUDINARY
========================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* =========================
   DEFAULT DATA
========================= */

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

/* =========================
   DATA FILE
========================= */

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(defaultData, null, 2)
  );
}

function readData() {
  try {
    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    return {
      ...defaultData,
      ...data,
      settings: {
        ...defaultData.settings,
        ...(data.settings || {})
      },
      products: Array.isArray(data.products)
        ? data.products
        : [],
      orders: Array.isArray(data.orders)
        ? data.orders
        : []
    };
  } catch (error) {
    console.error("data.json read error:", error);
    return defaultData;
  }
}

function saveData(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

/* =========================
   ADMIN SESSIONS
========================= */

const sessions = new Map();

function createToken(username) {
  const randomPart =
    crypto.randomBytes(32).toString("hex");

  const timestamp = Date.now().toString();

  const raw =
    username +
    "." +
    timestamp +
    "." +
    randomPart;

  const signature =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(raw)
      .digest("hex");

  return signature + "." +
    Buffer.from(username).toString("base64url");
}

function adminAuth(req, res, next) {
  const authHeader =
    req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const token =
    authHeader.substring(7);

  if (!sessions.has(token)) {
    return res.status(401).json({
      error: "Session expired"
    });
  }

  req.adminUser =
    sessions.get(token);

  req.adminToken = token;

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

app.post(
  "/api/admin/login",
  (req, res) => {

    const username =
      String(
        req.body?.username || ""
      ).trim();

    const password =
      String(
        req.body?.password || ""
      );

    if (
      username !== ADMIN_USER ||
      password !== ADMIN_PASS
    ) {
      return res.status(401).json({
        error:
          "Invalid username or password"
      });
    }

    const token =
      createToken(username);

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

/* =========================
   ADMIN LOGOUT
========================= */

app.post(
  "/api/admin/logout",
  adminAuth,
  (req, res) => {

    sessions.delete(
      req.adminToken
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   ADMIN PRODUCTS
========================= */

app.get(
  "/api/admin/products",
  adminAuth,
  (req, res) => {

    const data =
      readData();

    res.json(
      data.products
    );
  }
);

/* =========================
   ADD PRODUCT
========================= */

app.post(
  "/api/admin/products",
  adminAuth,
  (req, res) => {

    try {

      const data =
        readData();

      const body =
        req.body || {};

      const name =
        String(
          body.name || ""
        ).trim();

      if (!name) {
        return res.status(400).json({
          error:
            "Product name is required"
        });
      }

      const price =
        Number(
          body.price || 0
        );

      if (price <= 0) {
        return res.status(400).json({
          error:
            "Valid product price is required"
        });
      }

      const product = {
        id: Date.now(),
        name,
        category:
          String(
            body.category ||
            "General"
          ),
        price,
        oldPrice:
          Number(
            body.oldPrice ||
            price
          ),
        discount:
          Number(
            body.discount || 0
          ),
        stock:
          Number(
            body.stock || 0
          ),
        image:
          String(
            body.image || ""
          ),
        createdAt:
          new Date().toISOString()
      };

      data.products.push(
        product
      );

      saveData(data);

      res.json(product);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not create product"
      });

    }
  }
);

/* =========================
   EDIT PRODUCT
========================= */

app.put(
  "/api/admin/products/:id",
  adminAuth,
  (req, res) => {

    try {

      const data =
        readData();

      const id =
        Number(
          req.params.id
        );

      const index =
        data.products.findIndex(
          product =>
            Number(product.id) === id
        );

      if (index === -1) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      const oldProduct =
        data.products[index];

      const body =
        req.body || {};

      const updatedProduct = {
        ...oldProduct,
        ...body,
        id
      };

      updatedProduct.name =
        String(
          updatedProduct.name || ""
        ).trim();

      updatedProduct.category =
        String(
          updatedProduct.category ||
          "General"
        );

      updatedProduct.price =
        Number(
          updatedProduct.price || 0
        );

      updatedProduct.oldPrice =
        Number(
          updatedProduct.oldPrice ||
          updatedProduct.price
        );

      updatedProduct.discount =
        Number(
          updatedProduct.discount || 0
        );

      updatedProduct.stock =
        Number(
          updatedProduct.stock || 0
        );

      updatedProduct.image =
        String(
          updatedProduct.image || ""
        );

      data.products[index] =
        updatedProduct;

      saveData(data);

      res.json(
        updatedProduct
      );

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not update product"
      });

    }
  }
);

/* =========================
   DELETE PRODUCT
========================= */

app.delete(
  "/api/admin/products/:id",
  adminAuth,
  (req, res) => {

    try {

      const data =
        readData();

      const id =
        Number(
          req.params.id
        );

      const oldLength =
        data.products.length;

      data.products =
        data.products.filter(
          product =>
            Number(product.id) !== id
        );

      if (
        data.products.length ===
        oldLength
      ) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      saveData(data);

      res.json({
        ok: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not delete product"
      });

    }
  }
);

/* =========================
   CLOUDINARY UPLOAD
========================= */

app.post(
  "/api/admin/upload",
  adminAuth,
  async (req, res) => {

    try {

      const image =
        req.body?.image;

      if (!image) {
        return res.status(400).json({
          error:
            "No image received"
        });
      }

      if (
        !process.env
          .CLOUDINARY_CLOUD_NAME ||
        !process.env
          .CLOUDINARY_API_KEY ||
        !process.env
          .CLOUDINARY_API_SECRET
      ) {
        return res.status(500).json({
          error:
            "Cloudinary environment variables are missing"
        });
      }

      const result =
        await cloudinary.uploader.upload(
          image,
          {
            folder:
              "sm-online-shop/products",
            resource_type:
              "image"
          }
        );

      res.json({
        ok: true,
        url:
          result.secure_url,
        public_id:
          result.public_id
      });

    } catch (error) {

      console.error(
        "Cloudinary upload error:",
        error
      );

      res.status(500).json({
        error:
          "Cloudinary image upload failed"
      });

    }
  }
);

/* =========================
   STORE SETTINGS
========================= */

app.put(
  "/api/admin/settings",
  adminAuth,
  (req, res) => {

    try {

      const data =
        readData();

      data.settings = {
        ...data.settings,
        ...(req.body || {})
      };

      saveData(data);

      res.json({
        ok: true,
        settings:
          data.settings
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not save settings"
      });

    }
  }
);

/* =========================
   ADMIN ORDERS
========================= */

app.get(
  "/api/admin/orders",
  adminAuth,
  (req, res) => {

    const data =
      readData();

    res.json(
      data.orders
    );
  }
);

/* =========================
   CREATE ORDER
========================= */

app.post(
  "/api/orders",
  (req, res) => {

    try {

      const data =
        readData();

      const body =
        req.body || {};

      const customer =
        body.customer;

      const items =
        body.items;

      const paymentMethod =
        body.paymentMethod ||
        "cod";

      if (
        !customer?.name ||
        !customer?.phone ||
        !customer?.address
      ) {
        return res.status(400).json({
          error:
            "Customer information is required"
        });
      }

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          error:
            "Order items are required"
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
              Number(product.id) ===
              Number(item.id)
          );

        if (!product) {
          return res.status(400).json({
            error:
              "Product not found"
          });
        }

        const qty =
          Math.max(
            1,
            Number(
              item.qty || 1
            )
          );

        if (
          Number(product.stock) <
          qty
        ) {
          return res.status(400).json({
            error:
              "Not enough stock for " +
              product.name
          });
        }

        total +=
          Number(product.price) *
          qty;

        cleanItems.push({
          id:
            product.id,
          name:
            product.name,
          price:
            product.price,
          qty
        });
      }

      const order = {
        id:
          "SM" +
          Date.now(),

        createdAt:
          new Date().toISOString(),

        customer: {
          name:
            String(
              customer.name
            ),
          phone:
            String(
              customer.phone
            ),
          address:
            String(
              customer.address
            )
        },

        items:
          cleanItems,

        total,

        paymentMethod:
          String(
            paymentMethod
          ),

        status:
          "Pending"
      };

      data.orders.unshift(
        order
      );

      for (
        const item of cleanItems
      ) {

        const product =
          data.products.find(
            product =>
              Number(product.id) ===
              Number(item.id)
          );

        if (product) {
          product.stock =
            Number(
              product.stock
            ) -
            Number(
              item.qty
            );
        }
      }

      saveData(data);

      res.json({
        ok: true,
        orderId:
          order.id,
        total
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not create order"
      });

    }
  }
);

/* =========================
   PAYMENT
========================= */

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
      return res.status(400).json({
        error:
          "Unsupported payment method"
      });
    }

    res.status(501).json({
      error:
        method +
        " payment gateway is not configured yet."
    });
  }
);

/* =========================
   ADMIN PAGE
========================= */

app.get(
  "/admin",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );

  }
);

/* =========================
   WEBSITE FALLBACK
   Express 5 SAFE VERSION
========================= */

app.use(
  (req, res, next) => {

    if (
      req.method === "GET" &&
      !req.path.startsWith("/api/")
    ) {

      const indexFile =
        path.join(
          __dirname,
          "public",
          "index.html"
        );

      if (
        fs.existsSync(indexFile)
      ) {
        return res.sendFile(
          indexFile
        );
      }

    }

    next();

  }
);

/* =========================
   404
========================= */

app.use(
  (req, res) => {

    res.status(404).json({
      error:
        "Not found"
    });

  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "SM Online Shop running on port " +
      PORT
    );

  }
);
