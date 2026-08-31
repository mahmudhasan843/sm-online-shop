const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT = Number(process.env.PORT || 10000);

/* =====================================================
   DATABASE
===================================================== */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  },

  max: 10,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});


/* =====================================================
   CLOUDINARY
===================================================== */

const cloudinaryConfigured =
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

if (cloudinaryConfigured) {

  cloudinary.config({
    cloud_name:
      process.env.CLOUDINARY_CLOUD_NAME,

    api_key:
      process.env.CLOUDINARY_API_KEY,

    api_secret:
      process.env.CLOUDINARY_API_SECRET
  });

} else {

  console.warn(
    "Cloudinary environment variables are missing."
  );

}


/* =====================================================
   EXPRESS
===================================================== */

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "15mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "15mb"
  })
);


/* =====================================================
   STATIC FILES
===================================================== */

const publicPath =
  path.join(
    __dirname,
    "public"
  );

app.use(
  express.static(publicPath)
);


/* =====================================================
   ADMIN SESSION
===================================================== */

const adminSessions =
  new Map();


/* =====================================================
   ADMIN LOGIN
===================================================== */

/*
   Render Environment Variables থাকলে সেগুলো ব্যবহার করবে।
   না থাকলে আগের credentials ব্যবহার করবে।

   Username:
   SMADMIN

   Password:
   SM2728
*/

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME ||
  "SMADMIN";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  "SM2728";


/* =====================================================
   HELPERS
===================================================== */

function createToken() {

  return crypto
    .randomBytes(32)
    .toString("hex");

}


function getAdminToken(req) {

  const header =
    String(
      req.headers.authorization || ""
    );

  if (
    !header.startsWith("Bearer ")
  ) {
    return "";
  }

  return header
    .substring(7)
    .trim();

}


function requireAdmin(
  req,
  res,
  next
) {

  const token =
    getAdminToken(req);

  if (
    !token ||
    !adminSessions.has(token)
  ) {

    return res
      .status(401)
      .json({
        error:
          "Unauthorized. Please login again."
      });

  }

  next();

}


function safeNumber(
  value,
  fallback = 0
) {

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;

}


function safeInteger(
  value,
  fallback = 0
) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }

  return Math.floor(number);

}


function cleanText(
  value,
  fallback = ""
) {

  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value).trim();

}


/* =====================================================
   DATABASE SEQUENCE REPAIR
===================================================== */

/*
   IMPORTANT:

   Previous database versions may have corrupted
   PostgreSQL SERIAL sequences.

   Example:

   products_id_seq
   orders_id_seq

   This function repairs them from the actual MAX(id).

   It DOES NOT use user/customer/product text as
   a sequence value.
*/

async function repairSequence(
  client,
  tableName,
  columnName
) {

  try {

    const sequenceResult =
      await client.query(
        `
          SELECT pg_get_serial_sequence(
            $1,
            $2
          ) AS sequence_name
        `,
        [
          tableName,
          columnName
        ]
      );

    const sequenceName =
      sequenceResult.rows[0]
        ?.sequence_name;

    if (!sequenceName) {

      console.log(
        `No sequence found for ${tableName}.${columnName}`
      );

      return;

    }


    /*
       PostgreSQL identifiers cannot safely be
       passed as normal $1 parameters.

       sequenceName comes directly from PostgreSQL,
       not from user input.
    */

    const maxResult =
      await client.query(
        `
          SELECT COALESCE(
            MAX(id),
            0
          )::bigint AS max_id
          FROM ${tableName}
        `
      );

    const maxId =
      maxResult.rows[0]?.max_id || "0";

    const numericMax =
      Number(maxId);


    if (
      !Number.isSafeInteger(
        numericMax
      ) ||
      numericMax < 0
    ) {

      throw new Error(
        `Invalid MAX(id) for ${tableName}: ${maxId}`
      );

    }


    /*
       If there are no rows:

       set sequence to 1 and mark it as not called.

       Next INSERT will receive 1.
    */

    if (
      numericMax === 0
    ) {

      await client.query(
        `
          SELECT setval(
            $1::regclass,
            1,
            false
          )
        `,
        [
          sequenceName
        ]
      );

      console.log(
        `Sequence repaired: ${sequenceName} -> 1`
      );

      return;

    }


    /*
       Existing rows:
       next generated ID should be MAX(id) + 1.
    */

    await client.query(
      `
        SELECT setval(
          $1::regclass,
          $2::bigint,
          true
        )
      `,
      [
        sequenceName,
        String(numericMax)
      ]
    );


    console.log(
      `Sequence repaired: ${sequenceName} -> ${numericMax}`
    );

  } catch (error) {

    console.error(
      `Sequence repair failed for ${tableName}.${columnName}:`,
      error
    );

    throw error;

  }

}


