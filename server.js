const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT = Number(process.env.PORT) || 10000;

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   CONFIG
   ========================================================= */

const ADMIN_USER = process.env.ADMIN_USER || "SMADMIN";
const ADMIN_PASS = process.env.ADMIN_PASS || "SM2728";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "SM_ONLINE_SHOP_SECRET_2026";

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing.");
  process.exit(1);
}

/* =========================================================
   POSTGRESQL
   ========================================================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
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
   ADMIN SESSIONS
   ========================================================= */

const adminSessions = new Map();

/* =========================================================
   HELPER FUNCTIONS
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

  return Math.max(0, n);
}

function nonNegativeInt(value, fallback = 0) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.max(0, Math.floor(n));
}

function makeRandomId(prefix) {
  return (
    prefix +
    Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(4).toString("hex").toUpperCase()
  );
}

function makeProductId() {
  return makeRandomId("P");
}

function makeOrderId() {
  return makeRandomId("SM");
}

function makeCustomerId() {
  return makeRandomId("C");
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

function normalizeImages(value, fallbackImage = "") {
  let images = [];

  if (Array.isArray(value)) {
    images = value;
  } else if (typeof value === "string" && value.trim()) {
    const parsed = safeJsonParse(value, null);

    if (Array.isArray(parsed)) {
      images = parsed;
    } else {
      images = value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }

  images = images
    .map((x) => cleanText(x))
    .filter(Boolean);

  if (!images.length && cleanText(fallbackImage)) {
    images.push(cleanText(fallbackImage));
  }

  return [...new Set(images)].slice(0, 5);
}

function calculateDiscount(price, oldPrice, discount) {
  const p = Number(price) || 0;
  const op = Number(oldPrice) || 0;
  const d = Number(discount) || 0;

  if (d > 0) {
    return Math.min(100, Math.max(0, d));
  }

  if (op > p && op > 0) {
    return Math.round(((op - p) / op) * 100);
  }

  return 0;
}

function makeToken() {
  const random = crypto.randomBytes(32).toString("hex");

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(random)
    .digest("hex");

  return random + "." + signature;
}

function getTokenFromRequest(req) {
  const auth = cleanText(req.headers.authorization);

  if (!auth) {
    return "";
  }

  if (!auth.startsWith("Bearer ")) {
    return "";
  }

  return auth.slice(7).trim();
}

function adminAuth(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({
      error: "Admin authentication required"
    });
  }

  const session = adminSessions.get(token);

  if (!session) {
    return res.status(401).json({
      error: "Invalid or expired admin session"
    });
  }

  req.admin = session;

  next();
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

  return ORDER_STATUSES.includes(newStatus);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================
   DATABASE HELPERS
   ========================================================= */

