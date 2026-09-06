const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const app = express();

app.set("trust proxy", 1);

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "20mb"
}));

/* =========================================================
   BASIC SETTINGS
========================================================= */

const ADMIN_USERNAME = "SMADMIN";
const ADMIN_PASSWORD = "SM2728";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "CHANGE_THIS_SESSION_SECRET";

const CUSTOMER_COOKIE = "sm_customer_session";
const CUSTOMER_SESSION_DAYS = 30;

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

const defaultSettings = {
  shopName: "SM Online Shop",
  tagline: "Style • Comfort • Confidence ♥",
  phone1: "01827872334",
  phone2: "01886995687",
  facebook:
    "https://www.facebook.com/share/1Dr8FEmuoQ/",
  currency: "৳"
};

/* =========================================================
   DATABASE
========================================================= */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================================================
   CLOUDINARY
========================================================= */

cloudinary.config({
  cloud_name:
    process.env.CLOUDINARY_CLOUD_NAME,

  api_key:
    process.env.CLOUDINARY_API_KEY,

  api_secret:
    process.env.CLOUDINARY_API_SECRET
});

/* =========================================================
   GENERAL HELPERS
========================================================= */

function cleanText(value, fallback = "") {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value).trim();
}

function positiveNumber(
  value,
  fallback = 0
) {
  const n = Number(value);

  return Number.isFinite(n) && n >= 0
    ? n
    : fallback;
}

function nonNegativeInt(
  value,
  fallback = 0
) {
  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n < 0
  ) {
    return fallback;
  }

  return Math.floor(n);
}

function safeJsonParse(
  value,
  fallback
) {
  try {
    if (
      typeof value === "object" &&
      value !== null
    ) {
      return value;
    }

    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function makeId(prefix) {
  return (
    prefix +
    Date.now()
      .toString(36)
      .toUpperCase() +
    crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase()
  );
}

function createRandomToken(
  bytes = 32
) {
  return crypto
    .randomBytes(bytes)
    .toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function isProduction() {
  return (
    process.env.NODE_ENV ===
      "production" ||
    Boolean(process.env.RENDER)
  );
}

/* =========================================================
   COOKIE HELPERS
========================================================= */

function parseCookies(req) {
  const header =
    req.headers.cookie || "";

  const cookies = {};

  header
    .split(";")
    .forEach((part) => {
      const index =
        part.indexOf("=");

      if (index === -1) {
        return;
      }

      const key =
        part
          .slice(0, index)
          .trim();

      const value =
        part
          .slice(index + 1)
          .trim();

      try {
        cookies[key] =
          decodeURIComponent(value);
      } catch {
        cookies[key] =
          value;
      }
    });

  return cookies;
}

function setCustomerCookie(
  res,
  token
) {
  const maxAge =
    CUSTOMER_SESSION_DAYS *
    24 *
    60 *
    60;

  let cookie =
    `${CUSTOMER_COOKIE}=${encodeURIComponent(token)}; ` +
    `Max-Age=${maxAge}; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `SameSite=Lax`;

  if (isProduction()) {
    cookie += "; Secure";
  }

  res.setHeader(
    "Set-Cookie",
    cookie
  );
}

function clearCustomerCookie(
  res
) {
  let cookie =
    `${CUSTOMER_COOKIE}=; ` +
    `Max-Age=0; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `SameSite=Lax`;

  if (isProduction()) {
    cookie += "; Secure";
  }

  res.setHeader(
    "Set-Cookie",
    cookie
  );
}

/* =========================================================
   URL HELPERS
========================================================= */

function getBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL
      .replace(/\/+$/, "");
  }

  if (
    process.env.RENDER_EXTERNAL_URL
  ) {
    return process.env
      .RENDER_EXTERNAL_URL
      .replace(/\/+$/, "");
  }

  return (
    `${req.protocol}://${req.get("host")}`
  );
}

function getOAuthRedirectUri(
  req,
  provider
) {
  return (
    `${getBaseUrl(req)}/auth/${provider}/callback`
  );
}

function redirectLoginError(
  res,
  message
) {
  const params =
    new URLSearchParams({
      loginError:
        message ||
        "Login failed"
    });

  res.redirect(
    `/?${params.toString()}`
  );
}

/* =========================================================
   HTTP JSON HELPER
========================================================= */

async function fetchJson(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      options
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    const message =
      data?.error_description ||
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `Request failed with status ${response.status}`;

    throw new Error(
      String(message)
    );
  }

  return data;
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initDatabase() {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    /* -------------------------------------------------------
       STORE SETTINGS
    ------------------------------------------------------- */

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL
          DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    /*
      IMPORTANT:
      Old database may already have store_settings
      without the data column.
    */

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS data JSONB
      DEFAULT '{}'::jsonb
    `);

    /*
      Old database may use these columns.
      Add them if they do not exist.
    */

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS shop_name TEXT
      DEFAULT 'SM Online Shop'
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS tagline TEXT
      DEFAULT 'Style • Comfort • Confidence ♥'
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS phone1 TEXT
      DEFAULT '01827872334'
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS phone2 TEXT
      DEFAULT '01886995687'
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS facebook TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS currency TEXT
      DEFAULT '৳'
    `);

    /* -------------------------------------------------------
       PRODUCTS
    ------------------------------------------------------- */

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT DEFAULT '',
        description TEXT DEFAULT '',
        price NUMERIC(12,2)
          NOT NULL DEFAULT 0,
        old_price NUMERIC(12,2)
          NOT NULL DEFAULT 0,
        discount NUMERIC(12,2)
          NOT NULL DEFAULT 0,
        stock INTEGER
          NOT NULL DEFAULT 0,
        image TEXT DEFAULT '',
        gallery JSONB
          DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ
          DEFAULT NOW(),
        updated_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    /* -------------------------------------------------------
       ORDERS
    ------------------------------------------------------- */

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer JSONB NOT NULL,
        items JSONB NOT NULL,
        total NUMERIC(12,2)
          NOT NULL DEFAULT 0,
        payment_method TEXT
          DEFAULT 'COD',
        status TEXT
          NOT NULL DEFAULT 'Pending',
        payment_status TEXT
          NOT NULL DEFAULT 'Pending',
        stock_restored BOOLEAN
          NOT NULL DEFAULT FALSE,
        customer_id TEXT,
        created_at TIMESTAMPTZ
          DEFAULT NOW(),
        updated_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    /* -------------------------------------------------------
       CUSTOMERS
    ------------------------------------------------------- */

    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        email TEXT DEFAULT '',
        provider TEXT DEFAULT '',
        provider_id TEXT DEFAULT '',
        avatar_url TEXT DEFAULT '',
        created_at TIMESTAMPTZ
          DEFAULT NOW(),
        updated_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    /* -------------------------------------------------------
       CUSTOMER SESSIONS
    ------------------------------------------------------- */

    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_sessions (
        token_hash TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    /* -------------------------------------------------------
       OAUTH STATES
    ------------------------------------------------------- */

    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ
          DEFAULT NOW()
      )
    `);

    /* -------------------------------------------------------
       OLD DATABASE REPAIR
    ------------------------------------------------------- */

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS category TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS description TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS price NUMERIC(12,2)
      NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS old_price NUMERIC(12,2)
      NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2)
      NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock INTEGER
      NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS image TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS gallery JSONB
      DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
      DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
      DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_id TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN
      NOT NULL DEFAULT FALSE
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
      DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS email TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS provider TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS provider_id TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS avatar_url TEXT
      DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
      DEFAULT NOW()
    `);

    /* -------------------------------------------------------
       STORE SETTINGS DATA REPAIR
    ------------------------------------------------------- */

    await client.query(`
      UPDATE store_settings
      SET
        data = jsonb_build_object(
          'shopName',
          COALESCE(
            shop_name,
            'SM Online Shop'
          ),

          'tagline',
          COALESCE(
            tagline,
            'Style • Comfort • Confidence ♥'
          ),

          'phone1',
          COALESCE(
            phone1,
            '01827872334'
          ),

          'phone2',
          COALESCE(
            phone2,
            '01886995687'
          ),

          'facebook',
          COALESCE(
            facebook,
            ''
          ),

          'currency',
          COALESCE(
            currency,
            '৳'
          )
        ),
        updated_at = NOW()
      WHERE id = 1
    `);

    /* -------------------------------------------------------
       DEFAULT SETTINGS
    ------------------------------------------------------- */

    const settingsResult =
      await client.query(`
        SELECT id
        FROM store_settings
        WHERE id = 1
        LIMIT 1
      `);

    if (
      !settingsResult.rows.length
    ) {
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
          data
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
          $7::jsonb
        )
        `,
        [
          defaultSettings.shopName,
          defaultSettings.tagline,
          defaultSettings.phone1,
          defaultSettings.phone2,
          defaultSettings.facebook,
          defaultSettings.currency,
          JSON.stringify(
            defaultSettings
          )
        ]
      );
    }

    /* -------------------------------------------------------
       INDEXES
    ------------------------------------------------------- */

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      orders_customer_id_idx
      ON orders(customer_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      customers_email_lower_idx
      ON customers(LOWER(email))
    `);

    /* -------------------------------------------------------
       CLEAN EXPIRED DATA
    ------------------------------------------------------- */

    await client.query(`
      DELETE FROM customer_sessions
      WHERE expires_at < NOW()
    `);

    await client.query(`
      DELETE FROM oauth_states
      WHERE expires_at < NOW()
    `);

    await client.query(
      "COMMIT"
    );

    console.log(
      "Database initialized successfully."
    );
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

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
   CUSTOMER AUTH HELPERS
