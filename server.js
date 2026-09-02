const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================================
   BASIC CONFIG
   ========================================================= */

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use(express.static(path.join(__dirname, "public")));

const ADMIN_USER = String(
  process.env.ADMIN_USER || "SMADMIN"
).trim();

const ADMIN_PASS = String(
  process.env.ADMIN_PASS || "SM2728"
).trim();

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "SM_ONLINE_SHOP_SECRET_2026_CHANGE_ME";

/* =========================================================
   DATABASE
   ========================================================= */

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

/* =========================================================
   CLOUDINARY
   ========================================================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* =========================================================
   SETTINGS
   ========================================================= */

const defaultSettings = {
  shopName: "SM Online Shop",
  tagline: "Style • Comfort • Confidence ♥",
  phone1: "01827872334",
  phone2: "01886995687",
  facebook: "",
  currency: "BDT"
};

const ORDER_STATUSES = [
  "Pending",
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled"
];

const PAYMENT_STATUSES = [
  "Pending",
  "Paid",
  "Failed",
  "Refunded"
];

/* =========================================================
   HELPERS
   ========================================================= */

function cleanText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim();
}

function positiveNumber(value, fallback = 0) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return n;
}

function nonNegativeInt(value, fallback = 0) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.max(0, Math.floor(n));
}

function makeId(prefix) {
  return (
    prefix +
    Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(4).toString("hex").toUpperCase()
  );
}

function makeProductId() {
  return makeId("P");
}

function makeOrderId() {
  return makeId("SM");
}

function makeCustomerId() {
  return makeId("C");
}

