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

// Настройки RuSender
const RUSENDER_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZFVzZXIiOjIyNzk5LCJpZEV4dGVybmFsTWFpbEFwaUtleSI6NDA0NCwiaWF0IjoxNzc1NDE2NTYwfQ.Sgaw4BUITlXPw4jbpyR5bIo_1LQNDswJ0cvuetMeyIo';
const RUSENDER_SENDER_EMAIL = 'noreply@voiceinsidegalaxy.ru';  // ✅ исправлено
const RUSENDER_SENDER_NAME = 'Voice Inside Galaxy';

const USERS_FILE = '/tmp/users.json';
const PURCHASES_FILE = '/tmp/purchases.json';
const RESET_TOKENS_FILE = '/tmp/reset_tokens.json';

function initFiles() {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(PURCHASES_FILE)) fs.writeFileSync(PURCHASES_FILE, '[]');
  if (!fs.existsSync(RESET_TOKENS_FILE)) fs.writeFileSync(RESET_TOKENS_FILE, '{}');
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e) { return []; }
}

function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function loadPurchases() {
  try { return JSON.parse(fs.readFileSync(PURCHASES_FILE)); } catch(e) { return []; }
}

function savePurchases(purchases) { fs.writeFileSync(PURCHASES_FILE, JSON.stringify(purchases, null, 2)); }

function loadResetTokens() {
  try { return JSON.parse(fs.readFileSync(RESET_TOKENS_FILE)); } catch(e) { return {}; }
}

function saveResetTokens(tokens) { fs.writeFileSync(RESET_TOKENS_FILE, JSON.stringify(tokens, null, 2)); }

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Отправка письма через RuSender API
async function sendEmail(to, subject, htmlContent, userName = '') {
  try {
    console.log(`📧 Попытка отправить письмо на ${to} через RuSender...`);
    const response = await axios.post('https://api.rusender.ru/v1/external-mails/send', {
      mail: {
        to: { email: to, name: userName },
        from: { email: RUSENDER_SENDER_EMAIL, name: RUSENDER_SENDER_NAME },
        subject: subject,
        html: htmlContent
      }
    }, {
      headers: {
        'X-Api-Key': RUSENDER_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ Письмо отправлено на ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка отправки письма через RuSender:', error.response?.data || error.message);
    return false;
  }
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

// Восстановление пароля - отправка ссылки
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email обязателен' });
  }
  
  const users = loadUsers();
  const user = users.find(u => u.email === email);
  
  if (!user) {
    return res.json({ success: true, message: 'Если такой email существует, ссылка будет отправлена' });
  }
  
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 3600000;
  
  const tokens = loadResetTokens();
  tokens[token] = { email, expiresAt };
  saveResetTokens(tokens);
  
  const resetLink = `${YOUR_SITE_URL}/reset-password.html?token=${token}`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #111; color: #e8e8e8; border-radius: 12px;">
      <h2 style="color: #FFCC00;">Восстановление пароля</h2>
      <p>Здравствуйте, ${user.name}!</p>
      <p>Вы запросили восстановление пароля на сайте <strong>Voice Inside Galaxy</strong>.</p>
      <p>Для установки нового пароля нажмите на кнопку ниже:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background: #FFCC00; color: #000; padding: 12px 28px; text-decoration: none; border-radius: 40px; font-weight: 600;">Сбросить пароль</a>
      </div>
      <p>Ссылка действительна в течение 1 часа.</p>
      <p>Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>
      <hr style="border-color: #333; margin: 20px 0;">
      <p style="font-size: 12px; color: #666;">© Voice Inside Galaxy</p>
    </div>
  `;
  
  const sent = await sendEmail(email, 'Восстановление пароля — Voice Inside Galaxy', htmlContent, user.name);
  
  if (sent) {
    res.json({ success: true, message: 'Ссылка для сброса пароля отправлена на ваш email' });
  } else {
    res.json({ success: false, error: 'Не удалось отправить письмо. Попробуйте позже.' });
  }
});

// Сброс пароля
app.post('/api/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!token || !newPassword) {
    return res.status(400).json({ success: false, error: 'Токен и новый пароль обязательны' });
  }
  
  if (newPassword.length < 4) {
    return res.json({ success: false, error: 'Пароль должен быть не менее 4 символов' });
  }
  
  const tokens = loadResetTokens();
  const resetData = tokens[token];
  
  if (!resetData) {
    return res.json({ success: false, error: 'Недействительная или устаревшая ссылка' });
  }
  
  if (Date.now() > resetData.expiresAt) {
    delete tokens[token];
    saveResetTokens(tokens);
    return res.json({ success: false, error: 'Ссылка устарела. Запросите восстановление заново.' });
  }
  
  const users = loadUsers();
  const userIndex = users.findIndex(u => u.email === resetData.email);
  
  if (userIndex === -1) {
    return res.json({ success: false, error: 'Пользователь не найден' });
  }
  
  users[userIndex].password_hash = hashPassword(newPassword);
  saveUsers(users);
  
  delete tokens[token];
  saveResetTokens(tokens);
  
  res.json({ success: true, message: 'Пароль успешно изменён' });
});

// Получить покупки пользователя
app.get('/api/my-purchases', (req, res) => {
  const userId = parseInt(req.query.userId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId не указан' });
  
  const purchases = loadPurchases();
  const userPurchases = purchases.filter(p => p.user_id === userId);
  res.json({ success: true, purchases: userPurchases });
});

// Создание платежа
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, description, courseId, courseName, userId, email } = req.body;
    
    console.log('💰 Создание платежа:', { amount, courseName, userId, email });
    
    const paymentData = {
      amount: { value: amount.toString(), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: `${YOUR_SITE_URL}/success.html` },
      description: description.substring(0, 128),
      metadata: { courseId: courseId.toString(), courseName: courseName, userId: userId.toString() }
    };
    
    const customerEmail = email || 'customer@voiceinsidegalaxy.ru';
    
    paymentData.receipt = {
      customer: { email: customerEmail },
      items: [{
        description: courseName.substring(0, 128),
        quantity: "1.00",
        amount: { value: amount.toString(), currency: "RUB" },
        vat_code: "1",
        payment_mode: "full_payment",
        payment_subject: "service"
      }]
    };
    
    const response = await axios.post('https://api.yookassa.ru/v3/payments', paymentData, {
      auth: { username: SHOP_ID, password: SECRET_KEY },
      headers: { 'Idempotence-Key': uuidv4(), 'Content-Type': 'application/json' }
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
      auth: { username: SHOP_ID, password: SECRET_KEY }
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
      auth: { username: SHOP_ID, password: SECRET_KEY }
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
  console.log(`📧 RuSender отправитель: ${RUSENDER_SENDER_EMAIL}`);
});
