/**
 * @file client.factory.js
 * @description 
 * Фабрика створення та конфігурації корпоративного HTTP-клієнта.
 * Дотримується чіткого порядку ієрархії мідлварів (цибулини).
 */

import { HttpClient } from './HttpClient.js'

// Імпорт усіх наших розроблених мідлварів
import { createLoggerMiddleware } from './middlewares/logger.middleware.js'
import { createCircuitBreakerMiddleware } from './middlewares/circuitBreaker.middleware.js'
import { createRetryMiddleware } from './middlewares/retry.middleware.js'
import { createTimeoutMiddleware } from './middlewares/timeout.middleware.js'
import { createHeadersMiddleware } from './middlewares/headers.middleware.js'
import { createIdempotencyMiddleware } from './middlewares/idempotency.middleware.js'
import { createQueryParamsMiddleware } from './middlewares/queryParams.middleware.js'
import { bodySerializerMiddleware } from './middlewares/bodySerializer.middleware.js' // (якщо використовується)
import { createCacheMiddleware } from './middlewares/cache.middleware.js'
import { createErrorMiddleware } from './middlewares/error.middleware.js'
import { createResponseExtensionMiddleware } from './middlewares/responseExtension.middleware.js'

/**
 * Створює та налаштовує готовий до продакшну інстанс HttpClient.
 * 
 * @returns {HttpClient} Налаштований клієнт.
 */
export function createApiClient() {
    const client = new HttpClient({
        baseUrl: 'https://api.enterprise.com/v1',
        defaultHeaders: {
            'Accept': 'application/json',
            'X-Client-Platform': 'Web-Dashboard'
        }
    })

    // ==========================================
    // ПОРЯДОК ПІДКЛЮЧЕННЯ МІДЛВАРІВ (ОБОВ'ЯЗКОВИЙ ПОРЯДОК)
    // ==========================================

    // 1. ЛОГУВАТОР (Зовнішній шар)
    // Має стояти найпершим, щоб охоплювати весь життєвий цикл запиту, 
    // включаючи час виконання ретраїв, таймаути та фіксацію помилок.
    client.use(createLoggerMiddleware({
        logger: console,
        logBody: false // Безпека: не світимо паролі в консолі
    }))

    // 2. ЗАХИСНИК ВІД ПАДІНЬ (Circuit Breaker)
    // Стоїть на вході, щоб у разі лежачого бекенда миттєво обривати запити 
    // і навіть не гаяти час на мережу чи ретраї.
    client.use(createCircuitBreakerMiddleware({
        failureThreshold: 5,   // 5 послідовних помилок вибивають запобіжник
        resetTimeout: 30000    // 30 секунд перепочинку для сервера
    }))

    // 3. ПОВТОРНІ СПРОБИ (Retry with Exponential Backoff)
    // Охоплює мережеві виклики. Якщо запит впаде через тимчасовий збій мережі, 
    // він піде на повторне коло (але вже через Circuit Breaker).
    client.use(createRetryMiddleware({
        retries: 3,
        baseDelay: 1000
    }))

    // 4. ОБМЕЖЕННЯ ЧАСУ (Timeout)
    // Захищає від зависань запиту (наприклад, якщо сервер відповідає довше 10 секунд).
    client.use(createTimeoutMiddleware({
        timeout: 10000
    }))

    // 5. ДЕФОЛТНІ ЗАГОЛОВКИ ТА ЗАХИСТ (Headers & Request ID)
    // Додає глобальні заголовки та унікальний X-Request-ID для трекінгу в логах бекенда.
    client.use(createHeadersMiddleware({
        addRequestId: true,
        requestIdHeaderName: 'X-Request-ID'
    }))

    // 6. ІДЕМПОТЕНТНІСТЬ (Idempotency)
    // Додає Idempotency-Key для небезпечних методів (POST, PUT, DELETE), 
    // щоб уникнути подвійних транзакцій при ретраях.
    client.use(createIdempotencyMiddleware({
        methods: ['POST', 'PUT', 'PATCH', 'DELETE']
    }))

    // 7. СЕРІАЛІЗАТОР ТІЛА ТА QUERY-ПАРАМЕТРІВ (Data Preparation)
    // Готують вихідні дані: перетворюють об'єкти в query-рядок (з сортуванням ключів) 
    // та серіалізують тіло запиту в JSON.
    client.use(createQueryParamsMiddleware())
    // client.use(bodySerializerMiddleware()) // Якщо об'єкт body ще не перетворено в рядок

    // 8. КЕШУВАННЯ (Cache Middleware)
    // Ставиться пізніше заQueryParams, оскільки перевіряє кеш за вже повністю 
    // сформованим канонічним URL та нормалізованим тілом (з урахуванням QUERY).
    client.use(createCacheMiddleware({
        ttl: 60000,                  // 1 хвилина
        methods: ['GET', 'QUERY']    // Кешуємо і GET, і пошукові QUERY
    }))

    // 9. ОБРОБНИК ПОМИЛОК (Error Middleware)
    // Перехоплює неуспішні статуси (поза 200-299), витягує тіло помилки 
    // та кидає структурований клас HttpError.
    client.use(createErrorMiddleware())

    // 10. АВТОПАРСЕР ТА РОЗШИРЕННЯ ВІДПОВІДІ (Response Extension)
    // Фінальний внутрішній шар: клонує стрім відповіді, автоматично парсить JSON 
    // і розширює нативний Response зручною властивістю .data (Axios-style).
    client.use(createResponseExtensionMiddleware())

    return client
}

// Експортуємо готовий інстанс для використання в додатку
export const api = createApiClient()
