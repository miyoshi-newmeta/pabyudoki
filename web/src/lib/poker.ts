/**
 * API の置き場所。本番は別の Worker（poker/）にあるので POKER_ORIGIN を使う。
 * このリポジトリのローカル版は同じサーバー（src/pages/api/doki/）で答えるので空文字。
 */
export function pokerOrigin(env: Record<string, unknown> | undefined): string {
  const v = env?.POKER_ORIGIN;
  return typeof v === 'string' && v ? v : '';
}
