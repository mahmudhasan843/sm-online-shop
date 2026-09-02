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
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

/* =========================================================
   BASIC SETTINGS
========================================================= */

const ADMIN_USERNAME = "SMADMIN";
const ADMIN_PASSWORD = "SM2728";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET";

const CUSTOMER_COOKIE = "sm_customer_session";
const CUSTOMER_SESSION_DAYS = 30;

const ORDER_STATUSES = [
  "Pending",
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
];

const PAYMENT_STATUSES = [
  "Pending",
  "Paid",
  "Failed",
  "Refunded",
];

const defaultSettings = {
  shopName: "SM Online Shop",
  tagline: "Style • Comfort • Confidence ♥",
  phone1: "01827872334",
  phone2: "01886995687",
  facebook: "https://www.facebook.com/share/1Dr8FEmuoQ/",
  currency: "৳",
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
    rejectUnauthorized: false,
  },
});

/* =========================================================
   CLOUDINARY
========================================================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* =========================================================
   HELPERS
========================================================= */

function cleanText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function positiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function nonNegativeInt(value, fallback = 0) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }

  return Math.floor(n);
}

function safeJsonParse(value, fallback) {
  try {
    if (typeof value === "object") return value;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function makeId(prefix) {
  return (
    prefix +
    Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(5).toString("hex").toUpperCase()
  );
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function createRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function isProduction() {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RENDER)
  );
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });

  return cookies;
}

function setCustomerCookie(res, token) {
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

function clearCustomerCookie(res) {
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

function getBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(
      /\/+$/,
      ""
    );
  }

  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(
      /\/+$/,
      ""
    );
  }

  return `${req.protocol}://${req.get("host")}`;
}

function getOAuthRedirectUri(req, provider) {
  return `${getBaseUrl(req)}/auth/${provider}/callback`;
}

function redirectLoginError(res, message) {
  const params = new URLSearchParams({
    loginError:
      message || "Login failed",
  });

  res.redirect(
    `/?${params.toString()}`
  );
}

async function fetchJson(url, options = {}) {
  const response = await fetch(
    url,
    options
  );

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text,
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
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT DEFAULT '',
        description TEXT DEFAULT '',
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        old_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount NUMERIC(12,2) NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        image TEXT DEFAULT '',
        gallery JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer JSONB NOT NULL,
        items JSONB NOT NULL,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        payment_method TEXT DEFAULT 'COD',
        status TEXT NOT NULL DEFAULT 'Pending',
        payment_status TEXT NOT NULL DEFAULT 'Pending',
        stock_restored BOOLEAN NOT NULL DEFAULT FALSE,
        customer_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_sessions (
        token_hash TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    /* ---------- Repair old tables ---------- */

    await client.query(`
      ALTER TABLE products
      ALTER COLUMN id TYPE TEXT
      USING id::text
    `).catch(() => {});

    await client.query(`
      ALTER TABLE products
      ALTER COLUMN id DROP DEFAULT
    `).catch(() => {});

    await client.query(`
      ALTER TABLE orders
      ALTER COLUMN id TYPE TEXT
      USING id::text
    `).catch(() => {});

    await client.query(`
      ALTER TABLE orders
      ALTER COLUMN id DROP DEFAULT
    `).catch(() => {});

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS provider_id TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_id TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS old_price NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0
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

    await client.query(`
      UPDATE customers
      SET
        email = COALESCE(email, ''),
        provider = COALESCE(provider, ''),
        provider_id = COALESCE(provider_id, ''),
        avatar_url = COALESCE(avatar_url, ''),
        phone = COALESCE(phone, ''),
        address = COALESCE(address, ''),
        name = COALESCE(name, '')
    `);

    await client.query(`
      UPDATE products
      SET
        category = COALESCE(category, ''),
        description = COALESCE(description, ''),
        image = COALESCE(image, ''),
        gallery = COALESCE(gallery, '[]'::jsonb),
        price = COALESCE(price, 0),
        old_price = COALESCE(old_price, 0),
        discount = COALESCE(discount, 0),
        stock = COALESCE(stock, 0)
    `);

    await client.query(`
      UPDATE orders
      SET
        stock_restored =
          COALESCE(stock_restored, FALSE)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS orders_customer_id_idx
      ON orders(customer_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS customers_email_lower_idx
      ON customers(LOWER(email))
      WHERE email IS NOT NULL
        AND email <> ''
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS customers_provider_providerid_idx
      ON customers(provider, provider_id)
      WHERE provider IS NOT NULL
        AND provider <> ''
        AND provider_id IS NOT NULL
        AND provider_id <> ''
    `);

    await client.query(`
      DELETE FROM customer_sessions
      WHERE expires_at < NOW()
    `);

    await client.query(`
      DELETE FROM oauth_states
      WHERE expires_at < NOW()
    `);

    const settingsResult =
      await client.query(`
        SELECT id
        FROM store_settings
        WHERE id = 1
      `);

    if (
      settingsResult.rows.length === 0
    ) {
      await client.query(
        `
        INSERT INTO store_settings
          (id, data)
        VALUES
          (1, $1::jsonb)
        `,
        [
          JSON.stringify(
            defaultSettings
          ),
        ]
      );
    }

    await client.query("COMMIT");

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
   CUSTOMER AUTHENTICATION
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

  if (!result.rows.length) {
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
          "Customer login required.",
      });
    }

    req.customer = customer;

    next();
  } catch (error) {
    console.error(
      "Customer auth error:",
      error
    );

    res.status(500).json({
      ok: false,
      message:
        "Authentication error.",
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
      customerId,
    ]
  );

  return rawToken;
}

