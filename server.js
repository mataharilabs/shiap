const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const https = require('https');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(__dirname, 'uploads', 'products');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dbFile = path.join(dataDir, 'shiap.db');
const db = new sqlite3.Database(dbFile);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '458099308260-6o72sp90ae82sgusf1uhh9vm403qa9sk.apps.googleusercontent.com';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `product-${req.params.id}-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname)));

app.get('/api/google-client-id', (req, res) => {
  res.json({ client_id: GOOGLE_CLIENT_ID });
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      country TEXT,
      company_name TEXT,
      tax_id TEXT,
      phone TEXT,
      business_scale TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      years_on_platform INTEGER DEFAULT 0,
      response_rate REAL DEFAULT 0,
      kyb_verified INTEGER DEFAULT 0,
      export_license INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS rfqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      product_name TEXT,
      description TEXT,
      quantity TEXT,
      target_price TEXT,
      origin TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_email TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      specifications TEXT,
      price REAL NOT NULL DEFAULT 0,
      moq INTEGER DEFAULT 50,
      image_emoji TEXT DEFAULT '📦',
      image_url TEXT DEFAULT NULL,
      variants TEXT,
      avg_rating REAL DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      units_sold INTEGER DEFAULT 0,
      wholesale_pricing TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`ALTER TABLE products ADD COLUMN image_url TEXT DEFAULT NULL`, [], () => {});

    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      buyer_email TEXT NOT NULL,
      supplier_email TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      tracking_number TEXT DEFAULT NULL,
      carrier TEXT DEFAULT NULL,
      eta TEXT DEFAULT NULL,
      payment_method TEXT DEFAULT NULL,
      payment_date TEXT DEFAULT NULL,
      production_update TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`ALTER TABLE orders ADD COLUMN tracking_number TEXT DEFAULT NULL`, [], () => {});
    db.run(`ALTER TABLE orders ADD COLUMN carrier TEXT DEFAULT NULL`, [], () => {});
    db.run(`ALTER TABLE orders ADD COLUMN eta TEXT DEFAULT NULL`, [], () => {});
    db.run(`ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT NULL`, [], () => {});
    db.run(`ALTER TABLE orders ADD COLUMN payment_date TEXT DEFAULT NULL`, [], () => {});
    db.run(`ALTER TABLE orders ADD COLUMN production_update TEXT DEFAULT NULL`, [], () => {});
    db.run(`ALTER TABLE orders ADD COLUMN shipping_address TEXT DEFAULT NULL`, [], () => {});
    db.run(`ALTER TABLE rfqs ADD COLUMN status TEXT DEFAULT 'open'`, [], () => {});

    db.run(`CREATE TABLE IF NOT EXISTS saved_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      reviewer_company TEXT,
      rating INTEGER NOT NULL,
      review_text TEXT,
      order_quantity INTEGER,
      country TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS product_faq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id)
    )`);
  });
}

initializeDatabase();

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) return reject(err); resolve(row); });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) return reject(err); resolve(rows); });
  });
}

app.post('/api/register', (req, res) => {
  const { role, first_name, last_name, email, password, country, company_name, tax_id, phone, business_scale } = req.body;
  if (!role || !email || !password) return res.status(400).json({ error: 'Role, email, and password are required.' });
  bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
    if (hashErr) return res.status(500).json({ error: 'Unable to hash password.' });
    const stmt = db.prepare(`INSERT INTO users (role, first_name, last_name, email, password, country, company_name, tax_id, phone, business_scale, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(role, first_name || '', last_name || '', email, hashedPassword, country || '', company_name || '', tax_id || '', phone || '', business_scale || '', role === 'admin' ? 'active' : 'pending', function (err) {
      if (err) return res.status(400).json({ error: 'Email already registered or invalid data.' });
      res.json({ message: 'Account created successfully.', userId: this.lastID });
    });
    stmt.finalize();
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    bcrypt.compare(password, user.password, (compareErr, match) => {
      if (compareErr) return res.status(500).json({ error: 'Database error.' });
      if (!match) return res.status(401).json({ error: 'Invalid credentials.' });
      res.json({ role: user.role, status: user.status, email: user.email, first_name: user.first_name || '', last_name: user.last_name || '', company_name: user.company_name || '' });
    });
  });
});

app.get('/api/user', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  db.get('SELECT id, role, first_name, last_name, email, company_name, country, tax_id, phone, business_scale, status, created_at FROM users WHERE email = ?', [email], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  });
});

