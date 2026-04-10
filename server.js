const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();

// ========== НАСТРОЙКИ CORS ==========
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'], credentials: true }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ========== НАСТРОЙКИ UNISENDER ==========
const UNISENDER_API_KEY = '6p78dqzsxasfcdoj7k7n4b4xgmfwhmqbw96rsr7a';
const UNISENDER_SENDER_EMAIL = 'markusqueenwork@gmail.com';
const UNISENDER_SENDER_NAME = 'Voice Inside Galaxy';
// ========================================

const SHOP_ID = '1319443';
const SECRET_KEY = 'live_oERkhR1uKbbSskCwVY_SzaLbXH1O5P4egEL-toqLPJA';
const YOUR_SITE_URL = 'https://voiceinsidegalaxy.ru';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await client.query(`CREATE TABLE IF NOT EXISTS purchases (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL, course_name VARCHAR(255) NOT NULL, price INTEGER NOT NULL, payment_id VARCHAR(255), purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await client.query(`CREATE TABLE IF NOT EXISTS reset_tokens (token VARCHAR(255) PRIMARY KEY, email VARCHAR(255) NOT NULL, expires_at BIGINT NOT NULL)`);
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

// ========== ОТПРАВКА ЧЕРЕЗ UNISENDER ==========
async function sendEmail(to, subject, htmlContent, userName = '') {
  try {
    const params = new URLSearchParams();
    params.append('api_key', UNISENDER_API_KEY);
    params.append('email', to);
    params.append('sender_name', UNISENDER_SENDER_NAME);
    params.append('sender_email', UNISENDER_SENDER_EMAIL);
    params.append('subject', subject);
    params.append('body', htmlContent);
    params.append('list_id', '1');

    const response = await axios.post('https://api.unisender.com/ru/api/sendEmail?format=json', params);
    
    if (response.data.result && response.data.result.email_id) {
      console.log(`✅ Письмо отправлено на ${to} через Unisender, ID: ${response.data.result.email_id}`);
      return true;
    } else {
      console.error('❌ Ошибка Unisender:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Ошибка Unisender:', error.response?.data || error.message);
    return false;
  }
}
// ============================================

// Регистрация
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Заполните все поля' });
  try {
    const result = await pool.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email', [name, email, hashPassword(password)]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.json({ success: false, error: 'Email уже зарегистрирован' });
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT id, name, email FROM users WHERE email = $1 AND password_hash = $2', [email, hashPassword(password)]);
    if (result.rows.length === 0) return res.json({ success: false, error: 'Неверный email или пароль' });
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Восстановление пароля
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  console.log(`🔐 Запрос на восстановление для: ${email}`);
  if (!email) return res.status(400).json({ success: false, error: 'Email обязателен' });
  try {
    const userRes = await pool.query('SELECT name FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) return res.json({ success: true, message: 'Если такой email существует, ссылка будет отправлена' });
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 3600000;
    await pool.query('INSERT INTO reset_tokens (token, email, expires_at) VALUES ($1, $2, $3)', [token, email, expiresAt]);
    const resetLink = `${YOUR_SITE_URL}/reset-password.html?token=${token}`;
    const htmlContent = `<div style="font-family: Arial; max-width: 600px; padding: 20px; background: #111; color: #e8e8e8; border-radius: 12px;"><h2 style="color: #FFCC00;">Восстановление пароля</h2><p>Здравствуйте, ${userRes.rows[0].name}!</p><p>Вы запросили восстановление пароля.</p><div style="text-align: center; margin: 30px 0;"><a href="${resetLink}" style="background: #FFCC00; color: #000; padding: 12px 28px; text-decoration: none; border-radius: 40px;">Сбросить пароль</a></div><p>Ссылка действительна 1 час.</p><hr><p style="font-size: 12px;">© Voice Inside Galaxy</p></div>`;
    
    const sent = await sendEmail(email, 'Восстановление пароля — Voice Inside Galaxy', htmlContent, userRes.rows[0].name);
    if (sent) {
      res.json({ success: true, message: 'Ссылка отправлена на ваш email' });
    } else {
      res.status(500).json({ success: false, error: 'Не удалось отправить письмо. Попробуйте позже.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Сброс пароля
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ success: false, error: 'Токен и новый пароль обязательны' });
  if (newPassword.length < 4) return res.json({ success: false, error: 'Пароль минимум 4 символа' });
  try {
    const tokenRes = await pool.query('SELECT email, expires_at FROM reset_tokens WHERE token = $1', [token]);
    if (tokenRes.rows.length === 0) return res.json({ success: false, error: 'Недействительная ссылка' });
    const { email, expires_at } = tokenRes.rows[0];
    if (Date.now() > expires_at) {
      await pool.query('DELETE FROM reset_tokens WHERE token = $1', [token]);
      return res.json({ success: false, error: 'Ссылка устарела' });
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hashPassword(newPassword), email]);
    await pool.query('DELETE FROM reset_tokens WHERE token = $1', [token]);
    res.json({ success: true, message: 'Пароль успешно изменён' });
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
    if (paymentStatus.data.status !== 'succeeded') return res.json({ success: false, error: 'Платёж не подтверждён' });
    const existing = await pool.query('SELECT id FROM purchases WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
    if (existing.rows.length === 0) {
      await pool.query('INSERT INTO purchases (user_id, course_id, course_name, price, payment_id) VALUES ($1, $2, $3, $4, $5)', [userId, courseId, courseName, price, paymentId]);
    }
    res.json({ success: true, message: 'Курс добавлен в профиль' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Ошибка проверки платежа' });
  }
});

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
  console.log(`📧 Отправитель: ${UNISENDER_SENDER_EMAIL}`);
});