function safeJsonParse(value, fallback = null) {
  try {
    if (value === null || value === undefined) {
      return fallback;
    }

    if (typeof value === "object") {
      return value;
    }

    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isValidStatusTransition(oldStatus, newStatus) {
  if (oldStatus === newStatus) {
    return true;
  }

  if (oldStatus === "Cancelled") {
    return false;
  }

  if (oldStatus === "Delivered") {
    return false;
  }

  if (newStatus === "Cancelled") {
    return true;
  }

  const order = [
    "Pending",
    "Confirmed",
    "Processing",
    "Shipped",
    "Delivered"
  ];

  const oldIndex = order.indexOf(oldStatus);
  const newIndex = order.indexOf(newStatus);

  if (oldIndex === -1 || newIndex === -1) {
    return false;
  }

  return newIndex >= oldIndex;
}

/* =========================================================
   DATABASE COLUMN TYPE
   ========================================================= */

async function columnType(tableName, columnName, client = pool) {
  const result = await client.query(
    `
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0].data_type;
}

/* =========================================================
   DATABASE INITIALIZATION
   ========================================================= */

async function initDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* =====================================================
       STORE SETTINGS
       ===================================================== */

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY,
        shop_name TEXT NOT NULL DEFAULT 'SM Online Shop',
        tagline TEXT NOT NULL DEFAULT 'Style • Comfort • Confidence ♥',
        phone1 TEXT NOT NULL DEFAULT '01827872334',
        phone2 TEXT NOT NULL DEFAULT '01886995687',
        facebook TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'BDT',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* =====================================================
       PRODUCTS
       ===================================================== */

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Unnamed Product',
        category TEXT NOT NULL DEFAULT 'General',
        description TEXT NOT NULL DEFAULT '',
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        old_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount NUMERIC(6,2) NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        image TEXT NOT NULL DEFAULT '',
        gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* =====================================================
       REPAIR OLD PRODUCT TABLE
       ===================================================== */

    const productIdType = await columnType(
      "products",
      "id",
      client
    );

    if (
      productIdType &&
      productIdType !== "text" &&
      productIdType !== "character varying"
    ) {
      await client.query(`
        ALTER TABLE products
        ALTER COLUMN id DROP DEFAULT
      `);

      await client.query(`
        ALTER TABLE products
        ALTER COLUMN id TYPE TEXT
        USING id::text
      `);
    }

    await client.query(`
      ALTER TABLE products
      ALTER COLUMN id DROP DEFAULT
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS name TEXT
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS old_price NUMERIC(12,2) DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount NUMERIC(6,2) DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS image TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS gallery JSONB DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);

    /* Repair NULL values */

    await client.query(`
      UPDATE products
      SET name = 'Unnamed Product'
      WHERE name IS NULL OR BTRIM(name) = ''
    `);

    await client.query(`
      UPDATE products
      SET category = 'General'
      WHERE category IS NULL
    `);

    await client.query(`
      UPDATE products
      SET description = ''
      WHERE description IS NULL
    `);

    await client.query(`
      UPDATE products
      SET price = 0
      WHERE price IS NULL
    `);

    await client.query(`
      UPDATE products
      SET old_price = price
      WHERE old_price IS NULL
    `);

    await client.query(`
      UPDATE products
      SET discount = 0
      WHERE discount IS NULL
    `);

    await client.query(`
      UPDATE products
      SET stock = 0
      WHERE stock IS NULL
    `);

    await client.query(`
      UPDATE products
      SET image = ''
      WHERE image IS NULL
    `);

    await client.query(`
      UPDATE products
      SET gallery = '[]'::jsonb
      WHERE gallery IS NULL
    `);

    await client.query(`
      UPDATE products
      SET created_at = NOW()
      WHERE created_at IS NULL
    `);

    await client.query(`
      UPDATE products
      SET updated_at = NOW()
      WHERE updated_at IS NULL
    `);

    /* =====================================================
       ORDERS
       ===================================================== */

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        customer JSONB NOT NULL DEFAULT '{}'::jsonb,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'cod',
        status TEXT NOT NULL DEFAULT 'Pending',
        payment_status TEXT NOT NULL DEFAULT 'Pending',
        stock_restored BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const orderIdType = await columnType(
      "orders",
      "id",
      client
    );

    if (
      orderIdType &&
      orderIdType !== "text" &&
      orderIdType !== "character varying"
    ) {
      await client.query(`
        ALTER TABLE orders
        ALTER COLUMN id DROP DEFAULT
      `);

      await client.query(`
        ALTER TABLE orders
        ALTER COLUMN id TYPE TEXT
        USING id::text
      `);
    }

    await client.query(`
      ALTER TABLE orders
      ALTER COLUMN id DROP DEFAULT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer JSONB DEFAULT '{}'::jsonb
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cod'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Pending'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Pending'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN DEFAULT FALSE
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      UPDATE orders
      SET customer = '{}'::jsonb
      WHERE customer IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET items = '[]'::jsonb
      WHERE items IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET total = 0
      WHERE total IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET payment_method = 'cod'
      WHERE payment_method IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET status = 'Pending'
      WHERE status IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET payment_status = 'Pending'
      WHERE payment_status IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET stock_restored = FALSE
      WHERE stock_restored IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET created_at = NOW()
      WHERE created_at IS NULL
    `);

    await client.query(`
      UPDATE orders
      SET updated_at = NOW()
      WHERE updated_at IS NULL
    `);

    /* =====================================================
       CUSTOMERS
       ===================================================== */

    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const customerIdType = await columnType(
      "customers",
      "id",
      client
    );

    if (
      customerIdType &&
      customerIdType !== "text" &&
      customerIdType !== "character varying"
    ) {
      await client.query(`
        ALTER TABLE customers
        ALTER COLUMN id DROP DEFAULT
      `);

      await client.query(`
        ALTER TABLE customers
        ALTER COLUMN id TYPE TEXT
        USING id::text
      `);
    }

    await client.query(`
      ALTER TABLE customers
      ALTER COLUMN id DROP DEFAULT
    `);

    /* =====================================================
       SETTINGS - NO ON CONFLICT
       ===================================================== */

    const settingsCheck = await client.query(`
      SELECT id
      FROM store_settings
      WHERE id = 1
      LIMIT 1
    `);

    if (!settingsCheck.rows.length) {
      await client.query(
        `
        INSERT INTO store_settings
        (
          id,
          shop_name,
          tagline,
          phone1,
          phone2,
          facebook,
          currency,
          updated_at
        )
        VALUES
        (1, $1, $2, $3, $4, $5, $6, NOW())
        `,
        [
          defaultSettings.shopName,
          defaultSettings.tagline,
          defaultSettings.phone1,
          defaultSettings.phone2,
          defaultSettings.facebook,
          defaultSettings.currency
        ]
      );
    }

    await client.query("COMMIT");

    console.log("Database initialized successfully.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error(
      "Database initialization error:",
      error
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   ADMIN AUTH
   ========================================================= */

/*
   Simple in-memory admin sessions.
   Render restart হলে session আবার login করতে হবে।
*/

const adminSessions = new Map();

function createAdminToken() {
  const random = crypto.randomBytes(32).toString("hex");

  const timestamp = Date.now().toString();

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(random + timestamp)
    .digest("hex");

  return `${random}.${timestamp}.${signature}`;
}

function adminAuth(req, res, next) {
  const authHeader = cleanText(
    req.headers.authorization
  );

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Admin login required"
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({
      error: "Invalid or expired admin session"
    });
  }

  const session = adminSessions.get(token);

  if (
    !session ||
    Date.now() - session.createdAt >
      24 * 60 * 60 * 1000
  ) {
    adminSessions.delete(token);

    return res.status(401).json({
      error: "Admin session expired"
    });
  }

  req.admin = {
    username: session.username
  };

  next();
}

/* =========================================================
   ADMIN LOGIN
   ========================================================= */

app.post("/api/admin/login", (req, res) => {
  try {
    const username = cleanText(
      req.body?.username
    );

    const password = cleanText(
      req.body?.password
    );

    console.log(
      "Admin login attempt:",
      username
    );

    if (
      username !== ADMIN_USER ||
      password !== ADMIN_PASS
    ) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    const token = createAdminToken();

    adminSessions.set(token, {
      username,
      createdAt: Date.now()
    });

    return res.json({
      ok: true,
      token,
      username
    });
  } catch (error) {
    console.error(
      "Admin login error:",
      error
    );

    return res.status(500).json({
      error: "Login failed"
    });
  }
});

/* =========================================================
   ADMIN CHECK
   ========================================================= */

app.get(
  "/api/admin/check",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,
      loggedIn: true,
      username: req.admin.username
    });
  }
);