/* =====================================================
   DATABASE INITIALIZATION
===================================================== */

async function initDatabase() {

  const client =
    await pool.connect();

  try {

    console.log(
      "Starting database initialization..."
    );

    await client.query(
      "BEGIN"
    );


    /* =================================================
       STORE SETTINGS
    ================================================= */

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_settings (

        id SERIAL PRIMARY KEY,

        shop_name TEXT DEFAULT 'SM Online Shop',

        tagline TEXT DEFAULT '',

        phone1 TEXT DEFAULT '',

        phone2 TEXT DEFAULT '',

        facebook TEXT DEFAULT '',

        currency TEXT DEFAULT 'BDT',

        updated_at TIMESTAMPTZ DEFAULT NOW()

      )
    `);


    /*
       Safe migrations.

       No COALESCE between different data types.
    */

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


    /*
       Fill NULL values separately.

       This avoids PostgreSQL COALESCE type errors.
    */

    await client.query(`
      UPDATE store_settings
      SET shop_name = 'SM Online Shop'
      WHERE shop_name IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET tagline = ''
      WHERE tagline IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET phone1 = ''
      WHERE phone1 IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET phone2 = ''
      WHERE phone2 IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET facebook = ''
      WHERE facebook IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET currency = 'BDT'
      WHERE currency IS NULL
    `);

    await client.query(`
      UPDATE store_settings
      SET updated_at = NOW()
      WHERE updated_at IS NULL
    `);


    /* =================================================
       PRODUCTS
    ================================================= */

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (

        id SERIAL PRIMARY KEY,

        name TEXT NOT NULL,

        category TEXT DEFAULT 'General',

        description TEXT DEFAULT '',

        price NUMERIC(12,2) NOT NULL DEFAULT 0,

        old_price NUMERIC(12,2) DEFAULT 0,

        discount NUMERIC(6,2) DEFAULT 0,

        stock INTEGER DEFAULT 0,

        image TEXT DEFAULT '',

        created_at TIMESTAMPTZ DEFAULT NOW(),

        updated_at TIMESTAMPTZ DEFAULT NOW()

      )
    `);


    /* =================================================
       PRODUCTS MIGRATION
    ================================================= */

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS category TEXT
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS description TEXT
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS old_price NUMERIC(12,2)
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS discount NUMERIC(6,2)
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock INTEGER
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS image TEXT
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    `);


    /* =================================================
       PRODUCTS NULL REPAIR
    ================================================= */

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
      SET created_at = NOW()
      WHERE created_at IS NULL
    `);

    await client.query(`
      UPDATE products
      SET updated_at = NOW()
      WHERE updated_at IS NULL
    `);


    /* =================================================
       ORDERS
    ================================================= */

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (

        id BIGSERIAL PRIMARY KEY,

        customer JSONB DEFAULT '{}'::jsonb,

        items JSONB DEFAULT '[]'::jsonb,

        total NUMERIC(12,2) DEFAULT 0,

        status TEXT DEFAULT 'Pending',

        payment_status TEXT DEFAULT 'Pending',

        payment_method TEXT DEFAULT 'cod',

        created_at TIMESTAMPTZ DEFAULT NOW(),

        updated_at TIMESTAMPTZ DEFAULT NOW()

      )
    `);


    /* =================================================
       ORDERS MIGRATION
    ================================================= */

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer JSONB
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS items JSONB
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS total NUMERIC(12,2)
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS status TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_status TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_method TEXT
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    `);


    /* =================================================
       ORDERS NULL REPAIR
    ================================================= */

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
      SET payment_method = 'cod'
      WHERE payment_method IS NULL
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


    /* =================================================
       DEFAULT STORE SETTINGS
    ================================================= */

    const settingsResult =
      await client.query(`
        SELECT id
        FROM store_settings
        ORDER BY id ASC
        LIMIT 1
      `);


    if (
      settingsResult.rows.length === 0
    ) {

      await client.query(`
        INSERT INTO store_settings
        (
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
          'SM Online Shop',
          '',
          '',
          '',
          '',
          'BDT',
          NOW()
        )
      `);

    }


    /* =================================================
       REPAIR SERIAL SEQUENCES
    ================================================= */

    console.log(
      "Repairing product ID sequence..."
    );

    await repairSequence(
      client,
      "products",
      "id"
    );


    console.log(
      "Repairing order ID sequence..."
    );

    await repairSequence(
      client,
      "orders",
      "id"
    );


    await client.query(
      "COMMIT"
    );


    console.log(
      "Database initialized successfully."
    );


  } catch (error) {

    try {

      await client.query(
        "ROLLBACK"
      );

    } catch (rollbackError) {

      console.error(
        "Rollback error:",
        rollbackError
      );

    }


    console.error(
      "Database initialization error:",
      error
    );

    throw error;

  } finally {

    client.release();

  }

}


