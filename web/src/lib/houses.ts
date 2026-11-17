/** プロフィールへのリンク（本番のダッシュボードにある関数の簡易版。ローカルではランキングが空なので使われない） */
export function userPath(displayName: string, discordId?: string | null): string {
  return discordId ? `/u/${discordId}` : `/u/${encodeURIComponent(displayName)}`;
}