/* =========================================================
   ADMIN LOGOUT
   ========================================================= */

app.post(
  "/api/admin/logout",
  adminAuth,
  (req, res) => {
    const authHeader =
      cleanText(req.headers.authorization);

    const token = authHeader
      .replace(/^Bearer\s+/i, "")
      .trim();

    adminSessions.delete(token);

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   STORE API
   ========================================================= */

app.get("/api/store", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        shop_name AS "shopName",
        tagline,
        phone1,
        phone2,
        facebook,
        currency,
        updated_at AS "updatedAt"
      FROM store_settings
      WHERE id = 1
      LIMIT 1
    `);

    if (!result.rows.length) {
      return res.json({
        ok: true,
        store: defaultSettings
      });
    }

    res.json({
      ok: true,
      store: result.rows[0]
    });
  } catch (error) {
    console.error(
      "Store API error:",
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   PUBLIC PRODUCTS
   ========================================================= */

app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id::text AS id,
        name,
        category,
        description,
        price::float AS price,
        old_price::float AS "oldPrice",
        discount::float AS discount,
        stock,
        image,
        gallery,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM products
      ORDER BY created_at DESC
    `);

    const products = result.rows.map((p) => ({
      ...p,
      gallery: Array.isArray(p.gallery)
        ? p.gallery
        : safeJsonParse(p.gallery, [])
    }));

    res.json({
      ok: true,
      products
    });
  } catch (error) {
    console.error(
      "Products API error:",
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   ADMIN GET PRODUCTS
   ========================================================= */

app.get(
  "/api/admin/products",
  adminAuth,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          id::text AS id,
          name,
          category,
          description,
          price::float AS price,
          old_price::float AS "oldPrice",
          discount::float AS discount,
          stock,
          image,
          gallery,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM products
        ORDER BY created_at DESC
      `);

      const products = result.rows.map((p) => ({
        ...p,
        gallery: Array.isArray(p.gallery)
          ? p.gallery
          : safeJsonParse(p.gallery, [])
      }));

      res.json({
        ok: true,
        products
      });
    } catch (error) {
      console.error(
        "Admin products error:",
        error
      );

      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   CLOUDINARY IMAGE UPLOAD
   ========================================================= */

app.post(
  "/api/admin/upload",
  adminAuth,
  async (req, res) => {
    try {
      let imageData =
        req.body?.image ||
        req.body?.file ||
        req.body?.data;

      if (!imageData) {
        return res.status(400).json({
          error: "Image data is required"
        });
      }

      imageData = String(imageData);

      if (
        !imageData.startsWith("data:image/")
      ) {
        return res.status(400).json({
          error:
            "Invalid image format. Please upload an image file."
        });
      }

      const result =
        await cloudinary.uploader.upload(
          imageData,
          {
            folder: "sm-online-shop/products",
            resource_type: "image"
          }
        );

      return res.json({
        ok: true,
        url: result.secure_url,
        publicId: result.public_id
      });
    } catch (error) {
      console.error(
        "Cloudinary upload error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Image upload failed"
      });
    }
  }
);

/* =========================================================
   CREATE PRODUCT
   ========================================================= */

app.post(
  "/api/admin/products",
  adminAuth,
  async (req, res) => {
    try {
      const body = req.body || {};

      const name = cleanText(body.name);

      if (!name) {
        return res.status(400).json({
          error: "Product name is required"
        });
      }

      const category =
        cleanText(
          body.category,
          "General"
        ) || "General";

      const description =
        cleanText(
          body.description,
          ""
        );

      const price = positiveNumber(
        body.price,
        0
      );

      const oldPrice = positiveNumber(
        body.oldPrice ??
          body.old_price,
        price
      );

      const discount = positiveNumber(
        body.discount,
        0
      );

      const stock = nonNegativeInt(
        body.stock,
        0
      );

      const image = cleanText(
        body.image,
        ""
      );

      let gallery =
        body.gallery;

      if (!Array.isArray(gallery)) {
        gallery = [];
      }

      gallery = gallery
        .map((x) => cleanText(x))
        .filter(Boolean);

      if (
        image &&
        !gallery.includes(image)
      ) {
        gallery.unshift(image);
      }

      const productId =
        makeProductId();

      const result = await pool.query(
        `
        INSERT INTO products
        (
          id,
          name,
          category,
          description,
          price,
          old_price,
          discount,
          stock,
          image,
          gallery,
          created_at,
          updated_at
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::jsonb,
          NOW(),
          NOW()
        )
        RETURNING
          id::text AS id,
          name,
          category,
          description,
          price::float AS price,
          old_price::float AS "oldPrice",
          discount::float AS discount,
          stock,
          image,
          gallery,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          productId,
          name,
          category,
          description,
          price,
          oldPrice,
          discount,
          stock,
          image,
          JSON.stringify(gallery)
        ]
      );

      res.status(201).json({
        ok: true,
        product: result.rows[0]
      });
    } catch (error) {
      console.error(
        "Create product error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not create product"
      });
    }
  }
);