========================================================= */

async function getCustomerFromSession(
  req
) {
  const cookies =
    parseCookies(req);

  const rawToken =
    cookies[CUSTOMER_COOKIE];

  if (!rawToken) {
    return null;
  }

  const tokenHash =
    hashToken(rawToken);

  const result =
    await pool.query(
      `
      SELECT
        c.id,
        c.name,
        c.phone,
        c.address,
        c.email,
        c.provider,
        c.provider_id,
        c.avatar_url,
        c.created_at,
        c.updated_at
      FROM customer_sessions s
      JOIN customers c
        ON c.id = s.customer_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
      LIMIT 1
      `,
      [tokenHash]
    );

  if (
    !result.rows.length
  ) {
    return null;
  }

  return result.rows[0];
}

async function requireCustomer(
  req,
  res,
  next
) {
  try {
    const customer =
      await getCustomerFromSession(
        req
      );

    if (!customer) {
      return res.status(401).json({
        ok: false,
        loginRequired: true,
        message:
          "Customer login required."
      });
    }

    req.customer =
      customer;

    next();
  } catch (error) {
    console.error(
      "Customer auth error:",
      error
    );

    res.status(500).json({
      ok: false,
      message:
        "Authentication error."
    });
  }
}

async function createCustomerSession(
  customerId
) {
  const rawToken =
    createRandomToken(32);

  const tokenHash =
    hashToken(rawToken);

  await pool.query(
    `
    INSERT INTO customer_sessions
    (
      token_hash,
      customer_id,
      expires_at
    )
    VALUES
    (
      $1,
      $2,
      NOW() + INTERVAL '30 days'
    )
    `,
    [
      tokenHash,
      customerId
    ]
  );

  return rawToken;
}