/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/health",
  async (req, res) => {

    try {

      await pool.query(
        "SELECT 1"
      );

      res.json({

        ok: true,

        status:
          "online"

      });

    } catch (error) {

      console.error(
        "Health check error:",
        error
      );

      res
        .status(500)
        .json({

          ok: false,

          status:
            "database error"

        });

    }

  }
);


/* =====================================================
   STORE API
===================================================== */

app.get(
  "/api/store",
  async (req, res) => {

    try {

      const settingsResult =
        await pool.query(`
          SELECT
            shop_name AS "shopName",
            tagline,
            phone1,
            phone2,
            facebook,
            currency
          FROM store_settings
          ORDER BY id ASC
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
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM products
          ORDER BY id DESC
        `);


      res.json({

        settings:
          settingsResult.rows[0] ||
          {
            shopName:
              "SM Online Shop",

            tagline:
              "",

            phone1:
              "",

            phone2:
              "",

            facebook:
              "",

            currency:
              "BDT"
          },

        products:
          productsResult.rows

      });

    } catch (error) {

      console.error(
        "Store API error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not load store."

        });

    }

  }
);


/* =====================================================
   PUBLIC PRODUCTS
===================================================== */

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
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM products
          WHERE stock > 0
          ORDER BY id DESC
        `);


      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        "Products API error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not load products."

        });

    }

  }
);


/* =====================================================
   ADMIN LOGIN
===================================================== */

app.post(
  "/api/admin/login",
  async (req, res) => {

    try {

      const username =
        cleanText(
          req.body.username
        );

      const password =
        String(
          req.body.password || ""
        );


      console.log(
        "Admin login attempt:",
        username
      );


      if (
        username !== ADMIN_USERNAME ||
        password !== ADMIN_PASSWORD
      ) {

        return res
          .status(401)
          .json({

            error:
              "Invalid username or password."

          });

      }


      const token =
        createToken();


      adminSessions.set(
        token,
        {

          username:
            ADMIN_USERNAME,

          createdAt:
            Date.now()

        }
      );


      console.log(
        "Admin login successful."
      );


      res.json({

        success:
          true,

        token,

        username:
          ADMIN_USERNAME

      });

    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Login failed."

        });

    }

  }
);


/* =====================================================
   ADMIN SESSION CHECK
===================================================== */

app.get(
  "/api/admin/check",
  requireAdmin,
  async (req, res) => {

    const token =
      getAdminToken(req);

    const session =
      adminSessions.get(token);


    res.json({

      success:
        true,

      username:
        session
          ? session.username
          : ADMIN_USERNAME

    });

  }
);


/* =====================================================
   ADMIN LOGOUT
===================================================== */

app.post(
  "/api/admin/logout",
  requireAdmin,
  async (req, res) => {

    const token =
      getAdminToken(req);

    adminSessions.delete(
      token
    );


    res.json({

      success:
        true

    });

  }
);


/* =====================================================
   ADMIN PRODUCTS
===================================================== */

app.get(
  "/api/admin/products",
  requireAdmin,
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
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM products
          ORDER BY id DESC
        `);


      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        "Admin products error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not load products."

        });

    }

  }
);


/* =====================================================
   CREATE PRODUCT
===================================================== */

