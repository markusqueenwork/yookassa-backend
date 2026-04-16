const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

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

// ========== ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (RENDER) ==========
const SHOP_ID = process.env.SHOP_ID || '1319443';
const SECRET_KEY = process.env.SECRET_KEY || 'live_oERkhR1uKbbSskCwVY_SzaLbXH1O5P4egEL-toqLPJA';
const YOUR_SITE_URL = process.env.YOUR_SITE_URL || 'https://voiceinsidegalaxy.ru';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// ==================================================

// ========== ПОДКЛЮЧЕНИЕ К SUPABASE ==========
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Ошибка: SUPABASE_URL и SUPABASE_ANON_KEY должны быть заданы в переменных окружения');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('✅ Supabase подключён');
// ============================================

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
    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, password_hash: hashPassword(password) }])
      .select('id, name, email')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.json({ success: false, error: 'Email уже зарегистрирован' });
      }
      console.error('Ошибка регистрации:', error);
      return res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }

    res.json({ success: true, user: data });
  } catch (err) {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('email', email)
      .eq('password_hash', hashPassword(password))
      .single();

    if (error || !data) {
      return res.json({ success: false, error: 'Неверный email или пароль' });
    }

    res.json({ success: true, user: data });
  } catch (err) {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Получить покупки
app.get('/api/my-purchases', async (req, res) => {
  const userId = parseInt(req.query.userId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId не указан' });

  try {
    const { data, error } = await supabase
      .from('purchases')
      .select('course_id, course_name, price, purchased_at')
      .eq('user_id', userId)
      .order('purchased_at', { ascending: false });

    if (error) {
      console.error('Ошибка получения покупок:', error);
      return res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }

    res.json({ success: true, purchases: data });
  } catch (err) {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Создание платежа (поддержка нескольких курсов)
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, description, courseIds, courseName, userId, email } = req.body;
    
    // courseIds может быть массивом или одним ID
    const ids = Array.isArray(courseIds) ? courseIds : [courseIds];
    
    const paymentData = {
      amount: { value: amount.toString(), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: `${YOUR_SITE_URL}/success.html` },
      description: description.substring(0, 128),
      metadata: { 
        courseIds: JSON.stringify(ids), 
        courseName: courseName, 
        userId: userId.toString() 
      },
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
    
    res.json({ 
      success: true, 
      confirmationUrl: response.data.confirmation.confirmation_url, 
      paymentId: response.data.id 
    });
  } catch (error) {
    console.error('Ошибка создания платежа:', error);
    res.status(500).json({ success: false, error: error.response?.data?.description || 'Ошибка создания платежа' });
  }
});

// Подтверждение оплаты (поддержка нескольких курсов)
app.post('/api/confirm-payment', async (req, res) => {
  const { paymentId, userId, courseIds, courseNames, price } = req.body;
  
  try {
    const paymentStatus = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      auth: { username: SHOP_ID, password: SECRET_KEY }
    });
    
    if (paymentStatus.data.status !== 'succeeded') {
      return res.json({ success: false, error: 'Платёж не подтверждён' });
    }

    // courseIds может быть массивом или одним ID
    const ids = Array.isArray(courseIds) ? courseIds : [courseIds];
    const names = courseNames ? courseNames.split(', ') : [`Курс #${ids[0]}`];
    const pricePerCourse = Math.floor(price / ids.length);
    
    const results = [];
    
    for (let i = 0; i < ids.length; i++) {
      const courseId = ids[i];
      const courseName = names[i] || `Курс #${courseId}`;
      
      // Проверяем, нет ли уже такой покупки
      const { data: existing, error: checkError } = await supabase
        .from('purchases')
        .select('id')
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .maybeSingle();

      if (checkError) {
        console.error('Ошибка проверки покупки:', checkError);
        continue;
      }

      if (!existing) {
        const { error: insertError } = await supabase
          .from('purchases')
          .insert([{ 
            user_id: userId, 
            course_id: courseId, 
            course_name: courseName, 
            price: pricePerCourse, 
            payment_id: paymentId 
          }]);

        if (insertError) {
          console.error('Ошибка добавления покупки:', insertError);
        } else {
          results.push(courseId);
        }
      }
    }

    res.json({ 
      success: true, 
      message: `Добавлено курсов: ${results.length}`,
      addedCourses: results 
    });
  } catch (err) {
    console.error('Ошибка проверки платежа:', err);
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
    console.error('Ошибка проверки статуса:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Бэкенд работает!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});