async function findOrCreateOAuthCustomer(
  profile
) {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    await client.query(`
      DELETE FROM oauth_states
      WHERE expires_at < NOW()
    `);

    let result =
      await client.query(
        `
        SELECT *
        FROM customers
        WHERE provider = $1
          AND provider_id = $2
        LIMIT 1
        `,
        [
          profile.provider,
          profile.providerId,
        ]
      );

    let customer;

    if (result.rows.length) {
      const existing =
        result.rows[0];

      result =
        await client.query(
          `
          UPDATE customers
          SET
            name = $1,
            email = $2,
            provider = $3,
            provider_id = $4,
            avatar_url = $5,
            updated_at = NOW()
          WHERE id = $6
          RETURNING *
          `,
          [
            profile.name,
            profile.email,
            profile.provider,
            profile.providerId,
            profile.avatarUrl,
            existing.id,
          ]
        );

      customer =
        result.rows[0];
    } else {
      /* Try matching existing account by email */

      if (profile.email) {
        result =
          await client.query(
            `
            SELECT *
            FROM customers
            WHERE LOWER(email) =
                  LOWER($1)
            LIMIT 1
            `,
            [profile.email]
          );
      } else {
        result = {
          rows: [],
        };
      }

      if (result.rows.length) {
        const existing =
          result.rows[0];

        result =
          await client.query(
            `
            UPDATE customers
            SET
              name = $1,
              email = $2,
              provider = $3,
              provider_id = $4,
              avatar_url = $5,
              updated_at = NOW()
            WHERE id = $6
            RETURNING *
            `,
            [
              profile.name ||
                existing.name ||
                "",
              profile.email ||
                existing.email ||
                "",
              profile.provider,
              profile.providerId,
              profile.avatarUrl ||
                existing.avatar_url ||
                "",
              existing.id,
            ]
          );

        customer =
          result.rows[0];
      } else {
        const customerId =
          makeId("C");

        result =
          await client.query(
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
                $4,
                $5,
                $6
              )
            RETURNING *
            `,
            [
              customerId,
              profile.name ||
                "Customer",
              profile.email ||
                "",
              profile.provider,
              profile.providerId,
              profile.avatarUrl ||
                "",
            ]
          );

        customer =
          result.rows[0];
      }
    }

    await client.query(
      "COMMIT"
    );

    return customer;
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   OAUTH STATE
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
      provider,
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
        provider,
      ]
    );

  return (
    result.rows.length > 0
  );
}

/* =========================================================
   GOOGLE LOGIN
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
          response_type: "code",
          scope:
            "openid email profile",
          state,
          access_type: "online",
          prompt:
            "select_account",
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
        state,
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
          "Google login session expired. Please try again."
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
                "application/x-www-form-urlencoded",
            },
            body:
              new URLSearchParams({
                client_id:
                  process.env
                    .GOOGLE_CLIENT_ID,
                client_secret:
                  process.env
                    .GOOGLE_CLIENT_SECRET,
                code: String(code),
                grant_type:
                  "authorization_code",
                redirect_uri:
                  redirectUri,
              }).toString(),
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
                `Bearer ${tokenData.access_token}`,
            },
          }
        );

      if (!userInfo.sub) {
        throw new Error(
          "Google account ID missing."
        );
      }

      const customer =
        await findOrCreateOAuthCustomer(
          {
            provider: "google",
            providerId:
              String(userInfo.sub),
            name: cleanText(
              userInfo.name,
              "Google Customer"
            ),
            email: cleanText(
              userInfo.email
            ),
            avatarUrl: cleanText(
              userInfo.picture
            ),
          }
        );

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
        "Google login failed. Please try again."
      );
    }
  }
);

/* =========================================================
   FACEBOOK LOGIN
========================================================= */

const FACEBOOK_GRAPH_VERSION =
  process.env.FACEBOOK_GRAPH_VERSION ||
  "v24.0";

app.get(
  "/auth/facebook",
  async (req, res) => {
    try {
      if (
        !process.env.FACEBOOK_APP_ID ||
        !process.env.FACEBOOK_APP_SECRET
      ) {
        return redirectLoginError(
          res,
          "Facebook login is not configured."
        );
      }

      const state =
        await createOAuthState(
          "facebook"
        );

      const redirectUri =
        getOAuthRedirectUri(
          req,
          "facebook"
        );

      const params =
        new URLSearchParams({
          client_id:
            process.env
              .FACEBOOK_APP_ID,
          redirect_uri:
            redirectUri,
          state,
          scope:
            "email,public_profile",
        });

      res.redirect(
        `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth?${params.toString()}`
      );
    } catch (error) {
      console.error(
        "Facebook start error:",
        error
      );

      redirectLoginError(
        res,
        "Unable to start Facebook login."
      );
    }
  }
);

app.get(
  "/auth/facebook/callback",
  async (req, res) => {
    try {
      const {
        code,
        state,
      } = req.query;

      if (!code || !state) {
        return redirectLoginError(
          res,
          "Invalid Facebook login request."
        );
      }

      const validState =
        await consumeOAuthState(
          state,
          "facebook"
        );

      if (!validState) {
        return redirectLoginError(
          res,
          "Facebook login session expired. Please try again."
        );
      }

      const redirectUri =
        getOAuthRedirectUri(
          req,
          "facebook"
        );

      const tokenParams =
        new URLSearchParams({
          client_id:
            process.env
              .FACEBOOK_APP_ID,
          client_secret:
            process.env
              .FACEBOOK_APP_SECRET,
          redirect_uri:
            redirectUri,
          code: String(code),
        });

      const tokenData =
        await fetchJson(
          `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token?${tokenParams.toString()}`
        );

      if (
        !tokenData.access_token
      ) {
        throw new Error(
          "Facebook access token missing."
        );
      }

      const profileUrl =
        new URL(
          `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`
        );

      profileUrl.searchParams.set(
        "fields",
        "id,name,email,picture"
      );

      profileUrl.searchParams.set(
        "access_token",
        tokenData.access_token
      );

      const profile =
        await fetchJson(
          profileUrl.toString()
        );

      if (!profile.id) {
        throw new Error(
          "Facebook account ID missing."
        );
      }

      const avatar =
        profile.picture?.data?.url ||
        "";

      const customer =
        await findOrCreateOAuthCustomer(
          {
            provider: "facebook",
            providerId:
              String(profile.id),
            name: cleanText(
              profile.name,
              "Facebook Customer"
            ),
            email: cleanText(
              profile.email
            ),
            avatarUrl:
              cleanText(avatar),
          }
        );

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
        "Facebook callback error:",
        error
      );

      redirectLoginError(
        res,
        "Facebook login failed. Please try again."
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
          customer: null,
        });
      }

      res.json({
        ok: true,
        loggedIn: true,
        customer,
      });
    } catch (error) {
      console.error(
        "Customer me error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load customer.",
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
        const tokenHash =
          hashToken(rawToken);

        await pool.query(
          `
          DELETE FROM customer_sessions
          WHERE token_hash = $1
          `,
          [tokenHash]
        );
      }

      clearCustomerCookie(
        res
      );

      res.set(
        "Cache-Control",
        "no-store"
      );

      res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "Customer logout error:",
        error
      );

      clearCustomerCookie(
        res
      );

      res.status(500).json({
        ok: false,
        message:
          "Logout failed.",
      });
    }
  }
);

app.put(
  "/api/customer/profile",
  requireCustomer,
  async (req, res) => {
    try {
      const name =
        cleanText(
          req.body?.name,
          req.customer.name
        );

      const phone =
        cleanText(
          req.body?.phone,
          req.customer.phone
        );

      const address =
        cleanText(
          req.body?.address,
          req.customer.address
        );

      if (!name) {
        return res.status(400).json({
          ok: false,
          message:
            "Name is required.",
        });
      }

      const result =
        await pool.query(
          `
          UPDATE customers
          SET
            name = $1,
            phone = $2,
            address = $3,
            updated_at = NOW()
          WHERE id = $4
          RETURNING
            id,
            name,
            phone,
            address,
            email,
            provider,
            provider_id,
            avatar_url,
            created_at,
            updated_at
          `,
          [
            name,
            phone,
            address,
            req.customer.id,
          ]
        );

      res.json({
        ok: true,
        customer:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "Profile update error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to update profile.",
      });
    }
  }
);

/* =========================================================
   CUSTOMER ORDERS
========================================================= */

app.get(
  "/api/customer/orders",
  requireCustomer,
  async (req, res) => {
    try {
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
          WHERE customer_id = $1
          ORDER BY created_at DESC
          `,
          [req.customer.id]
        );

      res.json({
        ok: true,
        orders:
          result.rows,
      });
    } catch (error) {
      console.error(
        "Customer orders error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load orders.",
      });
    }
  }
);

