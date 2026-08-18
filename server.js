/* =========================
   ADMIN UPDATE ORDER STATUS
========================= */

app.put(
  "/api/admin/orders/:id",
  adminAuth,
  async (req, res) => {

    try {

      const orderId =
        String(req.params.id || "").trim();

      const status =
        String(req.body?.status || "").trim();

      const allowedStatuses = [
        "Pending",
        "Confirmed",
        "Delivered",
        "Cancelled"
      ];

      if (!allowedStatuses.includes(status)) {

        return res.status(400).json({
          error: "Invalid order status"
        });
      }

      const result = await pool.query(
        `
        UPDATE orders

        SET status = $1

        WHERE id = $2

        RETURNING
          id,
          created_at AS "createdAt",
          customer,
          items,
          total::float AS total,
          payment_method AS "paymentMethod",
          status
        `,
        [
          status,
          orderId
        ]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: "Order not found"
        });
      }

      res.json({
        ok: true,
        order: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Update order status error:",
        error
      );

      res.status(500).json({
        error:
          "Could not update order status"
      });
    }
  }
);


/* =========================
   CUSTOMER ORDER STATUS
========================= */

app.get(
  "/api/orders/:id",
  async (req, res) => {

    try {

      const orderId =
        String(req.params.id || "").trim();

      if (!orderId) {

        return res.status(400).json({
          error: "Order ID is required"
        });
      }

      const result = await pool.query(
        `
        SELECT

          id,

          created_at AS "createdAt",

          customer,

          items,

          total::float AS total,

          payment_method AS "paymentMethod",

          status

        FROM orders

        WHERE id = $1
        `,
        [orderId]
      );

      if (!result.rows.length) {

        return res.status(404).json({
          error: "Order not found"
        });
      }

      const order = result.rows[0];

      res.json({
        ok: true,
        order
      });

    } catch (error) {

      console.error(
        "Customer order status error:",
        error
      );

      res.status(500).json({
        error:
          "Could not load order"
      });
    }
  }
);