/* =========================================================
   UPDATE PRODUCT
   ========================================================= */

app.put(
  "/api/admin/products/:id",
  adminAuth,
  async (req, res) => {
    try {
      const productId =
        cleanText(req.params.id);

      if (!productId) {
        return res.status(400).json({
          error: "Product ID is required"
        });
      }

      const body = req.body || {};

      const existingResult =
        await pool.query(
          `
          SELECT
            id::text AS id,
            name,
            category,
            description,
            price::float AS price,
            old_price::float AS "oldPrice",
            discount::float AS discount,
            stock,
            image,
            gallery
          FROM products
          WHERE id = $1
          `,
          [productId]
        );

      if (!existingResult.rows.length) {
        return res.status(404).json({
          error: "Product not found"
        });
      }

      const existing =
        existingResult.rows[0];

      const name =
        body.name !== undefined
          ? cleanText(body.name)
          : existing.name;

      const category =
        body.category !== undefined
          ? cleanText(
              body.category,
              "General"
            )
          : existing.category;

      const description =
        body.description !== undefined
          ? cleanText(
              body.description
            )
          : existing.description;

      const price =
        body.price !== undefined
          ? positiveNumber(
              body.price,
              existing.price
            )
          : existing.price;

      const oldPrice =
        body.oldPrice !== undefined ||
        body.old_price !== undefined
          ? positiveNumber(
              body.oldPrice ??
                body.old_price,
              price
            )
          : existing.oldPrice;

      const discount =
        body.discount !== undefined
          ? positiveNumber(
              body.discount,
              existing.discount
            )
          : existing.discount;

      const stock =
        body.stock !== undefined
          ? nonNegativeInt(
              body.stock,
              existing.stock
            )
          : existing.stock;

      const image =
        body.image !== undefined
          ? cleanText(body.image)
          : existing.image;

      let gallery =
        body.gallery !== undefined
          ? body.gallery
          : existing.gallery;

      if (!Array.isArray(gallery)) {
        gallery = [];
      }

      gallery = gallery
        .map((x) => cleanText(x))
        .filter(Boolean);

      if (
        image &&
        !gallery.includes(image)
      ) {
        gallery.unshift(image);
      }

      const result =
        await pool.query(
          `
          UPDATE products
          SET
            name = $1,
            category = $2,
            description = $3,
            price = $4,
            old_price = $5,
            discount = $6,
            stock = $7,
            image = $8,
            gallery = $9::jsonb,
            updated_at = NOW()
          WHERE id = $10
          RETURNING
            id::text AS id,
            name,
            category,
            description,
            price::float AS price,
            old_price::float AS "oldPrice",
            discount::float AS discount,
            stock,
            image,
            gallery,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          `,
          [
            name,
            category,
            description,
            price,
            oldPrice,
            discount,
            stock,
            image,
            JSON.stringify(gallery),
            productId
          ]
        );

      res.json({
        ok: true,
        product: result.rows[0]
      });
    } catch (error) {
      console.error(
        "Update product error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not update product"
      });
    }
  }
);

