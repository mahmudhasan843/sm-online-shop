=========================== */

app.post(
  "/api/admin/logout",
  auth,
  (req,res)=>{

    const token =
      req.headers.authorization
        .replace("Bearer ","");


    sessions.delete(token);


    res.json({
      ok:true
    });

  }
);


/* =====================================
   ADMIN ORDERS
===================================== */

app.get(
  "/api/admin/orders",
  auth,
  (req,res)=>{

    res.json(
      read().orders
    );

  }
);


/* =====================================
   ADMIN PRODUCTS
===================================== */

app.get(
  "/api/admin/products",
  auth,
  (req,res)=>{

    res.json(
      read().products
    );

  }
);


/* =====================================
   ADD PRODUCT
===================================== */

app.post(
  "/api/admin/products",
  auth,
  (req,res)=>{

    const d = read();

    const p = req.body || {};


    if(
      !p.name ||
      p.price === undefined ||
      p.price === ""
    ){

      return res
        .status(400)
        .json({
          error:"Name and price required"
        });

    }


    p.id =
      Date.now();


    p.price =
      Number(p.price);


    p.oldPrice =
      Number(
        p.oldPrice ||
        p.price
      );


    p.stock =
      Number(
        p.stock || 0
      );


    p.discount =
      Number(
        p.discount || 0
      );


    p.category =
      p.category || "Other";


    /*
      Image can be:
      - Base64 image from phone
      - Existing URL
    */

    p.image =
      p.image || "";


    d.products.push(p);


    write(d);


    res.json(p);

  }
);


/* =====================================
   EDIT PRODUCT
===================================== */

app.put(
  "/api/admin/products/:id",
  auth,
  (req,res)=>{

    const d = read();

    const id =
      Number(req.params.id);


    const index =
      d.products.findIndex(
        x => x.id === id
      );


    if(index < 0){

      return res
        .status(404)
        .json({
          error:"Product not found"
        });

    }


    const oldProduct =
      d.products[index];


    const update =
      req.body || {};


    /*
      If new image is not sent,
      keep old image.
    */

    if(
      !update.image &&
      oldProduct.image
    ){

      update.image =
        oldProduct.image;

    }


    d.products[index] = {

      ...oldProduct,

      ...update,

      id:id

    };


    for(
      const key of [
        "price",
        "oldPrice",
        "stock",
        "discount"
      ]
    ){

      if(
        d.products[index][key] !==
        undefined
      ){

        d.products[index][key] =
          Number(
            d.products[index][key]
          );

      }

    }


    write(d);


    res.json(
      d.products[index]
    );

  }
);


/* =====================================
   DELETE PRODUCT
===================================== */

app.delete(
  "/api/admin/products/:id",
  auth,
  (req,res)=>{

    const d = read();

    const id =
      Number(req.params.id);


    d.products =
      d.products.filter(
        x => x.id !== id
      );


    write(d);


    res.json({
      ok:true
    });

  }
);


/* =====================================
   STORE SETTINGS
===================================== */

app.put(
  "/api/admin/settings",
  auth,
  (req,res)=>{

    const d = read();


    d.settings = {

      ...d.settings,

      ...(req.body || {})

    };


    write(d);


    res.json(
      d.settings
    );

  }
);


/* =====================================
   CREATE ORDER
===================================== */

app.post(
  "/api/orders",
  (req,res)=>{

    const d = read();


    const {
      customer,
      items,
      paymentMethod
    } = req.body || {};


    if(
      !customer?.name ||
      !customer?.phone ||
      !customer?.address ||
      !Array.isArray(items) ||
      !items.length
    ){

      return res
        .status(400)
        .json({
          error:
            "Customer and order details are required"
        
   PAYMENT ADAPTE