app.get(
  "/api/customer/orders/:id",
  requireCustomer,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM orders
          WHERE id = $1
            AND customer_id = $2
          LIMIT 1
          `,
          [
            cleanText(
              req.params.id
            ),
            req.customer.id,
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          message:
            "Order not found.",
        });
      }

      res.json({
        ok: true,
        order:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "Customer order details error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load order.",
      });
    }
  }
);

/* =========================================================
   STORE API
   LOGIN REQUIRED
========================================================= */

app.get(
  "/api/store",
  requireCustomer,
  async (req, res) => {
    try {
      const settingsResult =
        await pool.query(`
          SELECT data
          FROM store_settings
          WHERE id = 1
          LIMIT 1
        `);

      const productsResult =
        await pool.query(`
          SELECT
            id,
            name,
            category,
            description,
            price,
            old_price AS "oldPrice",
            discount,
            stock,
            image,
            gallery,
            created_at,
            updated_at
          FROM products
          ORDER BY created_at DESC
        `);

      const settings =
        settingsResult.rows[0]
          ?.data ||
        defaultSettings;

      res.json({
        ok: true,
        settings,
        products:
          productsResult.rows,
      });
    } catch (error) {
      console.error(
        "Store API error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load store.",
      });
    }
  }
);

app.get(
  "/api/products",
  requireCustomer,
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
            old_price AS "oldPrice",
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
          result.rows,
      });
    } catch (error) {
      console.error(
        "Products API error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load products.",
      });
    }
  }
);

/* =========================================================
   ADMIN AUTH
========================================================= */

const adminSessions =
  new Map();

function createAdminToken() {
  const timestamp =
    Date.now().toString();

  const signature =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(
        `${ADMIN_USERNAME}:${timestamp}`
      )
      .digest("hex");

  return Buffer.from(
    `${timestamp}.${signature}`
  ).toString(
    "base64url"
  );
}

function verifyAdminToken(
  token
) {
  if (!token) return false;

  try {
    const decoded =
      Buffer.from(
        token,
        "base64url"
      ).toString("utf8");

    const [
      timestamp,
      signature,
    ] = decoded.split(".");

    if (
      !timestamp ||
      !signature
    ) {
      return false;
    }

    const age =
      Date.now() -
      Number(timestamp);

    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age >
        24 *
          60 *
          60 *
          1000
    ) {
      return false;
    }

    const expected =
      crypto
        .createHmac(
          "sha256",
          SESSION_SECRET
        )
        .update(
          `${ADMIN_USERNAME}:${timestamp}`
        )
        .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(
        signature
      ),
      Buffer.from(
        expected
      )
    );
  } catch {
    return false;
  }
}

function adminAuth(
  req,
  res,
  next
) {
  const auth =
    req.headers.authorization ||
    "";

  if (
    !auth.startsWith(
      "Bearer "
    )
  ) {
    return res.status(401).json({
      ok: false,
      message:
        "Admin login required.",
    });
  }

  const token =
    auth.slice(7);

  if (
    !verifyAdminToken(token) ||
    !adminSessions.has(token)
  ) {
    return res.status(401).json({
      ok: false,
      message:
        "Invalid or expired admin session.",
    });
  }

  next();
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
          "Invalid username or password.",
      });
    }

    const token =
      createAdminToken();

    adminSessions.set(
      token,
      {
        createdAt:
          Date.now(),
      }
    );

    res.json({
      ok: true,
      token,
    });
  }
);

app.get(
  "/api/admin/check",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,
      loggedIn: true,
    });
  }
);

app.post(
  "/api/admin/logout",
  adminAuth,
  (req, res) => {
    const auth =
      req.headers.authorization ||
      "";

    const token =
      auth.slice(7);

    adminSessions.delete(
      token
    );

    res.json({
      ok: true,
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
      const result =
        await pool.query(`
          SELECT
            id,
            name,
            category,
            description,
            price,
            old_price AS "oldPrice",
            discount,
            stock,
            image,
            gallery,
            created_at,
            updated_at
          FROM products
          ORDER BY created_at DESC
        `);

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "Admin products GET error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load products.",
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
        req.body?.image ||
        req.body?.file ||
        req.body?.data;

      if (!image) {
        return res.status(400).json({
          ok: false,
          message:
            "Image data is required.",
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
            "Cloudinary is not configured.",
        });
      }

      const result =
        await cloudinary
          .uploader
          .upload(
            image,
            {
              folder:
                "sm-online-shop",
              resource_type:
                "image",
            }
          );

      res.json({
        ok: true,
        url:
          result.secure_url,
        publicId:
          result.public_id,
      });
    } catch (error) {
      console.error(
        "Cloudinary upload error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "Image upload failed.",
      });
    }
  }
);

/* =========================================================
   ADMIN CREATE PRODUCT
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
          ok: false,
          message:
            "Product name is required.",
        });
      }

      const category =
        cleanText(
          body.category
        );

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
            body.old_price
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

      if (
        !Array.isArray(
          gallery
        )
      ) {
        gallery = [];
      }

      gallery =
        gallery
          .map((item) =>
            cleanText(item)
          )
          .filter(Boolean);

      if (
        image &&
        !gallery.includes(
          image
        )
      ) {
        gallery.unshift(
          image
        );
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
          RETURNING
            id,
            name,
            category,
            description,
            price,
            old_price AS "oldPrice",
            discount,
            stock,
            image,
            gallery,
            created_at,
            updated_at
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
            ),
          ]
        );

      res.json({
        ok: true,
        product:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "Admin create product error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "Unable to create product.",
      });
    }
  }
);

/* =========================================================
   ADMIN UPDATE PRODUCT
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

      const body =
        req.body || {};

      const name =
        cleanText(body.name);

      if (!name) {
        return res.status(400).json({
          ok: false,
          message:
            "Product name is required.",
        });
      }

      const category =
        cleanText(
          body.category
        );

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
            body.old_price
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

      if (
        !Array.isArray(
          gallery
        )
      ) {
        gallery = [];
      }

      gallery =
        gallery
          .map((item) =>
            cleanText(item)
          )
          .filter(Boolean);

      if (
        image &&
        !gallery.includes(
          image
        )
      ) {
        gallery.unshift(
          image
        );
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
            id,
            name,
            category,
            description,
            price,
            old_price AS "oldPrice",
            discount,
            stock,
            image,
            gallery,
            created_at,
            updated_at
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
            id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Product not found.",
        });
      }

      res.json({
        ok: true,
        product:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "Admin update product error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "Unable to update product.",
      });
    }
  }
);

/* =========================================================
   ADMIN DELETE PRODUCT
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

      const result =
        await pool.query(
          `
          DELETE FROM products
          WHERE id = $1
          RETURNING id
          `,
          [id]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Product not found.",
        });
      }

      res.json({
        ok: true,
        id,
      });
    } catch (error) {
      console.error(
        "Admin delete product error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "Unable to delete product.",
      });
    }
  }
);

/* =========================================================
   ORDER HELPERS
========================================================= */

async function restoreOrderStock(
  client,
  orderId
) {
  const orderResult =
    await client.query(
      `
      SELECT *
      FROM orders
      WHERE id = $1
      FOR UPDATE
      `,
      [orderId]
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

  if (
    order.stock_restored
  ) {
    return order;
  }

  const items =
    Array.isArray(
      order.items
    )
      ? order.items
      : safeJsonParse(
          order.items,
          []
        );

  for (
    const item of items
  ) {
    const productId =
      cleanText(
        item.productId ??
          item.id
      );

    const quantity =
      nonNegativeInt(
        item.quantity ??
          item.qty,
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
        productId,
      ]
    );
  }

  const updated =
    await client.query(
      `
      UPDATE orders
      SET
        stock_restored = TRUE,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [orderId]
    );

  return updated.rows[0];
}

