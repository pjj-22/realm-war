// Strip pictographic emojis (legacy DB rows wrote them into messages;
// icons are rendered from event type now)
export function stripEmoji(s) {
  return (s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]\s*/gu, '')
}