/* =========================================================
   OAUTH HELPERS
========================================================= */

async function createOAuthState(
  provider
) {
  const state =
    createRandomToken(24);

  await pool.query(
    `
    INSERT INTO oauth_states
    (
      state,
      provider,
      expires_at
    )
    VALUES
    (
      $1,
      $2,
      NOW() + INTERVAL '10 minutes'
    )
    `,
    [
      state,
      provider
    ]
  );

  return state;
}

async function consumeOAuthState(
  state,
  provider
) {
  const result =
    await pool.query(
      `
      DELETE FROM oauth_states
      WHERE state = $1
        AND provider = $2
        AND expires_at > NOW()
      RETURNING state
      `,
      [
        state,
        provider
      ]
    );

  return (
    result.rows.length > 0
  );
}

/* =========================================================
   CUSTOMER AUTH — GOOGLE
========================================================= */

app.get(
  "/auth/google",
  async (req, res) => {
    try {
      if (
        !process.env.GOOGLE_CLIENT_ID ||
        !process.env.GOOGLE_CLIENT_SECRET
      ) {
        return redirectLoginError(
          res,
          "Google login is not configured."
        );
      }

      const state =
        await createOAuthState(
          "google"
        );

      const redirectUri =
        getOAuthRedirectUri(
          req,
          "google"
        );

      const params =
        new URLSearchParams({
          client_id:
            process.env
              .GOOGLE_CLIENT_ID,

          redirect_uri:
            redirectUri,

          response_type:
            "code",

          scope:
            "openid email profile",

          state,

          access_type:
            "online",

          prompt:
            "select_account"
        });

      res.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
      );
    } catch (error) {
      console.error(
        "Google start error:",
        error
      );

      redirectLoginError(
        res,
        "Unable to start Google login."
      );
    }
  }
);

app.get(
  "/auth/google/callback",
  async (req, res) => {
    try {
      const {
        code,
        state
      } = req.query;

      if (!code || !state) {
        return redirectLoginError(
          res,
          "Invalid Google login request."
        );
      }

      const validState =
        await consumeOAuthState(
          state,
          "google"
        );

      if (!validState) {
        return redirectLoginError(
          res,
          "Google login session expired."
        );
      }

      const redirectUri =
        getOAuthRedirectUri(
          req,
          "google"
        );

      const tokenData =
        await fetchJson(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body:
              new URLSearchParams({
                client_id:
                  process.env
                    .GOOGLE_CLIENT_ID,

                client_secret:
                  process.env
                    .GOOGLE_CLIENT_SECRET,

                code:
                  String(code),

                grant_type:
                  "authorization_code",

                redirect_uri:
                  redirectUri
              }).toString()
          }
        );

      if (
        !tokenData.access_token
      ) {
        throw new Error(
          "Google access token missing."
        );
      }

      const userInfo =
        await fetchJson(
          "https://openidconnect.googleapis.com/v1/userinfo",
          {
            headers: {
              Authorization:
                `Bearer ${tokenData.access_token}`
            }
          }
        );

      if (!userInfo.sub) {
        throw new Error(
          "Google account ID missing."
        );
      }

      const customerId =
        makeId("C");

      let customer;

      const existing =
        await pool.query(
          `
          SELECT *
          FROM customers
          WHERE provider = 'google'
            AND provider_id = $1
          LIMIT 1
          `,
          [
            String(
              userInfo.sub
            )
          ]
        );

      if (
        existing.rows.length
      ) {
        const result =
          await pool.query(
            `
            UPDATE customers
            SET
              name = $1,
              email = $2,
              avatar_url = $3,
              updated_at = NOW()
            WHERE id = $4
            RETURNING *
            `,
            [
              cleanText(
                userInfo.name,
                "Google Customer"
              ),

              cleanText(
                userInfo.email
              ),

              cleanText(
                userInfo.picture
              ),

              existing.rows[0].id
            ]
          );

        customer =
          result.rows[0];
      } else {
        const result =
          await pool.query(
            `
            INSERT INTO customers
            (
              id,
              name,
              phone,
              address,
              email,
              provider,
              provider_id,
              avatar_url
            )
            VALUES
            (
              $1,
              $2,
              '',
              '',
              $3,
              'google',
              $4,
              $5
            )
            RETURNING *
            `,
            [
              customerId,

              cleanText(
                userInfo.name,
                "Google Customer"
              ),

              cleanText(
                userInfo.email
              ),

              String(
                userInfo.sub
              ),

              cleanText(
                userInfo.picture
              )
            ]
          );

        customer =
          result.rows[0];
      }

      const sessionToken =
        await createCustomerSession(
          customer.id
        );

      setCustomerCookie(
        res,
        sessionToken
      );

      res.redirect("/");
    } catch (error) {
      console.error(
        "Google callback error:",
        error
      );

      redirectLoginError(
        res,
        "Google login failed."
      );
    }
  }
);

/* =========================================================
   CUSTOMER API
========================================================= */

app.get(
  "/api/customer/me",
  async (req, res) => {
    try {
      const customer =
        await getCustomerFromSession(
          req
        );

      res.set(
        "Cache-Control",
        "no-store"
      );

      if (!customer) {
        return res.json({
          ok: true,
          loggedIn: false,
          customer: null
        });
      }

      res.json({
        ok: true,
        loggedIn: true,
        customer
      });
    } catch (error) {
      console.error(
        "Customer me error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load customer."
      });
    }
  }
);