app.get('/api/dashboard/buyer', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const user = await dbGet('SELECT id, role, first_name, last_name, email, company_name, status FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const activeOrdersRow = await dbGet('SELECT COUNT(*) AS count FROM orders WHERE buyer_email = ?', [email]);
    const runningRfqsRow = await dbGet('SELECT COUNT(*) AS count FROM rfqs WHERE user_email = ?', [email]);
    const totalSpentRow = await dbGet('SELECT COALESCE(SUM(total_price), 0) AS total_spent FROM orders WHERE buyer_email = ?', [email]);
    const savedProductsRow = await dbGet('SELECT COUNT(*) AS count FROM saved_products WHERE user_email = ?', [email]);
    res.json({ user, active_orders: activeOrdersRow.count || 0, running_rfqs: runningRfqsRow.count || 0, total_spent: totalSpentRow.total_spent || 0, saved_products: savedProductsRow.count || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch buyer dashboard data.' });
  }
});

app.get('/api/dashboard/admin', async (req, res) => {
  try {
    const totalUsersRow = await dbGet('SELECT COUNT(*) AS count FROM users');
    const totalBuyersRow = await dbGet('SELECT COUNT(*) AS count FROM users WHERE role = ?', ['buyer']);
    const totalSuppliersRow = await dbGet('SELECT COUNT(*) AS count FROM users WHERE role = ?', ['supplier']);
    const activeSuppliersRow = await dbGet('SELECT COUNT(*) AS count FROM users WHERE role = ? AND status = ?', ['supplier', 'active']);
    const totalProductsRow = await dbGet('SELECT COUNT(*) AS count FROM products');
    const totalOrdersRow = await dbGet('SELECT COUNT(*) AS count FROM orders');
    const totalRfqsRow = await dbGet('SELECT COUNT(*) AS count FROM rfqs');
    const totalRevenueRow = await dbGet('SELECT COALESCE(SUM(total_price), 0) AS total_revenue FROM orders');
    res.json({ total_users: totalUsersRow.count || 0, total_buyers: totalBuyersRow.count || 0, total_suppliers: totalSuppliersRow.count || 0, active_suppliers: activeSuppliersRow.count || 0, total_products: totalProductsRow.count || 0, total_orders: totalOrdersRow.count || 0, total_rfqs: totalRfqsRow.count || 0, total_revenue: totalRevenueRow.total_revenue || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch admin dashboard data.' });
  }
});

app.get('/api/dashboard/supplier', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const supplier = await dbGet('SELECT id, role, first_name, last_name, company_name, email, status FROM users WHERE email = ? AND role = ?', [email, 'supplier']);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found.' });
    const totalSalesRow = await dbGet('SELECT COALESCE(SUM(total_price), 0) AS total_sales FROM orders WHERE supplier_email = ?', [email]);
    const newOrdersRow = await dbGet('SELECT COUNT(*) AS count FROM orders WHERE supplier_email = ? AND status IN (?, ?)', [email, 'new', 'paid']);
    const rfqLeadsRow = await dbGet('SELECT COUNT(*) AS count FROM rfqs');
    const productsCountRow = await dbGet('SELECT COUNT(*) AS count FROM products WHERE supplier_email = ?', [email]);
    const totalRevenueRow = await dbGet('SELECT COALESCE(SUM(total_price), 0) AS total_revenue FROM orders WHERE supplier_email = ?', [email]);
    res.json({ supplier, total_sales: totalSalesRow.total_sales || 0, new_orders: newOrdersRow.count || 0, rfq_leads: rfqLeadsRow.count || 0, products_count: productsCountRow.count || 0, wallet_balance: (totalRevenueRow.total_revenue || 0) * 0.8 });
  } catch (error) {
    res.status(500).json({ error: 'Unable to fetch supplier dashboard data.' });
  }
});

function verifyGoogleIdToken(idToken) {
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error('Invalid Google token.'));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

app.post('/api/google-signin', async (req, res) => {
  const { id_token } = req.body;
  if (!id_token) return res.status(400).json({ error: 'Google ID token is required.' });
  try {
    const payload = await verifyGoogleIdToken(id_token);
    const email = payload.email;
    if (!email) return res.status(400).json({ error: 'Google account does not provide an email.' });
    if (payload.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Google token audience mismatch.' });
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error.' });
      if (user) return res.json({ role: user.role, status: user.status, email: user.email, first_name: user.first_name || '', last_name: user.last_name || '', company_name: user.company_name || '' });
      const role = 'buyer';
      const firstName = payload.given_name || '';
      const lastName = payload.family_name || '';
      const randomPassword = crypto.randomBytes(16).toString('hex');
      bcrypt.hash(randomPassword, 10, (hashErr, hashedPassword) => {
        if (hashErr) return res.status(500).json({ error: 'Unable to hash password.' });
        const stmt = db.prepare(`INSERT INTO users (role, first_name, last_name, email, password, country, company_name, tax_id, phone, business_scale, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(role, firstName, lastName, email, hashedPassword, '', '', '', '', '', 'active', function (insertErr) {
          if (insertErr) return res.status(500).json({ error: 'Unable to create Google user.' });
          res.json({ role, status: 'active', email, first_name: firstName, last_name: lastName, company_name: '' });
        });
        stmt.finalize();
      });
    });
  } catch (error) {
    res.status(401).json({ error: 'Unable to verify Google token.' });
  }
});

app.post('/api/rfq', (req, res) => {
  const { email, product_name, description, quantity, target_price, origin } = req.body;
  if (!email || !product_name || !description) return res.status(400).json({ error: 'Email, product name, and description are required.' });
  const stmt = db.prepare(`INSERT INTO rfqs (user_email, product_name, description, quantity, target_price, origin) VALUES (?, ?, ?, ?, ?, ?)`);
  stmt.run(email, product_name, description, quantity || '', target_price || '', origin || '', function (err) {
    if (err) return res.status(500).json({ error: 'Unable to submit RFQ.' });
    res.json({ message: 'RFQ submitted successfully.', rfqId: this.lastID });
  });
  stmt.finalize();
});

app.get('/api/users', (req, res) => {
  db.all('SELECT id, role, first_name, last_name, email, country, company_name, status, created_at FROM users ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Unable to fetch users.' });
    res.json(rows);
  });
});

app.get('/api/rfqs', (req, res) => {
  db.all(`
    SELECT r.*, u.company_name AS buyer_company, u.country AS buyer_country, u.status AS buyer_status
    FROM rfqs r
    LEFT JOIN users u ON r.user_email = u.email
    ORDER BY r.created_at DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Unable to fetch RFQs.' });
    res.json(rows);
  });
});

app.get('/api/rfqs/buyer', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const rfqs = await dbAll('SELECT * FROM rfqs WHERE user_email = ? ORDER BY created_at DESC', [email]);
    res.json(rfqs);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch RFQs.' });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await dbAll(`
      SELECT p.id, p.name, p.category, p.price, p.moq, p.image_emoji, p.image_url,
        p.avg_rating, p.review_count, p.units_sold, p.status, p.supplier_email,
        COALESCE(u.company_name, '') AS supplier_name,
        COALESCE(u.country, 'China') AS supplier_country,
        p.created_at
      FROM products p
      LEFT JOIN users u ON p.supplier_email = u.email
      WHERE p.status = 'active'
      ORDER BY p.created_at DESC
    `);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch products.' });
  }
});

app.get('/api/products/admin', async (req, res) => {
  try {
    const products = await dbAll(`
      SELECT p.*, u.company_name AS supplier_name, u.country AS supplier_country
      FROM products p
      LEFT JOIN users u ON p.supplier_email = u.email
      ORDER BY p.created_at DESC
    `);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch products.' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const product = await dbGet(`
      SELECT p.id, p.name, p.category, p.description, p.specifications, p.price, p.moq,
        p.image_emoji, p.image_url, p.variants, p.avg_rating, p.review_count, p.units_sold, p.wholesale_pricing,
        p.status, p.supplier_email, p.created_at,
        u.id as supplier_id, u.company_name as supplier_name, u.country as supplier_country,
        u.years_on_platform, u.response_rate, u.kyb_verified, u.export_license
      FROM products p
      LEFT JOIN users u ON p.supplier_email = u.email
      WHERE p.id = ?
    `, [id]);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    const reviews = await dbAll('SELECT id, reviewer_company, rating, review_text, order_quantity, country, created_at FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC', [id]);
    const faqs = await dbAll('SELECT id, question, answer FROM product_faq WHERE product_id = ? ORDER BY id ASC', [id]);
    if (product.specifications) { try { product.specifications = JSON.parse(product.specifications); } catch (e) { product.specifications = []; } }
    if (product.variants) { try { product.variants = JSON.parse(product.variants); } catch (e) { product.variants = []; } }
    if (product.wholesale_pricing) { try { product.wholesale_pricing = JSON.parse(product.wholesale_pricing); } catch (e) { product.wholesale_pricing = []; } }
    const supplierOrders = await dbGet('SELECT COUNT(*) as total_orders FROM orders WHERE supplier_email = ?', [product.supplier_email]);
    product.review_count = reviews.length;
    product.reviews = reviews;
    product.faqs = faqs;
    product.supplier_total_orders = supplierOrders?.total_orders || 0;
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch product.' });
  }
});

app.get('/api/orders/buyer', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const orders = await dbAll(`
      SELECT o.*, p.name AS product_name, p.image_emoji,
        u.company_name AS supplier_company, u.country AS supplier_country
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      LEFT JOIN users u ON o.supplier_email = u.email
      WHERE o.buyer_email = ?
      ORDER BY o.created_at DESC
    `, [email]);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch orders.' });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status, buyer_email } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required.' });
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE orders SET status=? WHERE id=? AND buyer_email=?', [status, id, buyer_email],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ message: 'Order status updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update order status.' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { buyer_email, items, shipping_address, payment_method } = req.body;
  if (!buyer_email || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'buyer_email and items[] are required.' });
  try {
    const results = [];
    const paymentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    for (const item of items) {
      const orderNumber = `ORD-${new Date().getFullYear()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const lastId = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO orders (order_number, buyer_email, supplier_email, product_id, quantity, total_price, status, payment_method, payment_date, shipping_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderNumber, buyer_email, item.supplier_email, item.product_id, item.quantity, item.total_price, 'paid', payment_method || 'Xendit Virtual Account', paymentDate, shipping_address || null],
          function (err) { if (err) reject(err); else resolve(this.lastID); }
        );
      });
      results.push({ order_number: orderNumber, id: lastId });
    }
    res.json({ orders: results });
  } catch (err) {
    res.status(500).json({ error: 'Unable to create orders.' });
  }
});

