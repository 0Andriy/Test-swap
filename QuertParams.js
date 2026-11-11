/**
 * @file queryParams.middleware.js
 * @description 
 * Інтерцептор для автоматичної серіалізації та додавання Query Parameters до URL запиту.
 * Підтримує передачу простих значень, масивів та вкладених структур, коректно 
 * об'єднуючи їх з існуючими параметрами в URL.
 */

/**
 * Рекурсивно або послідовно додає параметри до об'єкта URLSearchParams.
 * 
 * @param {URLSearchParams} searchParams - Об'єкт URLSearchParams, куди додаються параметри.
 * @param {string} prefix - Префікс для вкладених ключів (використовується внутрішньо).
 * @param {any} value - Значення параметра (рядок, число, масив, об'єкт).
 */
function appendParam(searchParams, prefix, value) {
    if (value === undefined || value === null) {
        return // Пропускаємо порожні значення
    }

    if (Array.isArray(value)) {
        // Для масивів додаємо кожен елемент окремо (наприклад: status=active&status=pending)
        value.forEach((item) => {
            if (item !== undefined && item !== null) {
                searchParams.append(prefix, String(item))
            }
        })
    } else if (typeof value === 'object' && !(value instanceof Date) && !(value instanceof Blob)) {
        // Для вкладених об'єктів формуємо нотацію з крапками або дужками за потреби
        // Наприклад: filter[role]=admin
        for (const [key, subValue] of Object.entries(value)) {
            appendParam(searchParams, `${prefix}[${key}]`, subValue)
        }
    } else {
        // Базові типи (string, number, boolean, date тощо)
        searchParams.append(prefix, String(value))
    }
}

/**
 * Створює параметризований мідлвар для обробки Query Parameters.
 * 
 * @param {Object} [globalConfig={}] - Глобальні налаштування.
 * @param {Object} [globalConfig.params] - Глобальні параметри, які додаватимуться до кожного запиту.
 * @returns {import('../HttpClient.js').MiddlewareFunction} Налаштована функція мідлвара.
 * 
 * @example
 * client.use(createQueryParamsMiddleware({
 *     params: { apiKey: 'secret_123' } // Додаватиметься до всіх запитів
 * }));
 * 
 * // Використання на рівні запиту:
 * client.get('/users', { params: { page: 2, role: ['admin', 'moderator'] } });
 */
export function createQueryParamsMiddleware(globalConfig = {}) {
    const { params: globalParams = {} } = globalConfig

    return async function queryParamsMiddleware(context, next) {
        // Оборонний захист контексту та опцій
        context.options = context.options || {}
        const { options, logger } = context

        // Збираємо параметри: об'єднуємо глобальні з локальними параметрами запиту
        const requestParams = options.params !== undefined ? options.params : null

        // Якщо параметрів немає ні глобально, ні локально — просто йдемо далі
        if (!globalParams && !requestParams) {
            return next()
        }

        // Формуємо загальний об'єкт параметрів
        const mergedParams = {
            ...(typeof globalParams === 'object' ? globalParams : {}),
            ...(requestParams && typeof requestParams === 'object' ? requestParams : {}),
        }

        // Якщо після злиття об'єкт порожній, видаляємо службове поле та виходимо
        if (Object.keys(mergedParams).length === 0) {
            delete options.params
            return next()
        }

        try {
            // Оскільки context.url може бути відносним (наприклад, '/users' при наявності baseUrl у клієнті),
            // для коректного парсингу через конструктор URL використовуємо тимчасовий базовий домен, 
            // якщо URL не містить протоколу.
            const isAbsolute = context.url.includes('://') || context.url.startsWith('//')
            const dummyBase = 'http://localhost'
            
            const urlObj = new URL(context.url, isAbsolute ? undefined : dummyBase)

            // Працюємо з існуючими query params у початковому URL
            const searchParams = urlObj.searchParams

            // Додаємо нові злиті параметри
            for (const [key, value] of Object.entries(mergedParams)) {
                appendParam(searchParams, key, value)
            }

            // Оновлюємо URL у контексті
            if (isAbsolute) {
                context.url = urlObj.toString()
            } else {
                // Повертаємо у вигляді відносного шматка (pathname + search + hash)
                context.url = urlObj.pathname + urlObj.search + urlObj.hash
            }

            logger?.debug?.(`[QueryParamsMiddleware] Сформовано новий URL з параметрами: ${context.url}`)
        } catch (error) {
            logger?.error?.(`[QueryParamsMiddleware] Помилка обробки Query Parameters: ${error.message}`)
            throw new TypeError(`[HttpClient] Неможливо сформувати query parameters: ${error.message}`)
        } finally {
            // Обов'язково видаляємо службове поле params перед передачею в чистий fetch
            delete options.params
        }

        return next()
    }
}
