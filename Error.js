/**
 * @file error.middleware.js
 * @description 
 * Інтерцептор для автоматичної обробки HTTP-помилок (статуси поза діапазоном 200–299).
 * Конвертує неуспішні відповіді у структурований об'єкт помилки HttpError 
 * з розпакуванням тіла відповіді (JSON або текст).
 */

/**
 * Спеціалізований клас HTTP-помилки з розширеним контекстом.
 */
export class HttpError extends Error {
    /**
     * @param {string} message - Повідомлення про помилку.
     * @param {number} status - HTTP статус-код (наприклад, 400, 422, 500).
     * @param {string} statusText - Текстовий опис статусу.
     * @param {string} url - URL, на який здійснювався запит.
     * @param {any} [data] - Додаткові дані/тіло помилки, повернуті сервером.
     */
    constructor(message, status, statusText, url, data = null) {
        super(message)
        this.name = 'HttpError'
        this.status = status
        this.statusText = statusText
        this.url = url
        this.data = data
    }
}

/**
 * Створює параметризований мідлвар для обробки помилок.
 * 
 * @param {Object} [globalConfig={}] - Глобальні налаштування.
 * @param {function(Response): boolean} [globalConfig.isError] - Кастомний предикат для визначення помилки.
 * @returns {import('../HttpClient.js').MiddlewareFunction} Налаштована функція мідлвара.
 * 
 * @example
 * client.use(createErrorMiddleware());
 */
export function createErrorMiddleware(globalConfig = {}) {
    return async function errorMiddleware(context, next) {
        const { options, logger } = context
        
        // Виконуємо запит далі по ланцюжку
        const response = await next()

        // Якщо відповідь успішна (статус у діапазоні 200-299) — просто повертаємо її
        if (response && response.ok) {
            return response
        }

        const method = (options?.method || 'GET').toUpperCase()
        const url = context.url

        logger?.warn?.(`[ErrorMiddleware] ⚠️ Отримано неуспішний статус ${response.status} для ${method} ${url}`)

        // Намагаємося безпечно витягнути деталі помилки з тіла відповіді
        let errorData = null
        try {
            const clonedResponse = response.clone()
            const contentType = clonedResponse.headers.get('content-type') || ''

            if (contentType.includes('application/json')) {
                errorData = await clonedResponse.json()
            } else {
                errorData = await clonedResponse.text()
            }
        } catch (parseError) {
            logger?.debug?.(`[ErrorMiddleware] Не вдалося розпарсити тіло помилки: ${parseError.message}`)
        }

        // Формуємо зрозуміле повідомлення про помилку
        const errorMessage = 
            errorData?.message || 
            errorData?.error || 
            `HTTP Error: ${response.status} ${response.statusText} (${method} ${url})`

        // Кидаємо структурований HttpError
        throw new HttpError(
            errorMessage,
            response.status,
            response.statusText,
            url,
            errorData
        )
    }
}