app.post(
  "/api/customer/logout",
  async (req, res) => {
    try {
      const cookies =
        parseCookies(req);

      const rawToken =
        cookies[CUSTOMER_COOKIE];

      if (rawToken) {
        await pool.query(
          `
          DELETE FROM customer_sessions
          WHERE token_hash = $1
          `,
          [
            hashToken(
              rawToken
            )
          ]
        );
      }

      clearCustomerCookie(
        res
      );

      res.json({
        ok: true
      });
    } catch (error) {
      clearCustomerCookie(
        res
      );

      res.status(500).json({
        ok: false,
        message:
          "Logout failed."
      });
    }
  }
);

/* =========================================================
   ADMIN AUTHENTICATION
   IMPORTANT — THIS FIXES:
   ReferenceError: adminAuth is not defined
========================================================= */

const adminSessions =
  new Map();

function createAdminToken() {
  return createRandomToken(32);
}

function adminAuth(
  req,
  res,
  next
) {
  try {
    const authorization =
      req.headers.authorization ||
      "";

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        ok: false,
        message:
          "Admin login required."
      });
    }

    const token =
      authorization
        .slice(7)
        .trim();

    if (
      !token ||
      !adminSessions.has(token)
    ) {
      return res.status(401).json({
        ok: false,
        message:
          "Admin session expired. Please login again."
      });
    }

    req.admin = {
      username:
        ADMIN_USERNAME
    };

    next();
  } catch (error) {
    console.error(
      "Admin auth error:",
      error
    );

    return res.status(500).json({
      ok: false,
      message:
        "Admin authentication error."
    });
  }
}

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
      cleanText(
        req.body?.password
      );

    if (
      username !==
        ADMIN_USERNAME ||
      password !==
        ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        ok: false,
        message:
          "Invalid username or password."
      });
    }

    const token =
      createAdminToken();

    adminSessions.set(
      token,
      {
        createdAt:
          Date.now()
      }
    );

    res.json({
      ok: true,
      token
    });
  }
);

app.get(
  "/api/admin/check",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,
      loggedIn: true
    });
  }
);

app.post(
  "/api/admin/logout",
  adminAuth,
  (req, res) => {
    const authorization =
      req.headers.authorization ||
      "";

    const token =
      authorization
        .slice(7)
        .trim();

    adminSessions.delete(
      token
    );

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   STOP HERE — PART 2 WILL CONTINUE DIRECTLY
========================================================= */
/* =========================================================
   PART 2 — ADMIN PRODUCTS + ORDERS
========================================================= */

/* =========================================================
   ADMIN — GET PRODUCTS
========================================================= */

app.get(
  "/api/admin/products",
  adminAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
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
          FROM products
          ORDER BY created_at DESC
        `);

      res.json({
        ok: true,
        products:
          result.rows
      });
    } catch (error) {
      console.error(
        "Admin products error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load products."
      });
    }
  }
);


/* =========================================================
   ADMIN — CLOUDINARY IMAGE UPLOAD
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
          ok: false,
          message:
            "Image is required."
        });
      }

      if (
        typeof image !== "string" ||
        !image.startsWith("data:image/")
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid image format."
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
          ok: false,
          message:
            "Cloudinary is not configured."
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
        publicId:
          result.public_id
      });
    } catch (error) {
      console.error(
        "Cloudinary upload error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Image upload failed."
      });
    }
  }
);


/* =========================================================
   ADMIN — CREATE PRODUCT
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

      const category =
        cleanText(body.category);

      const description =
        cleanText(
          body.description
        );

      const price =
        positiveNumber(
          body.price
        );

      const oldPrice =
        positiveNumber(
          body.oldPrice ??
          body.old_price ??
          0
        );

      const discount =
        positiveNumber(
          body.discount
        );

      const stock =
        nonNegativeInt(
          body.stock
        );

      const image =
        cleanText(
          body.image
        );

      let gallery =
        body.gallery;

      if (!Array.isArray(gallery)) {
        gallery = [];
      }

      gallery =
        gallery
          .filter(
            (item) =>
              typeof item ===
                "string" &&
              item.trim()
          )
          .map(
            (item) =>
              item.trim()
          );

      if (
        image &&
        !gallery.includes(image)
      ) {
        gallery.unshift(
          image
        );
      }

      if (!name) {
        return res.status(400).json({
          ok: false,
          message:
            "Product name is required."
        });
      }

      const id =
        makeId("P");

      const result =
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
            gallery
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
            $10::jsonb
          )
          RETURNING *
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
            image,
            JSON.stringify(
              gallery
            )
          ]
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
        ok: false,
        message:
          "Unable to create product."
      });
    }
  }
);


/* =========================================================
   ADMIN — UPDATE PRODUCT
========================================================= */

app.put(
  "/api/admin/products/:id",
  adminAuth,
  async (req, res) => {
    try {
      const productId =
        cleanText(
          req.params.id
        );

      if (!productId) {
        return res.status(400).json({
          ok: false,
          message:
            "Product ID is required."
        });
      }

      const body =
        req.body || {};

      const name =
        cleanText(body.name);

      const category =
        cleanText(body.category);

      const description =
        cleanText(
          body.description
        );

      const price =
        positiveNumber(
          body.price
        );

      const oldPrice =
        positiveNumber(
          body.oldPrice ??
          body.old_price ??
          0
        );

      const discount =
        positiveNumber(
          body.discount
        );

      const stock =
        nonNegativeInt(
          body.stock
        );

      const image =
        cleanText(
          body.image
        );

      let gallery =
        body.gallery;

      if (!Array.isArray(gallery)) {
        gallery = [];
      }

      gallery =
        gallery
          .filter(
            (item) =>
              typeof item ===
                "string" &&
              item.trim()
          )
          .map(
            (item) =>
              item.trim()
          );

      if (
        image &&
        !gallery.includes(image)
      ) {
        gallery.unshift(
          image
        );
      }

      if (!name) {
        return res.status(400).json({
          ok: false,
          message:
            "Product name is required."
        });
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
          RETURNING *
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
            JSON.stringify(
              gallery
            ),
            productId
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Product not found."
        });
      }

      res.json({
        ok: true,
        product:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Update product error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to update product."
      });
    }
  }
);


/* =========================================================
   ADMIN — DELETE PRODUCT
========================================================= */

app.delete(
  "/api/admin/products/:id",
  adminAuth,
  async (req, res) => {
    try {
      const productId =
        cleanText(
          req.params.id
        );

      if (!productId) {
        return res.status(400).json({
          ok: false,
          message:
            "Product ID is required."
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM products
          WHERE id = $1
          RETURNING id
          `,
          [
            productId
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Product not found."
        });
      }

      res.json({
        ok: true,
        message:
          "Product deleted successfully."
      });
    } catch (error) {
      console.error(
        "Delete product error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to delete product."
      });
    }
  }
);


