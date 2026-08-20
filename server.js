```javascript
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT =
  process.env.PORT || 3000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   ENVIRONMENT
========================================================= */

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "CHANGE_THIS_SESSION_SECRET";

const ADMIN_USER =
  process.env.ADMIN_USER ||
  "SMADMIN";

const ADMIN_PASS =
  process.env.ADMIN_PASS ||
  "SM2728";

/* =========================================================
   POSTGRESQL
========================================================= */

if (!process.env.DATABASE_URL) {

  console.error(
    "ERROR: DATABASE_URL is missing."
  );

  process.exit(1);
}

const pool =
  new Pool({

    connectionString:
      process.env.DATABASE_URL,

    ssl: {
      rejectUnauthorized: false
    },

    max: 5

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
   DEFAULT SETTINGS
========================================================= */

const defaultSettings = {

  shopName:
    "SM Online Shop",

  tagline:
    "Style • Comfort • Confidence ♥",

  phone1:
    "01827872334",

  phone2:
    "01886995687",

  facebook:
    "",

  currency:
    "BDT"

};

/* =========================================================
   ORDER STATUS
========================================================= */

const ORDER_STATUSES = [

  "Pending",

  "Confirmed",

  "Processing",

  "Shipped",

  "Delivered",

  "Cancelled"

];

/* =========================================================
   PAYMENT STATUS
========================================================= */

const PAYMENT_STATUSES = [

  "Pending",

  "Paid",

  "Failed",

  "Refunded"

];

/* =========================================================
   STATUS FLOW
========================================================= */

const STATUS_FLOW = {

  Pending: [
    "Confirmed",
    "Cancelled"
  ],

  Confirmed: [
    "Processing",
    "Shipped",
    "Cancelled"
  ],

  Processing: [
    "Shipped",
    "Cancelled"
  ],

  Shipped: [
    "Delivered",
    "Cancelled"
  ],

  Delivered: [
    "Cancelled"
  ],

  Cancelled: []

};

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initDatabase() {

  await pool.query(`

    CREATE TABLE IF NOT EXISTS store_settings (

      id INTEGER PRIMARY KEY,

      shop_name TEXT NOT NULL
        DEFAULT 'SM Online Shop',

      tagline TEXT NOT NULL
        DEFAULT 'Style • Comfort • Confidence ♥',

      phone1 TEXT NOT NULL
        DEFAULT '01827872334',

      phone2 TEXT NOT NULL
        DEFAULT '01886995687',

      facebook TEXT NOT NULL
        DEFAULT '',

      currency TEXT NOT NULL
        DEFAULT 'BDT'

    );



    CREATE TABLE IF NOT EXISTS products (

      id BIGINT PRIMARY KEY,

      name TEXT NOT NULL,

      category TEXT NOT NULL
        DEFAULT 'General',

      price NUMERIC(12,2) NOT NULL,

      old_price NUMERIC(12,2) NOT NULL,

      discount NUMERIC(5,2) NOT NULL
        DEFAULT 0,

      stock INTEGER NOT NULL
        DEFAULT 0,

      image TEXT NOT NULL
        DEFAULT '',

      created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()

    );



    CREATE TABLE IF NOT EXISTS orders (

      id TEXT PRIMARY KEY,

      created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

      customer JSONB NOT NULL,

      items JSONB NOT NULL,

      total NUMERIC(12,2) NOT NULL,

      payment_method TEXT NOT NULL
        DEFAULT 'cod',

      status TEXT NOT NULL
        DEFAULT 'Pending'

    );



    INSERT INTO store_settings (
      id
    )

    VALUES (
      1
    )

    ON CONFLICT (id)
    DO NOTHING;



    ALTER TABLE orders

    ADD COLUMN IF NOT EXISTS
      payment_status TEXT
      NOT NULL
      DEFAULT 'Pending';

  `);

  console.log(
    "PostgreSQL database initialized."
  );

}

/* =========================================================
   SETTINGS
========================================================= */

async function getSettings() {

  const result =
    await pool.query(`

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
      "",

    currency:
      row.currency ||
      "BDT"

  };

}

/* =========================================================
   PRODUCTS
========================================================= */

async function getProducts() {

  const result =
    await pool.query(`

      SELECT

        id::text AS id,

        name,

        category,

        price::float AS price,

        old_price::float
          AS "oldPrice",

        discount::float
          AS discount,

        stock,

        image,

        created_at
          AS "createdAt"

      FROM products

      ORDER BY
        created_at DESC

    `);

  return result.rows.map(
    product => ({

      ...product,

      id:
        Number(
          product.id
        )

    })
  );

}

/* =========================================================
   ORDERS
========================================================= */

async function getOrders() {

  const result =
    await pool.query(`

      SELECT

        id,

        created_at
          AS "createdAt",

        customer,

        items,

        total::float
          AS total,

        payment_method
          AS "paymentMethod",

        status,

        payment_status
          AS "paymentStatus"

      FROM orders

      ORDER BY
        created_at DESC

    `);

  return result.rows;

}