app.post(
  "/api/admin/products",
  requireAdmin,
  async (req, res) => {

    try {

      const name =
        cleanText(
          req.body.name
        );

      const category =
        cleanText(
          req.body.category,
          "General"
        ) ||
        "General";

      const description =
        cleanText(
          req.body.description
        );

      const price =
        safeNumber(
          req.body.price
        );

      const oldPrice =
        safeNumber(
          req.body.oldPrice,
          price
        );

      const discount =
        Math.max(
          0,
          safeNumber(
            req.body.discount
          )
        );

      const stock =
        Math.max(
          0,
          safeInteger(
            req.body.stock
          )
        );

      const image =
        cleanText(
          req.body.image
        );


      if (!name) {

        return res
          .status(400)
          .json({

            error:
              "Product name is required."

          });

      }


      if (
        price <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valid product price is required."

          });

      }


      if (
        discount > 100
      ) {

        return res
          .status(400)
          .json({

            error:
              "Discount cannot be more than 100%."

          });

      }


      const result =
        await pool.query(
          `
            INSERT INTO products
            (
              name,
              category,
              description,
              price,
              old_price,
              discount,
              stock,
              image,
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
              NOW(),
              NOW()
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
            image
          ]
        );


      res
        .status(201)
        .json(
          result.rows[0]
        );

    } catch (error) {

      console.error(
        "Create product error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not create product."

        });

    }

  }
);


/* =====================================================
   UPDATE PRODUCT
===================================================== */

app.put(
  "/api/admin/products/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid product ID."

          });

      }


      const name =
        cleanText(
          req.body.name
        );

      const category =
        cleanText(
          req.body.category,
          "General"
        ) ||
        "General";

      const description =
        cleanText(
          req.body.description
        );

      const price =
        safeNumber(
          req.body.price
        );

      const oldPrice =
        safeNumber(
          req.body.oldPrice,
          price
        );

      const discount =
        Math.max(
          0,
          safeNumber(
            req.body.discount
          )
        );

      const stock =
        Math.max(
          0,
          safeInteger(
            req.body.stock
          )
        );

      const image =
        cleanText(
          req.body.image
        );


      if (!name) {

        return res
          .status(400)
          .json({

            error:
              "Product name is required."

          });

      }


      if (
        price <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valid product price is required."

          });

      }


      if (
        discount > 100
      ) {

        return res
          .status(400)
          .json({

            error:
              "Discount cannot be more than 100%."

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
              updated_at = NOW()
            WHERE id = $9
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
            id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res
          .status(404)
          .json({

            error:
              "Product not found."

          });

      }


      res.json(
        result.rows[0]
      );

    } catch (error) {

      console.error(
        "Update product error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not update product."

        });

    }

  }
);


/* =====================================================
   DELETE PRODUCT
===================================================== */

app.delete(
  "/api/admin/products/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid product ID."

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
            id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res
          .status(404)
          .json({

            error:
              "Product not found."

          });

      }


      res.json({

        success:
          true

      });

    } catch (error) {

      console.error(
        "Delete product error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not delete product."

        });

    }

  }
);


/* =====================================================
   CLOUDINARY UPLOAD
===================================================== */

app.post(
  "/api/admin/upload",
  requireAdmin,
  async (req, res) => {

    try {

      if (
        !cloudinaryConfigured
      ) {

        return res
          .status(500)
          .json({

            error:
              "Cloudinary is not configured."

          });

      }


      const image =
        cleanText(
          req.body.image
        );


      if (!image) {

        return res
          .status(400)
          .json({

            error:
              "Image is required."

          });

      }


      const result =
        await cloudinary.uploader.upload(
          image,
          {
            folder:
              "sm-online-shop/products"
          }
        );


      res.json({

        success:
          true,

        url:
          result.secure_url

      });

    } catch (error) {

      console.error(
        "Cloudinary upload error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Image upload failed."

        });

    }

  }
);


/* =====================================================
   ADMIN ORDERS
   CANCELLED ORDERS ARE HIDDEN
===================================================== */

app.get(
  "/api/admin/orders",
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await pool.query(`
          SELECT
            id,
            customer,
            items,
            total,
            status,
            payment_status AS "paymentStatus",
            payment_method AS "paymentMethod",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM orders
          WHERE status IS DISTINCT FROM 'Cancelled'
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

      res
        .status(500)
        .json({

          error:
            "Could not load orders."

        });

    }

  }
);


