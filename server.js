const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT = process.env.PORT || 10000;


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


/* =====================================================
   CLOUDINARY
===================================================== */

if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
} else {
  console.warn(
    "Cloudinary environment variables are missing."
  );
}


/* =====================================================
   EXPRESS
===================================================== */

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

const publicPath = path.join(
  __dirname,
  "public"
);

app.use(
  express.static(publicPath)
);


/* =====================================================
   ADMIN SESSION
===================================================== */

const adminSessions = new Map();


/* =====================================================
   ADMIN LOGIN DETAILS
===================================================== */

const ADMIN_USERNAME = "SMADMIN";
const ADMIN_PASSWORD = "SM2728";


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
    req.headers.authorization || "";

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


/* =====================================================
   DATABASE INITIALIZATION
===================================================== */

async function initDatabase() {

  const client =
    await pool.connect();

  try {

    await client.query("BEGIN");


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


    /* =================================================
       STORE SETTINGS MIGRATION
    ================================================= */

    await client.query(`

      ALTER TABLE store_settings

      ADD COLUMN IF NOT EXISTS
      shop_name TEXT DEFAULT 'SM Online Shop'

    `);

    await client.query(`

      ALTER TABLE store_settings

      ADD COLUMN IF NOT EXISTS
      tagline TEXT DEFAULT ''

    `);

    await client.query(`

      ALTER TABLE store_settings

      ADD COLUMN IF NOT EXISTS
      phone1 TEXT DEFAULT ''

    `);

    await client.query(`

      ALTER TABLE store_settings

      ADD COLUMN IF NOT EXISTS
      phone2 TEXT DEFAULT ''

    `);

    await client.query(`

      ALTER TABLE store_settings

      ADD COLUMN IF NOT EXISTS
      facebook TEXT DEFAULT ''

    `);

    await client.query(`

      ALTER TABLE store_settings

      ADD COLUMN IF NOT EXISTS
      currency TEXT DEFAULT 'BDT'

    `);

    await client.query(`

      ALTER TABLE store_settings

      ADD COLUMN IF NOT EXISTS
      updated_at TIMESTAMPTZ DEFAULT NOW()

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

      ADD COLUMN IF NOT EXISTS
      description TEXT DEFAULT ''

    `);

    await client.query(`

      ALTER TABLE products

      ADD COLUMN IF NOT EXISTS
      category TEXT DEFAULT 'General'

    `);

    await client.query(`

      ALTER TABLE products

      ADD COLUMN IF NOT EXISTS
      old_price NUMERIC(12,2) DEFAULT 0

    `);

    await client.query(`

      ALTER TABLE products

      ADD COLUMN IF NOT EXISTS
      discount NUMERIC(6,2) DEFAULT 0

    `);

    await client.query(`

      ALTER TABLE products

      ADD COLUMN IF NOT EXISTS
      stock INTEGER DEFAULT 0

    `);

    await client.query(`

      ALTER TABLE products

      ADD COLUMN IF NOT EXISTS
      image TEXT DEFAULT ''

    `);

    await client.query(`

      ALTER TABLE products

      ADD COLUMN IF NOT EXISTS
      created_at TIMESTAMPTZ DEFAULT NOW()

    `);

    await client.query(`

      ALTER TABLE products

      ADD COLUMN IF NOT EXISTS
      updated_at TIMESTAMPTZ DEFAULT NOW()

    `);


    await client.query(`

      UPDATE products

      SET updated_at =
        COALESCE(
          updated_at,
          created_at,
          NOW()
        )

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
       ORDERS ID AUTO-INCREMENT REPAIR
       
       FIXES:
       null value in column "id"
       of relation "orders"
    ================================================= */

    await client.query(`

      CREATE SEQUENCE IF NOT EXISTS orders_id_seq

    `);


    await client.query(`

      ALTER SEQUENCE orders_id_seq

      OWNED BY orders.id

    `);


    await client.query(`

      ALTER TABLE orders

      ALTER COLUMN id

      SET DEFAULT nextval('orders_id_seq')

    `);


    /* =================================================
       SYNC ORDER SEQUENCE WITH EXISTING ORDERS
    ================================================= */

    await client.query(`

      SELECT setval(

        'orders_id_seq',

        COALESCE(

          (

            SELECT MAX(id)

            FROM orders

          ),

          0

        ) + 1,

        false

      )

    `);


    /* =================================================
       ORDERS MIGRATION
    ================================================= */

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      customer JSONB DEFAULT '{}'::jsonb

    `);

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      items JSONB DEFAULT '[]'::jsonb

    `);

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      total NUMERIC(12,2) DEFAULT 0

    `);

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      status TEXT DEFAULT 'Pending'

    `);

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      payment_status TEXT DEFAULT 'Pending'

    `);

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      payment_method TEXT DEFAULT 'cod'

    `);

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      created_at TIMESTAMPTZ DEFAULT NOW()

    `);

    await client.query(`

      ALTER TABLE orders

      ADD COLUMN IF NOT EXISTS
      updated_at TIMESTAMPTZ DEFAULT NOW()

    `);


    await client.query(`

      UPDATE orders

      SET updated_at =
        COALESCE(
          updated_at,
          created_at,
          NOW()
        )

      WHERE updated_at IS NULL

    `);


    /* =================================================
       DEFAULT STORE SETTINGS
    ================================================= */

    const settingsResult =
      await client.query(`

        SELECT id

        FROM store_settings

        ORDER BY id

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

        status: "online"

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

          ORDER BY id

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
        String(
          req.body.username || ""
        ).trim();

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

      const {

        name,

        category,

        description,

        price,

        oldPrice,

        discount,

        stock,

        image

      } = req.body;


      const cleanName =
        String(
          name || ""
        ).trim();


      if (!cleanName) {

        return res
          .status(400)
          .json({

            error:
              "Product name is required."

          });

      }


      const cleanPrice =
        safeNumber(price);


      if (
        cleanPrice <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valid product price is required."

          });

      }


      const result =
        await pool.query(`

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

          cleanName,

          String(
            category ||
            "General"
          ),

          String(
            description ||
            ""
          ),

          cleanPrice,

          safeNumber(
            oldPrice,
            cleanPrice
          ),

          safeNumber(
            discount
          ),

          Math.max(
            0,
            Math.floor(
              safeNumber(stock)
            )
          ),

          String(
            image ||
            ""
          )

        ]);


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
        !Number.isInteger(id)
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid product ID."

          });

      }


      const {

        name,

        category,

        description,

        price,

        oldPrice,

        discount,

        stock,

        image

      } = req.body;


      const cleanName =
        String(
          name || ""
        ).trim();


      if (!cleanName) {

        return res
          .status(400)
          .json({

            error:
              "Product name is required."

          });

      }


      const cleanPrice =
        safeNumber(price);


      if (
        cleanPrice <= 0
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valid product price is required."

          });

      }


      const result =
        await pool.query(`

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

          cleanName,

          String(
            category ||
            "General"
          ),

          String(
            description ||
            ""
          ),

          cleanPrice,

          safeNumber(
            oldPrice,
            cleanPrice
          ),

          safeNumber(
            discount
          ),

          Math.max(
            0,
            Math.floor(
              safeNumber(stock)
            )
          ),

          String(
            image ||
            ""
          ),

          id

        ]);


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
        !Number.isInteger(id)
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid product ID."

          });

      }


      const result =
        await pool.query(`

          DELETE FROM products

          WHERE id = $1

          RETURNING id

        `,

        [id]);


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
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {

        return res
          .status(500)
          .json({

            error:
              "Cloudinary is not configured."

          });

      }


      const image =
        String(
          req.body.image ||
          ""
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

      const {

        customer,

        items,

        total,

        paymentMethod

      } = req.body;


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


      await client.query(
        "BEGIN"
      );


      const finalItems = [];


      /* =================================================
         VERIFY PRODUCTS AND STOCK
      ================================================= */

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
            Math.floor(
              safeNumber(
                item.qty,
                1
              )
            )
          );


        if (
          !Number.isInteger(
            productId
          )
        ) {

          throw new Error(
            "Invalid product ID."
          );

        }


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

            [productId]

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


        if (
          Number(product.stock) <
          qty
        ) {

          throw new Error(
            `Not enough stock for ${product.name}.`
          );

        }


        finalItems.push({

          productId:
            product.id,

          name:
            product.name,

          price:
            Number(
              product.price
            ),

          qty:
            qty,

          image:
            product.image || ""

        });


        /* =================================================
           REDUCE STOCK
        ================================================= */

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

            qty,

            productId

          ]

        );

      }


      /* =================================================
         CALCULATE TOTAL FROM DATABASE PRICES
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


      /* =================================================
         CREATE ORDER
         
         IMPORTANT:
         ID IS GENERATED BY orders_id_seq
      ================================================= */

      const result =
        await client.query(

          `

            INSERT INTO orders

            (

              id,

              customer,

              items,

              total,

              status,

              payment_status,

              payment_method,

              updated_at

            )

            VALUES

            (

              nextval('orders_id_seq'),

              $1,

              $2,

              $3,

              'Pending',

              'Pending',

              $4,

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
              customer || {}
            ),

            JSON.stringify(
              finalItems
            ),

            calculatedTotal,

            String(
              paymentMethod ||
              "cod"
            )

          ]

        );


      /* =================================================
         COMMIT
      ================================================= */

      await client.query(
        "COMMIT"
      );


      console.log(
        `Order #${result.rows[0].id} created successfully.`
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
          "Rollback error:",
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
   CANCEL IS PERMANENTLY SAVED
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
        String(
          req.body.status ||
          ""
        ).trim();


      const allowedStatuses = [

        "Pending",

        "Confirmed",

        "Processing",

        "Shipped",

        "Delivered",

        "Cancelled"

      ];


      if (
        !Number.isInteger(id)
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
        await pool.query(`

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

        ]);


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
        String(
          req.body.paymentStatus ||
          ""
        ).trim();


      const allowedStatuses = [

        "Pending",

        "Paid",

        "Failed",

        "Refunded"

      ];


      if (
        !Number.isInteger(id)
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
        await pool.query(`

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

        ]);


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

      const {

        shopName,

        tagline,

        phone1,

        phone2,

        facebook,

        currency

      } = req.body;


      const result =
        await pool.query(`

          UPDATE store_settings

          SET

            shop_name = $1,

            tagline = $2,

            phone1 = $3,

            phone2 = $4,

            facebook = $5,

            currency = $6,

            updated_at = NOW()

          WHERE id = (

            SELECT id

            FROM store_settings

            ORDER BY id

            LIMIT 1

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

          String(
            shopName ||
            "SM Online Shop"
          ),

          String(
            tagline ||
            ""
          ),

          String(
            phone1 ||
            ""
          ),

          String(
            phone2 ||
            ""
          ),

          String(
            facebook ||
            ""
          ),

          String(
            currency ||
            "BDT"
          )

        ]);


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
   404 API
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
   ERROR HANDLER
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

process.on(
  "SIGTERM",
  async () => {

    console.log(
      "SIGTERM received."
    );

    await pool.end();

    process.exit(0);

  }
);


process.on(
  "SIGINT",
  async () => {

    console.log(
      "SIGINT received."
    );

    await pool.end();

    process.exit(0);

  }
);
