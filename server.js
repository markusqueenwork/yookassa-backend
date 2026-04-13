const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();

// ========== НАСТРОЙКИ CORS ==========
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
// ============================================

app.use(express.json());

const SHOP_ID = '1319443';
const SECRET_KEY = 'live_oERkhR1uKbbSskCwVY_SzaLbXH1O5P4egEL-toqLPJA';
const YOUR_SITE_URL = 'https://voiceinsidegalaxy.ru';

// ========== ПОДКЛЮЧЕНИЕ К POSTGRESQL (ДЛЯ VPS REG.RU) ==========
const pool = new Pool({
  user: 'voice_user',
  password: 'ZaNuda4kapl.',
  host: 'localhost',
  port: 5432,
  database: 'voiceinsidegalaxy_db'
});
// ================================================================

// Инициализация таблиц
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL,
        course_name VARCHAR(255) NOT NULL,
        price INTEGER NOT NULL,
        payment_id VARCHAR(255),
        purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ База данных и таблицы созданы');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
  } finally {
    client.release();
  }
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Регистрация
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Заполните все поля' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hashPassword(password)]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.json({ success: false, error: 'Email уже зарегистрирован' });
    }
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE email = $1 AND password_hash = $2',
      [email, hashPassword(password)]
    );
    if (result.rows.length === 0) {
      return res.json({ success: false, error: 'Неверный email или пароль' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Получить покупки
app.get('/api/my-purchases', async (req, res) => {
  const userId = parseInt(req.query.userId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId не указан' });
  try {
    const result = await pool.query('SELECT course_id, course_name, price, purchased_at FROM purchases WHERE user_id = $1 ORDER BY purchased_at DESC', [userId]);
    res.json({ success: true, purchases: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Создание платежа
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, description, courseId, courseName, userId, email } = req.body;
    const paymentData = {
      amount: { value: amount.toString(), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: `${YOUR_SITE_URL}/success.html` },
      description: description.substring(0, 128),
      metadata: { courseId: courseId.toString(), courseName: courseName, userId: userId.toString() },
      receipt: {
        customer: { email: email || 'customer@voiceinsidegalaxy.ru' },
        items: [{
          description: courseName.substring(0, 128),
          quantity: "1.00",
          amount: { value: amount.toString(), currency: "RUB" },
          vat_code: "1",
          payment_mode: "full_payment",
          payment_subject: "service"
        }]
      }
    };
    const response = await axios.post('https://api.yookassa.ru/v3/payments', paymentData, {
      auth: { username: SHOP_ID, password: SECRET_KEY },
      headers: { 'Idempotence-Key': uuidv4(), 'Content-Type': 'application/json' }
    });
    res.json({ success: true, confirmationUrl: response.data.confirmation.confirmation_url, paymentId: response.data.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.description || 'Ошибка создания платежа' });
  }
});

// Подтверждение оплаты
app.post('/api/confirm-payment', async (req, res) => {
  const { paymentId, userId, courseId, courseName, price } = req.body;
  try {
    const paymentStatus = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      auth: { username: SHOP_ID, password: SECRET_KEY }
    });
    if (paymentStatus.data.status !== 'succeeded') {
      return res.json({ success: false, error: 'Платёж не подтверждён' });
    }
    const existing = await pool.query('SELECT id FROM purchases WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
    if (existing.rows.length === 0) {
      await pool.query('INSERT INTO purchases (user_id, course_id, course_name, price, payment_id) VALUES ($1, $2, $3, $4, $5)', [userId, courseId, courseName, price, paymentId]);
    }
    res.json({ success: true, message: 'Курс добавлен в профиль' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка проверки платежа' });
  }
});

// Проверка статуса платежа
app.get('/api/payment/:id', async (req, res) => {
  try {
    const response = await axios.get(`https://api.yookassa.ru/v3/payments/${req.params.id}`, {
      auth: { username: SHOP_ID, password: SECRET_KEY }
    });
    res.json({ success: true, status: response.data.status, paid: response.data.paid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Бэкенд работает!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
  await initDB();
});