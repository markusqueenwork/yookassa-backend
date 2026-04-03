const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// ========== ВОТ ЗДЕСЬ ВАШИ ДАННЫЕ (ЗАМЕНИТЕ) ==========
const SHOP_ID = '1319443';                    // ← ЗАМЕНИТЕ 123 на ваш shopId
const SECRET_KEY = 'live_oERkhR1uKbbSskCwVY_SzaLbXH1O5P4egEL-toqLPJA';                // ← ЗАМЕНИТЕ 321 на ваш секретный ключ
const YOUR_SITE_URL = 'https://voiceinsidegalaxy.ru';  // ← ЗАМЕНИТЕ на адрес вашего сайта
// =====================================================

// Создание платежа
app.post('/api/create-payment', async (req, res) => {
    try {
        const { amount, description, courseId, courseName } = req.body;
        
        console.log(`💰 Создание платежа: ${amount}₽ за курс "${courseName}"`);
        
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
            description: description,
            metadata: {
                courseId: courseId,
                courseName: courseName
            }
        };
        
        const response = await axios.post('https://api.yookassa.ru/v3/payments', paymentData, {
            auth: { username: SHOP_ID, password: SECRET_KEY },
            headers: {
                'Idempotence-Key': uuidv4(),
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`✅ Платеж создан: ${response.data.id}`);
        
        res.json({
            success: true,
            confirmationUrl: response.data.confirmation.confirmation_url,
            paymentId: response.data.id
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            error: error.response?.data?.description || 'Ошибка создания платежа'
        });
    }
});

// Webhook для уведомлений от ЮKassa
app.post('/api/webhook', async (req, res) => {
    try {
        const event = req.body;
        
        if (event.object?.status === 'succeeded') {
            console.log(`✅ Успешная оплата! Платеж: ${event.object.id}`);
            console.log(`Курс: ${event.object.metadata?.courseName}`);
        }
        
        res.send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.send('OK');
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// Корневой маршрут для проверки
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Бэкенд работает!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});
