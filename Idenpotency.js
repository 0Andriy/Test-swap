/**
 * @file idempotency.middleware.js
 * @description 
 * Інтерцептор для автоматичного додавання унікального ключа ідемпотентності (Idempotency-Key) 
 * до небезпечних HTTP-методів (POST, PUT, PATCH, DELETE) з метою запобігання дублюванню транзакцій.
 */

/**
 * Генерує унікальний ідемпотентний ключ.
 * @returns {string}
 */
function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return 'idemp_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36)
}

/**
 * Створює параметризований мідлвар ідемпотентності.
 * 
 * @param {Object} [globalConfig={}] - Глобальні налаштування.
 * @param {string[]} [globalConfig.methods=['POST', 'PUT', 'PATCH', 'DELETE']] - Методи, що вимагають ключа.
 * @param {string} [globalConfig.headerName='Idempotency-Key'] - Назва заголовка.
 * @returns {import('../HttpClient.js'].MiddlewareFunction}
 * 
 * @example
 * client.use(createIdempotencyMiddleware());
 * 
 * // Вимкнення для конкретного запиту:
 * client.post('/pay', { body: data, idempotency: false });
 */
export function createIdempotencyMiddleware(globalConfig = {}) {
    const {
        methods = ['POST', 'PUT', 'PATCH', 'DELETE'],
        headerName = 'Idempotency-Key',
    } = globalConfig

    return async function idempotencyMiddleware(context, next) {
        context.options = context.options || {}
        context.options.headers = context.options.headers || {}
        const { options, logger } = context

        const method = (options.method || 'GET').toUpperCase()

        // Якщо метод підпадає під ідемпотентність і користувач її навмисно не вимкнув
        if (methods.includes(method) && options.idempotency !== false) {
            const hasKey = Object.keys(options.headers).some(
                key => key.toLowerCase() === headerName.toLowerCase()
            )

            if (!hasKey) {
                const key = typeof options.idempotency === 'string' 
                    ? options.idempotency 
                    : generateIdempotencyKey()

                options.headers[headerName] = key
                logger?.debug?.(`[IdempotencyMiddleware] Додано ${headerName}: ${key} для ${method} ${context.url}`)
            }
        }

        delete options.idempotency
        return next()
    }
}