app.post('/api/products/:id/review', async (req, res) => {
  const product_id = req.params.id;
  const { reviewer_company, rating, review_text, order_quantity, country } = req.body;
  if (!rating) return res.status(400).json({ error: 'Rating is required.' });
  try {
    const lastId = await new Promise((resolve, reject) => {
      db.run('INSERT INTO product_reviews (product_id, reviewer_company, rating, review_text, order_quantity, country) VALUES (?, ?, ?, ?, ?, ?)',
        [product_id, reviewer_company || '', rating, review_text || '', order_quantity || null, country || ''],
        function (err) { if (err) reject(err); else resolve(this.lastID); });
    });
    res.json({ message: 'Review submitted.', reviewId: lastId });
  } catch (err) {
    res.status(500).json({ error: 'Unable to submit review.' });
  }
});

app.get('/api/supplier/products', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const products = await dbAll('SELECT * FROM products WHERE supplier_email = ? ORDER BY created_at DESC', [email]);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch supplier products.' });
  }
});

app.post('/api/products', async (req, res) => {
  const { supplier_email, name, category, description, moq } = req.body;
  if (!supplier_email || !name) return res.status(400).json({ error: 'supplier_email and name are required.' });
  try {
    const result = await new Promise((resolve, reject) => {
      db.run('INSERT INTO products (supplier_email, name, category, description, moq, price, image_emoji, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [supplier_email, name, category || '', description || '', moq || 50, 0, '📦', 'pending'],
        function (err) { if (err) reject(err); else resolve(this.lastID); });
    });
    res.json({ message: 'Product submitted for review.', productId: result });
  } catch (err) {
    res.status(500).json({ error: 'Unable to create product.' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const id = req.params.id;
  const { name, category, description, moq, price, image_emoji, image_url, status, supplier_email, variants } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name is required.' });
  const variantsJson = Array.isArray(variants) ? JSON.stringify(variants) : (variants || null);
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE products SET name=?, category=?, description=?, moq=?, price=?, image_emoji=?, image_url=?, status=?, variants=? WHERE id=? AND supplier_email=?',
        [name, category || '', description || '', moq || 50, price || 0, image_emoji || '📦', image_url || null, status || 'pending', variantsJson, id, supplier_email],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ message: 'Product updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update product.' });
  }
});

app.put('/api/admin/products/:id', async (req, res) => {
  const id = req.params.id;
  const { name, category, description, moq, price, image_emoji, image_url, status, variants } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name is required.' });
  const variantsJson = Array.isArray(variants) ? JSON.stringify(variants) : (variants || null);
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE products SET name=?, category=?, description=?, moq=?, price=?, image_emoji=?, image_url=?, status=?, variants=? WHERE id=?',
        [name, category || '', description || '', moq || 50, price || 0, image_emoji || '📦', image_url || null, status || 'active', variantsJson, id],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ message: 'Product updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update product.' });
  }
});

app.post('/api/products/:id/image', upload.single('image'), async (req, res) => {
  const id = req.params.id;
  const { supplier_email } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
  const imageUrl = `/uploads/products/${req.file.filename}`;
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE products SET image_url=? WHERE id=? AND supplier_email=?', [imageUrl, id, supplier_email],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ image_url: imageUrl });
  } catch (err) {
    res.status(500).json({ error: 'Unable to save image.' });
  }
});

