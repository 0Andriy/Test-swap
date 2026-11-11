/**
 * @file cache.middleware.js
 * @description 
 * Інтерцептор для кешування результатів HTTP-запитів (переважно GET) у пам'яті.
 * Підтримує час життя запису (TTL), ручне інвалідовування та можливість 
 * пропуску кешу для конкретного запиту через `{ cache: false }` або `{ forceRefresh: true }`.
 */

/**
 * Стандартне сховище кешу в пам'яті (In-Memory Map).
 * Зберігає пари: ключ -> { data, clonedResponse, expiresAt }
 */
const defaultMemoryCache = new Map()

/**
 * Створює унікальний ключ кешу на основі URL та опцій запиту.
 * 
 * @param {string} url - URL-адреса запиту.
 * @param {Object} [options={}] - Опції запиту.
 * @returns {string} Хеш-ключ для сховища.
 */
function generateCacheKey(url, options = {}) {
    // Враховуємо метод та заголовки (наприклад, якщо Authorization різний для різних юзерів)
    const method = (options.method || 'GET').toUpperCase()
    const authHeader = options.headers?.Authorization || options.headers?.authorization || ''
    
    return `${method}:${url}:${authHeader}`
}

/**
 * Створює клонований об'єкт Response.
 * Оскільки в Fetch API тіло відповіді (`body`) можна прочитати лише один раз, 
 * ми клонуємо Response перед збереженням у кеш, щоб і оригінальний запит, 
 * і наступні зкешовані запити могли успішно прочитати дані (наприклад, .json()).
 * 
 * @param {Response} response - Оригінальний об'єкт відповіді.
 * @returns {Promise<Response>} Клонований об'єкт відповіді.
 */
async function cloneResponse(response) {
    const cloned = response.clone()
    return cloned
}

/**
 * Створює параметризований мідлвар кешування.
 * 
 * @param {Object} [globalConfig={}] - Глобальні налаштування кешу.
 * @param {Map|Object} [globalConfig.storage=defaultMemoryCache] - Сховище для кешу.
 * @param {number} [globalConfig.ttl=60000] - Час життя кешу за замовчуванням у мілісекундах (дефолт: 1 хвилина).
 * @param {string[]} [globalConfig.methods=['GET']] - HTTP-методи, які дозволено кешувати.
 * @returns {import('../HttpClient.js').MiddlewareFunction} Налаштована функція мідлвара.
 * 
 * @example
 * client.use(createCacheMiddleware({
 *     ttl: 30000 // Кешувати всі GET запити на 30 секунд
 * }));
 * 
 * // Використання на рівні запиту з примусовим оновленням:
 * client.get('/profile', { cache: { forceRefresh: true } });
 * // Або повне вимкнення кешу для запиту:
 * client.get('/live-data', { cache: false });
 */
export function createCacheMiddleware(globalConfig = {}) {
    const {
        storage = defaultMemoryCache,
        ttl = 60000, // 1 хвилина за замовчуванням
        methods = ['GET'],
    } = globalConfig

    return async function cacheMiddleware(context, next) {
        // Оборонний захист контексту та опцій
        context.options = context.options || {}
        const { options, logger } = context

        const method = (options.method || 'GET').toUpperCase()

        // 1. Ранній вихід: якщо метод не входить у список кешованих або кешування вимкнено локально
        if (!methods.includes(method) || options.cache === false) {
            delete options.cache
            return next()
        }

        // Парсимо локальні налаштування кешу для конкретного запиту
        const requestCache = typeof options.cache === 'object' ? options.cache : {}
        const currentTtl = requestCache.ttl !== undefined ? requestCache.ttl : ttl
        const forceRefresh = Boolean(requestCache.forceRefresh)

        const cacheKey = generateCacheKey(context.url, options)

        // 2. Перевірка наявності валідного кешу (якщо не вимагається примусове оновлення)
        if (!forceRefresh && storage.has(cacheKey)) {
            const cachedItem = storage.get(cacheKey)

            // Перевіряємо, чи не минув час життя (TTL)
            if (Date.now() < cachedItem.expiresAt) {
                logger?.debug?.('[CacheMiddleware] 🎯 Знайдено актуальний кеш для:', context.url)
                
                // Повертаємо клоновану копію зкешованої відповіді
                delete options.cache
                return cachedItem.response.clone()
            } else {
                // Час життя вийшов — видаляємо застарілий запис
                logger?.debug?.('[CacheMiddleware] ⌛ Час життя кешу (TTL) вичерпано для:', context.url)
                storage.delete(cacheKey)
            }
        }

        // 3. Виконуємо реальний мережевий запит, оскільки кешу немає або він застарів
        logger?.debug?.('[CacheMiddleware] 🌐 Виконуємо мережевий запит (кеш відсутній):', context.url)
        
        const response = await next()

        // Кешуємо лише успішні відповіді (статус 200-299)
        if (response && response.ok) {
            try {
                // Клонуємо відповідь перед збереженням
                const responseToCache = await cloneResponse(response)
                
                storage.set(cacheKey, {
                    response: responseToCache,
                    expiresAt: Date.now() + currentTtl,
                })

                logger?.debug?.(`[CacheMiddleware] 💾 Успішно зкешовано відповідь для ${context.url} на ${currentTtl}мс`)
            } catch (cacheError) {
                logger?.error?.('[CacheMiddleware] Помилка при спробі зберегти відповідь у кеш:', cacheError.message)
            }
        }

        delete options.cache
        return response
    }
}