/* =========================================================
   DELETE PRODUCT
   ========================================================= */

app.delete(
  "/api/admin/products/:id",
  adminAuth,
  async (req, res) => {
    try {
      const productId =
        cleanText(req.params.id);

      const result =
        await pool.query(
          `
          DELETE FROM products
          WHERE id = $1
          RETURNING id::text AS id
          `,
          [productId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Product not found"
        });
      }

      res.json({
        ok: true,
        message: "Product deleted",
        id: result.rows[0].id
      });
    } catch (error) {
      console.error(
        "Delete product error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not delete product"
      });
    }
  }
);

/* =========================================================
   SAVE CUSTOMER
   ========================================================= */

async function saveCustomer(
  client,
  customer
) {
  const name =
    cleanText(customer?.name);

  const phone =
    cleanText(customer?.phone);

  const address =
    cleanText(customer?.address);

  if (!phone) {
    return null;
  }

  const existing =
    await client.query(
      `
      SELECT id
      FROM customers
      WHERE phone = $1
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [phone]
    );

  if (existing.rows.length) {
    const customerId =
      String(existing.rows[0].id);

    await client.query(
      `
      UPDATE customers
      SET
        name = $1,
        address = $2,
        updated_at = NOW()
      WHERE id = $3
      `,
      [
        name,
        address,
        customerId
      ]
    );

    return customerId;
  }

  const customerId =
    makeCustomerId();

  await client.query(
    `
    INSERT INTO customers
    (
      id,
      name,
      phone,
      address,
      created_at,
      updated_at
    )
    VALUES
    ($1, $2, $3, $4, NOW(), NOW())
    `,
    [
      customerId,
      name,
      phone,
      address
    ]
  );

  return customerId;
}

/* =========================================================
   CREATE ORDER
   ========================================================= */

app.post(
  "/api/orders",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const body =
        req.body || {};

      const customer =
        body.customer;

      const items =
        body.items;

      const paymentMethod =
        cleanText(
          body.paymentMethod,
          "cod"
        ) || "cod";

      if (
        !customer ||
        !cleanText(customer.name) ||
        !cleanText(customer.phone) ||
        !cleanText(customer.address)
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

      await client.query("BEGIN");

      const quantityMap =
        new Map();

      for (const item of items) {
        const productId =
          cleanText(item?.id);

        const qty =
          Math.max(
            1,
            nonNegativeInt(
              item?.qty,
              1
            )
          );

        if (!productId) {
          throw new Error(
            "Invalid product ID"
          );
        }

        quantityMap.set(
          productId,
          (quantityMap.get(
            productId
          ) || 0) + qty
        );
      }

      let total = 0;

      const cleanItems = [];

      for (
        const [
          productId,
          qty
        ] of quantityMap
      ) {
        const result =
          await client.query(
            `
            SELECT
              id::text AS id,
              name,
              price::float AS price,
              stock,
              image
            FROM products
            WHERE id = $1
            FOR UPDATE
            `,
            [productId]
          );

        if (!result.rows.length) {
          throw new Error(
            `Product not found: ${productId}`
          );
        }

        const product =
          result.rows[0];

        if (
          Number(product.stock) <
          qty
        ) {
          throw new Error(
            `Not enough stock for ${product.name}`
          );
        }

        const price =
          Number(product.price);

        total +=
          price * qty;

        cleanItems.push({
          id: String(
            product.id
          ),
          name: product.name,
          price,
          qty,
          image:
            product.image || ""
        });
      }

      total =
        Math.round(
          total * 100
        ) / 100;

      const cleanCustomer = {
        name: cleanText(
          customer.name
        ),
        phone: cleanText(
          customer.phone
        ),
        address: cleanText(
          customer.address
        )
      };

      await saveCustomer(
        client,
        cleanCustomer
      );

      /*
         IMPORTANT:
         Order ID is generated in Node.js.
         PostgreSQL sequence is NOT used.
      */

      const orderId =
        makeOrderId();

      await client.query(
        `
        INSERT INTO orders
        (
          id,
          created_at,
          customer,
          items,
          total,
          payment_method,
          status,
          payment_status,
          stock_restored,
          updated_at
        )
        VALUES
        (
          $1,
          NOW(),
          $2::jsonb,
          $3::jsonb,
          $4,
          $5,
          'Pending',
          'Pending',
          FALSE,
          NOW()
        )
        `,
        [
          orderId,
          JSON.stringify(
            cleanCustomer
          ),
          JSON.stringify(
            cleanItems
          ),
          total,
          paymentMethod
        ]
      );

      /* Reduce stock */

      for (const item of cleanItems) {
        const stockUpdate =
          await client.query(
            `
            UPDATE products
            SET
              stock = stock - $1,
              updated_at = NOW()
            WHERE id = $2
              AND stock >= $1
            `,
            [
              item.qty,
              item.id
            ]
          );

        if (
          stockUpdate.rowCount !== 1
        ) {
          throw new Error(
            `Stock changed while placing order for ${item.name}. Please try again.`
          );
        }
      }

      await client.query(
        "COMMIT"
      );

      res.status(201).json({
        ok: true,
        orderId,
        total,
        status: "Pending",
        paymentStatus: "Pending"
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "CREATE ORDER ERROR:",
        error
      );

      res.status(400).json({
        error:
          error.message ||
          "Could not create order"
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   RESTORE ORDER STOCK
   ========================================================= */

async function restoreOrderStock(
  client,
  order
) {
  if (order.stock_restored === true) {
    return;
  }

  const items =
    Array.isArray(order.items)
      ? order.items
      : safeJsonParse(
          order.items,
          []
        );

  if (!Array.isArray(items)) {
    throw new Error(
      "Order items are invalid"
    );
  }

  for (const item of items) {
    const productId =
      cleanText(item?.id);

    const qty =
      nonNegativeInt(
        item?.qty,
        0
      );

    if (
      !productId ||
      qty <= 0
    ) {
      continue;
    }

    await client.query(
      `
      UPDATE products
      SET
        stock = stock + $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        qty,
        productId
      ]
    );
  }

  await client.query(
    `
    UPDATE orders
    SET stock_restored = TRUE
    WHERE id = $1
    `,
    [order.id]
  );
}