// Seed sample data
app.get('/api/seed', (req, res) => {
  db.serialize(() => {
    db.run('DELETE FROM product_faq');
    db.run('DELETE FROM product_reviews');
    db.run('DELETE FROM orders');
    db.run('DELETE FROM saved_products');
    db.run('DELETE FROM products');
    db.run('DELETE FROM rfqs');
    db.run("DELETE FROM sqlite_sequence WHERE name IN ('products','orders','product_reviews','product_faq','rfqs','saved_products','users')");

    const testUsers = [
      { email: 'testbuyer@shiap.com', role: 'buyer', name: 'Budi', last: 'Santoso', company: 'PT Maju Jaya', country: 'Indonesia', status: 'active', years: 0, response: 0, kyb: 0, exp: 0, cat: '2026-06-10T08:00:00' },
      { email: 'supplier1@shiap.com', role: 'supplier', name: 'Supplier', last: 'One', company: 'Shenzhen TechPro Ltd.', country: 'China', status: 'active', years: 8, response: 98, kyb: 1, exp: 1, cat: '2026-06-08T09:00:00' },
      { email: 'supplier2@shiap.com', role: 'supplier', name: 'Supplier', last: 'Two', company: 'Yiwu Goods Trading', country: 'China', status: 'active', years: 5, response: 95, kyb: 1, exp: 1, cat: '2026-06-05T10:00:00' },
      { email: 'supplier3@shiap.com', role: 'supplier', name: 'Supplier', last: 'Three', company: 'Guangzhou Bright Co.', country: 'China', status: 'active', years: 3, response: 92, kyb: 1, exp: 0, cat: '2026-06-01T11:00:00' },
      { email: 'admin@shiap.com', role: 'admin', name: 'Admin', last: 'User', company: 'SHIAP', country: 'Indonesia', status: 'active', years: 0, response: 0, kyb: 0, exp: 0, cat: '2026-05-01T08:00:00' },
      { email: 'newbuyer1@example.com', role: 'buyer', name: 'Rika', last: 'Kusuma', company: 'PT Indo Textile', country: 'Indonesia', status: 'pending', years: 0, response: 0, kyb: 0, exp: 0, cat: '2026-06-24T14:00:00' },
      { email: 'newsupplier1@example.com', role: 'supplier', name: 'Ahmad', last: 'Jawid', company: 'Guangzhou Textile Co.', country: 'China', status: 'pending', years: 0, response: 0, kyb: 0, exp: 0, cat: '2026-06-23T10:00:00' },
      { email: 'newsupplier2@example.com', role: 'supplier', name: 'Wei', last: 'Zhang', company: 'Dongguan CNC Works', country: 'China', status: 'pending', years: 0, response: 0, kyb: 0, exp: 0, cat: '2026-06-22T09:00:00' }
    ];

    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUserStmt = db.prepare(`INSERT OR REPLACE INTO users (role, first_name, last_name, email, password, company_name, country, status, years_on_platform, response_rate, kyb_verified, export_license, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    testUsers.forEach(u => {
      insertUserStmt.run(u.role, u.name, u.last, u.email, hashedPassword, u.company, u.country || 'Indonesia', u.status, u.years, u.response, u.kyb, u.exp, u.cat || new Date().toISOString());
    });
    insertUserStmt.finalize();

    const products = [
      { supplier: 'supplier1@shiap.com', name: 'Electronic Components', category: 'Electronics', price: 150, desc: 'Premium quality electronic components suitable for industrial applications.', specs: JSON.stringify(['High precision tolerance', 'RoHS compliant', 'Bulk packaging available', 'Operating temp: -40C to +85C']), moq: 50, emoji: '💡', variants: JSON.stringify(['Standard', 'Premium']), rating: 4.8, reviews: 124, sold: 5200, wholesale: JSON.stringify([{qty:'50-199',price:150},{qty:'200+',price:135}]) },
      { supplier: 'supplier1@shiap.com', name: 'Industrial Parts', category: 'Hardware', price: 250, desc: 'Heavy-duty industrial parts for manufacturing.', specs: JSON.stringify(['Durable construction', 'Industrial grade', 'Long lifespan']), moq: 100, emoji: '⚙️', variants: JSON.stringify(['Standard', 'Premium']), rating: 4.5, reviews: 87, sold: 3100, wholesale: JSON.stringify([{qty:'50-99',price:250},{qty:'100+',price:225}]) },
      { supplier: 'supplier1@shiap.com', name: 'Plastic Polymers', category: 'Raw Materials', price: 75, desc: 'High quality plastic polymers for various applications.', specs: JSON.stringify(['Recyclable', 'Food-grade', 'Temperature resistant']), moq: 500, emoji: '🧪', variants: JSON.stringify(['Type A', 'Type B']), rating: 4.3, reviews: 56, sold: 8900, wholesale: JSON.stringify([{qty:'500-999',price:75},{qty:'1000+',price:68}]) },
      { supplier: 'supplier2@shiap.com', name: 'Steel Fasteners', category: 'Hardware', price: 45, desc: 'Premium steel fasteners for construction and manufacturing.', specs: JSON.stringify(['Stainless steel', 'Corrosion resistant', 'High tensile strength']), moq: 1000, emoji: '🔩', variants: JSON.stringify(['M8', 'M10', 'M12']), rating: 4.6, reviews: 234, sold: 15400, wholesale: JSON.stringify([{qty:'1000-4999',price:45},{qty:'5000+',price:40}]) },
      { supplier: 'supplier2@shiap.com', name: 'Textile Fabrics', category: 'Textiles', price: 120, desc: 'Premium textile fabrics for apparel and industrial use.', specs: JSON.stringify(['100% cotton option', 'Washable', 'Fade resistant']), moq: 50, emoji: '🧵', variants: JSON.stringify(['Cotton', 'Polyester blend']), rating: 4.7, reviews: 189, sold: 6700, wholesale: JSON.stringify([{qty:'50-199',price:120},{qty:'200+',price:105}]) },
      { supplier: 'supplier1@shiap.com', name: 'Industrial Network Switch 24-Port Managed Gigabit', category: 'Electronics', price: 15, desc: 'Enterprise-grade 24-port managed gigabit switch with 4 SFP uplinks. Layer 2/3 management with VLAN, QoS, Link Aggregation, and RSTP/MSTP support.', specs: JSON.stringify(['24 x Gigabit RJ45 + 4 x SFP uplinks','Non-blocking 56Gbps switching capacity','Supports 802.1Q VLAN, 802.3ad LACP','Web-based + CLI management','Operating temp: -40C to +85C','FCC, CE, RoHS certified']), moq: 50, emoji: '🖥️', variants: JSON.stringify(['24-Port Standard','24-Port + PoE','48-Port']), rating: 4.9, reviews: 312, sold: 8400, wholesale: JSON.stringify([{qty:'50-199',price:15},{qty:'200-499',price:13.5},{qty:'500+',price:12}]) },
      { supplier: 'supplier2@shiap.com', name: 'Stainless Steel Double Wall Water Bottle 500ml', category: 'Consumer Goods', price: 2.2, desc: 'Premium 500ml double-wall vacuum insulated stainless steel water bottle. Keeps liquids hot 12h, cold 24h. BPA-free food-grade 304 stainless steel.', specs: JSON.stringify(['Capacity: 500ml','Material: 304 stainless steel','Keeps hot 12h / cold 24h','BPA-free','Leak-proof lid','Custom color & logo available']), moq: 100, emoji: '🧴', variants: JSON.stringify(['White','Black','Silver','Custom Color']), rating: 4.7, reviews: 421, sold: 32000, wholesale: JSON.stringify([{qty:'100-499',price:2.2},{qty:'500-999',price:1.95},{qty:'1000+',price:1.75}]) },
      { supplier: 'supplier3@shiap.com', name: 'LED Panel Light 60x60cm 40W Cool White', category: 'Electronics', price: 11, desc: 'High-efficiency 40W LED panel light 600x600mm. Replaces 90W fluorescent fixtures. Suitable for offices, schools, and commercial spaces.', specs: JSON.stringify(['Power: 40W','Size: 600x600mm','Color temp: 6000K Cool White','Lumen: 4000lm','Lifespan: 50,000 hours','CE, RoHS, EMC certified']), moq: 50, emoji: '💡', variants: JSON.stringify(['4000K Neutral White','6000K Cool White','RGB Dimmable']), rating: 4.6, reviews: 187, sold: 12800, wholesale: JSON.stringify([{qty:'50-199',price:11},{qty:'200-499',price:9.5},{qty:'500+',price:8.5}]) }
    ];

    const insertProductStmt = db.prepare(`INSERT INTO products (supplier_email, name, category, description, specifications, price, moq, image_emoji, variants, avg_rating, review_count, units_sold, wholesale_pricing, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    products.forEach(p => {
      insertProductStmt.run(p.supplier, p.name, p.category, p.desc, p.specs, p.price, p.moq, p.emoji, p.variants, p.rating, p.reviews, p.sold, p.wholesale, 'active');
    });
    insertProductStmt.finalize();

    // Pending products awaiting admin approval
    const pendingProducts = [
      { supplier: 'newsupplier1@example.com', name: 'Cotton Yarn Ring Spun 20s Natural White', category: 'Textiles', price: 2.8, desc: 'Ring spun cotton yarn 20s count, natural white. Suitable for weaving and knitting applications.', moq: 1000, emoji: '🧵' },
      { supplier: 'newsupplier2@example.com', name: 'CNC Milling Machine 3-Axis Vertical 800mm', category: 'Machinery', price: 7500, desc: 'Compact 3-axis vertical CNC milling machine with 800x500x500mm travel.', moq: 1, emoji: '⚙️' }
    ];
    const insertPendingStmt = db.prepare(`INSERT INTO products (supplier_email, name, category, description, price, moq, image_emoji, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    pendingProducts.forEach(p => insertPendingStmt.run(p.supplier, p.name, p.category, p.desc, p.price, p.moq, p.emoji, 'pending'));
    insertPendingStmt.finalize();

    // Orders
    db.run(`INSERT OR REPLACE INTO orders (order_number, buyer_email, supplier_email, product_id, quantity, total_price, status, tracking_number, carrier, eta, payment_method, payment_date, production_update, created_at) VALUES ('ORD-2026-0445','testbuyer@shiap.com','supplier1@shiap.com',6,200,3000,'in_transit','CNPVG-2026-8847342','Yusen Logistics','Jul 5-8, 2026','Xendit Virtual Account','Jun 15, 2026',NULL,'2026-06-10T08:00:00')`);
    db.run(`INSERT OR REPLACE INTO orders (order_number, buyer_email, supplier_email, product_id, quantity, total_price, status, tracking_number, carrier, eta, payment_method, payment_date, production_update, created_at) VALUES ('ORD-2026-0438','testbuyer@shiap.com','supplier2@shiap.com',7,1000,2200,'completed',NULL,NULL,NULL,'Escrow Released','May 28, 2026',NULL,'2026-05-15T08:00:00')`);
    db.run(`INSERT OR REPLACE INTO orders (order_number, buyer_email, supplier_email, product_id, quantity, total_price, status, tracking_number, carrier, eta, payment_method, payment_date, production_update, created_at) VALUES ('ORD-2026-0441','testbuyer@shiap.com','supplier3@shiap.com',8,500,5500,'producing',NULL,NULL,'Jul 2, 2026','Xendit Virtual Account','Jun 18, 2026','Production 60% complete. Sample QC photos shared in chat. Expected dispatch Jun 30.','2026-06-18T08:00:00')`);
    db.run(`INSERT OR REPLACE INTO orders (order_number, buyer_email, supplier_email, product_id, quantity, total_price, status, tracking_number, carrier, eta, payment_method, payment_date, production_update, created_at) VALUES ('ORD-2026-0398','testbuyer@shiap.com','supplier2@shiap.com',5,200,4500,'disputed','YW-2026-003312','YunExpress',NULL,'Xendit Virtual Account','May 10, 2026',NULL,'2026-05-10T08:00:00')`);

    // Reviews — product 1: Electronic Components (22)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'PT Maju Jaya',5,'Excellent quality components for our factory assembly line. All specs matched the datasheet perfectly.',100,'Indonesia','2026-06-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'AsiaBridge Networks',5,'Great product for the price. Passed all our QC tests on the first attempt with zero rejects.',50,'Malaysia','2026-06-02T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Singapore Tech Supplies',4,'Good components overall, slight delay on delivery but quality is solid. Will order again.',200,'Singapore','2026-05-20T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Bangkok Electronics Hub',5,'Very reliable. Components passed all incoming inspection. Lead time is competitive versus local distributors.',150,'Thailand','2026-05-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Hanoi Tech Partners',5,'Superb packaging. Not a single component damaged in transit. Already on our approved vendor list.',250,'Vietnam','2026-04-28T11:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Dhaka Electronics',4,'Good quality, consistent with the certificate of conformance provided. Minor delay on customs clearance.',300,'Bangladesh','2026-04-15T09:30:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Cebu Robotics Lab',5,'Components are exactly as specified. Tolerances are tight and consistent across all 200 units sampled.',200,'Philippines','2026-04-01T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Chennai PCB Works',4,'Reliable supply. We have ordered 3 times and quality is consistent. Response time from supplier is good.',400,'India','2026-03-20T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Colombo Automation',5,'Excellent for our IoT device assembly. Failure rate is below 0.1% which is outstanding for this price point.',150,'Sri Lanka','2026-03-10T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Ho Chi Minh PCB Assembly',3,'Acceptable quality but 3% rejection rate on incoming inspection. Supplier offered partial credit after dispute.',300,'Vietnam','2026-02-25T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Jakarta Manufacturing',5,'Perfect for our SMD assembly line. Consistency across batches is excellent. Third reorder and still satisfied.',500,'Indonesia','2026-02-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Manila Electronics Co.',4,'Good quality and fair price. Outer packaging could be sturdier but all components arrived intact.',100,'Philippines','2026-01-28T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Kuala Lumpur Components',5,'Fast shipment and excellent documentation. CoC and RoHS certificates provided without being asked.',350,'Malaysia','2026-01-15T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Karachi Electro Parts',2,'Batch had higher than declared failure rate. Took 4 weeks to resolve. Quality control inconsistent.',200,'Pakistan','2025-12-28T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'PT Nusantara Electronics',5,'Very good quality. We use these in our consumer electronics assembly and customer complaint rate dropped significantly.',600,'Indonesia','2025-12-15T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Taipei Sourcing Agent',4,'Good product. Delivery from China to Taiwan was 8 days which is reasonable. Will continue ordering.',250,'Taiwan','2025-12-01T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Penang Industrial Supply',5,'Top quality for the price. ESD packaging is proper and components are clearly labeled. Highly recommended.',180,'Malaysia','2025-11-20T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Mumbai Tech Imports',4,'Reliable supplier. Always ships on time and quality is consistent. Only wish they had a wider product range.',400,'India','2025-11-05T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Bandung Electronics',5,'We switched from our previous supplier to this one and quality noticeably improved. Zero customer returns since.',150,'Indonesia','2025-10-22T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Singapore Micro Systems',4,'Good quality and competitive price. Supplier is responsive and helped resolve a minor labeling discrepancy quickly.',200,'Singapore','2025-10-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Surabaya Tech Parts',5,'Excellent batch consistency. We ran 100% incoming inspection on first order and now only do sampling. Very trustworthy.',300,'Indonesia','2025-09-25T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (1,'Colombo Tech Hub',3,'Average quality. Some units had cosmetic defects though functional. Price is good but quality could improve.',100,'Sri Lanka','2025-09-10T09:00:00')`);
    // Reviews — product 2: Industrial Parts (25)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'PT Sumber Rejeki Textiles',5,'Outstanding quality. The fabric arrived well-packaged and all 500 meters were consistent. Our production line has zero wastage.',500,'Indonesia','2026-06-15T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Bangkok Garment Co.',5,'Very reliable supplier. Lead time was as promised and the cotton yarn met all our GSM specs. Already placed a second order.',1000,'Thailand','2026-06-08T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Dhaka Apparel Ltd.',4,'Good product overall. Slightly delayed shipment but the quality compensates. Tensile strength is solid for ring-spun 20s.',2000,'Bangladesh','2026-05-28T11:30:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Ho Chi Minh Textile Hub',5,'Top-notch raw material. We have been sourcing from three suppliers and this one is consistently the best for natural white yarn.',800,'Vietnam','2026-05-20T08:45:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Manila Fabrics Inc.',3,'Decent quality but one pallet had some moisture damage. Supplier resolved the claim quickly and resent the affected quantity.',500,'Philippines','2026-05-12T14:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Chennai Spinning Mills',5,'Excellent uniformity across all 1000 kg. Count variation is within 2% which is great for ring-spun. Perfect for our export garments.',1000,'India','2026-05-05T07:30:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Kuala Lumpur Weaving',4,'Solid product. We compared samples from 5 suppliers and this had the best hand feel. Minor issue with labelling but sorted fast.',300,'Malaysia','2026-04-22T10:15:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'PT Indo Garment Prima',5,'Already our third bulk purchase. Price is competitive and quality is consistent every batch. Highly recommended for medium-scale mills.',2000,'Indonesia','2026-04-10T13:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Colombo Export Textiles',5,'Fast response from the supplier team. Moisture content was well within spec. Packing was professional for sea freight.',600,'Sri Lanka','2026-03-28T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Hanoi Industrial Textile',2,'One batch had nep count above our tolerance. Took 3 weeks to resolve. Quality control needs improvement for export standard orders.',400,'Vietnam','2026-03-15T16:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Karachi Cotton House',5,'Great value for 20s ring spun. We source 3 tons per month now. Supplier is very accommodating on packaging customization.',3000,'Pakistan','2026-03-02T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Surabaya Textile Group',4,'Good tensile strength and softness. We use this for branded T-shirt production. The natural white shade is very clean.',700,'Indonesia','2026-02-18T11:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Penang Yarn Trading',5,'Exceptional consistency across multiple shipments. Our knitting machines run smoother with this yarn vs other suppliers.',500,'Malaysia','2026-02-05T09:30:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Cebu Woven Products',4,'Good quality for the price point. Delivery was punctual. Packing could be improved to reduce breakage on outer layers.',200,'Philippines','2026-01-20T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Mumbai Hosiery Mills',5,'We have tested 8 suppliers over 2 years. This one ranks top for ring-spun 20s natural white. Reordering quarterly.',1500,'India','2026-01-05T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'PT Batik Alam Indah',5,'Superb quality and consistent weight across all rolls. Our cutting wastage dropped 8% after switching to this supplier.',800,'Indonesia','2025-12-20T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Taipei Fashion Imports',4,'Good yarn quality for the price. Shipping to Taiwan took 12 days which is acceptable. Will reorder next quarter.',400,'Taiwan','2025-12-05T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Singapore Textile Traders',5,'Consistent lot-to-lot quality is what keeps us coming back. No shade variation between batches unlike other suppliers.',600,'Singapore','2025-11-22T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Yangon Garment Factory',4,'Quality is good and price is very competitive. Communication with supplier could be faster but product delivers.',1000,'Myanmar','2025-11-08T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Bandung Textile Mill',5,'We source 5 tons monthly now. The supply chain is reliable and quality never disappoints. Best supplier on this platform.',5000,'Indonesia','2025-10-25T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Lahore Fabric House',3,'Acceptable quality but count variation was higher than spec on one delivery. Supplier was responsive to the complaint.',800,'Pakistan','2025-10-10T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Phnom Penh Garments',5,'Excellent quality for export garment production. EU buyers have not raised any fiber quality complaints since switching.',1200,'Cambodia','2025-09-28T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Medan Weaving Co.',4,'Good product and competitive price. Lead time is 18 days to Sumatra which is reasonable for sea freight.',600,'Indonesia','2025-09-15T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Colombo Knit Factory',5,'Perfect for our knitting machines. Yarn runs clean with minimal breakage. Production efficiency improved noticeably.',900,'Sri Lanka','2025-09-01T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (2,'Chittagong Export Mills',4,'Solid quality and good price. We have been ordering quarterly for a year. Documentation for customs is always complete.',2000,'Bangladesh','2025-08-18T08:00:00')`);
    // Reviews — product 3: Plastic Polymers (12)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'PT Plastik Nusantara',5,'Excellent food-grade polymer. Passed all our migration testing for food contact applications. Will order again.',500,'Indonesia','2026-06-05T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Bangkok Packaging Co.',4,'Good quality PP resin. Melt flow index is consistent with spec. Minor color variation in one lot but supplier replaced it.',1000,'Thailand','2026-05-15T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Manila Plastics Inc.',5,'Perfect for our injection molding operation. Shrinkage rate is very consistent and we have almost eliminated scrap.',800,'Philippines','2026-04-28T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Singapore Polymer Traders',4,'Reliable supply chain. Packaging is good for long-term storage. Documentation is complete and accurate.',600,'Singapore','2026-04-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Kuala Lumpur Plastics',5,'Great value. We compared 4 suppliers and this offers the best consistency at this price point.',700,'Malaysia','2026-03-22T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Ho Chi Minh Packaging',3,'Acceptable quality but one shipment had higher moisture content than spec. Took 2 weeks to replace.',500,'Vietnam','2026-03-05T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Jakarta Polymer Hub',5,'Excellent material for our automotive parts production. Passed all heat resistance tests easily.',900,'Indonesia','2026-02-18T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Cebu Manufacturing',4,'Good material and competitive price. Lead time is consistent at 14 days. Will continue ordering.',400,'Philippines','2026-02-01T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Chennai Polymer Works',5,'Consistent MFI across batches which is critical for our continuous extrusion process. Very satisfied.',1200,'India','2026-01-15T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Bandung Plastics',4,'Good recyclable material for our eco-friendly product line. Certificate of recyclability provided promptly.',300,'Indonesia','2025-12-28T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Surabaya Packaging',5,'We switched to this supplier 6 months ago and have not looked back. Quality is better and price is lower.',800,'Indonesia','2025-12-10T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (3,'Penang Industrial',2,'Two consecutive batches had quality issues. Contamination detected during processing. Response was slow.',500,'Malaysia','2025-11-25T09:00:00')`);
    // Reviews — product 4: Steel Fasteners (18)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Vietnam Industrial',5,'Perfect fasteners for our construction project. Dimensional accuracy is excellent and tensile strength tested well.',5000,'Vietnam','2026-06-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'PT Konstruksi Jaya',5,'High quality stainless fasteners. Passed our corrosion resistance test in salt spray chamber for 500 hours.',10000,'Indonesia','2026-05-25T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Bangkok Steel Trading',4,'Good fasteners and competitive price. Slight delay on delivery but quality is consistent with spec.',8000,'Thailand','2026-05-10T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Manila Construction Supply',5,'Excellent quality for marine applications. Passed all our saltwater corrosion testing. Will reorder regularly.',3000,'Philippines','2026-04-22T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Singapore Engineering',4,'Good quality fasteners with proper certification. Documentation for our ISO audit was complete and accurate.',5000,'Singapore','2026-04-05T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Kuala Lumpur Metalworks',5,'We have been ordering for 2 years. Quality never drops and price is consistently competitive.',15000,'Malaysia','2026-03-20T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Ho Chi Minh Steel Co.',3,'Average quality. Some M10 bolts had head cracking during installation at high torque. Supplier offered replacement.',2000,'Vietnam','2026-03-05T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Jakarta Fabricators',5,'Perfect for our structural steel work. All dimensions within ISO tolerance. Third order and still very satisfied.',7000,'Indonesia','2026-02-18T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Chennai Metal Supplies',4,'Good quality for the price. Hardness testing passed on all samples. Fast delivery from China to India.',6000,'India','2026-02-01T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Cebu Shipyard Parts',5,'Excellent corrosion resistance for our marine repair work. We now specify this supplier in our procurement standard.',4000,'Philippines','2026-01-15T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Surabaya Industrial',4,'Very good fasteners. Packaging is good and prevents damage during transit. Supplier is reliable.',8000,'Indonesia','2025-12-28T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Penang Manufacturing',5,'Top grade stainless steel. We use these in food processing equipment and quality is critical. Never had a failure.',5000,'Malaysia','2025-12-10T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Mumbai Engineering Co.',4,'Reliable supplier for our MRO needs. Consistent quality across multiple orders. Would be 5 stars with faster shipping.',10000,'India','2025-11-25T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Singapore Offshore Tech',5,'Critical components for our oil platform maintenance. Passed all material certification requirements. Excellent supplier.',3000,'Singapore','2025-11-08T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Bandung Metal Works',2,'One batch had wrong thread pitch on M12 bolts. Caused production shutdown for 2 days. Supplier reimbursed but serious issue.',2000,'Indonesia','2025-10-25T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Colombo Engineering',5,'Very good quality and fast delivery to Sri Lanka. We use these for our hotel construction projects.',4000,'Sri Lanka','2025-10-10T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'Taipei Precision Parts',4,'Good quality fasteners. Chemical composition test passed. Packaging could be improved for better protection.',6000,'Taiwan','2025-09-25T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (4,'PT Baja Nusantara',5,'Excellent product and very competitive price. We replaced our European supplier with this one and saved 35%.',12000,'Indonesia','2025-09-10T10:00:00')`);
    // Reviews — product 5: Textile Fabrics (14)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'PT Sandang Jaya',5,'Excellent cotton fabric. Color fastness test passed at grade 4-5 which meets our export buyer requirements.',200,'Indonesia','2026-06-12T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Bangkok Fashion House',4,'Good quality polyester blend. Slight pilling after wash test but acceptable for the price point.',300,'Thailand','2026-05-28T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Manila Apparel Co.',5,'Premium hand feel compared to other suppliers at this price. Our finished garments received good buyer feedback.',150,'Philippines','2026-05-10T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Ho Chi Minh Garments',5,'Consistent weight and width across all rolls. Zero rejects in our cutting process. Highly recommended.',500,'Vietnam','2026-04-25T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Singapore Textile Hub',4,'Good quality for uniform production. Color consistency is good but lead time was 2 days longer than quoted.',400,'Singapore','2026-04-08T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Kuala Lumpur Fashion',5,'We have been using this fabric for 6 months for our workwear line. Zero complaints from clients about quality.',250,'Malaysia','2026-03-22T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Dhaka Exports Ltd.',3,'Acceptable quality but shade variation between rolls was noticeable. Supplier offered discount instead of replacement.',600,'Bangladesh','2026-03-05T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Jakarta Apparel Group',5,'Best quality we have found at this price. Shrinkage after wash is within 3% which is excellent.',350,'Indonesia','2026-02-18T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Chennai Garment Mills',4,'Good fabric for mid-range garments. Tensile strength test passed. Delivery was on schedule.',450,'India','2026-02-01T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Cebu Clothing Factory',5,'Excellent for our school uniform orders. Color retention is outstanding after repeated washing.',200,'Philippines','2026-01-15T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'PT Tekstil Indah',5,'We source the full cotton range from this supplier. Quality and consistency have earned them a long-term contract.',700,'Indonesia','2025-12-28T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Phnom Penh Textile',4,'Good quality polyester blend for sportswear. Moisture wicking performance meets our spec.',300,'Cambodia','2025-12-10T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Surabaya Fashion Co.',5,'Excellent hand feel and drape for our ladies wear collection. Buyers gave very positive feedback on the fabric.',180,'Indonesia','2025-11-25T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (5,'Karachi Apparel Ltd.',2,'Quality was not consistent with sample approved. One batch had significant pilling issue. Resolution took too long.',400,'Pakistan','2025-11-08T10:00:00')`);
    // Reviews — product 6: Industrial Network Switch (20)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'PT Maju Jaya',5,'Excellent quality switches. All 200 units delivered in perfect condition. Deployed in our factory network with zero issues.',200,'Indonesia','2026-06-12T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'AsiaBridge Networks',5,'Great switch for the price. PoE performance is solid. Passed all our lab QC tests before deployment.',50,'Malaysia','2026-05-28T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Bangkok Data Center',5,'Running in our edge network for 3 months. VLAN config was straightforward. Temperature performance good in hot aisle.',20,'Thailand','2026-05-15T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Ho Chi Minh IT Solutions',4,'Good switch for the price range. Web UI is slightly dated but SNMP v3 works perfectly. Would buy again.',10,'Vietnam','2026-05-02T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Manila Cloud Services',5,'Deployed 30 units across our data center floor. Uptime has been 100% for 4 months. Excellent value.',30,'Philippines','2026-04-18T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Singapore Cloud Corp',5,'Excellent industrial switch. DIN-rail mount worked for our panel PCs. Non-blocking throughput as advertised.',30,'Singapore','2026-04-05T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Cebu Network Services',3,'Two units had fan noise issues after 3 months. Supplier handled the RMA but it took longer than expected.',15,'Philippines','2026-03-22T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Jakarta Network Systems',4,'Solid build quality. Used for hotel property network. 24 ports is perfect for floor distribution switches.',40,'Indonesia','2026-03-08T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Kuala Lumpur Telecom',5,'Fast delivery and well packaged. Switch firmware is stable and CLI management is clean. Ordered 50 more units.',50,'Malaysia','2026-02-22T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Surabaya IT Services',5,'We replaced our aging Cisco switches with these for cost reasons. Performance is comparable at 1/3 the price.',60,'Indonesia','2026-02-08T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Chennai Datacenter',4,'Good switch but documentation is only in Chinese. Supplier sent translated version after request. Good performance.',25,'India','2026-01-25T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Colombo Telecom',5,'Excellent for our ISP network deployment in rural areas. Industrial grade is important for our outdoor cabinets.',45,'Sri Lanka','2026-01-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'PT Telematika',5,'Very good switch for industrial automation network. Works perfectly in our PLC-controlled production environment.',80,'Indonesia','2025-12-28T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Dhaka ISP Network',4,'Good value. Link aggregation works well for our uplink redundancy. Would like more detailed English documentation.',35,'Bangladesh','2025-12-12T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Hanoi Systems Integrator',5,'Excellent product. We have deployed 200 units across 12 enterprise clients. Zero hardware failures in 8 months.',200,'Vietnam','2025-11-28T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Taipei Network Co.',4,'Good switch for price. QoS works as expected. Some minor inconsistency in CLI syntax vs documentation.',20,'Taiwan','2025-11-15T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Yangon Telecom',5,'Very good industrial switch for our harsh environment deployment. Operating in 45C ambient with no issues.',30,'Myanmar','2025-11-01T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Penang IT Solutions',2,'Two switches failed within 2 weeks of deployment. Power supply issue. Replacement sent but caused project delay.',10,'Malaysia','2025-10-18T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Cebu Cloud Infrastructure',5,'Replaced 40 legacy switches with these. Network performance improved and power consumption dropped 30%.',40,'Philippines','2025-10-05T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (6,'Singapore Network Labs',5,'Tested in our lab against 3 other brands at this price point. Best performance-to-cost ratio we have found.',15,'Singapore','2025-09-22T09:00:00')`);
    // Reviews — product 7: Water Bottle (16)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'PT Maju Jaya',5,'Beautiful bottles and customers love the quality. Will reorder for next season. Zero defects in 1000 units.',1000,'Indonesia','2026-06-08T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Bangkok Gift Wholesale',5,'Perfect for our corporate gifting business. Custom logo printing quality is excellent. Clients are very happy.',500,'Thailand','2026-05-25T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Manila Corporate Gifts',4,'Good quality bottle. Insulation performance tested at 12 hours hot which matches the spec. Minor lid issue on 2 units.',300,'Philippines','2026-05-10T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Singapore Promo Goods',5,'Premium quality for promotional merchandise. Our clients were impressed with the build quality and finish.',200,'Singapore','2026-04-25T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Ho Chi Minh Gift Co.',4,'Good insulation. Keeps coffee hot for 10+ hours. Minor cosmetic blemish on 3 units out of 500 ordered.',500,'Vietnam','2026-04-10T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Kuala Lumpur Retail',5,'We sell these in our outdoor sports stores. Customer return rate is under 1% which is exceptional.',800,'Malaysia','2026-03-25T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Jakarta Gift Solutions',5,'Excellent quality for the price. Custom engraving was done perfectly. Our corporate clients always reorder.',600,'Indonesia','2026-03-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Chennai Merchandising',3,'Quality is average for the price. Insulation only lasts 9 hours not 12 as claimed. Some lids do not seal tightly.',200,'India','2026-02-22T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Cebu Sports Retail',5,'Best quality vacuum bottle we have sourced. Our hiking and outdoor customers love the durability.',400,'Philippines','2026-02-08T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'PT Souvenir Nusantara',5,'We produce 2000 branded bottles per month for corporate clients. Quality and delivery are always consistent.',2000,'Indonesia','2026-01-25T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Surabaya Gift Imports',4,'Good quality product. Custom color was slightly off from PMS reference but still acceptable. Good price.',300,'Indonesia','2026-01-10T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Penang Eco Products',5,'We position these as eco-friendly alternatives to single-use plastic. BPA free certification provided. Great product.',500,'Malaysia','2025-12-25T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Colombo Promo Agency',4,'Good quality for corporate giveaways. Laser engraving is crisp and permanent. Delivery to Sri Lanka was 15 days.',150,'Sri Lanka','2025-12-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Hanoi Retail Chain',5,'Selling these in our 20 stores across Vietnam. Customer satisfaction is very high and repeat purchase rate is good.',1000,'Vietnam','2025-11-25T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Dhaka Gift House',2,'Several bottles had dents on arrival. Packaging is not sufficient for sea freight. Supplier agreed to improve.',200,'Bangladesh','2025-11-10T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (7,'Taipei Outdoor Gear',5,'Excellent quality that meets our Taiwan market standards. Customers are very satisfied with the performance.',600,'Taiwan','2025-10-28T08:00:00')`);
    // Reviews — product 8: LED Panel Light (15)
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Jakarta Office Supply',4,'Good brightness, easy installation. Energy saving vs old fluorescent. Customer satisfaction is high.',300,'Indonesia','2026-06-05T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'PT Property Developer',5,'Installed in our 10-floor office building. Energy savings of 55% vs old fluorescent. Excellent ROI.',2000,'Indonesia','2026-05-22T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Bangkok Office Solutions',5,'Perfect for commercial office fit-out projects. Light quality is excellent and installation is very easy.',500,'Thailand','2026-05-08T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Manila Electrical Supply',4,'Good LED panel. Lumen output measured at 3900lm which is slightly below spec but still very good for office use.',400,'Philippines','2026-04-22T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Singapore Building Tech',5,'Used in our green building project. Excellent color rendering index and uniform light distribution.',800,'Singapore','2026-04-08T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Ho Chi Minh Office Co.',4,'Good quality panels. Installation was straightforward. One panel had flicker issue after 2 weeks, replaced promptly.',350,'Vietnam','2026-03-25T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Kuala Lumpur Properties',5,'We specify this LED panel in all our commercial interior projects now. Quality and price are both excellent.',600,'Malaysia','2026-03-10T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Jakarta Hotel Group',3,'Quality is acceptable but 3 panels developed yellowing after 4 months. Supplier said it is within normal range.',200,'Indonesia','2026-02-22T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Chennai Commercial Lighting',5,'Excellent for our school and hospital projects. Light quality and lifespan meet our client requirements.',1000,'India','2026-02-08T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Cebu Commercial Projects',5,'Best value LED panel we have found. Installed in 3 office buildings and performance has been outstanding.',500,'Philippines','2026-01-25T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'PT Cahaya Properti',5,'We replaced 800 fluorescent fixtures with these. Energy bill dropped 52% and maintenance cost almost zero.',800,'Indonesia','2026-01-10T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Colombo Architecture',4,'Good quality for the price. CE and RoHS certificates were provided for our project specification requirements.',300,'Sri Lanka','2025-12-28T09:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Surabaya Electrical',5,'Excellent product. We have been installing these for 1 year and zero failures reported. Highly recommended.',700,'Indonesia','2025-12-12T08:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Penang Fit-Out Co.',2,'Several panels arrived with damaged drivers. Replacement process was slow. Not recommended for time-sensitive projects.',100,'Malaysia','2025-11-28T10:00:00')`);
    db.run(`INSERT INTO product_reviews (product_id,reviewer_company,rating,review_text,order_quantity,country,created_at) VALUES (8,'Hanoi Commercial Dev.',5,'Perfect for our commercial development projects. Buyers appreciate the energy efficiency and light quality.',900,'Vietnam','2025-11-12T09:00:00')`);

    // FAQs
    db.run(`INSERT INTO product_faq (product_id,question,answer) VALUES (1,'Can you provide a sample before bulk order?','Yes. Sample orders of 1-3 units are available at sample price + courier cost.')`);
    db.run(`INSERT INTO product_faq (product_id,question,answer) VALUES (4,'What are your bulk discounts?','We offer tiered pricing starting from 1000 units. Contact sales for customized quotes.')`);
    db.run(`INSERT INTO product_faq (product_id,question,answer) VALUES (6,'Can you provide a sample before bulk order?','Yes. Sample orders of 1-3 units available at sample price + courier cost. Lead time 5-7 business days.')`);
    db.run(`INSERT INTO product_faq (product_id,question,answer) VALUES (6,'Do you support custom firmware?','Custom OEM firmware available for orders above 500 units.')`);
    db.run(`INSERT INTO product_faq (product_id,question,answer) VALUES (6,'What is the typical production lead time?','Standard models: 7-10 business days. Custom configurations: 15-20 business days.')`);
    db.run(`INSERT INTO product_faq (product_id,question,answer) VALUES (7,'Can you print our logo on the bottle?','Yes, custom logo printing available for orders of 500+ units via silk screening or laser engraving.')`);
    db.run(`INSERT INTO product_faq (product_id,question,answer) VALUES (8,'Is the LED panel dimmable?','The RGB Dimmable variant supports 0-10V dimming. Standard variants are non-dimmable.')`);

    // RFQs
    db.run(`INSERT INTO rfqs (user_email,product_name,description,quantity,target_price,origin,status) VALUES ('testbuyer@shiap.com','Industrial Switch 24-Port','Looking for 24-port managed switches for factory network upgrade','500','$12/unit','China','open')`);
    db.run(`INSERT INTO rfqs (user_email,product_name,description,quantity,target_price,origin,status) VALUES ('testbuyer@shiap.com','LED Panel Light 60x60cm','Bulk LED panel lights for office renovation project in Jakarta','1000','$8/unit','China','open')`);
    db.run(`INSERT INTO rfqs (user_email,product_name,description,quantity,target_price,origin,status) VALUES ('newbuyer1@example.com','CNC Milling Machine 3-Axis Vertical','5 units for industrial production line upgrade. Travel 800x500x500mm, Spindle 12000 RPM min.','5','$8000/unit','China','open')`);
    db.run(`INSERT INTO rfqs (user_email,product_name,description,quantity,target_price,origin,status) VALUES ('newbuyer1@example.com','Cotton Yarn Ring Spun 20s Natural White','Bulk cotton yarn for textile manufacturing. Need ISO certification.','5000 kg','$2.80/kg','China','open')`);

    // Saved products
    db.run(`INSERT INTO saved_products (user_email,product_id) VALUES ('testbuyer@shiap.com',6)`);
    db.run(`INSERT INTO saved_products (user_email,product_id) VALUES ('testbuyer@shiap.com',8)`);

    db.run('SELECT 1', [], (err) => {
      res.json({ message: 'Sample data seeded successfully', users: testUsers.length, products: products.length, orders: 4 });
    });
  });
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const openDisputesRow = await dbGet("SELECT COUNT(*) AS count FROM orders WHERE status='disputed'");
    const pendingKybRow = await dbGet("SELECT COUNT(*) AS count FROM users WHERE status='pending'");
    const pendingProductsRow = await dbGet("SELECT COUNT(*) AS count FROM products WHERE status='pending'");
    const openRfqsRow = await dbGet("SELECT COUNT(*) AS count FROM rfqs WHERE status='open'");
    const recentRegistrations = await dbAll('SELECT id, role, first_name, last_name, email, company_name, country, status, created_at FROM users ORDER BY created_at DESC LIMIT 6');
    const disputeOrders = await dbAll(`
      SELECT o.id, o.order_number, o.buyer_email, o.supplier_email, o.total_price, o.status, o.created_at,
        p.name AS product_name, b.company_name AS buyer_company, s.company_name AS supplier_company
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      LEFT JOIN users b ON o.buyer_email = b.email
      LEFT JOIN users s ON o.supplier_email = s.email
      WHERE o.status = 'disputed'
      ORDER BY o.created_at DESC
      LIMIT 10
    `);
    res.json({
      open_disputes: openDisputesRow.count || 0,
      pending_kyb: pendingKybRow.count || 0,
      pending_products: pendingProductsRow.count || 0,
      open_rfqs: openRfqsRow.count || 0,
      recent_registrations: recentRegistrations,
      dispute_orders: disputeOrders
    });
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch admin stats.' });
  }
});

app.get('/api/orders/admin', async (req, res) => {
  try {
    const orders = await dbAll(`
      SELECT o.*,
        p.name AS product_name, p.image_emoji,
        b.company_name AS buyer_company, b.country AS buyer_country,
        s.company_name AS supplier_company
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      LEFT JOIN users b ON o.buyer_email = b.email
      LEFT JOIN users s ON o.supplier_email = s.email
      ORDER BY o.created_at DESC
    `);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch orders.' });
  }
});

app.put('/api/admin/orders/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required.' });
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE orders SET status=? WHERE id=?', [status, id],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ message: 'Order status updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update order status.' });
  }
});

