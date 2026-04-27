export class EnvelopeError extends Error {
  constructor(public detail: string) {
    super(`replay envelope error: ${detail}`)
    this.name = 'EnvelopeError'
  }
}

export class ParseError extends Error {
  constructor(public detail: string) {
    super(`replay parse error: ${detail}`)
    this.name = 'ParseError'
  }
}

export class FormatVersionUnsupportedError extends Error {
  constructor(public formatVersion: number) {
    super(`replay format version ${formatVersion} not supported`)
    this.name = 'FormatVersionUnsupportedError'
  }
}

export class ParseBoundsError extends ParseError {
  constructor(detail: string) {
    super(detail)
    this.name = 'ParseBoundsError'
  }
}