/* =========================================================
   RESTORE ORDER STOCK
========================================================= */

async function restoreOrderStock(
  client,
  orderId
) {
  const orderResult =
    await client.query(
      `
      SELECT
        id,
        items,
        stock_restored
      FROM orders
      WHERE id = $1
      FOR UPDATE
      `,
      [
        orderId
      ]
    );

  if (
    !orderResult.rows.length
  ) {
    throw new Error(
      "Order not found."
    );
  }

  const order =
    orderResult.rows[0];

  if (order.stock_restored) {
    return;
  }

  let items =
    safeJsonParse(
      order.items,
      []
    );

  if (!Array.isArray(items)) {
    items = [];
  }

  for (const item of items) {
    const productId =
      cleanText(
        item.productId ??
        item.product_id ??
        item.id
      );

    const quantity =
      nonNegativeInt(
        item.quantity ??
        item.qty ??
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
    [
      orderId
    ]
  );
}


/* =========================================================
   CUSTOMER — CREATE ORDER
   NO CUSTOMER LOGIN REQUIRED
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
        body.customer || {};

      let items =
        body.items;

      if (!Array.isArray(items)) {
        items = [];
      }

      if (!items.length) {
        return res.status(400).json({
          ok: false,
          message:
            "Your cart is empty."
        });
      }

      const customerData = {
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
          ),

        email:
          cleanText(
            customer.email
          ),

        city:
          cleanText(
            customer.city
          ),

        note:
          cleanText(
            customer.note
          )
      };

      if (
        !customerData.name
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Customer name is required."
        });
      }

      if (
        !customerData.phone
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Customer phone number is required."
        });
      }

      if (
        !customerData.address
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Customer address is required."
        });
      }

      const normalizedItems =
        items.map(
          (item) => ({
            productId:
              cleanText(
                item.productId ??
                item.product_id ??
                item.id
              ),

            name:
              cleanText(
                item.name
              ),

            price:
              positiveNumber(
                item.price
              ),

            quantity:
              nonNegativeInt(
                item.quantity ??
                item.qty
              ),

            image:
              cleanText(
                item.image
              )
          })
        );

      for (
        const item of normalizedItems
      ) {
        if (
          !item.productId ||
          item.quantity <= 0
        ) {
          return res.status(400).json({
            ok: false,
            message:
              "Invalid product quantity."
          });
        }
      }

      await client.query(
        "BEGIN"
      );

      let total = 0;

      const finalItems = [];

      for (
        const item of normalizedItems
      ) {
        const productResult =
          await client.query(
            `
            SELECT
              id,
              name,
              price,
              stock,
              image
            FROM products
            WHERE id = $1
            FOR UPDATE
            `,
            [
              item.productId
            ]
          );

        if (
          !productResult.rows.length
        ) {
          throw new Error(
            `Product not found: ${item.productId}`
          );
        }

        const product =
          productResult.rows[0];

        if (
          product.stock <
          item.quantity
        ) {
          throw new Error(
            `${product.name} is out of stock. Available stock: ${product.stock}`
          );
        }

        const unitPrice =
          Number(
            product.price
          );

        const lineTotal =
          unitPrice *
          item.quantity;

        total += lineTotal;

        finalItems.push({
          productId:
            product.id,

          name:
            product.name,

          price:
            unitPrice,

          quantity:
            item.quantity,

          image:
            product.image ||
            item.image ||
            ""
        });

        await client.query(
          `
          UPDATE products
          SET
            stock =
              stock - $1,
            updated_at =
              NOW()
          WHERE id = $2
          `,
          [
            item.quantity,
            product.id
          ]
        );
      }

      const paymentMethod =
        cleanText(
          body.paymentMethod ??
          body.payment_method ??
          "COD"
        ) || "COD";

      const orderId =
        makeId("ORD");

      await client.query(
        `
        INSERT INTO orders
        (
          id,
          customer,
          items,
          total,
          payment_method,
          status,
          payment_status,
          stock_restored,
          customer_id
        )
        VALUES
        (
          $1,
          $2::jsonb,
          $3::jsonb,
          $4,
          $5,
          'Pending',
          'Pending',
          FALSE,
          NULL
        )
        `,
        [
          orderId,

          JSON.stringify(
            customerData
          ),

          JSON.stringify(
            finalItems
          ),

          total,

          paymentMethod
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.status(201).json({
        ok: true,

        order: {
          id:
            orderId,

          total,

          status:
            "Pending",

          paymentStatus:
            "Pending",

          paymentMethod,

          customer:
            customerData,

          items:
            finalItems
        }
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "Create order error:",
        error
      );

      res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Unable to place order."
      });
    } finally {
      client.release();
    }
  }
);


/* =========================================================
   ADMIN — GET ACTIVE ORDERS
   Cancelled orders are hidden
========================================================= */

app.get(
  "/api/admin/orders",
  adminAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            id,
            customer,
            items,
            total,
            payment_method,
            status,
            payment_status,
            stock_restored,
            created_at,
            updated_at
          FROM orders
          WHERE status <> 'Cancelled'
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
              ),

            total:
              Number(
                order.total
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
        ok: false,
        message:
          "Unable to load orders."
      });
    }
  }
);