/* =========================================================
   ADMIN ORDERS
   ========================================================= */

app.get(
  "/api/admin/orders",
  adminAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            id::text AS id,
            created_at AS "createdAt",
            customer,
            items,
            total::float AS total,
            payment_method AS "paymentMethod",
            status,
            payment_status AS "paymentStatus",
            stock_restored AS "stockRestored",
            updated_at AS "updatedAt"
          FROM orders
          ORDER BY created_at DESC
        `);

      const orders =
        result.rows.map(
          (order) => ({
            ...order,
            customer:
              safeJsonParse(
                order.customer,
                {}
              ),
            items:
              safeJsonParse(
                order.items,
                []
              )
          })
        );

      res.json({
        ok: true,
        orders
      });
    } catch (error) {
      console.error(
        "Admin orders error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not load orders"
      });
    }
  }
);

/* =========================================================
   ADMIN UPDATE ORDER STATUS
   ========================================================= */

app.put(
  "/api/admin/orders/:id/status",
  adminAuth,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const orderId =
        cleanText(
          req.params.id
        );

      const newStatus =
        cleanText(
          req.body?.status
        );

      if (
        !ORDER_STATUSES.includes(
          newStatus
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid order status"
        });
      }

      await client.query(
        "BEGIN"
      );

      const orderResult =
        await client.query(
          `
          SELECT
            id::text AS id,
            created_at AS "createdAt",
            customer,
            items,
            total::float AS total,
            payment_method AS "paymentMethod",
            status,
            payment_status AS "paymentStatus",
            stock_restored
          FROM orders
          WHERE id = $1
          FOR UPDATE
          `,
          [orderId]
        );

      if (
        !orderResult.rows.length
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      const order =
        orderResult.rows[0];

      if (
        !isValidStatusTransition(
          order.status,
          newStatus
        )
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            `Cannot change order status from ${order.status} to ${newStatus}`
        });
      }

      if (
        newStatus ===
        "Cancelled"
      ) {
        await restoreOrderStock(
          client,
          order
        );
      }

      const updated =
        await client.query(
          `
          UPDATE orders
          SET
            status = $1,
            updated_at = NOW()
          WHERE id = $2
          RETURNING
            id::text AS id,
            created_at AS "createdAt",
            customer,
            items,
            total::float AS total,
            payment_method AS "paymentMethod",
            status,
            payment_status AS "paymentStatus",
            stock_restored AS "stockRestored",
            updated_at AS "updatedAt"
          `,
          [
            newStatus,
            orderId
          ]
        );

      await client.query(
        "COMMIT"
      );

      const updatedOrder =
        updated.rows[0];

      updatedOrder.customer =
        safeJsonParse(
          updatedOrder.customer,
          {}
        );

      updatedOrder.items =
        safeJsonParse(
          updatedOrder.items,
          []
        );

      res.json({
        ok: true,
        order: updatedOrder
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "Update order status error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not update order status"
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   CUSTOMER CANCEL ORDER
   ========================================================= */

app.put(
  "/api/orders/:id/cancel",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const orderId =
        cleanText(
          req.params.id
        );

      if (!orderId) {
        return res.status(400).json({
          error:
            "Order ID is required"
        });
      }

      await client.query(
        "BEGIN"
      );

      const result =
        await client.query(
          `
          SELECT
            id::text AS id,
            created_at AS "createdAt",
            customer,
            items,
            total::float AS total,
            payment_method AS "paymentMethod",
            status,
            payment_status AS "paymentStatus",
            stock_restored
          FROM orders
          WHERE id = $1
          FOR UPDATE
          `,
          [orderId]
        );

      if (
        !result.rows.length
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      const order =
        result.rows[0];

      if (
        order.status ===
        "Cancelled"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.json({
          ok: true,
          message:
            "Order is already cancelled",
          order
        });
      }

      if (
        order.status ===
        "Delivered"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            "Delivered order cannot be cancelled"
        });
      }

      await restoreOrderStock(
        client,
        order
      );

      const updated =
        await client.query(
          `
          UPDATE orders
          SET
            status = 'Cancelled',
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id::text AS id,
            created_at AS "createdAt",
            customer,
            items,
            total::float AS total,
            payment_method AS "paymentMethod",
            status,
            payment_status AS "paymentStatus",
            stock_restored AS "stockRestored"
          `,
          [orderId]
        );

      await client.query(
        "COMMIT"
      );

      const updatedOrder =
        updated.rows[0];

      updatedOrder.customer =
        safeJsonParse(
          updatedOrder.customer,
          {}
        );

      updatedOrder.items =
        safeJsonParse(
          updatedOrder.items,
          []
        );

      res.json({
        ok: true,
        order: updatedOrder
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "Customer cancel order error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not cancel order"
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   PAYMENT STATUS
   ========================================================= */

app.put(
  "/api/admin/orders/:id/payment-status",
  adminAuth,
  async (req, res) => {
    try {
      const orderId =
        cleanText(
          req.params.id
        );

      const paymentStatus =
        cleanText(
          req.body?.paymentStatus
        );

      if (
        !PAYMENT_STATUSES.includes(
          paymentStatus
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid payment status"
        });
      }

      const result =
        await pool.query(
          `
          UPDATE orders
          SET
            payment_status = $1,
            updated_at = NOW()
          WHERE id = $2
          RETURNING
            id::text AS id,
            payment_status AS "paymentStatus"
          `,
          [
            paymentStatus,
            orderId
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      res.json({
        ok: true,
        order: result.rows[0]
      });
    } catch (error) {
      console.error(
        "Payment status error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not update payment status"
      });
    }
  }
);

/* =========================================================
   PUBLIC ORDER TRACKING
   ========================================================= */

app.get(
  "/api/orders/:id",
  async (req, res) => {
    try {
      const orderId =
        cleanText(
          req.params.id
        );

      if (!orderId) {
        return res.status(400).json({
          error:
            "Order ID is required"
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id::text AS id,
            created_at AS "createdAt",
            customer,
            items,
            total::float AS total,
            payment_method AS "paymentMethod",
            status,
            payment_status AS "paymentStatus",
            stock_restored AS "stockRestored",
            updated_at AS "updatedAt"
          FROM orders
          WHERE id = $1
          LIMIT 1
          `,
          [orderId]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      const order =
        result.rows[0];

      order.customer =
        safeJsonParse(
          order.customer,
          {}
        );

      order.items =
        safeJsonParse(
          order.items,
          []
        );

      res.json({
        ok: true,
        order
      });
    } catch (error) {
      console.error(
        "Order tracking error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not load order"
      });
    }
  }
);

