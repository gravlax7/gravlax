import { describe, expect, it } from 'vitest'
import {
  diagnosticCategory,
  diagnosticError,
  jsonEnvelopeFields,
  responseKind,
  sanitizeDiagnosticFields
} from '../diagnosticLog'

describe('tracker diagnostics', () => {
  it('drops secret-bearing fields', () => {
    expect(
      sanitizeDiagnosticFields({
        tracker: 'redacted',
        cookie: 'secret-cookie',
        sessionCookie: 'secret-session',
        apiKey: 'secret-key',
        authorization: 'secret-auth',
        headers: 'secret-headers',
        responseText: 'secret-response',
        url: 'secret-url',
        credentialPresent: true
      })
    ).toEqual({ tracker: 'redacted', credentialPresent: true })
  })

  it('labels common safe response and error kinds', () => {
    expect(responseKind('application/json', '{"status":"success"}')).toBe('json')
    expect(responseKind('text/html', '<form id="login"><input type="password"></form>')).toBe(
      'login-page'
    )
    expect(responseKind('text/html', '<title>Checking your browser</title>')).toBe(
      'security-page'
    )
    expect(diagnosticError(new Error('authentication failed'))).toEqual({
      errorKind: 'authentication',
      errorName: 'Error',
      errorCode: undefined,
      causeName: undefined,
      errorMessage: 'authentication failed'
    })
  })

  it('walks wrapped fetch failures and keeps a short safe message', () => {
    const root = Object.assign(new Error('getaddrinfo ENOTFOUND tracker.example'), {
      code: 'ENOTFOUND'
    })
    const fetchError = new TypeError('fetch failed', { cause: root })
    const wrapped = Object.assign(new Error('network request failed', { cause: fetchError }), {
      name: 'RetryableError'
    })
    expect(diagnosticError(wrapped)).toEqual({
      errorKind: 'dns',
      errorName: 'TypeError',
      errorCode: 'ENOTFOUND',
      causeName: 'Error',
      errorMessage: 'fetch failed'
    })
  })

  it('records json envelope status and error without html or urls', () => {
    expect(jsonEnvelopeFields('json', '{"status":"success","response":{}}')).toEqual({
      envelopeStatus: 'success',
      envelopeError: undefined
    })
    expect(
      jsonEnvelopeFields('json', '{"status":"failure","error":"Invalid session"}')
    ).toEqual({
      envelopeStatus: 'failure',
      envelopeError: 'Invalid session'
    })
    expect(jsonEnvelopeFields('login-page', '<form><input type="password"></form>')).toEqual({})
    expect(
      jsonEnvelopeFields('json', '{"status":"failure","error":"see https://example.test/login"}')
    ).toEqual({
      envelopeStatus: 'failure',
      envelopeError: 'see [url]'
    })
  })

  it('gives each log line a clear category', () => {
    expect(diagnosticCategory('tracker_auth', { result: 'failing' })).toBe('ERROR')
    expect(diagnosticCategory('tracker_request', { status: 429 })).toBe('ERROR')
    expect(diagnosticCategory('tracker_request', { responseKind: 'login-page' })).toBe('ERROR')
    expect(diagnosticCategory('config_save_rejected', {})).toBe('WARN')
    expect(diagnosticCategory('tracker_auth', { result: 'available' })).toBe('INFO')
  })
})