/* =========================================================
   ADMIN SESSIONS
========================================================= */

const sessions =
  new Map();

/* =========================================================
   CREATE ADMIN TOKEN
========================================================= */

function createToken(
  username
) {

  const randomPart =
    crypto
      .randomBytes(32)
      .toString("hex");

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
      .toString(
        "base64url"
      )

  );

}

/* =========================================================
   ADMIN AUTH
========================================================= */

function adminAuth(
  req,
  res,
  next
) {

  const authHeader =
    req.headers.authorization ||
    "";

  if (
    !authHeader.startsWith(
      "Bearer "
    )
  ) {

    return res
      .status(401)
      .json({
        error:
          "Unauthorized"
      });

  }

  const token =
    authHeader.substring(7);

  if (
    !sessions.has(token)
  ) {

    return res
      .status(401)
      .json({
        error:
          "Session expired"
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

  async (
    req,
    res
  ) => {

    try {

      const [
        settings,
        products
      ] =
        await Promise.all([

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

      res
        .status(500)
        .json({

          error:
            "Could not load store"

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
      String(
        req.body?.username ||
        ""
      ).trim();

    const password =
      String(
        req.body?.password ||
        ""
      );

    if (

      username !==
        ADMIN_USER ||

      password !==
        ADMIN_PASS

    ) {

      return res
        .status(401)
        .json({

          error:
            "Invalid username or password"

        });

    }

    const token =
      createToken(
        username
      );

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

  async (
    req,
    res
  ) => {

    try {

      const products =
        await getProducts();

      res.json(
        products
      );

    } catch (error) {

      console.error(
        error
      );

      res
        .status(500)
        .json({

          error:
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

  async (
    req,
    res
  ) => {

    try {

      const body =
        req.body || {};

      const name =
        String(
          body.name || ""
        ).trim();

      if (!name) {

        return res
          .status(400)
          .json({

            error:
              "Product name is required"

          });

      }

      const price =
        Number(
          body.price || 0
        );

      if (
        price <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valid product price is required"

          });

      }

      const product = {

        id:
          Date.now(),

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
            body.discount ||
            0
          ),

        stock:
          Math.max(
            0,
            Number(
              body.stock || 0
            )
          ),

        image:
          String(
            body.image ||
            ""
          ),

        createdAt:
          new Date()
            .toISOString()

      };

      await pool.query(

        `

        INSERT INTO products (

          id,

          name,

          category,

          price,

          old_price,

          discount,

          stock,

          image,

          created_at

        )

        VALUES (

          $1,$2,$3,$4,$5,$6,$7,$8,$9

        )

        `,

        [

          product.id,

          product.name,

          product.category,

          product.price,

          product.oldPrice,

          product.discount,

          product.stock,

          product.image,

          product.createdAt

        ]

      );

      res.json(
        product
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

  async (
    req,
    res
  ) => {

    try {

      const id =
        Number(
          req.params.id
        );

      const existing =
        await pool.query(

          `

          SELECT

            id::text AS id,

            name,

            category,

            price::float
              AS price,

            old_price::float
              AS "oldPrice",

            discount::float
              AS discount,

            stock,

            image,

            created_at
              AS "createdAt"

          FROM products

          WHERE id = $1

          `,

          [id]

        );

      if (
        !existing.rows.length
      ) {

        return res
          .status(404)
          .json({

            error:
              "Product not found"

          });

      }

      const oldProduct = {

        ...existing.rows[0],

        id:
          Number(
            existing.rows[0].id
          )

      };

      const body =
        req.body || {};

      const updatedProduct = {

        ...oldProduct,

        ...body,

        id

      };

      updatedProduct.name =
        String(
          updatedProduct.name ||
          ""
        ).trim();

      updatedProduct.category =
        String(
          updatedProduct.category ||
          "General"
        );

      updatedProduct.price =
        Number(
          updatedProduct.price ||
          0
        );

      updatedProduct.oldPrice =
        Number(
          updatedProduct.oldPrice ||
          updatedProduct.price
        );

      updatedProduct.discount =
        Number(
          updatedProduct.discount ||
          0
        );

      updatedProduct.stock =
        Math.max(
          0,
          Number(
            updatedProduct.stock ||
            0
          )
        );

      updatedProduct.image =
        String(
          updatedProduct.image ||
          ""
        );

      if (

        !updatedProduct.name ||

        updatedProduct.price <= 0

      ) {

        return res
          .status(400)
          .json({

            error:
              "Valid product name and price are required"

          });

      }

      await pool.query(

        `

        UPDATE products

        SET

          name = $1,

          category = $2,

          price = $3,

          old_price = $4,

          discount = $5,

          stock = $6,

          image = $7

        WHERE id = $8

        `,

        [

          updatedProduct.name,

          updatedProduct.category,

          updatedProduct.price,

          updatedProduct.oldPrice,

          updatedProduct.discount,

          updatedProduct.stock,

          updatedProduct.image,

          id

        ]

      );

      res.json(
        updatedProduct
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

  async (
    req,
    res
  ) => {

    try {

      const id =
        Number(
          req.params.id
        );

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

        return res
          .status(404)
          .json({

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

      res
        .status(500)
        .json({

          error:
            "Could not delete product"

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

  async (
    req,
    res
  ) => {

    try {

      const image =
        req.body?.image;

      if (!image) {

        return res
          .status(400)
          .json({

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

        return res
          .status(500)
          .json({

            error:
              "Cloudinary environment variables are missing"

          });

      }

      const result =
        await cloudinary
          .uploader
          .upload(

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

      res
        .status(500)
        .json({

          error:
            "Cloudinary image upload failed"

        });

    }

  }
);

/* =========================================================
   STORE SETTINGS
========================================================= */

app.put(
  "/api/admin/settings",

  adminAuth,

  async (
    req,
    res
  ) => {

    try {

      const oldSettings =
        await getSettings();

      const settings = {

        ...oldSettings,

        ...(req.body || {})

      };

      await pool.query(

        `

        UPDATE store_settings

        SET

          shop_name = $1,

          tagline = $2,

          phone1 = $3,

          phone2 = $4,

          facebook = $5,

          currency = $6

        WHERE id = 1

        `,

        [

          String(
            settings.shopName ||
            defaultSettings.shopName
          ),

          String(
            settings.tagline ||
            defaultSettings.tagline
          ),

          String(
            settings.phone1 ||
            ""
          ),

          String(
            settings.phone2 ||
            ""
          ),

          String(
            settings.facebook ||
            ""
          ),

          String(
            settings.currency ||
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
        "Settings error:",
        error
      );

      res
        .status(500)
        .json({

          error:
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

  async (
    req,
    res
  ) => {

    try {

      const orders =
        await getOrders();

      res.json(
        orders
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
            "Could not load orders"

        });

    }

  }
);

/* =========================================================
   UPDATE ORDER STATUS
   IMPORTANT:
   - Status is saved permanently in PostgreSQL
   - Cancel restores stock
   - Cancel cannot restore stock twice
========================================================= */

app.put(
  "/api/admin/orders/:id/status",

  adminAuth,

  async (
    req,
    res
  ) => {

    const client =
      await pool.connect();

    try {

      const orderId =
        String(
          req.params.id || ""
        ).trim();

      const newStatus =
        String(
          req.body?.status || ""
        ).trim();

      if (
        !ORDER_STATUSES.includes(
          newStatus
        )
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid order status"

          });

      }

      await client.query(
        "BEGIN"
      );

      /* -----------------------------------------
         LOCK ORDER
      ----------------------------------------- */

      const orderResult =
        await client.query(

          `

          SELECT

            id,

            created_at
              AS "createdAt",

            customer,

            items,

            total::float
              AS total,

            payment_method
              AS "paymentMethod",

            status,

            payment_status
              AS "paymentStatus"

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

        return res
          .status(404)
          .json({

            error:
              "Order not found"

          });

      }

      const order =
        orderResult.rows[0];

      const oldStatus =
        order.status;

      /* -----------------------------------------
         SAME STATUS
      ----------------------------------------- */

      if (
        oldStatus === newStatus
      ) {

        await client.query(
          "COMMIT"
        );

        return res.json({

          ok: true,

          order

        });

      }

      /* -----------------------------------------
         ALREADY CANCELLED
      ----------------------------------------- */

      if (
        oldStatus === "Cancelled"
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res
          .status(409)
          .json({

            error:
              "Cancelled order cannot be changed."

          });

      }

      /* -----------------------------------------
         STATUS TRANSITION CHECK
      ----------------------------------------- */

      const allowed =
        STATUS_FLOW[
          oldStatus
        ] || [];

      if (
        !allowed.includes(
          newStatus
        )
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res
          .status(400)
          .json({

            error:
              `Cannot change order status from ${oldStatus} to ${newStatus}.`

          });

      }

      /* -----------------------------------------
         CANCEL ORDER
         RESTORE STOCK
      ----------------------------------------- */

      if (
        newStatus === "Cancelled"
      ) {

        const items =
          Array.isArray(
            order.items
          )
            ? order.items
            : [];

        for (
          const item of items
        ) {

          const productId =
            Number(
              item.id
            );

          const quantity =
            Math.max(
              0,
              Number(
                item.qty || 0
              )
            );

          if (
            !productId ||
            quantity <= 0
          ) {

            continue;

          }

          /*
             Lock product row before
             increasing stock.
          */

          const productResult =
            await client.query(

              `

              SELECT

                id,

                stock

              FROM products

              WHERE id = $1

              FOR UPDATE

              `,

              [productId]

            );

          /*
             If product was deleted,
             do not crash the whole
             cancellation process.
          */

          if (
            !productResult.rows.length
          ) {

            console.warn(

              "Product not found while restoring stock:",
              productId

            );

            continue;

          }

          await client.query(

            `

            UPDATE products

            SET stock =
              stock + $1

            WHERE id = $2

            `,

            [

              quantity,

              productId

            ]

          );

        }

      }

      /* -----------------------------------------
         SAVE NEW STATUS
     
```
