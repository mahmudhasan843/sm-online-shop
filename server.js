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
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value).trim();
}

function positiveNumber(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n) && n >= 0
    ? n
    : fallback;
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
    if (typeof value === "object") {
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

    if (index === -1) {
      return;
    }

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
    await client.query(
      "BEGIN"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    /* ---------------------------------------------------------
       STORE SETTINGS MIGRATION

       This fixes old databases where store_settings
       does not contain the "data" column.
    --------------------------------------------------------- */

    await client.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS data JSONB
      DEFAULT '{}'::jsonb
    `);

    const storeSettingColumns =
      await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'store_settings'
      `);

    const storeColumnNames =
      new Set(
        storeSettingColumns.rows.map(
          (row) => row.column_name
        )
      );

    if (
      storeColumnNames.has("shop_name") &&
      storeColumnNames.has("tagline") &&
      storeColumnNames.has("phone1") &&
      storeColumnNames.has("phone2") &&
      storeColumnNames.has("facebook") &&
      storeColumnNames.has("currency")
    ) {
      await client.query(`
        UPDATE store_settings
        SET data = jsonb_build_object(
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
        )
        WHERE id = 1
          AND (
            data IS NULL
            OR data = '{}'::jsonb
          )
      `);
    }

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

    /* =========================================================
       REPAIR OLD TABLES
    ========================================================= */

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
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_id TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS stock_restored
      BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS category
      TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS description
      TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS price
      NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS old_price
      NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount
      NUMERIC(12,2) NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock
      INTEGER NOT NULL DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS image
      TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS gallery
      JSONB DEFAULT '[]'::jsonb
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS created_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS updated_at
      TIMESTAMPTZ DEFAULT NOW()
    `);

    await client.query(`
      UPDATE customers
      SET
        email =
          COALESCE(email, ''),

        provider =
          COALESCE(provider, ''),

        provider_id =
          COALESCE(provider_id, ''),

        avatar_url =
          COALESCE(avatar_url, ''),

        phone =
          COALESCE(phone, ''),

        address =
          COALESCE(address, ''),

        name =
          COALESCE(name, '')
    `);

    await client.query(`
      UPDATE products
      SET
        category =
          COALESCE(category, ''),

        description =
          COALESCE(description, ''),

        image =
          COALESCE(image, ''),

        gallery =
          COALESCE(
            gallery,
            '[]'::jsonb
          ),

        price =
          COALESCE(price, 0),

        old_price =
          COALESCE(old_price, 0),

        discount =
          COALESCE(discount, 0),

        stock =
          COALESCE(stock, 0)
    `);

    await client.query(`
      UPDATE orders
      SET
        stock_restored =
          COALESCE(
            stock_restored,
            FALSE
          )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      orders_customer_id_idx
      ON orders(customer_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
      customers_email_lower_idx
      ON customers(LOWER(email))
      WHERE email IS NOT NULL
        AND email <> ''
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      customers_provider_providerid_idx
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
          (
            id,
            data
          )
        VALUES
          (
            1,
            $1::jsonb
          )
        `,
        [
          JSON.stringify(
            defaultSettings
          ),
        ]
      );
    }

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

          response_type:
            "code",

          scope:
            "openid email profile",

          state,

          access_type:
            "online",

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
            method:
              "POST",

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

                code:
                  String(code),

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
            provider:
              "google",

            providerId:
              String(userInfo.sub),

            name:
              cleanText(
                userInfo.name,
                "Google Customer"
              ),

            email:
              cleanText(
                userInfo.email
              ),

            avatarUrl:
              cleanText(
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

          code:
            String(code),
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
            provider:
              "facebook",

            providerId:
              String(profile.id),

            name:
              cleanText(
                profile.name,
                "Facebook Customer"
              ),

            email:
              cleanText(
                profile.email
              ),

            avatarUrl:
              cleanText(
                avatar
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

      res.json({
        ok: true,
        products:
          result.rows,
      });
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
        cleanText(
          body.name
        );

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
          .map(
            (item) =>
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
        cleanText(
          body.name
        );

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
          .map(
            (item) =>
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
        stock =
          stock + $1,
        updated_at =
          NOW()
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
   NO LOGIN REQUIRED
========================================================= */

app.post(
  "/api/orders",
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

      /*
        Customer information now comes
        directly from checkout form.
        No customer login is required.
      */

      const checkoutCustomer =
        body.customer || {};

      const name =
        cleanText(
          checkoutCustomer.name,
          "Customer"
        ) || "Customer";

      const phone =
        cleanText(
          checkoutCustomer.phone
        );

      const address =
        cleanText(
          checkoutCustomer.address
        );

      const email =
        cleanText(
          checkoutCustomer.email
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

        total +=
          lineTotal;

        normalizedItems.push({
          productId:
            product.id,

          id:
            product.id,

          name:
            product.name,

          price,

          quantity,

          qty:
            quantity,

          image:
            product.image ||
            "",

          gallery:
            Array.isArray(
              product.gallery
            )
              ? product.gallery
              : safeJsonParse(
                  product.gallery,
                  []
                ),

          lineTotal,
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
            quantity,
            productId,
          ]
        );
      }

      const orderId =
        makeId("SM");

      /*
        Customer snapshot is stored
        inside the order itself.

        customer_id is NULL because
        customer login is not required.
      */

      const customerSnapshot = {
        id: null,

        name,

        email,

        provider: "",

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
              NULL
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
        .query(
          "ROLLBACK"
        )
        .catch(
          () => {}
        );

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
   CANCELLED ORDERS ARE HIDDEN
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

      res.json({
        ok: true,
        orders:
          result.rows,
      });
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
        !orderResult.rows.length
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
        .query(
          "ROLLBACK"
        )
        .catch(
          () => {}
        );

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
   CUSTOMER ORDER CANCEL
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
            "Order ID is required.",
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
          [orderId]
        );

      if (
        !orderResult.rows.length
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
          message:
            "Order is already cancelled.",
          order,
        });
      }

      if (
        order.status ===
          "Shipped" ||
        order.status ===
          "Delivered"
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "This order can no longer be cancelled.",
        });
      }

      if (
        !order.stock_restored
      ) {
        order =
          await restoreOrderStock(
            client,
            orderId
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
          [orderId]
        );

      await client.query(
        "COMMIT"
      );

      res.json({
        ok: true,
        message:
          "Order cancelled successfully.",
        order:
          result.rows[0],
      });
    } catch (error) {
      await client
        .query(
          "ROLLBACK"
        )
        .catch(
          () => {}
        );

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
   PUBLIC ORDER TRACKING
   NO CUSTOMER LOGIN REQUIRED
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
            "Order ID is required.",
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
            stock_restored,
            created_at,
            updated_at
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
          ok: false,
          message:
            "Order not found.",
        });
      }

      res.set(
        "Cache-Control",
        "no-store"
      );

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
          "Unable to track order.",
      });
    }
  }
);


/* =========================================================
   PAYMENT PLACEHOLDER
   NO CUSTOMER LOGIN REQUIRED
========================================================= */

app.post(
  "/api/payment/create",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const orderId =
        cleanText(
          body.orderId
        );

      if (!orderId) {
        return res.status(400).json({
          ok: false,
          message:
            "Order ID is required.",
        });
      }

      const result =
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
          [orderId]
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

      const order =
        result.rows[0];

      if (
        order.status ===
        "Cancelled"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Cancelled orders cannot be paid.",
        });
      }

      /*
        This endpoint is intentionally
        a placeholder.

        Real payment gateway can be
        connected later.
      */

      res.json({
        ok: true,
        message:
          "Payment service is ready for gateway integration.",
        orderId:
          order.id,
        amount:
          Number(order.total),
        paymentMethod:
          order.payment_method,
        paymentStatus:
          order.payment_status,
      });
    } catch (error) {
      console.error(
        "Payment create error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to create payment.",
      });
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
            orderId,
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
        "Payment status update error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Unable to update payment status.",
      });
    }
  }
);


/* =========================================================
   PUBLIC STORE SETTINGS
========================================================= */

async function getSettings() {
  try {
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
          updated_at
        FROM store_settings
        ORDER BY id
        LIMIT 1
      `);

    if (
      !result.rows.length
    ) {
      return {
        ...defaultSettings,
      };
    }

    const row =
      result.rows[0];

    return {
      shopName:
        row.shop_name ||
        defaultSettings.shopName,

      tagline:
        row.tagline ||
        defaultSettings.tagline,

      phone1:
        row.phone1 ||
        defaultSettings.phone1,

      phone2:
        row.phone2 ||
        defaultSettings.phone2,

      facebook:
        row.facebook ||
        defaultSettings.facebook,

      currency:
        row.currency ||
        defaultSettings.currency,
    };
  } catch (error) {
    console.error(
      "Get settings error:",
      error
    );

    return {
      ...defaultSettings,
    };
  }
}


