const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   ENVIRONMENT
========================================================= */

const SESSION_SECRET =
  process.env.SESSION_SECRET || "SM_ONLINE_SHOP_SECRET_2026";

const ADMIN_USER =
  process.env.ADMIN_USER || "SMADMIN";

const ADMIN_PASS =
  process.env.ADMIN_PASS || "SM2728";

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
  max: 5
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error);
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

/* =========================================================
   STATUS
========================================================= */

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

function numberValue(value, fallback = 0) {
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

function safeJson(value, fallback) {
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

/* =========================================================
   DATABASE COLUMN TYPE
========================================================= */

async function columnType(tableName, columnName) {
  const result = await pool.query(
    `
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
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

    /* -------------------------------------------------------
       STORE SETTINGS
    ------------------------------------------------------- */

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        shop_name TEXT NOT NULL DEFAULT 'SM Online Shop',
        tagline TEXT NOT NULL DEFAULT 'Style • Comfort • Confidence ♥',
        phone1 TEXT NOT NULL DEFAULT '01827872334',
        phone2 TEXT NOT NULL DEFAULT '01886995687',
        facebook TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'BDT',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* -------------------------------------------------------
       PRODUCTS
       IMPORTANT:
       ID IS TEXT
    ------------------------------------------------------- */

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

    /* -------------------------------------------------------
       MIGRATE OLD PRODUCT ID
       BIGINT/SERIAL -> TEXT
    ------------------------------------------------------- */

    const productIdType = await columnType(
      "products",
      "id"
    );

    if (
      productIdType &&
      productIdType !== "text" &&
      productIdType !== "character varying"
    ) {
      console.log(
        "Migrating products.id to TEXT..."
      );

      await client.query(`
        ALTER TABLE products
        ALTER COLUMN id DROP DEFAULT
      `);

      await client.query(`
        ALTER TABLE products
        ALTER COLUMN id TYPE TEXT
        USING id::text
      `);

      console.log(
        "products.id migration completed."
      );
    }

    await client.query(`
      ALTER TABLE products
      ALTER COLUMN id DROP DEFAULT
    `);

    /* -------------------------------------------------------
       ADD MISSING PRODUCT COLUMNS
    ------------------------------------------------------- */

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

    /* -------------------------------------------------------
       REPAIR PRODUCT NULLS
    ------------------------------------------------------- */

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

    /* -------------------------------------------------------
       ORDERS
       IMPORTANT:
       ID IS TEXT
    ------------------------------------------------------- */

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

    /* -------------------------------------------------------
       MIGRATE OLD ORDER ID
       BIGINT/SERIAL -> TEXT
    ------------------------------------------------------- */

    const orderIdType = await columnType(
      "orders",
      "id"
    );

    if (
      orderIdType &&
      orderIdType !== "text" &&
      orderIdType !== "character varying"
    ) {
      console.log(
        "Migrating orders.id to TEXT..."
      );

      await client.query(`
        ALTER TABLE orders
        ALTER COLUMN id DROP DEFAULT
      `);

      await client.query(`
        ALTER TABLE orders
        ALTER COLUMN id TYPE TEXT
        USING id::text
      `);

      console.log(
        "orders.id migration completed."
      );
    }

    await client.query(`
      ALTER TABLE orders
      ALTER COLUMN id DROP DEFAULT
    `);

    /* -------------------------------------------------------
       ADD MISSING ORDER COLUMNS
    ------------------------------------------------------- */

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS created_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer
      JSONB DEFAULT '{}'::jsonb
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS items
      JSONB DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS total
      NUMERIC(12,2) DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_method
      TEXT DEFAULT 'cod'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS status
      TEXT DEFAULT 'Pending'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_status
      TEXT DEFAULT 'Pending'
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS stock_restored
      BOOLEAN DEFAULT FALSE
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    /* -------------------------------------------------------
       REPAIR ORDER NULLS
    ------------------------------------------------------- */

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

    /* -------------------------------------------------------
       CUSTOMERS
    ------------------------------------------------------- */

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

    /* -------------------------------------------------------
       STORE DEFAULT ROW
    ------------------------------------------------------- */

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
        currency
      )
      VALUES
      (1,$1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO NOTHING
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

    await client.query("COMMIT");

    console.log(
      "PostgreSQL database initialized successfully."
    );
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
   SETTINGS FUNCTIONS
========================================================= */

async function getSettings() {
  const result = await pool.query(`
    SELECT
      shop_name,
      tagline,
      phone1,
      phone2,
      facebook,
      currency
    FROM store_settings
    WHERE id = 1
  `);

  if (!result.rows.length) {
    return {
      ...defaultSettings
    };
  }

  const row = result.rows[0];

  return {
    shopName:
      row.shop_name || defaultSettings.shopName,

    tagline:
      row.tagline || defaultSettings.tagline,

    phone1:
      row.phone1 || defaultSettings.phone1,

    phone2:
      row.phone2 || defaultSettings.phone2,

    facebook:
      row.facebook || "",

    currency:
      row.currency || "BDT"
  };
}

/* =========================================================
   PRODUCT FUNCTIONS
========================================================= */

async function getProducts() {
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

  return result.rows.map((product) => ({
    ...product,

    id: String(product.id),

    gallery: Array.isArray(product.gallery)
      ? product.gallery
      : []
  }));
}

/* =========================================================
   ORDER FUNCTIONS
========================================================= */

async function getOrders() {
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

  return result.rows.map((order) => ({
    ...order,
    id: String(order.id),
    customer: safeJson(order.customer, {}),
    items: safeJson(order.items, [])
  }));
}

/* =========================================================
   ADMIN SESSION
========================================================= */

const sessions = new Map();

function createToken(username) {
  const randomPart =
    crypto.randomBytes(32).toString("hex");

  const timestamp =
    Date.now().toString();

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

  return (
    signature +
    "." +
    Buffer
      .from(username)
      .toString("base64url")
  );
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
    authHeader.substring(7).trim();

  if (!sessions.has(token)) {
    return res.status(401).json({
      error: "Session expired"
    });
  }

  req.adminUser =
    sessions.get(token);

  req.adminToken =
    token;

  next();
}

/* =========================================================
   STORE API
========================================================= */

app.get(
  "/api/store",
  async (req, res) => {
    try {
      const [
        settings,
        products
      ] = await Promise.all([
        getSettings(),
        getProducts()
      ]);

      res.json({
        settings,
        products
      });
    } catch (error) {
      console.error(
        "Store API error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not load store"
      });
    }
  }
);

/* =========================================================
   PUBLIC PRODUCTS API
========================================================= */

app.get(
  "/api/products",
  async (req, res) => {
    try {
      res.json(
        await getProducts()
      );
    } catch (error) {
      console.error(
        "Products API error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not load products"
      });
    }
  }
);

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  "/api/admin/login",
  (req, res) => {
    const username =
      cleanText(
        req.body?.username
      );

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

/* =========================================================
   ADMIN CHECK
========================================================= */

app.get(
  "/api/admin/check",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,
      username: req.adminUser
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
    sessions.delete(
      req.adminToken
    );

    res.json({
      ok: true
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
      res.json(
        await getProducts()
      );
    } catch (error) {
      console.error(
        "Admin products error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Could not load products"
      });
    }
  }
);

/* =========================================================
   ADD PRODUCT
========================================================= */

app.post(
  "/api/admin/products",
  adminAuth,
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const name =
        cleanText(body.name);

      if (!name) {
        return res.status(400).json({
          error:
            "Product name is required"
        });
      }

      const price =
        numberValue(body.price);

      if (price <= 0) {
        return res.status(400).json({
          error:
            "Valid product price is required"
        });
      }

      const productId =
        makeProductId();

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

      const oldPrice =
        Math.max(
          0,
          numberValue(
            body.oldPrice,
            price
          )
        );

      const discount =
        Math.max(
          0,
          numberValue(
            body.discount,
            0
          )
        );

      const stock =
        nonNegativeInt(
          body.stock,
          0
        );

      const image =
        cleanText(
          body.image,
          ""
        );

      let gallery = [];

      if (
        Array.isArray(
          body.gallery
        )
      ) {
        gallery =
          body.gallery
            .map((x) =>
              cleanText(x)
            )
            .filter(Boolean);
      }

      if (
        image &&
        !gallery.includes(image)
      ) {
        gallery.unshift(image);
      }

      await pool.query(
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
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          NOW(),NOW()
        )
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

      const result =
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
            gallery,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM products
          WHERE id = $1
          `,
          [productId]
        );

      res.status(201).json({
        ok: true,
        product:
          result.rows[0]
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
   EDIT PRODUCT
========================================================= */

app.put(
  "/api/admin/products/:id",
  adminAuth,
  async (req, res) => {
    try {
      const id =
        cleanText(
          req.params.id
        );

      if (!id) {
        return res.status(400).json({
          error:
            "Product ID is required"
        });
      }

      const existing =
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
            gallery,
            created_at AS "createdAt"
          FROM products
          WHERE id = $1
          `,
          [id]
        );

      if (!existing.rows.length) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      const old =
        existing.rows[0];

      const body =
        req.body || {};

      const name =
        cleanText(
          body.name,
          old.name
        );

      const category =
        cleanText(
          body.category,
          old.category
        ) || "General";

      const description =
        cleanText(
          body.description,
          old.description || ""
        );

      const price =
        numberValue(
          body.price,
          Number(old.price)
        );

      if (
        !name ||
        price <= 0
      ) {
        return res.status(400).json({
          error:
            "Valid product name and price are required"
        });
      }

      const oldPrice =
        Math.max(
          0,
          numberValue(
            body.oldPrice,
            Number(old.oldPrice || price)
          )
        );

      const discount =
        Math.max(
          0,
          numberValue(
            body.discount,
            Number(old.discount || 0)
          )
        );

      const stock =
        nonNegativeInt(
          body.stock,
          Number(old.stock || 0)
        );

      const image =
        cleanText(
          body.image,
          old.image || ""
        );

      let gallery =
        Array.isArray(old.gallery)
          ? old.gallery
          : [];

      if (
        Array.isArray(body.gallery)
      ) {
        gallery =
          body.gallery
            .map((x) =>
              cleanText(x)
            )
            .filter(Boolean);
      }

      if (
        image &&
        !gallery.includes(image)
      ) {
        gallery.unshift(image);
      }

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
          gallery = $9,
          updated_at = NOW()
        WHERE id = $10
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
          id
        ]
      );

      res.json({
        ok: true,
        product: {
          id,
          name,
          category,
          description,
          price,
          oldPrice,
          discount,
          stock,
          image,
          gallery
        }
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
      const id =
        cleanText(
          req.params.id
        );

      if (!id) {
        return res.status(400).json({
          error:
            "Product ID is required"
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM products
          WHERE id = $1
          `,
          [id]
        );

      if (
        result.rowCount === 0
      ) {
        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      res.json({
        ok: true
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
      const image =
        req.body?.image;

      if (!image) {
        return res.status(400).json({
          error:
            "No image received"
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
          error.message ||
          "Cloudinary image upload failed"
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
      res.json(
        await getSettings()
      );
    } catch (error) {
      console.error(
        "Settings load error:",
        error
      );

      res.status(500).json({
        error:
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
      const body =
        req.body || {};

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
        `,
        [
          cleanText(
            body.shopName,
            defaultSettings.shopName
          ),

          cleanText(
            body.tagline,
            defaultSettings.tagline
          ),

          cleanText(
            body.phone1,
            defaultSettings.phone1
          ),

          cleanText(
            body.phone2,
            defaultSettings.phone2
          ),

          cleanText(
            body.facebook,
            ""
          ),

          cleanText(
            body.currency,
            "BDT"
          )
        ]
      );

      res.json({
        ok: true,
        settings:
          await getSettings()
      });
    } catch (error) {
      console.error(
        "Settings update error:",
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
      res.json(
        await getOrders()
      );
    } catch (error) {
      console.error(
        "Load orders error:",
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
   STATUS TRANSITION
========================================================= */

function isValidStatusTransition(
  currentStatus,
  newStatus
) {
  if (
    currentStatus === newStatus
  ) {
    return true;
  }

  if (
    newStatus === "Cancelled"
  ) {
    return (
      currentStatus !==
      "Cancelled"
    );
  }

  if (
    currentStatus === "Cancelled"
  ) {
    return false;
  }

  const allowed = {
    Pending: [
      "Confirmed"
    ],

    Confirmed: [
      "Processing",
      "Shipped"
    ],

    Processing: [
      "Shipped"
    ],

    Shipped: [
      "Delivered"
    ],

    Delivered: []
  };

  return (
    allowed[currentStatus] || []
  ).includes(newStatus);
}

/* =========================================================
   RESTORE STOCK
========================================================= */

async function restoreOrderStock(
  client,
  order
) {
  if (
    order.stock_restored === true ||
    order.stockRestored === true
  ) {
    return false;
  }

  const items =
    Array.isArray(order.items)
      ? order.items
      : safeJson(
          order.items,
          []
        );

  for (
    const item of items
  ) {
    const productId =
      cleanText(item?.id);

    const quantity =
      nonNegativeInt(
        item?.qty,
        0
      );

    if (
      !productId ||
      quantity <= 0
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
        quantity,
        productId
      ]
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
    [String(order.id)]
  );

  return true;
}

/* =========================================================
   UPDATE ORDER STATUS
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

      if (!result.rows.length) {
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

      order.items =
        safeJson(
          order.items,
          []
        );

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

      res.json({
        ok: true,
        order:
          updated.rows[0]
      });
    } catch (error) {
      await client.query(
        "ROLLBACK"
      ).catch(() => {});

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

      if (!result.rows.length) {
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
   CREATE ORDER
   THIS FIXES:
   null value in column "id"
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

      /* -----------------------------------------------------
         CUSTOMER VALIDATION
      ----------------------------------------------------- */

      if (
        !customer ||
        !cleanText(
          customer.name
        ) ||
        !cleanText(
          customer.phone
        ) ||
        !cleanText(
          customer.address
        )
      ) {
        return res.status(400).json({
          error:
            "Customer information is required"
        });
      }

      /* -----------------------------------------------------
         ITEM VALIDATION
      ----------------------------------------------------- */

      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          error:
            "Order items are required"
        });
      }

      await client.query(
        "BEGIN"
      );

      /* -----------------------------------------------------
         COMBINE SAME PRODUCT
      ----------------------------------------------------- */

      const quantityMap =
        new Map();

      for (
        const item of items
      ) {
        const productId =
          cleanText(
            item?.id
          );

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
          (
            quantityMap.get(
              productId
            ) || 0
          ) + qty
        );
      }

      /* -----------------------------------------------------
         CHECK PRODUCTS + STOCK
      ----------------------------------------------------- */

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

        const availableStock =
          Number(
            product.stock
          );

        if (
          availableStock <
          qty
        ) {
          throw new Error(
            `Not enough stock for ${product.name}`
          );
        }

        const price =
          Number(
            product.price
          );

        total +=
          price * qty;

        cleanItems.push({
          id: String(
            product.id
          ),

          name:
            product.name,

          price,

          qty
        });
      }

      total =
        Math.round(
          total * 100
        ) / 100;

      /* -----------------------------------------------------
         CREATE ORDER ID
         NEVER NULL
      ----------------------------------------------------- */

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

      /* -----------------------------------------------------
         INSERT ORDER
      ----------------------------------------------------- */

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
          String(orderId),

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

      /* -----------------------------------------------------
         REDUCE STOCK
      ----------------------------------------------------- */

      for (
        const item of cleanItems
      ) {
        const stockResult =
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
              String(item.id)
            ]
          );

        if (
          stockResult.rowCount !==
          1
        ) {
          throw new Error(
            `Stock changed while placing order for ${item.name}. Please try again.`
          );
        }
      }

      /* -----------------------------------------------------
         SAVE CUSTOMER
      ----------------------------------------------------- */

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
        (
          $1,$2,$3,$4,NOW(),NOW()
        )
        ON CONFLICT (phone)
        DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          updated_at = NOW()
        `,
        [
          customerId,
          cleanCustomer.name,
          cleanCustomer.phone,
          cleanCustomer.address
        ]
      );

      await client.query(
        "COMMIT"
      );

      /* -----------------------------------------------------
         SUCCESS
      ----------------------------------------------------- */

      res.status(201).json({
        ok: true,

        orderId:
          String(orderId),

        total,

        status:
          "Pending",

        paymentStatus:
          "Pending"
      });
    } catch (error) {
      await client.query(
        "ROLLBACK"
      ).catch(() => {});

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
          `,
          [orderId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      const order =
        result.rows[0];

      order.id =
        String(order.id);

      order.customer =
        safeJson(
          order.customer,
          {}
        );

      order.items =
        safeJson(
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
   PUBLIC CANCEL ORDER
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
            stock_restored AS "stockRestored"
          FROM orders
          WHERE id = $1
          FOR UPDATE
          `,
          [orderId]
        );

      if (!result.rows.length) {
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

      order.items =
        safeJson(
          order.items,
          []
        );

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

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        order:
          updated.rows[0]
      });
    } catch (error) {
      await client.query(
        "ROLLBACK"
      ).catch(() => {});

      console.error(
        "Cancel order error:",
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
      fs.existsSync(
        adminFile
      )
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
        fs.existsSync(
          indexFile
        )
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
      error:
        "Not found"
    });
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER
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
