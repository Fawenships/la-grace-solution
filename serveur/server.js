const express = require("express");
const session = require("express-session");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5500";

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "LGS2026";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "dev-secret-change-this-before-production";

const isProduction = NODE_ENV === "production";

if (isProduction) {
  app.set("trust proxy", 1);
}

/* =========================================================
   DOSSIERS / FICHIERS
========================================================= */

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const FILES = {
  products: path.join(DATA_DIR, "products.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  settings: path.join(DATA_DIR, "settings.json"),
  promotion: path.join(DATA_DIR, "promotion.json")
};

/* =========================================================
   DONNÉES PAR DÉFAUT
========================================================= */

const DEFAULT_PRODUCTS = [
  {
    id: 1,
    name: "Panneau solaire 550W",
    category: "Solaire",
    description: "Panneau solaire haute performance 550W.",
    price: 0,
    stock: 0,
    image: "",
    active: true,
    promo: false
  },
  {
    id: 2,
    name: "Batterie solaire",
    category: "Batteries",
    description: "Batterie destinée aux installations solaires.",
    price: 0,
    stock: 0,
    image: "",
    active: true,
    promo: false
  },
  {
    id: 3,
    name: "Onduleur",
    category: "Onduleurs",
    description: "Onduleur pour alimentation et protection des appareils.",
    price: 0,
    stock: 0,
    image: "",
    active: true,
    promo: false
  }
];

const DEFAULT_ORDERS = [];

const DEFAULT_SETTINGS = {
  site_name: "La Grâce Solution",
  phone: "",
  email: "",
  hero_title: "Des solutions fiables pour votre énergie",
  hero_description:
    "Découvrez nos solutions solaires, batteries, onduleurs, matériel électrique et outils."
};

const DEFAULT_PROMOTION = {
  title: "",
  description: "",
  active: false
};

/* =========================================================
   OUTILS JSON
========================================================= */

function ensureJsonFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(defaultValue, null, 2),
      "utf8"
    );
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    const content = fs.readFileSync(file, "utf8");

    if (!content.trim()) {
      return fallback;
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("Erreur lecture JSON:", file, error);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

ensureJsonFile(FILES.products, DEFAULT_PRODUCTS);
ensureJsonFile(FILES.orders, DEFAULT_ORDERS);
ensureJsonFile(FILES.settings, DEFAULT_SETTINGS);
ensureJsonFile(FILES.promotion, DEFAULT_PROMOTION);

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(
  session({
    name: "lgs_admin_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

/* =========================================================
   SSE / TEMPS RÉEL
========================================================= */

const clients = new Set();

function broadcast(event, data = {}) {
  const message =
    `event: ${event}\n` +
    `data: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch (error) {
      clients.delete(client);
    }
  }
}

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_URL);
  res.setHeader("Access-Control-Allow-Credentials", "true");

  res.flushHeaders();

  res.write(
    `event: connected\ndata: ${JSON.stringify({
      ok: true
    })}\n\n`
  );

  clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

/* =========================================================
   OUTILS
========================================================= */

function generateId(items) {
  if (!items.length) {
    return 1;
  }

  return (
    Math.max(
      ...items.map(item => Number(item.id) || 0)
    ) + 1
  );
}

function cleanString(value, maxLength = 5000) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim().slice(0, maxLength);
}

function toBoolean(value) {
  return (
    value === true ||
    value === "true" ||
    value === 1 ||
    value === "1" ||
    value === "on"
  );
}

function toNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return number;
}

function hashPassword(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function safePasswordCompare(a, b) {
  const hashA = hashPassword(a);
  const hashB = hashPassword(b);

  return crypto.timingSafeEqual(
    Buffer.from(hashA),
    Buffer.from(hashB)
  );
}

/* =========================================================
   AUTHENTIFICATION ADMIN
========================================================= */

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    ok: false,
    message: "Accès administrateur requis."
  });
}

/* =========================================================
   ROUTE TEST
========================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "La Grâce Solution API",
    message: "Le serveur fonctionne correctement.",
    version: "1.0.0"
  });
});

/* =========================================================
   PRODUITS PUBLICS
========================================================= */

app.get("/api/products", (req, res) => {
  const products = readJson(
    FILES.products,
    DEFAULT_PRODUCTS
  );

  const activeProducts = products.filter(
    product => product.active !== false
  );

  res.json(activeProducts);
});

/* =========================================================
   SETTINGS PUBLICS
========================================================= */

app.get("/api/settings", (req, res) => {
  const settings = readJson(
    FILES.settings,
    DEFAULT_SETTINGS
  );

  res.json(settings);
});

/* =========================================================
   PROMOTION PUBLIQUE
========================================================= */

app.get("/api/promotion", (req, res) => {
  const promotion = readJson(
    FILES.promotion,
    DEFAULT_PROMOTION
  );

  res.json(promotion);
});

/* =========================================================
   COMMANDES CLIENT
========================================================= */

app.post("/api/orders", (req, res) => {
  try {
    const body = req.body || {};

    const customerName = cleanString(
      body.customer_name,
      150
    );

    const customerPhone = cleanString(
      body.customer_phone,
      50
    );

    const customerAddress = cleanString(
      body.customer_address,
      500
    );

    const paymentMethod = cleanString(
      body.payment_method,
      50
    );

    const requestedItems = Array.isArray(body.items)
      ? body.items
      : [];

    if (!customerName) {
      return res.status(400).json({
        ok: false,
        message: "Le nom du client est obligatoire."
      });
    }

    if (!customerPhone) {
      return res.status(400).json({
        ok: false,
        message: "Le téléphone est obligatoire."
      });
    }

    if (!customerAddress) {
      return res.status(400).json({
        ok: false,
        message: "L'adresse est obligatoire."
      });
    }

    const allowedPayments = [
      "MonCash",
      "NatCash",
      "À la livraison"
    ];

    if (!allowedPayments.includes(paymentMethod)) {
      return res.status(400).json({
        ok: false,
        message: "Mode de paiement invalide."
      });
    }

    if (!requestedItems.length) {
      return res.status(400).json({
        ok: false,
        message: "Le panier est vide."
      });
    }

    const products = readJson(
      FILES.products,
      DEFAULT_PRODUCTS
    );

    const orderItems = [];
    let total = 0;

    for (const requested of requestedItems) {
      const productId = Number(requested.id);
      const quantity = Math.floor(
        Number(requested.quantity)
      );

      if (!Number.isInteger(productId)) {
        return res.status(400).json({
          ok: false,
          message: "Produit invalide."
        });
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          ok: false,
          message: "Quantité invalide."
        });
      }

      const product = products.find(
        p => Number(p.id) === productId
      );

      if (!product || product.active === false) {
        return res.status(400).json({
          ok: false,
          message: "Un produit n'est plus disponible."
        });
      }

      if (Number(product.stock) < quantity) {
        return res.status(400).json({
          ok: false,
          message:
            `Stock insuffisant pour "${product.name}".`
        });
      }

      const price = toNumber(product.price);
      const subtotal = price * quantity;

      total += subtotal;

      orderItems.push({
        product_id: product.id,
        name: product.name,
        price,
        quantity,
        subtotal
      });
    }

    /* Décrémentation du stock */
    for (const item of orderItems) {
      const product = products.find(
        p => Number(p.id) === Number(item.product_id)
      );

      product.stock =
        Number(product.stock) - item.quantity;
    }

    writeJson(FILES.products, products);

    const orders = readJson(
      FILES.orders,
      DEFAULT_ORDERS
    );

    const order = {
      id: generateId(orders),
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      payment_method: paymentMethod,
      items: orderItems,
      total,
      status: "nouvelle",
      created_at: new Date().toISOString()
    };

    orders.push(order);

    writeJson(FILES.orders, orders);

    broadcast("order_created", {
      id: order.id
    });

    broadcast("products_updated");

    return res.status(201).json({
      ok: true,
      message: "Commande enregistrée avec succès.",
      order: {
        id: order.id,
        total: order.total,
        status: order.status
      }
    });

  } catch (error) {
    console.error("Erreur commande:", error);

    return res.status(500).json({
      ok: false,
      message: "Erreur lors de l'enregistrement de la commande."
    });
  }
});

/* =========================================================
   LOGIN ADMIN
========================================================= */

app.post("/api/admin/login", (req, res) => {
  const username = cleanString(
    req.body?.username,
    100
  );

  const password = String(
    req.body?.password || ""
  );

  const usernameOk =
    username === ADMIN_USERNAME;

  const passwordOk =
    safePasswordCompare(
      password,
      ADMIN_PASSWORD
    );

  if (!usernameOk || !passwordOk) {
    return res.status(401).json({
      ok: false,
      message: "Identifiants incorrects."
    });
  }

  req.session.isAdmin = true;
  req.session.adminUsername = username;

  return res.json({
    ok: true,
    message: "Connexion administrateur réussie."
  });
});

/* =========================================================
   VÉRIFICATION SESSION
========================================================= */

app.get(
  "/api/admin/me",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,
      username: req.session.adminUsername
    });
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/admin/logout",
  requireAdmin,
  (req, res) => {
    req.session.destroy(error => {
      if (error) {
        console.error(error);

        return res.status(500).json({
          ok: false,
          message: "Impossible de fermer la session."
        });
      }

      res.clearCookie("lgs_admin_session");

      res.json({
        ok: true
      });
    });
  }
);

/* =========================================================
   ADMIN — STATISTIQUES
========================================================= */

app.get(
  "/api/admin/stats",
  requireAdmin,
  (req, res) => {
    const products = readJson(
      FILES.products,
      DEFAULT_PRODUCTS
    );

    const orders = readJson(
      FILES.orders,
      DEFAULT_ORDERS
    );

    const activeProducts = products.filter(
      p => p.active !== false
    );

    const stock = products.reduce(
      (sum, product) =>
        sum + Math.max(0, Number(product.stock) || 0),
      0
    );

    const revenue = orders
      .filter(order => order.status !== "annulee")
      .reduce(
        (sum, order) =>
          sum + (Number(order.total) || 0),
        0
      );

    res.json({
      products: products.length,
      active: activeProducts.length,
      orders: orders.length,
      revenue,
      stock
    });
  }
);

/* =========================================================
   ADMIN — LISTE PRODUITS
========================================================= */

app.get(
  "/api/admin/products",
  requireAdmin,
  (req, res) => {
    const products = readJson(
      FILES.products,
      DEFAULT_PRODUCTS
    );

    res.json(products);
  }
);

/* =========================================================
   ADMIN — AJOUT PRODUIT
========================================================= */

app.post(
  "/api/admin/products",
  requireAdmin,
  (req, res) => {
    try {
      const body = req.body || {};

      const name = cleanString(body.name, 200);
      const category = cleanString(
        body.category,
        100
      );

      if (!name) {
        return res.status(400).json({
          ok: false,
          message: "Le nom du produit est obligatoire."
        });
      }

      if (!category) {
        return res.status(400).json({
          ok: false,
          message: "La catégorie est obligatoire."
        });
      }

      const products = readJson(
        FILES.products,
        DEFAULT_PRODUCTS
      );

      const product = {
        id: generateId(products),
        name,
        category,
        description: cleanString(
          body.description,
          2000
        ),
        price: Math.max(
          0,
          toNumber(body.price)
        ),
        stock: Math.max(
          0,
          Math.floor(toNumber(body.stock))
        ),
        image: cleanString(
          body.image,
          2000
        ),
        active:
          body.active === undefined
            ? true
            : toBoolean(body.active),
        promo: toBoolean(body.promo)
      };

      products.push(product);

      writeJson(FILES.products, products);

      broadcast("products_updated");

      res.status(201).json({
        ok: true,
        product
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message: "Erreur lors de l'ajout du produit."
      });
    }
  }
);

/* =========================================================
   ADMIN — MODIFIER PRODUIT
========================================================= */

app.put(
  "/api/admin/products/:id",
  requireAdmin,
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const products = readJson(
        FILES.products,
        DEFAULT_PRODUCTS
      );

      const index = products.findIndex(
        product => Number(product.id) === id
      );

      if (index === -1) {
        return res.status(404).json({
          ok: false,
          message: "Produit introuvable."
        });
      }

      const body = req.body || {};

      const current = products[index];

      const updated = {
        ...current,

        name:
          body.name !== undefined
            ? cleanString(body.name, 200)
            : current.name,

        category:
          body.category !== undefined
            ? cleanString(body.category, 100)
            : current.category,

        description:
          body.description !== undefined
            ? cleanString(body.description, 2000)
            : current.description,

        price:
          body.price !== undefined
            ? Math.max(0, toNumber(body.price))
            : current.price,

        stock:
          body.stock !== undefined
            ? Math.max(
                0,
                Math.floor(toNumber(body.stock))
              )
            : current.stock,

        image:
          body.image !== undefined
            ? cleanString(body.image, 2000)
            : current.image,

        active:
          body.active !== undefined
            ? toBoolean(body.active)
            : current.active,

        promo:
          body.promo !== undefined
            ? toBoolean(body.promo)
            : current.promo
      };

      if (!updated.name) {
        return res.status(400).json({
          ok: false,
          message: "Le nom du produit est obligatoire."
        });
      }

      products[index] = updated;

      writeJson(FILES.products, products);

      broadcast("products_updated");

      res.json({
        ok: true,
        product: updated
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message: "Erreur lors de la modification."
      });
    }
  }
);

/* =========================================================
   ADMIN — SUPPRIMER PRODUIT
========================================================= */

app.delete(
  "/api/admin/products/:id",
  requireAdmin,
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const products = readJson(
        FILES.products,
        DEFAULT_PRODUCTS
      );

      const index = products.findIndex(
        product => Number(product.id) === id
      );

      if (index === -1) {
        return res.status(404).json({
          ok: false,
          message: "Produit introuvable."
        });
      }

      const deleted = products.splice(index, 1)[0];

      writeJson(FILES.products, products);

      broadcast("products_updated");

      res.json({
        ok: true,
        product: deleted
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message: "Erreur lors de la suppression."
      });
    }
  }
);

/* =========================================================
   ADMIN — COMMANDES
========================================================= */

app.get(
  "/api/admin/orders",
  requireAdmin,
  (req, res) => {
    const orders = readJson(
      FILES.orders,
      DEFAULT_ORDERS
    );

    orders.sort(
      (a, b) =>
        new Date(b.created_at) -
        new Date(a.created_at)
    );

    res.json(orders);
  }
);

/* =========================================================
   ADMIN — CHANGER STATUT COMMANDE
========================================================= */

app.patch(
  "/api/admin/orders/:id/status",
  requireAdmin,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = cleanString(
        req.body?.status,
        50
      );

      const allowedStatuses = [
        "nouvelle",
        "confirmee",
        "expediee",
        "livree",
        "annulee"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          ok: false,
          message: "Statut invalide."
        });
      }

      const orders = readJson(
        FILES.orders,
        DEFAULT_ORDERS
      );

      const order = orders.find(
        item => Number(item.id) === id
      );

      if (!order) {
        return res.status(404).json({
          ok: false,
          message: "Commande introuvable."
        });
      }

      order.status = status;

      writeJson(FILES.orders, orders);

      broadcast("order_updated", {
        id,
        status
      });

      res.json({
        ok: true,
        order
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message: "Erreur lors de la modification."
      });
    }
  }
);

/* =========================================================
   ADMIN — PROMOTION
========================================================= */

app.put(
  "/api/admin/promotion",
  requireAdmin,
  (req, res) => {
    const promotion = {
      title: cleanString(
        req.body?.title,
        200
      ),

      description: cleanString(
        req.body?.description,
        2000
      ),

      active: toBoolean(
        req.body?.active
      )
    };

    writeJson(
      FILES.promotion,
      promotion
    );

    broadcast("promotion_updated");

    res.json({
      ok: true,
      promotion
    });
  }
);

/* =========================================================
   ADMIN — SETTINGS
========================================================= */

app.put(
  "/api/admin/settings",
  requireAdmin,
  (req, res) => {
    const current = readJson(
      FILES.settings,
      DEFAULT_SETTINGS
    );

    const settings = {
      ...current,

      site_name:
        req.body?.site_name !== undefined
          ? cleanString(
              req.body.site_name,
              200
            )
          : current.site_name,

      phone:
        req.body?.phone !== undefined
          ? cleanString(
              req.body.phone,
              100
            )
          : current.phone,

      email:
        req.body?.email !== undefined
          ? cleanString(
              req.body.email,
              200
            )
          : current.email,

      hero_title:
        req.body?.hero_title !== undefined
          ? cleanString(
              req.body.hero_title,
              300
            )
          : current.hero_title,

      hero_description:
        req.body?.hero_description !== undefined
          ? cleanString(
              req.body.hero_description,
              2000
            )
          : current.hero_description
    };

    writeJson(
      FILES.settings,
      settings
    );

    broadcast("settings_updated");

    res.json({
      ok: true,
      settings
    });
  }
);

/* =========================================================
   ERREURS
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "Route introuvable."
  });
});

app.use((error, req, res, next) => {
  console.error("Erreur serveur:", error);

  res.status(500).json({
    ok: false,
    message: "Erreur interne du serveur."
  });
});

/* =========================================================
   DÉMARRAGE
========================================================= */

app.listen(PORT, () => {
  console.log("======================================");
  console.log(" LA GRÂCE SOLUTION API");
  console.log("======================================");
  console.log(`Serveur démarré sur le port ${PORT}`);
  console.log(`Frontend autorisé : ${FRONTEND_URL}`);
  console.log(`Mode : ${NODE_ENV}`);
  console.log("======================================");
});
