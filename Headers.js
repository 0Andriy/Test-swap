/**
 * @file headers.middleware.js
 * @description 
 * Інтерцептор для автоматичного додавання дефолтних заголовків (Default Headers) 
 * та унікальних ідентифікаторів запитів (X-Request-ID / Trace ID) до кожного HTTP-запиту.
 */

/**
 * Генерує унікальний ідентифікатор запиту (UUID-like).
 * Використовує нативний криптографічний API або fallback на псевдовипадковий генератор.
 * 
 * @returns {string} Унікальний рядок ідентифікатора.
 */
function generateRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return 'req_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36)
}

/**
 * Створює параметризований мідлвар для управління заголовками.
 * 
 * @param {Object} [globalConfig={}] - Глобальні налаштування.
 * @param {Object|Function} [globalConfig.headers={}] - Статичні дефолтні заголовки або функція їх генерації.
 * @param {boolean} [globalConfig.addRequestId=true] - Чи додавати автоматичний X-Request-ID для трекінгу.
 * @param {string} [globalConfig.requestIdHeaderName='X-Request-ID'] - Назва заголовка для трекінгу.
 * @returns {import('../HttpClient.js').MiddlewareFunction} Налаштована функція мідлвара.
 * 
 * @example
 * client.use(createHeadersMiddleware({
 *     headers: {
 *         'Accept': 'application/json',
 *         'X-Client-Version': '1.2.0'
 *     },
 *     addRequestId: true
 * }));
 */
export function createHeadersMiddleware(globalConfig = {}) {
    const {
        headers: globalHeaders = {},
        addRequestId = true,
        requestIdHeaderName = 'X-Request-ID',
    } = globalConfig

    return async function headersMiddleware(context, next) {
        // Оборонний захист контексту та опцій
        context.options = context.options || {}
        context.options.headers = context.options.headers || {}
        const { options, logger } = context

        // 1. Отримуємо глобальні заголовки (підтримуємо як об'єкт, так і динамічну функцію)
        const resolvedGlobalHeaders = typeof globalHeaders === 'function' 
            ? globalHeaders(context) 
            : globalHeaders

        // 2. Зливаємо заголовки: глобальні + локальні заголовки конкретного запиту
        // Локальні заголовки мають вищий пріоритет і можуть перевизначати глобальні
        const mergedHeaders = {
            ...(typeof resolvedGlobalHeaders === 'object' ? resolvedGlobalHeaders : {}),
            ...options.headers,
        }

        // 3. Додаємо Request ID (якщо увімкнено і його ще не передали вручну)
        if (addRequestId) {
            // Перевіряємо наявність заголовка без урахування регістру (case-insensitive)
            const hasExistingRequestId = Object.keys(mergedHeaders).some(
                key => key.toLowerCase() === requestIdHeaderName.toLowerCase()
            )

            if (!hasExistingRequestId) {
                mergedHeaders[requestIdHeaderName] = generateRequestId()
            }
        }

        // Оновлюємо заголовки в опціях запиту
        options.headers = mergedHeaders

        logger?.debug?.(`[HeadersMiddleware] Сформовано заголовки для запиту ${context.url}:`, Object.keys(mergedHeaders))

        return next()
    }
}