app.put('/api/rfqs/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  const allowed = ['open', 'awarded', 'rejected', 'closed'];
  if (!status || !allowed.includes(status)) return res.status(400).json({ error: 'Valid status is required.' });
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE rfqs SET status=? WHERE id=?', [status, id],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ message: 'RFQ status updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update RFQ status.' });
  }
});

app.put('/api/users/:email/status', async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const { status } = req.body;
  const allowed = ['active', 'inactive', 'pending', 'suspended'];
  if (!status || !allowed.includes(status)) return res.status(400).json({ error: 'Valid status is required.' });
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET status=? WHERE email=?', [status, email],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ message: 'User status updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update user status.' });
  }
});

app.put('/api/admin/products/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  const allowed = ['active', 'inactive', 'pending'];
  if (!status || !allowed.includes(status)) return res.status(400).json({ error: 'Valid status is required.' });
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE products SET status=? WHERE id=?', [status, id],
        function (err) { if (err) reject(err); else resolve(this.changes); });
    });
    res.json({ message: 'Product status updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update product status.' });
  }
});

// Debug endpoints
app.get('/api/debug/orders', (req, res) => {
  db.all('SELECT * FROM orders', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.get('/api/debug/products', (req, res) => {
  db.all('SELECT * FROM products', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
