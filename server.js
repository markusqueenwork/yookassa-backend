const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const SHOP_ID = '1319443';
const SECRET_KEY = 'live_oERkhR1uKbbSskCwVY_SzaLbXH1O5P4egEL-toqLPJA';
const YOUR_SITE_URL = 'https://voiceinsidegalaxy.ru';

const USERS_FILE = '/tmp/users.json';
const PURCHASES_FILE = '/tmp/purchases.json';

function initFiles() {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(PURCHASES_FILE)) fs.writeFileSync(PURCHASES_FILE, '[]');
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e) { return []; }
}

function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function loadPurchases() {
  try { return JSON.parse(fs.readFileSync(PURCHASES_FILE)); } catch(e) { return []; }
}

function savePurchases(purchases) { fs.writeFileSync(PURCHASES_FILE, JSON.stringify(purchases, null, 2)); }

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

initFiles();

// Регистрация
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Заполните все поля' });
  }
  
  const users = loadUsers();
  if (users.find(u => u.email === email)) {
    return res.json({ success: false, error: 'Email уже зарегистрирован' });
  }
  
  const newUser = { id: users.length + 1, name, email, password_hash: hashPassword(password) };
  users.push(newUser);
  saveUsers(users);
  
  res.json({ success: true, user: { id: newUser.id, name, email } });
});

// Вход
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.email === email && u.password_hash === hashPassword(password));
  
  if (!user) {
    return res.json({ success: false, error: 'Неверный email или пароль' });
  }
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
});

// Получить покупки пользователя
app.get('/api/my-purchases', (req, res) => {
  const userId = parseInt(req.query.userId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId не указан' });
  
  const purchases = loadPurchases();
  const userPurchases = purchases.filter(p => p.user_id === userId);
  res.json({ success: true, purchases: userPurchases });
});

// Создание платежа (С ПОЛНЫМ ЧЕКОМ)
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, description, courseId, courseName, userId, email } = req.body;
    
    console.log('💰 Создание платежа:', { amount, courseName, userId, email });
    
    // Базовые данные платежа
    const paymentData = {
      amount: {
        value: amount.toString(),
        currency: "RUB"
      },
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
    
    // Добавляем чек (обязательно для фискализации)
    // Используем email пользователя или заглушку
    const customerEmail = email || 'customer@voiceinsidegalaxy.ru';
    
    paymentData.receipt = {
      customer: {
        email: customerEmail
      },
      items: [{
        description: courseName.substring(0, 128),
        quantity: "1.00",
        amount: {
          value: amount.toString(),
          currency: "RUB"
        },
        vat_code: "1",
        payment_mode: "full_payment",
        payment_subject: "service"
      }]
    };
    
    console.log('📋 Данные платежа с чеком:', JSON.stringify(paymentData, null, 2));
    
    const response = await axios.post('https://api.yookassa.ru/v3/payments', paymentData, {
      auth: {
        username: SHOP_ID,
        password: SECRET_KEY
      },
      headers: {
        'Idempotence-Key': uuidv4(),
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Платёж создан:', response.data.id);
    
    res.json({
      success: true,
      confirmationUrl: response.data.confirmation.confirmation_url,
      paymentId: response.data.id
    });
    
  } catch (error) {
    console.error('❌ Ошибка платежа:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.description || 'Ошибка создания платежа'
    });
  }
});

// Подтверждение оплаты
app.post('/api/confirm-payment', async (req, res) => {
  const { paymentId, userId, courseId, courseName, price } = req.body;
  
  console.log('🔍 Подтверждение платежа:', { paymentId, userId, courseId });
  
  if (!paymentId || !userId || !courseId) {
    return res.status(400).json({ success: false, error: 'Не хватает данных' });
  }
  
  try {
    const response = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      auth: {
        username: SHOP_ID,
        password: SECRET_KEY
      }
    });
    
    const payment = response.data;
    console.log('📊 Статус платежа:', payment.status);
    
    if (payment.status === 'succeeded') {
      const purchases = loadPurchases();
      const exists = purchases.find(p => p.user_id === userId && p.course_id === courseId);
      
      if (!exists) {
        const newPurchase = {
          user_id: userId,
          course_id: courseId,
          course_name: courseName,
          price: price,
          payment_id: paymentId,
          purchased_at: new Date().toISOString()
        };
        purchases.push(newPurchase);
        savePurchases(purchases);
        console.log('✅ Покупка сохранена:', newPurchase);
      } else {
        console.log('ℹ️ Курс уже был куплен ранее');
      }
      
      res.json({ success: true, message: 'Курс добавлен в профиль' });
    } else {
      res.json({ success: false, error: `Платёж не подтверждён (статус: ${payment.status})` });
    }
    
  } catch (error) {
    console.error('❌ Ошибка подтверждения:', error.message);
    res.status(500).json({ success: false, error: 'Ошибка проверки платежа' });
  }
});

// Проверка статуса платежа
app.get('/api/payment/:id', async (req, res) => {
  try {
    const response = await axios.get(`https://api.yookassa.ru/v3/payments/${req.params.id}`, {
      auth: {
        username: SHOP_ID,
        password: SECRET_KEY
      }
    });
    
    res.json({
      success: true,
      status: response.data.status,
      paid: response.data.paid
    });
  } catch (error) {
    console.error('Ошибка получения статуса:', error.message);
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
  console.log(`📦 SHOP_ID: ${SHOP_ID}`);
  console.log(`🔑 SECRET_KEY: ${SECRET_KEY ? '✓ загружен' : '✗ НЕ НАЙДЕН'}`);
  console.log(`🔗 YOUR_SITE_URL: ${YOUR_SITE_URL}`);
  console.log(`💾 Данные хранятся в: /tmp/users.json и /tmp/purchases.json`);
});