/* =========================================================
   PAYMENT PLACEHOLDER
   ========================================================= */

app.post(
  "/api/payment/create",
  (req, res) => {
    const method =
      cleanText(
        req.body?.method
      );

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
        `${method} payment gateway is not configured yet.`
    });
  }
);

/* =========================================================
   ADMIN SETTINGS GET
   ========================================================= */

app.get(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            id,
            shop_name AS "shopName",
            tagline,
            phone1,
            phone2,
            facebook,
            currency,
            updated_at AS "updatedAt"
          FROM store_settings
          WHERE id = 1
          LIMIT 1
        `);

      if (
        !result.rows.length
      ) {
        return res.json({
          ok: true,
          settings:
            defaultSettings
        });
      }

      res.json({
        ok: true,
        settings:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Get settings error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not load settings"
      });
    }
  }
);

/* =========================================================
   ADMIN SETTINGS SAVE
   ========================================================= */

app.put(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const shopName =
        cleanText(
          body.shopName,
          defaultSettings.shopName
        );

      const tagline =
        cleanText(
          body.tagline,
          defaultSettings.tagline
        );

      const phone1 =
        cleanText(
          body.phone1,
          defaultSettings.phone1
        );

      const phone2 =
        cleanText(
          body.phone2,
          defaultSettings.phone2
        );

      const facebook =
        cleanText(
          body.facebook,
          ""
        );

      const currency =
        cleanText(
          body.currency,
          "BDT"
        ) || "BDT";

      const existing =
        await pool.query(`
          SELECT id
          FROM store_settings
          WHERE id = 1
          LIMIT 1
        `);

      let result;

      if (!existing.rows.length) {
        result =
          await pool.query(
            `
            INSERT INTO store_settings
            (
              id,
              shop_name,
              tagline,
              phone1,
              phone2,
              facebook,
              currency,
              updated_at
            )
            VALUES
            (
              1,
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              NOW()
            )
            RETURNING
              id,
              shop_name AS "shopName",
              tagline,
              phone1,
              phone2,
              facebook,
              currency,
              updated_at AS "updatedAt"
            `,
            [
              shopName,
              tagline,
              phone1,
              phone2,
              facebook,
              currency
            ]
          );
      } else {
        result =
          await pool.query(
            `
            UPDATE store_settings
            SET
              shop_name = $1,
              tagline = $2,
              phone1 = $3,
              phone2 = $4,
              facebook = $5,
              currency = $6,
              updated_at = NOW()
            WHERE id = 1
            RETURNING
              id,
              shop_name AS "shopName",
              tagline,
              phone1,
              phone2,
              facebook,
              currency,
              updated_at AS "updatedAt"
            `,
            [
              shopName,
              tagline,
              phone1,
              phone2,
              facebook,
              currency
            ]
          );
      }

      res.json({
        ok: true,
        settings:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Save settings error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not save settings"
      });
    }
  }
);

/* =========================================================
   ADMIN PAGE
   ========================================================= */

app.get(
  "/admin",
  (req, res) => {
    const adminFile =
      path.join(
        __dirname,
        "public",
        "admin.html"
      );

    if (
      fs.existsSync(adminFile)
    ) {
      return res.sendFile(
        adminFile
      );
    }

    return res.status(404).send(
      "Admin page not found"
    );
  }
);

/* =========================================================
   OPTIONAL ADMIN.HTML DIRECT PATH
   ========================================================= */

app.get(
  "/admin.html",
  (req, res) => {
    const adminFile =
      path.join(
        __dirname,
        "public",
        "admin.html"
      );

    if (
      fs.existsSync(adminFile)
    ) {
      return res.sendFile(
        adminFile
      );
    }

    return res.status(404).send(
      "Admin page not found"
    );
  }
);

/* =========================================================
   WEBSITE FALLBACK
   ========================================================= */

app.use(
  (req, res, next) => {
    if (
      req.method === "GET" &&
      !req.path.startsWith(
        "/api/"
      )
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

/* =========================================================
   404
   ========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      error: "Not found"
    });
  }
);

/* =========================================================
   GLOBAL ERROR
   ========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    res.status(500).json({
      error:
        "Internal server error"
    });
  }
);

/* =========================================================
   START SERVER
   ========================================================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `SM Online Shop running on port ${PORT}`
        );

        console.log(
          `Admin username: ${ADMIN_USER}`
        );
      }
    );
  } catch (error) {
    console.error(
      "SERVER STARTUP FAILED:",
      error
    );

    process.exit(1);
  }
}

startServer();

/* =========================================================
   GRACEFUL SHUTDOWN
   ========================================================= */

async function shutdown(
  signal
) {
  console.log(
    `${signal} received. Closing server...`
  );

  try {
    await pool.end();
  } catch (error) {
    console.error(
      "Pool shutdown error:",
      error
    );
  }

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
