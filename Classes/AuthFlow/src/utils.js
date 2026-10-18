'use strict'

async function checkStatus(response) {
  const text = await response.text()
  let body

  try { body = text ? JSON.parse(text) : undefined } 
  catch { body = text }

  if (!response.ok) {
    const message = body?.error_description || body?.error || body?.Message || body?.message || text || `HTTP ${response.status}`
    const error = new Error(`${response.status} ${response.statusText || ''}: ${message}`.trim())

    error.response = response
    error.body = text
    error.data = body

    throw error
  }

  return body
}

module.exports = { checkStatus }