/* =========================================================
   PUBLIC STORE API
   CUSTOMER LOGIN NOT REQUIRED
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
                product.oldPrice ||
                  0
              ),

            discount:
              Number(
                product.discount ||
                  0
              ),

            stock:
              Number(
                product.stock ||
                  0
              ),

            gallery:
              Array.isArray(
                product.gallery
              )
                ? product.gallery
                : safeJsonParse(
                    product.gallery,
                    []
                  ),
          })
        );

      res.set(
        "Cache-Control",
        "no-store"
      );

      res.json({
        ok: true,
        settings,
        products,
      });
    } catch (error) {
      console.error(
        "Public store API error:",
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


/* =========================================================
   PUBLIC PRODUCTS API
   CUSTOMER LOGIN NOT REQUIRED
========================================================= */

app.get(
  "/api/products",
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
                product.oldPrice ||
                  0
              ),

            discount:
              Number(
                product.discount ||
                  0
              ),

            stock:
              Number(
                product.stock ||
                  0
              ),

            gallery:
              Array.isArray(
                product.gallery
              )
                ? product.gallery
                : safeJsonParse(
                    product.gallery,
                    []
                  ),
          })
        );

      res.json({
        ok: true,
        products,
      });
    } catch (error) {
      console.error(
        "Public products API error:",
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
   ADMIN SETTINGS - GET
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
            shop_name,
            tagline,
            phone1,
            phone2,
            facebook,
            currency,
            updated_at
          FROM store_settings
          ORDER BY id
          LIMIT 1
        `);

      if (
        !result.rows.length
      ) {
        return res.json({
          ok: true,
          settings:
            defaultSettings,
        });
      }

      const row =
        result.rows[0];

      res.json({
        ok: true,
        settings: {
          shopName:
            row.shop_name ||
            defaultSettings.shopName,

          tagline:
            row.tagline ||
            defaultSettings.tagline,

          phone1:
            row.phone1 ||
            defaultSettings.phone1,

          phone2:
            row.phone2 ||
            defaultSettings.phone2,

          facebook:
            row.facebook ||
            defaultSettings.facebook,

          currency:
            row.currency ||
            defaultSettings.currency,
        },
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


/* =========================================================
   ADMIN SETTINGS - UPDATE
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
          defaultSettings.facebook
        );

      const currency =
        cleanText(
          body.currency,
          defaultSettings.currency
        );

      const result =
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
            data = $7::jsonb,
            updated_at = NOW()
          WHERE id = 1
          RETURNING *
          `,
          [
            shopName,
            tagline,
            phone1,
            phone2,
            facebook,
            currency,

            JSON.stringify({
              shopName,
              tagline,
              phone1,
              phone2,
              facebook,
              currency,
            }),
          ]
        );

      if (
        !result.rows.length
      ) {
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
            shopName,
            tagline,
            phone1,
            phone2,
            facebook,
            currency,

            JSON.stringify({
              shopName,
              tagline,
              phone1,
              phone2,
              facebook,
              currency,
            }),
          ]
        );
      }

      res.json({
        ok: true,
        settings: {
          shopName,
          tagline,
          phone1,
          phone2,
          facebook,
          currency,
        },
      });
    } catch (error) {
      console.error(
        "Admin settings PUT error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "Unable to save settings.",
      });
    }
  }
);


