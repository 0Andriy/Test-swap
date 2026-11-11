/**
 * @file cache.middleware.js
 * @description 
 * Інтерцептор для кешування результатів HTTP-запитів у пам'яті (In-Memory).
 * Підтримує:
 * - Канонічну нормалізацію (сортування) Query-параметрів.
 * - Стабілізовану серіалізацію тіла запиту (Stable JSON Stringify) для методів на кшталт QUERY / POST.
 * - Час життя запису (TTL).
 * - Гнучке керування на рівні запиту (вимкнення або примусове оновлення forceRefresh).
 */

/**
 * Стандартне сховище кешу в пам'яті (In-Memory Map).
 * Зберігає пари: ключ -> { response, expiresAt }
 * @type {Map<string, { response: Response, expiresAt: number }>}
 */
const defaultMemoryCache = new Map()

/**
 * Рекурсивно сортує ключі об'єкта для створення стабільного JSON-рядка (Canonical JSON).
 * Гарантує, що { b: 2, a: 1 } і { a: 1, b: 2 } дадуть ідентичний ключ для кешу,
 * що особливо важливо для складних пошукових запитів та методів QUERY.
 * 
 * @param {any} value - Значення для нормалізації.
 * @returns {string} Стабільний JSON-рядок.
 */
function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value)
    }

    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']'
    }

    const keys = Object.keys(value).sort()
    const sortedObj = {}
    
    for (const key of keys) {
        sortedObj[key] = value[key]
    }

    return JSON.stringify(sortedObj, (key, val) => {
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            const sortedNestedKeys = Object.keys(val).sort()
            const result = {}
            for (const k of sortedNestedKeys) {
                result[k] = val[k]
            }
            return result
        }
        return val
    })
}

/**
 * Створює канонічний (нормалізований) ключ кешу.
 * Враховує HTTP-метод, шлях, заголовки авторизації, відсортовані query-параметри 
 * та нормалізоване тіло запиту (body).
 * 
 * @param {string} url - URL-адреса запиту.
 * @param {Object} [options={}] - Опції запиту.
 * @returns {string} Унікальний та стабільний ключ кешу.
 */
function generateCacheKey(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase()
    const authHeader = options.headers?.Authorization || options.headers?.authorization || ''
    
    let canonicalBody = ''
    if (options.body) {
        try {
            const parsedBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body
            canonicalBody = stableStringify(parsedBody)
        } catch {
            // Fallback для не-JSON тіла (наприклад, FormData або масиви байтів)
            canonicalBody = String(options.body)
        }
    }

    try {
        const isAbsolute = url.includes('://') || url.startsWith('//')
        const urlObj = new URL(url, isAbsolute ? undefined : 'http://localhost')

        // Сортуємо query-параметри за алфавітом, усуваючи залежність від порядку їх передачі
        urlObj.searchParams.sort()

        const canonicalPath = urlObj.pathname + urlObj.search

        return `${method}:${canonicalPath}:${authHeader}:${canonicalBody}`
    } catch {
        return `${method}:${url}:${authHeader}:${canonicalBody}`
    }
}

/**
 * Клонує об'єкт Response. 
 * Необхідно, оскільки тіло Response у Fetch API можна прочитати лише один раз.
 * 
 * @param {Response} response - Оригінальна відповідь.
 * @returns {Promise<Response>} Клонована відповідь.
 */
async function cloneResponse(response) {
    return response.clone()
}

/**
 * Створює параметризований мідлвар кешування (Фабрика).
 * 
 * @param {Object} [globalConfig={}] - Глобальні налаштування кешу.
 * @param {Map|Object} [globalConfig.storage=defaultMemoryCache] - Сховище для кешу.
 * @param {number} [globalConfig.ttl=60000] - Час життя кешу за замовчуванням у мілісекундах (дефолт: 1 хвилина).
 * @param {string[]} [globalConfig.methods=['GET', 'QUERY']] - HTTP-методи, які дозволено кешувати.
 * @returns {import('../HttpClient.js').MiddlewareFunction} Налаштована функція мідлвара.
 * 
 * @example
 * client.use(createCacheMiddleware({
 *     ttl: 30000,
 *     methods: ['GET', 'QUERY']
 * }));
 */
export function createCacheMiddleware(globalConfig = {}) {
    const {
        storage = defaultMemoryCache,
        ttl = 60000, // 1 хвилина за замовчуванням
        methods = ['GET', 'QUERY'],
    } = globalConfig

    return async function cacheMiddleware(context, next) {
        // Оборонний захист контексту та опцій
        context.options = context.options || {}
        const { options, logger } = context

        const method = (options.method || 'GET').toUpperCase()

        // 1. Ранній вихід: якщо метод не кешується або кешування вимкнено локально ({ cache: false })
        if (!methods.includes(method) || options.cache === false) {
            delete options.cache
            return next()
        }

        // Парсимо локальні налаштування кешу для конкретного запиту
        const requestCache = typeof options.cache === 'object' ? options.cache : {}
        const currentTtl = requestCache.ttl !== undefined ? requestCache.ttl : ttl
        const forceRefresh = Boolean(requestCache.forceRefresh)

        const cacheKey = generateCacheKey(context.url, options)

        // 2. Перевірка наявності валідного запису в кеші (якщо не вимагається примусове оновлення)
        if (!forceRefresh && storage.has(cacheKey)) {
            const cachedItem = storage.get(cacheKey)

            if (Date.now() < cachedItem.expiresAt) {
                logger?.debug?.(`[CacheMiddleware] 🎯 [Cache Hit] Знайдено актуальний кеш для ${method} ${context.url}`)
                
                delete options.cache
                // Повертаємо клоновану копію зкешованої відповіді
                return cachedItem.response.clone()
            } else {
                logger?.debug?.(`[CacheMiddleware] ⌛ Час життя кешу (TTL) вичерпано для ${context.url}`)
                storage.delete(cacheKey)
            }
        }

        logger?.debug?.(`[CacheMiddleware] 🌐 [Cache Miss] Виконуємо мережевий запит для ${method} ${context.url}`)

        // 3. Виконуємо реальний запит далі по ланцюжку
        const response = await next()

        // Кешуємо лише успішні відповіді (статус 200-299)
        if (response && response.ok) {
            try {
                const responseToCache = await cloneResponse(response)
                
                storage.set(cacheKey, {
                    response: responseToCache,
                    expiresAt: Date.now() + currentTtl,
                })

                logger?.debug?.(`[CacheMiddleware] 💾 Успішно збережено в кеш на ${currentTtl}мс`)
            } catch (cacheError) {
                logger?.error?.(`[CacheMiddleware] Помилка збереження в кеш: ${cacheError.message}`)
            }
        }

        delete options.cache
        return response
    }
}