/* =========================================================
   ADMIN — UPDATE ORDER STATUS
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
          ok: false,
          message:
            "Invalid order status."
        });
      }

      await client.query(
        "BEGIN"
      );

      const existingResult =
        await client.query(
          `
          SELECT
            id,
            status,
            stock_restored
          FROM orders
          WHERE id = $1
          FOR UPDATE
          `,
          [
            orderId
          ]
        );

      if (
        !existingResult.rows.length
      ) {
        throw new Error(
          "Order not found."
        );
      }

      const existing =
        existingResult.rows[0];

      if (
        newStatus ===
          "Cancelled" &&
        existing.status !==
          "Cancelled"
      ) {
        await restoreOrderStock(
          client,
          orderId
        );
      }

      await client.query(
        `
        UPDATE orders
        SET
          status = $1,
          updated_at = NOW()
        WHERE id = $2
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
        message:
          "Order status updated successfully.",
        status:
          newStatus
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "Update order status error:",
        error
      );

      res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Unable to update order status."
      });
    } finally {
      client.release();
    }
  }
);


/* =========================================================
   PART 2 END
   PART 3 WILL CONTINUE DIRECTLY FROM HERE
========================================================= */
/* =========================================================
   PART 3 — CUSTOMER ORDER ACTIONS + STORE + PRODUCTS
========================================================= */


/* =========================================================
   CUSTOMER — CANCEL ORDER
   NO CUSTOMER LOGIN REQUIRED
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
          ok: false,
          message:
            "Order ID is required."
        });
      }

      await client.query(
        "BEGIN"
      );

      const result =
        await client.query(
          `
          SELECT
            id,
            status,
            stock_restored
          FROM orders
          WHERE id = $1
          FOR UPDATE
          `,
          [
            orderId
          ]
        );

      if (
        !result.rows.length
      ) {
        throw new Error(
          "Order not found."
        );
      }

      const order =
        result.rows[0];

      if (
        order.status ===
          "Cancelled"
      ) {
        await client.query(
          "COMMIT"
        );

        return res.json({
          ok: true,
          message:
            "Order is already cancelled.",
          status:
            "Cancelled"
        });
      }

      if (
        order.status ===
          "Delivered"
      ) {
        throw new Error(
          "Delivered order cannot be cancelled."
        );
      }

      if (
        order.status ===
          "Shipped"
      ) {
        throw new Error(
          "Shipped order cannot be cancelled."
        );
      }

      await restoreOrderStock(
        client,
        orderId
      );

      await client.query(
        `
        UPDATE orders
        SET
          status = 'Cancelled',
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          orderId
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        message:
          "Order cancelled successfully.",
        status:
          "Cancelled"
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "Cancel order error:",
        error
      );

      res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Unable to cancel order."
      });
    } finally {
      client.release();
    }
  }
);


/* =========================================================
   CUSTOMER — TRACK ORDER
   NO LOGIN REQUIRED
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
          ok: false,
          message:
            "Order ID is required."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            customer,
            items,
            total,
            payment_method,
            status,
            payment_status,
            created_at,
            updated_at
          FROM orders
          WHERE id = $1
          LIMIT 1
          `,
          [
            orderId
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Order not found."
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
            ),

          items:
            safeJsonParse(
              order.items,
              []
            ),

          total:
            Number(
              order.total
            )
        }
      });
    } catch (error) {
      console.error(
        "Track order error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load order."
      });
    }
  }
);


/* =========================================================
   CUSTOMER — ORDER TRACKING ALIAS
========================================================= */

