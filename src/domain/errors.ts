export type DomainErrorCode =
  | 'INVALID_DATE'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'REASON_REQUIRED'
  | 'CHECKOUT_BEFORE_CHECKIN'
  | 'VISIT_IN_FUTURE'
  | 'VISIT_NOT_FOUND'
  | 'VISIT_NOT_EDITABLE'
  | 'DUPLICATE_VISIT'
  | 'INVALID_CARRYOVER_DATE'

export class DomainError extends Error {
  readonly code: DomainErrorCode

  constructor(code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