/* =========================================================
   CLEANUP OLD SESSIONS / OAUTH STATES
========================================================= */

async function cleanupExpiredData() {
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
      "Cleanup error:",
      error
    );
  }
}

const cleanupInterval =
  setInterval(
    cleanupExpiredData,
    60 * 60 * 1000
  );


/* =========================================================
   PUBLIC STATIC FILES
========================================================= */

app.use(
  express.static(
    PUBLIC_DIR,
    {
      index:
        "index.html",
      extensions:
        ["html"],
      maxAge:
        isProduction()
          ? "1h"
          : 0,
    }
  )
);


/* =========================================================
   ADMIN HTML
========================================================= */

app.get(
  "/admin",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "admin.html"
      )
    );
  }
);

app.get(
  "/admin.html",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "admin.html"
      )
    );
  }
);
// ============================================================
// PART 4 — STATIC FILES, ADMIN PAGE, ERROR HANDLER & START
// ============================================================

// ------------------------------------------------------------
// Static frontend files
// ------------------------------------------------------------

app.use(express.static(PUBLIC_DIR));


// ------------------------------------------------------------
// Admin page
// ------------------------------------------------------------

app.get("/admin", (req, res) => {
  const adminFile = path.join(PUBLIC_DIR, "admin.html");

  if (!fs.existsSync(adminFile)) {
    return res.status(404).send("admin.html not found.");
  }

  res.sendFile(adminFile);
});