app.get(
  "/api/orders/track/:id",
  async (req, res) => {
    try {
      const orderId =
        cleanText(
          req.params.id
        );

      if (!orderId) {
        return res.status(400).json({
          ok: false,
          message:
            "Order ID is required."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            customer,
            items,
            total,
            payment_method,
            status,
            payment_status,
            created_at,
            updated_at
          FROM orders
          WHERE id = $1
          LIMIT 1
          `,
          [
            orderId
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Order not found."
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
            ),

          items:
            safeJsonParse(
              order.items,
              []
            ),

          total:
            Number(
              order.total
            )
        }
      });
    } catch (error) {
      console.error(
        "Order tracking error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to track order."
      });
    }
  }
);


/* =========================================================
   PAYMENT — CREATE
   PLACEHOLDER FOR NOW
========================================================= */

app.post(
  "/api/payment/create",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const orderId =
        cleanText(
          body.orderId ??
          body.order_id
        );

      const method =
        cleanText(
          body.method ??
          body.paymentMethod ??
          body.payment_method
        ) || "COD";

      if (!orderId) {
        return res.status(400).json({
          ok: false,
          message:
            "Order ID is required."
        });
      }

      const orderResult =
        await pool.query(
          `
          SELECT
            id,
            total,
            payment_method,
            payment_status,
            status
          FROM orders
          WHERE id = $1
          LIMIT 1
          `,
          [
            orderId
          ]
        );

      if (
        !orderResult.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Order not found."
        });
      }

      res.json({
        ok: true,

        payment: {
          orderId,
          method,
          amount:
            Number(
              orderResult.rows[0]
                .total
            ),

          status:
            orderResult.rows[0]
              .payment_status,

          message:
            "Payment gateway is ready for integration."
        }
      });
    } catch (error) {
      console.error(
        "Payment create error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to create payment."
      });
    }
  }
);


/* =========================================================
   ADMIN — UPDATE PAYMENT STATUS
========================================================= */

app.put(
  "/api/admin/orders/:id/payment",
  adminAuth,
  async (req, res) => {
    try {
      const orderId =
        cleanText(
          req.params.id
        );

      const paymentStatus =
        cleanText(
          req.body?.paymentStatus ??
          req.body?.payment_status
        );

      if (
        !PAYMENT_STATUSES.includes(
          paymentStatus
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid payment status."
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
            id,
            payment_status,
            updated_at
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
          ok: false,
          message:
            "Order not found."
        });
      }

      res.json({
        ok: true,
        message:
          "Payment status updated successfully.",
        order:
          result.rows[0]
      });
    } catch (error) {
      console.error(
        "Payment status error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to update payment status."
      });
    }
  }
);


/* =========================================================
   STORE SETTINGS
========================================================= */

async function getSettings() {
  const result =
    await pool.query(`
      SELECT
        id,
        shop_name,
        tagline,
        phone1,
        phone2,
        facebook,
        currency,
        data
      FROM store_settings
      WHERE id = 1
      LIMIT 1
    `);

  if (
    !result.rows.length
  ) {
    return {
      ...defaultSettings
    };
  }

  const row =
    result.rows[0];

  const storedData =
    safeJsonParse(
      row.data,
      {}
    );

  return {
    shopName:
      cleanText(
        row.shop_name,
        storedData.shopName ||
          defaultSettings.shopName
      ),

    tagline:
      cleanText(
        row.tagline,
        storedData.tagline ||
          defaultSettings.tagline
      ),

    phone1:
      cleanText(
        row.phone1,
        storedData.phone1 ||
          defaultSettings.phone1
      ),

    phone2:
      cleanText(
        row.phone2,
        storedData.phone2 ||
          defaultSettings.phone2
      ),

    facebook:
      cleanText(
        row.facebook,
        storedData.facebook ||
          defaultSettings.facebook
      ),

    currency:
      cleanText(
        row.currency,
        storedData.currency ||
          defaultSettings.currency
      )
  };
}


/* =========================================================
   PUBLIC — STORE API
   NO CUSTOMER LOGIN REQUIRED
========================================================= */

app.get(
  "/api/store",
  async (req, res) => {
    try {
      const settings =
        await getSettings();

      const productsResult =
        await pool.query(`
          SELECT
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
          FROM products
          ORDER BY created_at DESC
        `);

      const products =
        productsResult.rows.map(
          (product) => ({
            ...product,

            price:
              Number(
                product.price
              ),

            oldPrice:
              Number(
                product.old_price
              ),

            discount:
              Number(
                product.discount
              ),

            stock:
              Number(
                product.stock
              ),

            gallery:
              Array.isArray(
                product.gallery
              )
                ? product.gallery
                : safeJsonParse(
                    product.gallery,
                    []
                  )
          })
        );

      res.set(
        "Cache-Control",
        "no-store"
      );

      res.json({
        ok: true,
        settings,
        products
      });
    } catch (error) {
      console.error(
        "Store API error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load store."
      });
    }
  }
);


/* =========================================================
   PUBLIC — PRODUCTS API
   NO CUSTOMER LOGIN REQUIRED
========================================================= */

app.get(
  "/api/products",
  async (req, res) => {
    try {
      const category =
        cleanText(
          req.query.category
        );

      const search =
        cleanText(
          req.query.search
        );

      let query = `
        SELECT
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
        FROM products
      `;

      const values = [];

      const conditions = [];

      if (category) {
        values.push(
          category
        );

        conditions.push(
          `category = $${values.length}`
        );
      }

      if (search) {
        values.push(
          `%${search}%`
        );

        conditions.push(
          `(
            name ILIKE $${values.length}
            OR category ILIKE $${values.length}
            OR description ILIKE $${values.length}
          )`
        );
      }

      if (
        conditions.length
      ) {
        query +=
          " WHERE " +
          conditions.join(
            " AND "
          );
      }

      query +=
        " ORDER BY created_at DESC";

      const result =
        await pool.query(
          query,
          values
        );

      const products =
        result.rows.map(
          (product) => ({
            ...product,

            price:
              Number(
                product.price
              ),

            oldPrice:
              Number(
                product.old_price
              ),

            discount:
              Number(
                product.discount
              ),

            stock:
              Number(
                product.stock
              ),

            gallery:
              Array.isArray(
                product.gallery
              )
                ? product.gallery
                : safeJsonParse(
                    product.gallery,
                    []
                  )
          })
        );

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
        ok: false,
        message:
          "Unable to load products."
      });
    }
  }
);


/* =========================================================
   ADMIN — GET STORE SETTINGS
========================================================= */

app.get(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const settings =
        await getSettings();

      res.json({
        ok: true,
        settings
      });
    } catch (error) {
      console.error(
        "Admin settings GET error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load settings."
      });
    }
  }
);


/* =========================================================
   ADMIN — UPDATE STORE SETTINGS
========================================================= */

app.put(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const settings = {
        shopName:
          cleanText(
            body.shopName ??
            body.shop_name,
            defaultSettings.shopName
          ),

        tagline:
          cleanText(
            body.tagline,
            defaultSettings.tagline
          ),

        phone1:
          cleanText(
            body.phone1 ??
            body.phone_1,
            defaultSettings.phone1
          ),

        phone2:
          cleanText(
            body.phone2 ??
            body.phone_2,
            defaultSettings.phone2
          ),

        facebook:
          cleanText(
            body.facebook,
            defaultSettings.facebook
          ),

        currency:
          cleanText(
            body.currency,
            defaultSettings.currency
          )
      };

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
          data,
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
          $7::jsonb,
          NOW()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          shop_name =
            EXCLUDED.shop_name,

          tagline =
            EXCLUDED.tagline,

          phone1 =
            EXCLUDED.phone1,

          phone2 =
            EXCLUDED.phone2,

          facebook =
            EXCLUDED.facebook,

          currency =
            EXCLUDED.currency,

          data =
            EXCLUDED.data,

          updated_at =
            NOW()
        `,
        [
          settings.shopName,
          settings.tagline,
          settings.phone1,
          settings.phone2,
          settings.facebook,
          settings.currency,
          JSON.stringify(
            settings
          )
        ]
      );

      res.json({
        ok: true,
        message:
          "Store settings updated successfully.",
        settings
      });
    } catch (error) {
      console.error(
        "Admin settings PUT error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to update settings."
      });
    }
  }
);


/* =========================================================
   PART 3 END
   PART 4 WILL CONTINUE DIRECTLY FROM HERE
========================================================= */
/* =========================================================
   PART 4 — CLEANUP + STATIC FILES + ADMIN + START SERVER
   ========================================================= */

// ---------------------------------------------------------
// CLEANUP EXPIRED SESSIONS / OLD OAUTH STATES
// ---------------------------------------------------------

async function cleanupExpiredData() {
  try {
    // Remove expired admin sessions
    const now = Date.now();

    for (const [token, session] of adminSessions.entries()) {
      if (!session || !session.expiresAt || session.expiresAt <= now) {
        adminSessions.delete(token);
      }
    }

    // Remove expired customer sessions
    await pool.query(`
      DELETE FROM customer_sessions
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW()
    `);

    // Remove expired OAuth states
    await pool.query(`
      DELETE FROM oauth_states
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW()
    `);

    console.log("🧹 Cleanup completed");
  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}


// Run cleanup once when server starts
cleanupExpiredData();


// Run cleanup every 30 minutes
const cleanupTimer = setInterval(() => {
  cleanupExpiredData();
}, 30 * 60 * 1000);


// ---------------------------------------------------------
// STATIC FILES
// ---------------------------------------------------------

const publicDir = path.join(__dirname, "public");

app.use(express.static(publicDir, {
  extensions: ["html"],
  index: "index.html"
}));


// ---------------------------------------------------------
// ADMIN PAGE
// ---------------------------------------------------------

app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});


