/**
 * @file circuitBreaker.middleware.js
 * @description 
 * Інтерцептор Circuit Breaker для захисту від каскадних збоїв (Cascading Failures).
 * Автоматично перериває потік запитів до проблемного сервісу та дає йому час на відновлення.
 */

/**
 * Створює параметризований мідлвар Circuit Breaker.
 * 
 * @param {Object} [globalConfig={}] - Глобальні налаштування.
 * @param {number} [globalConfig.failureThreshold=5] - Кількість послідовних помилок для відкриття кола.
 * @param {number} [globalConfig.resetTimeout=30000] - Час (мс), протягом якого коло залишається відкритим (дефолт: 30 сек).
 * @returns {import('../HttpClient.js'].MiddlewareFunction}
 * 
 * @example
 * client.use(createCircuitBreakerMiddleware({
 *     failureThreshold: 3,
 *     resetTimeout: 15000
 * }));
 */
export function createCircuitBreakerMiddleware(globalConfig = {}) {
    const {
        failureThreshold = 5,
        resetTimeout = 30000,
    } = globalConfig

    // Внутрішній стан запобіжника (спільний для інстансу клієнта)
    let state = 'CLOSED' // 'CLOSED' | 'OPEN' | 'HALF-OPEN'
    let failureCount = 0
    let nextAttemptTimestamp = 0

    return async function circuitBreakerMiddleware(context, next) {
        const { logger, options } = context

        // Якщо коло ВІДКРИТЕ (OPEN)
        if (state === 'OPEN') {
            const now = Date.now()
            
            // Перевіряємо, чи минув час очікування для переходу в HALF-OPEN
            if (now >= nextAttemptTimestamp) {
                state = 'HALF-OPEN'
                logger?.debug?.('[CircuitBreaker] 🟡 Стан переведено в HALF-OPEN (тестовий запит до бекенда)')
            } else {
                const timeLeftSec = Math.ceil((nextAttemptTimestamp - now) / 1000)
                logger?.warn?.(`[CircuitBreaker] 🔴 Коло OPEN! Запит заблоковано. До відновлення: ${timeLeftSec}с`)

                const error = new Error(`[CircuitBreaker] Запит заблоковано: сервіс тимчасово недоступний (Circuit Open).`)
                error.name = 'CircuitOpenError'
                throw error
            }
        }

        try {
            // Виконуємо запит далі по ланцюжку (наприклад, до мережі чи кешу)
            const response = await next()

            // Якщо запит успішний
            if (state === 'HALF-OPEN') {
                state = 'CLOSED'
                failureCount = 0
                logger?.info?.('[CircuitBreaker] 🟢 Тестовий запит успішний! Коло закрито (CLOSED).')
            } else if (state === 'CLOSED') {
                // Успішний запит скидає лічильник послідовних помилок
                failureCount = 0
            }

            return response
        } catch (error) {
            // Визначаємо, чи вважати цю помилку критичною для Circuit Breaker 
            // (наприклад, серверні помилки 5xx, таймаути або мережеві збої)
            const isServerFailure = 
                !error.status || 
                error.status >= 500 || 
                error.name === 'TimeoutError' || 
                error.name === 'TypeError' // Мережеві помилки (Failed to fetch)

            if (isServerFailure) {
                failureCount++
                logger?.error?.(`[CircuitBreaker] ⚠️ Зафіксовано збій (${failureCount}/${failureThreshold}): ${error.message}`)

                // Якщо ми в HALF-OPEN і сталася помилка, або досягли ліміту у CLOSED
                if (state === 'HALF-OPEN' || failureCount >= failureThreshold) {
                    state = 'OPEN'
                    nextAttemptTimestamp = Date.now() + resetTimeout
                    logger?.error?.(`[CircuitBreaker] 🔴 Ліміт помилок вичерпано! Коло ВІДКРИТО (OPEN) на ${resetTimeout}мс`)
                }
            }

            throw error
        }
    }
}
