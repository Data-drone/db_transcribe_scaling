/**
 * Hide spoken account-number sequences used by the synthetic fixtures.
 * This presentation helper is not a production redaction or authorization layer.
 */
export function maskedText(text: string): string {
  return text.replace(/\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine)[\s,-]+){3,}(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/gi, '[account number hidden]')
}