// ---------------------------------------------------------
// ROOT WEBSITE
// ---------------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});


// ---------------------------------------------------------
// EXPRESS 5 SAFE FRONTEND FALLBACK
// IMPORTANT:
// DO NOT USE app.get("*", ...)
// ---------------------------------------------------------

app.use((req, res, next) => {
  // API routes should reach the API 404 handler
  if (req.path.startsWith("/api/")) {
    return next();
  }

  // OAuth routes should reach OAuth handlers
  if (req.path.startsWith("/auth/")) {
    return next();
  }

  // If request accepts HTML, return the main website
  if (req.accepts("html")) {
    return res.sendFile(path.join(publicDir, "index.html"));
  }

  next();
});


// ---------------------------------------------------------
// 404 HANDLER
// ---------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "Not found."
  });
});


// ---------------------------------------------------------
// GLOBAL ERROR HANDLER
// ---------------------------------------------------------

app.use((err, req, res, next) => {
  console.error("❌ GLOBAL ERROR:");
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode =
    Number.isInteger(err.statusCode) ? err.statusCode :
    Number.isInteger(err.status) ? err.status :
    500;

  res.status(statusCode).json({
    ok: false,
    message:
      err.message ||
      "Internal server error."
  });
});


// ---------------------------------------------------------
// START SERVER
// ---------------------------------------------------------

async function startServer() {
  try {
    console.log("========================================");
    console.log("🚀 SM Online Shop starting...");
    console.log("========================================");

    // Initialize database
    await initDatabase();

    // Make sure cleanup is running
    await cleanupExpiredData();

    app.listen(PORT, "0.0.0.0", () => {
      console.log("========================================");
      console.log("✅ SM Online Shop is running");
      console.log(`🌐 Port: ${PORT}`);
      console.log(`📁 Public: ${publicDir}`);
      console.log("========================================");
    });

  } catch (error) {
    console.error("❌ SERVER STARTUP FAILED");
    console.error(error);

    process.exit(1);
  }
}


// ---------------------------------------------------------
// GRACEFUL SHUTDOWN
// ---------------------------------------------------------

async function shutdown(signal) {
  console.log(`\n🛑 ${signal} received. Shutting down...`);

  try {
    // Stop cleanup timer
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
    }

    // Clear admin sessions
    adminSessions.clear();

    // Close PostgreSQL connection pool
    await pool.end();

    console.log("✅ Database connection closed");
    console.log("✅ Server shutdown completed");

    process.exit(0);

  } catch (error) {
    console.error("❌ Shutdown error:", error);
    process.exit(1);
  }
}


// ---------------------------------------------------------
// PROCESS SIGNALS
// ---------------------------------------------------------

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});


// ---------------------------------------------------------
// UNHANDLED ERRORS
// ---------------------------------------------------------

process.on("unhandledRejection", (reason) => {
  console.error("❌ UNHANDLED REJECTION:");
  console.error(reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ UNCAUGHT EXCEPTION:");
  console.error(error);
});


// ---------------------------------------------------------
// START APPLICATION
// ---------------------------------------------------------

startServer();