async function tableExists(tableName) {
  const result = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    ) AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function columnExists(tableName, columnName) {
  const result = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS exists
    `,
    [tableName, columnName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function columnType(tableName, columnName) {
  const result = await pool.query(
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

  return result.rows[0]?.data_type || null;
}

async function ensureColumn(
  tableName,
  columnName,
  definition
) {
  const exists = await columnExists(
    tableName,
    columnName
  );

  if (!exists) {
    await pool.query(`
      ALTER TABLE ${tableName}
      ADD COLUMN ${columnName} ${definition}
    `);
  }
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
        id INTEGER,
        shop_name TEXT,
        tagline TEXT,
        phone1 TEXT,
        phone2 TEXT,
        facebook TEXT,
        currency TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS id INTEGER
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS shop_name TEXT
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS tagline TEXT
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS phone1 TEXT
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS phone2 TEXT
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS facebook TEXT
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS currency TEXT
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    `);

    await client.query(`
      UPDATE store_settings
      SET id = 1
      WHERE id IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET shop_name = $1
      WHERE shop_name IS NULL OR BTRIM(shop_name) = ''
    `,
      [defaultSettings.shopName]
    );

    await client.query(`
      UPDATE store_settings
      SET tagline = $1
      WHERE tagline IS NULL OR BTRIM(tagline) = ''
    `,
      [defaultSettings.tagline]
    );

    await client.query(`
      UPDATE store_settings
      SET phone1 = $1
      WHERE phone1 IS NULL
    `,
      [defaultSettings.phone1]
    );

    await client.query(`
      UPDATE store_settings
      SET phone2 = $1
      WHERE phone2 IS NULL
    `,
      [defaultSettings.phone2]
    );

    await client.query(`
      UPDATE store_settings
      SET facebook = ''
      WHERE facebook IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET currency = $1
      WHERE currency IS NULL OR BTRIM(currency) = ''
    `,
      [defaultSettings.currency]
    );

    await client.query(`
      UPDATE store_settings
      SET updated_at = NOW()
      WHERE updated_at IS NULL
    `);

    /*
      IMPORTANT:
      এখানে ON CONFLICT ব্যবহার করা হচ্ছে না।
      তাই "there is no unique or exclusion constraint..."
      error হবে না।
    */

    const settingsCheck = await client.query(`
      SELECT id
      FROM store_settings
      ORDER BY id
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
        images JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /*
      Existing old database may have BIGINT/SERIAL id.
      Convert it to TEXT.
    */

    const productIdType = await columnType(
      "products",
      "id"
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
      ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      UPDATE products
      SET name = 'Unnamed Product'
      WHERE name IS NULL OR BTRIM(name) = ''
    `);

    await client.query(`
      UPDATE products
      SET category = 'General'
      WHERE category IS NULL OR BTRIM(category) = ''
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
      SET images = '[]'::jsonb
      WHERE images IS NULL
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
      "id"
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
      "id"
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

    await client.query("COMMIT");

    console.log(
      "Database initialized successfully."
    );
  } catch (error) {
    await client.query("ROLLBACK");

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
   STORE API
   ========================================================= */

app.get("/api/store", async (req, res) => {
  try {
    const result = await pool.query(`
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
      ORDER BY id
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
    console.error("Store API error:", error);

    res.status(500).json({
      error: error.message || "Could not load store settings"
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
        images,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM products
      ORDER BY created_at DESC
    `);

    const products = result.rows.map((product) => {
      const images = normalizeImages(
        product.images,
        product.image
      );

      return {
        ...product,
        id: String(product.id),
        images,
        image: product.image || images[0] || "",
        discount: calculateDiscount(
          product.price,
          product.oldPrice,
          product.discount
        )
      };
    });

    res.json({
      ok: true,
      products
    });
  } catch (error) {
    console.error("Products API error:", error);

    res.status(500).json({
      error: error.message || "Could not load products"
    });
  }
});

/* =========================================================
   ADMIN LOGIN
   ========================================================= */

app.post("/api/admin/login", (req, res) => {
  try {
    const username = cleanText(req.body?.username);
    const password = cleanText(req.body?.password);

    if (
      username !== ADMIN_USER ||
      password !== ADMIN_PASS
    ) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    const token = makeToken();

    adminSessions.set(token, {
      username: ADMIN_USER,
      createdAt: Date.now()
    });

    res.json({
      ok: true,
      token,
      username: ADMIN_USER
    });
  } catch (error) {
    console.error("Admin login error:", error);

    res.status(500).json({
      error: "Could not login"
    });
  }
});

/* =========================================================
   ADMIN LOGOUT
   ========================================================= */

app.post(
  "/api/admin/logout",
  adminAuth,
  (req, res) => {
    const token = getTokenFromRequest(req);

    if (token) {
      adminSessions.delete(token);
    }

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   ADMIN CHECK
   ========================================================= */

app.get(
  "/api/admin/check",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,
      authenticated: true,
      username: req.admin.username
    });
  }
);

/* =========================================================
   ADMIN PRODUCTS
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
          images,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM products
        ORDER BY created_at DESC
      `);

      const products = result.rows.map((product) => ({
        ...product,
        id: String(product.id),
        images: normalizeImages(
          product.images,
          product.image
        ),
        discount: calculateDiscount(
          product.price,
          product.oldPrice,
          product.discount
        )
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
        error: error.message ||
          "Could not load admin products"
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

      const category =
        cleanText(body.category, "General") ||
        "General";

      const description =
        cleanText(body.description);

      const price = positiveNumber(
        body.price,
        0
      );

      const oldPrice = positiveNumber(
        body.oldPrice ??
          body.old_price ??
          0,
        0
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
        body.image ||
          body.imageUrl ||
          ""
      );

      const images = normalizeImages(
        body.images,
        image
      );

      if (!name) {
        return res.status(400).json({
          error: "Product name is required"
        });
      }

      const id = makeProductId();

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
            images,
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
          images,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          id,
          name,
          category,
          description,
          price,
          oldPrice,
          discount,
          stock,
          images[0] || "",
          JSON.stringify(images)
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

      const name = cleanText(body.name);

      const category =
        cleanText(body.category, "General") ||
        "General";

      const description =
        cleanText(body.description);

      const price = positiveNumber(
        body.price,
        0
      );

      const oldPrice = positiveNumber(
        body.oldPrice ??
          body.old_price ??
          0,
        0
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
        body.image ||
          body.imageUrl ||
          ""
      );

      const images = normalizeImages(
        body.images,
        image
      );

      if (!name) {
        return res.status(400).json({
          error: "Product name is required"
        });
      }

      const result = await pool.query(
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
          images = $9::jsonb,
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
          images,
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
          images[0] || "",
          JSON.stringify(images),
          productId
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Product not found"
        });
      }

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
   PATCH PRODUCT
   ========================================================= */

app.patch(
  "/api/admin/products/:id",
  adminAuth,
  async (req, res) => {
    try {
      const productId =
        cleanText(req.params.id);

      const existing = await pool.query(
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
          images
        FROM products
        WHERE id = $1
        `,
        [productId]
      );

      if (!existing.rows.length) {
        return res.status(404).json({
          error: "Product not found"
        });
      }

      const old = existing.rows[0];
      const body = req.body || {};

      const name =
        body.name !== undefined
          ? cleanText(body.name)
          : old.name;

      const category =
        body.category !== undefined
          ? cleanText(body.category, "General")
          : old.category;

      const description =
        body.description !== undefined
          ? cleanText(body.description)
          : old.description;

      const price =
        body.price !== undefined
          ? positiveNumber(body.price, 0)
          : Number(old.price);

      const oldPrice =
        body.oldPrice !== undefined ||
        body.old_price !== undefined
          ? positiveNumber(
              body.oldPrice ??
                body.old_price,
              0
            )
          : Number(old.oldPrice);

      const discount =
        body.discount !== undefined
          ? positiveNumber(body.discount, 0)
          : Number(old.discount);

      const stock =
        body.stock !== undefined
          ? nonNegativeInt(body.stock, 0)
          : Number(old.stock);

      const image =
        body.image !== undefined
          ? cleanText(body.image)
          : cleanText(old.image);

      const images =
        body.images !== undefined
          ? normalizeImages(
              body.images,
              image
            )
          : normalizeImages(
              old.images,
              image
            );

      const result = await pool.query(
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
          images = $9::jsonb,
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
          images,
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
          images[0] || "",
          JSON.stringify(images),
          productId
        ]
      );

      res.json({
        ok: true,
        product: result.rows[0]
      });
    } catch (error) {
      console.error(
        "Patch product error:",
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

      if (!productId) {
        return res.status(400).json({
          error: "Product ID is required"
        });
      }

      const result = await pool.query(
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
   CLOUDINARY UPLOAD
   ========================================================= */

app.post(
  "/api/admin/upload",
  adminAuth,
  async (req, res) => {
    try {
      const imageData = cleanText(
        req.body?.image ||
        req.body?.file ||
        req.body?.data
      );

      if (!imageData) {
        return res.status(400).json({
          error: "Image data is required"
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
        await cloudinary.uploader.upload(
          imageData,
          {
            folder: "sm-online-shop/products",
            resource_type: "image"
          }
        );

      res.json({
        ok: true,
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height
      });
    } catch (error) {
      console.error(
        "Cloudinary upload error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not upload image"
      });
    }
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
      const result = await pool.query(`
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
        ORDER BY id
        LIMIT 1
      `);

      res.json({
        ok: true,
        settings:
          result.rows[0] || defaultSettings
      });
    } catch (error) {
      console.error(
        "Admin settings error:",
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
   ADMIN SETTINGS UPDATE
   ========================================================= */

app.put(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const body = req.body || {};

      const shopName =
        cleanText(
          body.shopName,
          defaultSettings.shopName
        ) || defaultSettings.shopName;

      const tagline =
        cleanText(
          body.tagline,
          defaultSettings.tagline
        ) || defaultSettings.tagline;

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

      const check = await pool.query(`
        SELECT id
        FROM store_settings
        ORDER BY id
        LIMIT 1
      `);

      let result;

      if (check.rows.length) {
        result = await pool.query(
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
          WHERE id = $7
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
            currency,
            check.rows[0].id
          ]
        );
      } else {
        result = await pool.query(
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
        settings: result.rows[0]
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
   ADMIN ORDERS
   ========================================================= */

app.get(
  "/api/admin/orders",
  adminAuth,
  async (req, res) => {
    try {
      const result = await pool.query(`
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

      const orders = result.rows.map((order) => ({
        ...order,
        id: String(order.id),
        customer:
          safeJsonParse(order.customer, {}) || {},
        items:
          safeJsonParse(order.items, []) || []
      }));

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
   SAVE CUSTOMER
   ========================================================= */

async function saveCustomer(client, customer) {
  const name = cleanText(customer?.name);
  const phone = cleanText(customer?.phone);
  const address = cleanText(customer?.address);

  if (!phone) {
    return null;
  }

  const existing = await client.query(
    `
    SELECT id
    FROM customers
    WHERE phone = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [phone]
  );

  if (existing.rows.length) {
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
        existing.rows[0].id
      ]
    );

    return existing.rows[0].id;
  }

  const customerId = makeCustomerId();

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
      (
        $1,
        $2,
        $3,
        $4,
        NOW(),
        NOW()
      )
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
   RESTORE ORDER STOCK
   ========================================================= */

async function restoreOrderStock(client, order) {
  if (order.stock_restored) {
    return;
  }

  const items =
    safeJsonParse(order.items, []) || [];

  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    const productId =
      cleanText(item?.id);

    const qty =
      nonNegativeInt(item?.qty, 0);

    if (!productId || qty <= 0) {
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
      [qty, productId]
    );
  }

  await client.query(
    `
    UPDATE orders
    SET
      stock_restored = TRUE,
      updated_at = NOW()
    WHERE id = $1
    `,
    [order.id]
  );
}

/* =========================================================
   CREATE ORDER
   ========================================================= */

app.post(
  "/api/orders",
  async (req, res) => {
    const client = await pool.connect();

    try {
      const body = req.body || {};

      const customer =
        body.customer || {};

      const items =
        body.items;

      const paymentMethod =
        cleanText(
          body.paymentMethod,
          "cod"
        ) || "cod";

      if (
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

      const quantityMap = new Map();

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
          (quantityMap.get(productId) || 0) +
            qty
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
              stock
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

        const stock =
          Number(product.stock) || 0;

        if (stock < qty) {
          throw new Error(
            `Not enough stock for ${product.name}. Available: ${stock}`
          );
        }

        const price =
          Number(product.price) || 0;

        total +=
          price * qty;

        cleanItems.push({
          id: String(product.id),
          name: product.name,
          price,
          qty
        });
      }

      total =
        Math.round(total * 100) /
        100;

      const orderId =
        makeOrderId();

      const cleanCustomer = {
        name:
          cleanText(
            customer.name
          ),
        phone:
          cleanText(
            customer.phone
          ),
        address:
          cleanText(
            customer.address
          )
      };

      /*
        Save/update customer.
      */

      await saveCustomer(
        client,
        cleanCustomer
      );

      /*
        INSERT ORDER.

        এখানে id অবশ্যই Node.js generated TEXT.
        PostgreSQL sequence ব্যবহার করছে না।
      */

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

      /*
        Reduce stock.
      */

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

      await client.query("COMMIT");

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
        "Order creation error:",
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
   UPDATE ORDER STATUS
   ========================================================= */

app.put(
  "/api/admin/orders/:id/status",
  adminAuth,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const orderId =
        cleanText(req.params.id);

      const newStatus =
        cleanText(
          req.body?.status
        );

      if (!orderId) {
        return res.status(400).json({
          error:
            "Order ID is required"
        });
      }

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

      await client.query("BEGIN");

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
            stock_restored AS "stockRestored"
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

      /*
        Cancel হলে stock ফেরত।
      */

      if (
        newStatus === "Cancelled"
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

      await client.query("COMMIT");

      res.json({
        ok: true,
        order: {
          ...updated.rows[0],
          customer:
            safeJsonParse(
              updated.rows[0]
                .customer,
              {}
            ) || {},
          items:
            safeJsonParse(
              updated.rows[0]
                .items,
              []
            ) || []
        }
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
   UPDATE PAYMENT STATUS
   ========================================================= */

app.put(
  "/api/admin/orders/:id/payment-status",
  adminAuth,
  async (req, res) => {
    try {
      const orderId =
        cleanText(req.params.id);

      const paymentStatus =
        cleanText(
          req.body?.paymentStatus
        );

      if (!orderId) {
        return res.status(400).json({
          error:
            "Order ID is required"
        });
      }

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
            payment_status AS "paymentStatus",
            updated_at AS "updatedAt"
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
        order:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Update payment status error:",
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
        cleanText(req.params.id);

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

      res.json({
        ok: true,
        order: {
          ...order,
          customer:
            safeJsonParse(
              order.customer,
              {}
            ) || {},
          items:
            safeJsonParse(
              order.items,
              []
            ) || []
        }
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
   PUBLIC CANCEL ORDER
   ========================================================= */

app.put(
  "/api/orders/:id/cancel",
  async (req, res) => {
    const client = await pool.connect();

    try {
      const orderId =
        cleanText(req.params.id);

      if (!orderId) {
        return res.status(400).json({
          error:
            "Order ID is required"
        });
      }

      await client.query("BEGIN");

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
            stock_restored AS "stockRestored"
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
            stock_restored AS "stockRestored",
            updated_at AS "updatedAt"
          `,
          [orderId]
        );

      await client.query("COMMIT");

      res.json({
        ok: true,
        order: {
          ...updated.rows[0],
          customer:
            safeJsonParse(
              updated.rows[0]
                .customer,
              {}
            ) || {},
          items:
            safeJsonParse(
              updated.rows[0]
                .items,
              []
            ) || []
        }
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
   PAYMENT PLACEHOLDER
   ========================================================= */

app.post(
  "/api/payment/create",
  async (req, res) => {
    try {
      const method =
        cleanText(
          req.body?.method
        ).toLowerCase();

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

      return res.status(501).json({
        error:
          `${method} payment gateway is not configured yet.`
      });
    } catch (error) {
      console.error(
        "Payment create error:",
        error
      );

      res.status(500).json({
        error:
          "Could not create payment"
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
        PUBLIC_DIR,
        "admin.html"
      );

    if (
      fs.existsSync(adminFile)
    ) {
      return res.sendFile(
        adminFile
      );
    }

    res.status(404).send(
      "Admin page not found"
    );
  }
);

/* =========================================================
   OPTIONAL ADMIN.HTML
   ========================================================= */

app.get(
  "/admin.html",
  (req, res) => {
    const adminFile =
      path.join(
        PUBLIC_DIR,
        "admin.html"
      );

    if (
      fs.existsSync(adminFile)
    ) {
      return res.sendFile(
        adminFile
      );
    }

    res.status(404).send(
      "Admin page not found"
    );
  }
);

/* =========================================================
   ROOT WEBSITE
   ========================================================= */

app.get(
  "/",
  (req, res) => {
    const indexFile =
      path.join(
        PUBLIC_DIR,
        "index.html"
      );

    if (
      fs.existsSync(indexFile)
    ) {
      return res.sendFile(
        indexFile
      );
    }

    res.status(404).send(
      "SM Online Shop website not found"
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
      !req.path.startsWith("/api/")
    ) {
      const indexFile =
        path.join(
          PUBLIC_DIR,
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
   GLOBAL ERROR HANDLER
   ========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error:
        error.message ||
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
      }
    );
  } catch (error) {
    console.error(
      "Server startup failed:",
      error
    );

    process.exit(1);
  }
}

/* =========================================================
   GRACEFUL SHUTDOWN
   ========================================================= */

async function shutdown(signal) {
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

/* =========================================================
   RUN
   ========================================================= */

startServer();