app.get("/admin.html", (req, res) => {
  const adminFile = path.join(PUBLIC_DIR, "admin.html");

  if (!fs.existsSync(adminFile)) {
    return res.status(404).send("admin.html not found.");
  }

  res.sendFile(adminFile);
});


// ------------------------------------------------------------
// Express 5 safe frontend fallback
// IMPORTANT:
// Do NOT use app.get("*", ...)
// ------------------------------------------------------------

app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/") ||
    req.path.startsWith("/auth/")
  ) {
    return next();
  }

  // Only return index.html for normal browser routes.
  // Do not interfere with files such as CSS, JS, images, etc.
  const accept = req.headers.accept || "";

  if (
    accept.includes("text/html") &&
    !req.path.includes(".")
  ) {
    const indexFile = path.join(PUBLIC_DIR, "index.html");

    if (fs.existsSync(indexFile)) {
      return res.sendFile(indexFile);
    }
  }

  return next();
});


// ------------------------------------------------------------
// 404 handler
// ------------------------------------------------------------

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      ok: false,
      message: "API endpoint not found."
    });
  }

  res.status(404).send("Page not found.");
});


// ------------------------------------------------------------
// Global error handler
// ------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);

  if (res.headersSent) {
    return next(err);
  }

  const status =
    Number.isInteger(err.status) ? err.status : 500;

  if (req.path.startsWith("/api/")) {
    return res.status(status).json({
      ok: false,
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error."
          : (err.message || "Internal server error.")
    });
  }

  res.status(status).send(
    process.env.NODE_ENV === "production"
      ? "Internal server error."
      : (err.message || "Internal server error.")
  );
});


// ============================================================
// START SERVER
// ============================================================

let server = null;

async function startServer() {
  try {
    console.log("Starting SM Online Shop server...");

    await initDatabase();

    console.log("Database initialization completed.");

    server = app.listen(PORT, () => {
      console.log(
        `SM Online Shop running on port ${PORT}`
      );

      console.log(
        `Environment: ${process.env.NODE_ENV || "development"}`
      );

      console.log(
        `Public directory: ${PUBLIC_DIR}`
      );
    });

    server.on("error", (err) => {
      console.error("SERVER ERROR:", err);

      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use.`
        );
      }
    });

  } catch (error) {
    console.error(
      "FAILED TO START SERVER:"
    );

    console.error(error);

    process.exit(1);
  }
}


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down...`
  );

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log("HTTP server closed.");
          resolve();
        });
      });
    }

    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }

    await pool.end();

    console.log(
      "Database pool closed."
    );

    process.exit(0);

  } catch (error) {
    console.error(
      "Shutdown error:",
      error
    );

    process.exit(1);
  }
}


// ------------------------------------------------------------
// Process signals
// ------------------------------------------------------------

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);


// ------------------------------------------------------------
// Unhandled errors
// ------------------------------------------------------------

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "UNHANDLED REJECTION:",
      reason
    );
  }
);


process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);


// ============================================================
// RUN
// ============================================================

startServer();