/* =========================================================
   CUSTOMER CREATE ORDER
   LOGIN REQUIRED
========================================================= */

app.post(
  "/api/orders",
  requireCustomer,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const body =
        req.body || {};

      const rawItems =
        Array.isArray(
          body.items
        )
          ? body.items
          : [];

      if (
        !rawItems.length
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Your cart is empty.",
        });
      }

      const checkoutCustomer =
        body.customer || {};

      const name =
        cleanText(
          checkoutCustomer.name,
          req.customer.name
        ) ||
        req.customer.name ||
        "Customer";

      const phone =
        cleanText(
          checkoutCustomer.phone,
          req.customer.phone
        );

      const address =
        cleanText(
          checkoutCustomer.address,
          req.customer.address
        );

      if (!phone) {
        return res.status(400).json({
          ok: false,
          message:
            "Phone number is required.",
        });
      }

      if (!address) {
        return res.status(400).json({
          ok: false,
          message:
            "Delivery address is required.",
        });
      }

      const paymentMethod =
        cleanText(
          body.paymentMethod,
          "COD"
        );

      await client.query(
        "BEGIN"
      );

      const normalizedItems =
        [];

      let total = 0;

      for (
        const rawItem of rawItems
      ) {
        const productId =
          cleanText(
            rawItem.productId ??
              rawItem.id
          );

        const quantity =
          nonNegativeInt(
            rawItem.quantity ??
              rawItem.qty,
            0
          );

        if (
          !productId ||
          quantity <= 0
        ) {
          throw new Error(
            "Invalid cart item."
          );
        }

        const productResult =
          await client.query(
            `
            SELECT *
            FROM products
            WHERE id = $1
            FOR UPDATE
            `,
            [productId]
          );

        if (
          !productResult.rows
            .length
        ) {
          throw new Error(
            "A product in your cart no longer exists."
          );
        }

        const product =
          productResult.rows[0];

        if (
          Number(
            product.stock
          ) < quantity
        ) {
          throw new Error(
            `${product.name} does not have enough stock.`
          );
        }

        const price =
          Number(
            product.price
          );

        const lineTotal =
          price * quantity;

        total += lineTotal;

        normalizedItems.push({
          productId:
            product.id,
          id: product.id,
          name:
            product.name,
          price,
          quantity,
          qty: quantity,
          image:
            product.image ||
            "",
          lineTotal,
        });

        await client.query(
          `
          UPDATE products
          SET
            stock = stock - $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [
            quantity,
            productId,
          ]
        );
      }

      const orderId =
        makeId("SM");

      const customerSnapshot =
        {
          id:
            req.customer.id,
          name,
          email:
            req.customer.email ||
            "",
          provider:
            req.customer.provider ||
            "",
          phone,
          address,
        };

      const result =
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
              $6
            )
          RETURNING *
          `,
          [
            orderId,
            JSON.stringify(
              customerSnapshot
            ),
            JSON.stringify(
              normalizedItems
            ),
            total,
            paymentMethod,
            req.customer.id,
          ]
        );

      await client.query(
        `
        UPDATE customers
        SET
          name = $1,
          phone = $2,
          address = $3,
          updated_at = NOW()
        WHERE id = $4
        `,
        [
          name,
          phone,
          address,
          req.customer.id,
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        orderId,
        order:
          result.rows[0],
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "Create order error:",
        error
      );

      res.status(400).json({
        ok: false,
        message:
          error?.message ||
          "Unable to create order.",
      });
    } finally {
      client.release();
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
            customer_id,
            created_at,
            updated_at
          FROM orders
          WHERE status <> 'Cancelled'
          ORDER BY created_at DESC
        `);

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "Admin orders error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load orders.",
      });
    }
  }
);

/* =========================================================
   ADMIN CHANGE ORDER STATUS
========================================================= */

app.put(
  "/api/admin/orders/:id/status",
  adminAuth,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const id =
        cleanText(
          req.params.id
        );

      const status =
        cleanText(
          req.body?.status
        );

      if (
        !ORDER_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid order status.",
        });
      }

      await client.query(
        "BEGIN"
      );

      const orderResult =
        await client.query(
          `
          SELECT *
          FROM orders
          WHERE id = $1
          FOR UPDATE
          `,
          [id]
        );

      if (
        !orderResult.rows
          .length
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Order not found.",
        });
      }

      let order =
        orderResult.rows[0];

      if (
        status === "Cancelled" &&
        !order.stock_restored
      ) {
        order =
          await restoreOrderStock(
            client,
            id
          );
      }

      const result =
        await client.query(
          `
          UPDATE orders
          SET
            status = $1,
            updated_at = NOW()
          WHERE id = $2
          RETURNING *
          `,
          [
            status,
            id,
          ]
        );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        order:
          result.rows[0],
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "Admin order status error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "Unable to update order.",
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
  requireCustomer,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const id =
        cleanText(
          req.params.id
        );

      await client.query(
        "BEGIN"
      );

      const orderResult =
        await client.query(
          `
          SELECT *
          FROM orders
          WHERE id = $1
            AND customer_id = $2
          FOR UPDATE
          `,
          [
            id,
            req.customer.id,
          ]
        );

      if (
        !orderResult.rows
          .length
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Order not found.",
        });
      }

      let order =
        orderResult.rows[0];

      if (
        order.status ===
        "Cancelled"
      ) {
        await client.query(
          "COMMIT"
        );

        return res.json({
          ok: true,
          order,
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
          ok: false,
          message:
            "Delivered orders cannot be cancelled.",
        });
      }

      if (
        !order.stock_restored
      ) {
        order =
          await restoreOrderStock(
            client,
            id
          );
      }

      const result =
        await client.query(
          `
          UPDATE orders
          SET
            status = 'Cancelled',
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
          [id]
        );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        order:
          result.rows[0],
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
        ok: false,
        message:
          error?.message ||
          "Unable to cancel order.",
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   ADMIN PAYMENT STATUS
========================================================= */

app.put(
  "/api/admin/orders/:id/payment-status",
  adminAuth,
  async (req, res) => {
    try {
      const id =
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
          ok: false,
          message:
            "Invalid payment status.",
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
          RETURNING *
          `,
          [
            paymentStatus,
            id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Order not found.",
        });
      }

      res.json({
        ok: true,
        order:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "Payment status error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "Unable to update payment status.",
      });
    }
  }
);

/* =========================================================
   CUSTOMER ORDER TRACKING
   OWN ORDERS ONLY
========================================================= */

app.get(
  "/api/orders/:id",
  requireCustomer,
  async (req, res) => {
    try {
      const id =
        cleanText(
          req.params.id
        );

      const result =
        await pool.query(
          `
          SELECT *
          FROM orders
          WHERE id = $1
            AND customer_id = $2
          LIMIT 1
          `,
          [
            id,
            req.customer.id,
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Order not found.",
        });
      }

      res.json({
        ok: true,
        order:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "Order tracking error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load order.",
      });
    }
  }
);

/* =========================================================
   PAYMENT PLACEHOLDER
========================================================= */

app.post(
  "/api/payment/create",
  requireCustomer,
  async (req, res) => {
    return res.status(501).json({
      ok: false,
      message:
        "Online payment gateway is not connected yet. Use Cash on Delivery for now.",
    });
  }
);

/* =========================================================
   ADMIN SETTINGS
========================================================= */

app.get(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT data
          FROM store_settings
          WHERE id = 1
          LIMIT 1
        `);

      res.json({
        ok: true,
        settings:
          result.rows[0]?.data ||
          defaultSettings,
      });
    } catch (error) {
      console.error(
        "Admin settings GET error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to load settings.",
      });
    }
  }
);

