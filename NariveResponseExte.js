/**
 * @file nativeResponseExtension.middleware.js
 * @description 
 * Інтерцептор, який безпечно розширює нативний об'єкт Response властивістю .data,
 * клонуючи стрім, щоб не заблокувати оригінальні методи (response.json тощо).
 */

export function createResponseExtensionMiddleware() {
    return async function responseExtensionMiddleware(context, next) {
        context.options = context.options || {}
        const { options, logger } = context

        // Виконуємо запит і отримуємо нативний Response
        const response = await next()

        // Якщо користувач вимагає сирий роув-респонс через { raw: true }
        if (options.raw === true) {
            delete options.raw
            return response
        }
        delete options.raw

        const status = response.status
        if (status === 204 || status === 304 || response.body === null) {
            response.data = null
            return response
        }

        try {
            const contentType = response.headers.get('content-type') || ''

            if (contentType.includes('application/json')) {
                // ПАСТКА УНИКНУТА: клонуємо респонс перед читанням, 
                // щоб оригінальний response.json() залишався доступним для розробника
                const clonedForParsing = response.clone()
                response.data = await clonedForParsing.json()
                
                logger?.debug?.(`[ResponseExtension] Нативний Response успішно розширено властивістю .data`)
            } else if (contentType.includes('text/')) {
                const clonedForParsing = response.clone()
                response.data = await clonedForParsing.text()
            } else {
                // Для бінарних даних .data залишаємо як сам Response або Blob
                response.data = null
            }
        } catch (parseError) {
            logger?.warn?.(`[ResponseExtension] Помилка автопарсингу тіла: ${parseError.message}`)
            response.data = null
        }

        return response
    }
}
