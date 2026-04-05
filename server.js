const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ========== КОНФИГУРАЦИЯ ==========
const SHOP_ID = '1319443';
const SECRET_KEY = 'live_oERkhR1uKbbSskCwVY_SzaLbXH1O5P4egEL-toqLPJA';
const YOUR_SITE_URL = 'https://voiceinsidegalaxy.ru';

// ========== БАЗА ДАННЫХ ==========
const db = new sqlite3.Database('database.sqlite');

// Создаём таблицы
db.serialize(() => {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Покупки
  db.run(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    course_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    payment_id TEXT,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// ========== ХЕШИРОВАНИЕ ПАРОЛЕЙ ==========
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// ========== API ПОЛЬЗОВАТЕЛЕЙ ==========

// Регистрация
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Заполните все поля' });
  }
  
  const password_hash = hashPassword(password);
  
  db.run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email, password_hash],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.json({ success: false, error: 'Email уже зарегистрирован' });
        }
        return res.status(500).json({ success: false, error: err.message });
      }
      
      res.json({
        success: true,
        user: { id: this.lastID, name, email }
      });
    }
  );
});

// Вход
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const password_hash = hashPassword(password);
  
  db.get('SELECT id, name, email FROM users WHERE email = ? AND password_hash = ?',
    [email, password_hash],
    (err, user) => {
      if (err || !user) {
        return res.json({ success: false, error: 'Неверный email или пароль' });
      }
      
      res.json({ success: true, user });
    }
  );
});

// Получить покупки пользователя
app.get('/api/my-purchases', async (req, res) => {
  const userId = req.query.userId;
  
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId не указан' });
  }
  
  db.all('SELECT course_id, course_name, price, purchased_at FROM purchases WHERE user_id = ? ORDER BY purchased_at DESC',
    [userId],
    (err, purchases) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      
      res.json({ success: true, purchases });
    }
  );
});

// ========== ОПЛАТА ==========

// Создание платежа
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, description, courseId, courseName, email, userId } = req.body;
    
    console.log(`💰 Создание платежа: ${amount}₽ за "${courseName}"`);
    console.log(`👤 User ID: ${userId}, Email: ${email}`);
    
    const paymentData = {
      amount: { value: amount.toString(), currency: "RUB" },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: `${YOUR_SITE_URL}/success.html`
      },
      description: description.substring(0, 128),
      metadata: {
        courseId: courseId.toString(),
        courseName: courseName,
        userId: userId.toString()
      }
    };
    
    if (email) {
      paymentData.receipt = {
        customer: { email: email },
        items: [{
          description: courseName.substring(0, 128),
          quantity: "1.00",
          amount: { value: amount.toString(), currency: "RUB" },
          vat_code: "1",
          payment_mode: "full_payment",
          payment_subject: "service"
        }]
      };
    }
    
    const response = await axios.post('https://api.yookassa.ru/v3/payments', paymentData, {
      auth: { username: SHOP_ID, password: SECRET_KEY },
      headers: { 'Idempotence-Key': uuidv4(), 'Content-Type': 'application/json' }
    });
    
    console.log(`✅ Платёж создан: ${response.data.id}`);
    
    res.json({
      success: true,
      confirmationUrl: response.data.confirmation.confirmation_url,
      paymentId: response.data.id
    });
    
  } catch (error) {
    console.error('❌ Ошибка создания платежа:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.description || 'Ошибка создания платежа'
    });
  }
});

// Подтверждение оплаты (вызывается из success.html)
app.post('/api/confirm-payment', async (req, res) => {
  const { paymentId, userId, courseId, courseName, price } = req.body;
  
  if (!paymentId || !userId || !courseId) {
    return res.status(400).json({ success: false, error: 'Не хватает данных' });
  }
  
  try {
    // Проверяем статус в ЮKassa
    const response = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      auth: { username: SHOP_ID, password: SECRET_KEY }
    });
    
    const payment = response.data;
    
    if (payment.status === 'succeeded') {
      // Проверяем, не куплен ли уже курс
      db.get('SELECT id FROM purchases WHERE user_id = ? AND course_id = ?',
        [userId, courseId],
        (err, existing) => {
          if (existing) {
            return res.json({ success: true, message: 'Курс уже был куплен ранее' });
          }
          
          // Добавляем покупку в БД
          db.run(`INSERT INTO purchases (user_id, course_id, course_name, price, payment_id)
                  VALUES (?, ?, ?, ?, ?)`,
            [userId, courseId, courseName, price, paymentId],
            function(err) {
              if (err) {
                console.error('Ошибка сохранения покупки:', err);
                return res.status(500).json({ success: false, error: 'Ошибка сохранения' });
              }
              
              console.log(`✅ Курс ${courseId} добавлен пользователю ${userId}`);
              res.json({ success: true, message: 'Курс добавлен в профиль' });
            }
          );
        }
      );
    } else {
      res.json({ success: false, error: `Платёж не подтверждён (статус: ${payment.status})` });
    }
    
  } catch (error) {
    console.error('Ошибка подтверждения:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка проверки платежа' });
  }
});

// Webhook от ЮKassa
app.post('/api/webhook', async (req, res) => {
  const event = req.body;
  console.log('📨 Webhook:', event.object?.id, event.object?.status);
  
  if (event.object?.status === 'succeeded') {
    const paymentId = event.object.id;
    const userId = event.object.metadata?.userId;
    const courseId = event.object.metadata?.courseId;
    const courseName = event.object.metadata?.courseName;
    const amount = event.object.amount?.value;
    
    if (userId && courseId) {
      db.run(`INSERT OR IGNORE INTO purchases (user_id, course_id, course_name, price, payment_id)
              VALUES (?, ?, ?, ?, ?)`,
        [userId, courseId, courseName, amount, paymentId],
        (err) => {
          if (err) console.error('Webhook error:', err);
          else console.log(`✅ Webhook: курс ${courseId} добавлен пользователю ${userId}`);
        }
      );
    }
  }
  
  res.send('OK');
});

// Проверка статуса платежа
app.get('/api/payment/:id', async (req, res) => {
  try {
    const response = await axios.get(`https://api.yookassa.ru/v3/payments/${req.params.id}`, {
      auth: { username: SHOP_ID, password: SECRET_KEY }
    });
    
    res.json({
      success: true,
      status: response.data.status,
      paid: response.data.paid
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Корневой маршрут
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Бэкенд работает!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});