app.put(
  "/api/admin/settings",
  adminAuth,
  async (req, res) => {
    try {
      const currentResult =
        await pool.query(`
          SELECT data
          FROM store_settings
          WHERE id = 1
          LIMIT 1
        `);

      const current =
        currentResult.rows[0]?.data ||
        defaultSettings;

      const body =
        req.body || {};

      const settings = {
        ...current,

        shopName:
          cleanText(
            body.shopName,
            current.shopName
          ),

        tagline:
          cleanText(
            body.tagline,
            current.tagline
          ),

        phone1:
          cleanText(
            body.phone1,
            current.phone1
          ),

        phone2:
          cleanText(
            body.phone2,
            current.phone2
          ),

        facebook:
          cleanText(
            body.facebook,
            current.facebook
          ),

        currency:
          cleanText(
            body.currency,
            current.currency ||
              "৳"
          ),
      };

      const result =
        await pool.query(
          `
          UPDATE store_settings
          SET
            data = $1::jsonb,
            updated_at = NOW()
          WHERE id = 1
          RETURNING data
          `,
          [
            JSON.stringify(
              settings
            ),
          ]
        );

      res.json({
        ok: true,
        settings:
          result.rows[0].data,
      });
    } catch (error) {
      console.error(
        "Admin settings PUT error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to save settings.",
      });
    }
  }
);

