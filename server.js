
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

const DATA = path.join(__dirname, "data.json");

const SECRET =
  process.env.SESSION_SECRET || "CHANGE_THIS_SECRET";

const ADMIN_USER =
  process.env.ADMIN_USER || "SMADMIN";

const ADMIN_PASS =
  process.env.ADMIN_PASS || "SM2728";


function read() {
  return JSON.parse(
    fs.readFileSync(DATA, "utf8")
  );
}


function write(data) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(data, null, 2)
  );
}


/* LOGIN SESSIONS */

const sessions = new Map();


function makeToken(user) {

  const raw =
    user +
    "." +
    Date.now() +
    "." +
    crypto.randomBytes(24).toString("hex");

  return (
    crypto
      .createHmac("sha256", SECRET)
      .update(raw)
      .digest("hex") +
    "." +
    Buffer.from(user).toString("base64url")
  );
}


function auth(req, res, next) {

  const token =
    req.headers.authorization?.replace(
      "Bearer ",
      ""
    );

  if (!token || !sessions.has(token)) {

    return res.status(401).json({
      error: "Unauthorized"
    });

  }

  req.admin = sessions.get(token);

  next();
}


/* STORE */

app.get("/api/store", (req, res) => {

  const data = read();

  res.json({
    settings: data.settings,
    products: data.products
  });

});


/* ADMIN LOGIN */

app.post(
  "/api/admin/login",
  (req, res) => {

    const {
      username,
      password
    } = req.body || {};

    if (
      username !== ADMIN_USER ||
      password !== ADMIN_PASS
    ) {

      return res.status(401).json({
        error: "Invalid username or password"
      });

    }

    const token =
      makeToken(username);

    sessions.set(
      token,
      username
    );

    res.json({
      token
    });

  }
);


/* LOGOUT */

app.post(
  "/api/admin/logout",
  auth,
  (req, res) => {

    const token =
      req.headers.authorization
        .replace("Bearer ", "");

    sessions.delete(token);

    res.json({
      ok: true
    });

  }
);


/* ADMIN ORDERS */

app.get(
  "/api/admin/orders",
  auth,
  (req, res) => {

    res.json(read().orders);

  }
);


/* CHANGE ORDER STATUS */

app.put(
  "/api/admin/orders/:id/status",
  auth,
  (req, res) => {

    const data = read();

    const order =
      data.orders.find(
        x =>
          String(x.id) ===
          String(req.params.id)
      );

    if (!order) {

      return res.status(404).json({
        error: "Order not found"
      });

    }

    const allowed = [
      "Pending",
      "Confirmed",
      "Processing",
      "Shipped",
      "Delivered",
      "Cancelled"
    ];

    const status =
      req.body?.status;

    if (!allowed.includes(status)) {

      return res.status(400).json({
        error: "Invalid status"
      });

    }

    order.status = status;

    order.updatedAt =
      new Date().toISOString();

    write(data);

    res.json({
      ok: true,
      order
    });

  }
);


/* PRODUCTS */

app.get(
  "/api/admin/products",
  auth,
  (req, res) => {

    res.json(read().products);

  }
);


/* ADD PRODUCT */

app.post(
  "/api/admin/products",
  auth,
  (req, res) => {

    const data = read();

    const p = req.body || {};

    if (!p.name || !p.price) {

      return res.status(400).json({
        error:
          "Name and price required"
      });

    }

    p.id = Date.now();

    p.price =
      Number(p.price);

    p.oldPrice =
      Number(
        p.oldPrice || p.price
      );

    p.stock =
      Number(p.stock || 0);

    p.discount =
      Number(p.discount || 0);

    data.products.push(p);

    write(data);

    res.json(p);

  }
);


/* EDIT PRODUCT */

app.put(
  "/api/admin/products/:id",
  auth,
  (req, res) => {

    const data = read();

    const id =
      Number(req.params.id);

    const index =
      data.products.findIndex(
        x => x.id === id
      );

    if (index < 0) {

      return res.status(404).json({
        error: "Product not found"
      });

    }

    data.products[index] = {
      ...data.products[index],
      ...req.body,
      id
    };

    [
      "price",
      "oldPrice",
      "stock",
      "discount"
    ].forEach(key => {

      if (
        data.products[index][key] != null
      ) {

        data.products[index][key] =
          Number(
            data.products[index][key]
          );

      }

    });

    write(data);

    res.json(
      data.products[index]
    );

  }
);


/* DELETE PRODUCT */

app.delete(
  "/api/admin/products/:id",
  auth,
  (req, res) => {

    const data = read();

    const id =
      Number(req.params.id);

    data.products =
      data.products.filter(
        x => x.id !== id
      );

    write(data);

    res.json({
      ok: true
    });

  }
);


/* STORE SETTINGS */

app.put(
  "/api/admin/settings",
  auth,
  (req, res) => {

    const data = read();

    data.settings = {
      ...data.settings,
      ...req.body
    };

    write(data);

    res.json(
      data.settings
    );

  }
);


/* CUSTOMER ORDER */

app.post(
  "/api/orders",
  (req, res) => {

    const data = read();

    const {
      customer,
      items,
      paymentMethod
    } = req.body || {};

    if (
      !customer?.name ||
      !customer?.phone ||
      !customer?.address ||
      !Array.isArray(items) ||
      !items.length
    ) {

      return res.status(400).json({
        error:
          "Customer and order details are required"
      });

    }

    let total = 0;

    const clean = [];

    for (const item of items) {

      const product =
        data.products.find(
          x =>
            x.id ===
            Number(item.id)
        );

      const qty =
        Math.max(
          1,
          Number(item.qty || 1)
        );

      if (
        !product ||
        product.stock < qty
      ) {

        return res.status(400).json({
          error:
            "Out of stock: " +
            (product?.name || "product")
        });

      }

      total +=
        product.price * qty;

      clean.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty
      });

    }


    const order = {

      id:
        "SM" +
        Date.now(),

      createdAt:
        new Date().toISOString(),

      customer,

      items: clean,

      total,

      paymentMethod:
        paymentMethod || "cod",

      status:
        "Pending"

    };


    data.orders.unshift(order);


    clean.forEach(item => {

      const product =
        data.products.find(
          x =>
            x.id === item.id
        );

      if (product) {

        product.stock -=
          item.qty;

      }

    });


    write(data);

    res.json({
      ok: true,
      orderId: order.id,
      total
    });

  }
);


/* PAYMENT PLACEHOLDER */

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


/* FRONTEND */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);


app.listen(
  PORT,
  () => {

    console.log(
      "SM Online Shop running on port " +
      PORT
    );

  }
);
