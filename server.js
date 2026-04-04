const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// ========== ВАШИ ДАННЫЕ ==========
const SHOP_ID = '1319443';
const SECRET_KEY = 'live_oERkhR1uKbbSskCwVY_SzaLbXH1O5P4egEL-toqLPJA';
const YOUR_SITE_URL = 'https://voiceinsidegalaxy.ru';
// =================================

// Создание платежа
app.post('/api/create-payment', async (req, res) => {
    try {
        const { amount, description, courseId, courseName, email } = req.body;
        
        console.log(`💰 Создание платежа: ${amount}₽ за курс "${courseName}"`);
        console.log(`📧 Email: ${email || 'не указан'}`);
        
        // Базовая структура платежа
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
                courseName: courseName
            }
        };
        
        // Добавляем чек (обязательно для ЮKassa)
        if (email) {
            paymentData.receipt = {
                customer: {
                    email: email
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
            console.log(`✅ Чек добавлен для ${email}`);
        } else {
            console.log(`⚠️ Чек не добавлен: email не передан`);
        }
        
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
        
        console.log(`✅ Платеж создан: ${response.data.id}`);
        
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

// Webhook для уведомлений от ЮKassa
app.post('/api/webhook', async (req, res) => {
    try {
        const event = req.body;
        console.log('📨 Получен webhook:', JSON.stringify(event, null, 2));
        
        if (event.object?.status === 'succeeded') {
            const paymentId = event.object.id;
            const courseId = event.object.metadata?.courseId;
            const courseName = event.object.metadata?.courseName;
            
            console.log(`✅ УСПЕШНАЯ ОПЛАТА! Платеж: ${paymentId}, Курс: ${courseName}`);
        } else if (event.object?.status === 'canceled') {
            console.log(`❌ Платеж отменен: ${event.object.id}`);
        }
        
        res.send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.send('OK');
    }
});

// Проверка статуса платежа (исправлено)
app.get('/api/payment/:id', async (req, res) => {
    try {
        const response = await axios.get(`https://api.yookassa.ru/v3/payments/${req.params.id}`, {
            auth: { username: SHOP_ID, password: SECRET_KEY }
        });
        
        console.log(`🔍 Статус платежа ${req.params.id}: ${response.data.status}`);
        
        res.json({
            success: true,
            status: response.data.status,
            paid: response.data.paid,
            paymentId: response.data.id
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
});