/* =====================================================
   CREATE CUSTOMER ORDER
===================================================== */

app.post(
  "/api/orders",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const customer =
        req.body.customer || {};

      const items =
        req.body.items;

      const paymentMethod =
        cleanText(
          req.body.paymentMethod,
          "cod"
        ) ||
        "cod";


      if (
        !Array.isArray(items) ||
        items.length === 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Order items are required."

          });

      }


      /*
         Limit maximum items to prevent abuse.
      */

      if (
        items.length > 100
      ) {

        return res
          .status(400)
          .json({

            error:
              "Too many items in one order."

          });

      }


      await client.query(
        "BEGIN"
      );


      const finalItems = [];


      for (
        const item of items
      ) {

        const productId =
          Number(
            item.productId ||
            item.id
          );


        const qty =
          Math.max(
            1,
            safeInteger(
              item.qty,
              1
            )
          );


        if (
          !Number.isInteger(
            productId
          ) ||
          productId <= 0
        ) {

          throw new Error(
            "Invalid product ID."
          );

        }


        if (
          qty > 1000
        ) {

          throw new Error(
            "Invalid product quantity."
          );

        }


        /*
           FOR UPDATE prevents two customers from
           buying the same last stock simultaneously.
        */

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
              productId
            ]
          );


        if (
          productResult.rows.length === 0
        ) {

          throw new Error(
            "Product not found."
          );

        }


        const product =
          productResult.rows[0];


        const productStock =
          safeInteger(
            product.stock
          );


        if (
          productStock < qty
        ) {

          throw new Error(
            `Not enough stock for ${product.name}.`
          );

        }


        const productPrice =
          safeNumber(
            product.price
          );


        finalItems.push({

          productId:
            product.id,

          name:
            product.name,

          price:
            productPrice,

          qty:
            qty,

          image:
            product.image ||
            ""

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
            qty,
            productId
          ]
        );

      }


      /* =================================================
         CALCULATE TOTAL ON SERVER
      ================================================= */

      const calculatedTotal =
        finalItems.reduce(
          (
            sum,
            item
          ) => {

            return (
              sum +
              (
                Number(
                  item.price
                ) *
                Number(
                  item.qty
                )
              )
            );

          },
          0
        );


      const roundedTotal =
        Math.round(
          (
            calculatedTotal +
            Number.EPSILON
          ) *
          100
        ) /
        100;


      /* =================================================
         CREATE ORDER

         IMPORTANT:
         ID IS NOT PROVIDED.

         PostgreSQL generates it automatically.
      ================================================= */

      const result =
        await client.query(
          `
            INSERT INTO orders
            (
              customer,
              items,
              total,
              status,
              payment_status,
              payment_method,
              created_at,
              updated_at
            )
            VALUES
            (
              $1::jsonb,
              $2::jsonb,
              $3,
              'Pending',
              'Pending',
              $4,
              NOW(),
              NOW()
            )
            RETURNING
              id,
              customer,
              items,
              total,
              status,
              payment_status AS "paymentStatus",
              payment_method AS "paymentMethod",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
          `,
          [
            JSON.stringify(
              customer
            ),

            JSON.stringify(
              finalItems
            ),

            roundedTotal,

            paymentMethod
          ]
        );


      await client.query(
        "COMMIT"
      );


      console.log(
        `New order created: #${result.rows[0].id}`
      );


      res
        .status(201)
        .json(
          result.rows[0]
        );

    } catch (error) {

      try {

        await client.query(
          "ROLLBACK"
        );

      } catch (rollbackError) {

        console.error(
          "Order rollback error:",
          rollbackError
        );

      }


      console.error(
        "Create order error:",
        error
      );


      res
        .status(400)
        .json({

          error:
            error.message ||
            "Could not create order."

        });

    } finally {

      client.release();

    }

  }
);


/* =====================================================
   UPDATE ORDER STATUS
===================================================== */