/* =========================================================
   CLEAN OLD SESSIONS PERIODICALLY
========================================================= */

setInterval(
  async () => {
    try {
      await pool.query(`
        DELETE FROM customer_sessions
        WHERE expires_at < NOW()
      `);

      await pool.query(`
        DELETE FROM oauth_states
        WHERE expires_at < NOW()
      `);
    } catch (error) {
      console.error(
        "Session cleanup error:",
        error
      );
    }
  },
  60 * 60 * 1000
);

/* =========================================================
   STATIC FILES
========================================================= */

if (
  fs.existsSync(
    PUBLIC_DIR
  )
) {
  app.use(
    express.static(
      PUBLIC_DIR,
      {
        index: "index.html",
      }
    )
  );
}

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
      fs.existsSync(
        adminFile
      )
    ) {
      return res.sendFile(
        adminFile
      );
    }

    res.status(404).send(
      "Admin page not found."
    );
  }
);

app.get(
  "/admin.html",
  (req, res) => {
    const adminFile =
      path.join(
        PUBLIC_DIR,
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
      "Admin page not found."
    );
  }
);

/* =========================================================
   WEBSITE FALLBACK
   FIXED FOR NEW EXPRESS VERSION
========================================================= */

app.use(
  (req, res, next) => {
    if (
      req.path.startsWith(
        "/api/"
      ) ||
      req.path.startsWith(
        "/auth/"
      )
    ) {
      return next();
    }

    const indexFile =
      path.join(
        PUBLIC_DIR,
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

    res.status(404).send(
      "SM Online Shop website not found."
    );
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      message: "Not found.",
    });
  }
);

/* =========================================================
   ERROR HANDLER
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
      ok: false,
      message:
        error?.message ||
        "Internal server error.",
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
      () => {
        console.log(
          `SM Online Shop running on port ${PORT}`
        );

        console.log(
          `Admin: /admin.html`
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

async function shutdown(
  signal
) {
  console.log(
    `${signal} received. Shutting down...`
  );

  try {
    await pool.end();
  } catch (error) {
    console.error(
      "Database shutdown error:",
      error
    );
  }

  process.exit(0);
}

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

startServer();