app.put(
  "/api/admin/orders/:id/status",
  requireAdmin,
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      const status =
        cleanText(
          req.body.status
        );


      const allowedStatuses = [

        "Pending",

        "Confirmed",

        "Processing",

        "Shipped",

        "Delivered",

        "Cancelled"

      ];


      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid order ID."

          });

      }


      if (
        !allowedStatuses.includes(
          status
        )
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid order status."

          });

      }


      const result =
        await pool.query(
          `
            UPDATE orders
            SET
              status = $1,
              updated_at = NOW()
            WHERE id = $2
            RETURNING
              id,
              customer,
              items,
              total,
              status,
              payment_status AS "paymentStatus",
              payment_method AS "paymentMethod",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
          `,
          [
            status,
            id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res
          .status(404)
          .json({

            error:
              "Order not found."

          });

      }


      console.log(
        `Order #${id} status changed to ${status}`
      );


      res.json({

        success:
          true,

        order:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Update order status error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not update order status."

        });

    }

  }
);


/* =====================================================
   UPDATE PAYMENT STATUS
===================================================== */

app.put(
  "/api/admin/orders/:id/payment-status",
  requireAdmin,
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      const paymentStatus =
        cleanText(
          req.body.paymentStatus
        );


      const allowedStatuses = [

        "Pending",

        "Paid",

        "Failed",

        "Refunded"

      ];


      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid order ID."

          });

      }


      if (
        !allowedStatuses.includes(
          paymentStatus
        )
      ) {

        return res
          .status(400)
          .json({

            error:
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
              customer,
              items,
              total,
              status,
              payment_status AS "paymentStatus",
              payment_method AS "paymentMethod",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
          `,
          [
            paymentStatus,
            id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res
          .status(404)
          .json({

            error:
              "Order not found."

          });

      }


      res.json({

        success:
          true,

        order:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Update payment status error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not update payment status."

        });

    }

  }
);


/* =====================================================
   ADMIN SETTINGS
===================================================== */

app.put(
  "/api/admin/settings",
  requireAdmin,
  async (req, res) => {

    try {

      const shopName =
        cleanText(
          req.body.shopName,
          "SM Online Shop"
        ) ||
        "SM Online Shop";

      const tagline =
        cleanText(
          req.body.tagline
        );

      const phone1 =
        cleanText(
          req.body.phone1
        );

      const phone2 =
        cleanText(
          req.body.phone2
        );

      const facebook =
        cleanText(
          req.body.facebook
        );

      const currency =
        cleanText(
          req.body.currency,
          "BDT"
        ) ||
        "BDT";


      const existing =
        await pool.query(`
          SELECT id
          FROM store_settings
          ORDER BY id ASC
          LIMIT 1
        `);


      let result;


      if (
        existing.rows.length === 0
      ) {

        result =
          await pool.query(
            `
              INSERT INTO store_settings
              (
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
                currency
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
              WHERE id = $7
              RETURNING
                id,
                shop_name AS "shopName",
                tagline,
                phone1,
                phone2,
                facebook,
                currency
            `,
            [
              shopName,
              tagline,
              phone1,
              phone2,
              facebook,
              currency,
              existing.rows[0].id
            ]
          );

      }


      res.json({

        success:
          true,

        settings:
          result.rows[0]

      });

    } catch (error) {

      console.error(
        "Settings update error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            "Could not save settings."

        });

    }

  }
);


/* =====================================================
   ADMIN PAGE
===================================================== */

app.get(
  "/admin",
  (req, res) => {

    res.sendFile(
      path.join(
        publicPath,
        "admin.html"
      )
    );

  }
);


/* =====================================================
   ROOT
===================================================== */

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        publicPath,
        "index.html"
      )
    );

  }
);


/* =====================================================
   API 404
===================================================== */

app.use(
  "/api",
  (req, res) => {

    res
      .status(404)
      .json({

        error:
          "API endpoint not found."

      });

  }
);


/* =====================================================
   GENERAL ERROR HANDLER
===================================================== */

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

      return next(
        error
      );

    }


    res
      .status(500)
      .json({

        error:
          "Internal server error."

      });

  }
);


/* =====================================================
   START SERVER
===================================================== */

async function startServer() {

  try {

    await initDatabase();


    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `SM Online Shop server running on port ${PORT}`
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


/* =====================================================
   GRACEFUL SHUTDOWN
===================================================== */

async function shutdown(
  signal
) {

  console.log(
    `${signal} received. Shutting down...`
  );


  try {

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


process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
