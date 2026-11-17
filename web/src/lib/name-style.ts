/**
 * 名前の見せ方（装備中の称号の色とアイコン）。
 *
 * ダッシュボードで人の名前を出すところは、すべてここを通す。
 *   ・サーバー描画 … SQL に NAME_STYLE_COLUMNS / nameStyleJoin() を足し、<UserName> で描く
 *   ・ブラウザ描画 … /api/name-styles で取り、applyNameStyle() で飾る
 * どちらも最後は nameStyleOf() と iconView() で判定するので、見た目がずれない。
 */

export interface NameStyle {
  /** 名前の色（称号のレアリティ色）。称号を装備していなければ null */
  color: string | null;
  /** アイコン（画像のパス or 絵文字）。無ければ null */
  icon: string | null;
  /** 装備中の称号の名前（ホバーで出す） */
  title: string | null;
}

export type IconView =
  | { kind: 'img'; src: string }
  | { kind: 'emoji'; text: string }
  | null;

/** SQL で取り出す列の名前。行はこの名前で nameStyleOf() に渡す */
export interface NameStyleRow {
  name_color?: string | null;
  name_icon?: string | null;
  name_title?: string | null;
}

/** SELECT に足す列（ビューの別名は ns 固定） */
export const NAME_STYLE_COLUMNS = 'ns.color AS name_color, ns.icon AS name_icon, ns.title AS name_title';

/**
 * 1つのクエリで複数人ぶんの名前を取るとき用（例: 師弟の師匠と弟子）。
 * alias は JOIN の別名、prefix は返す列の接頭辞（`${prefix}_name_color` などになる）。
 */
export function nameStyleColumnsFor(alias: string, prefix: string): string {
  return `${alias}.color AS ${prefix}_name_color, ${alias}.icon AS ${prefix}_name_icon, ${alias}.title AS ${prefix}_name_title`;
}

/** 上と対になる JOIN */
export function nameStyleJoinAs(alias: string, idExpr: string): string {
  return `LEFT JOIN user_name_style ${alias} ON ${alias}.discord_id = ${idExpr}`;
}

/** FROM に足す JOIN。idExpr はその行の Discord ID の列（例: 'u.discord_id'） */
export function nameStyleJoin(idExpr: string): string {
  return `LEFT JOIN user_name_style ns ON ns.discord_id = ${idExpr}`;
}

export const NO_STYLE: NameStyle = { color: null, icon: null, title: null };

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_PATH_RE = /^\/title-icons\/[a-z0-9_]+\.(png|svg|webp)$/;

/** DB の値を、そのまま style 属性や src に入れてよい形に整える（不正な値は捨てる） */
export function nameStyleOf(row: NameStyleRow | null | undefined): NameStyle {
  if (!row) return NO_STYLE;
  const color = typeof row.name_color === 'string' && COLOR_RE.test(row.name_color) ? row.name_color : null;
  const icon = typeof row.name_icon === 'string' && row.name_icon.trim() !== '' ? row.name_icon.trim() : null;
  const title = typeof row.name_title === 'string' && row.name_title !== '' ? row.name_title : null;
  // 称号を装備していない（色が無い）ときはアイコンも出さない
  if (!color) return NO_STYLE;
  return { color, icon, title };
}

/** アイコンを画像として出すか、絵文字として出すか */
export function iconView(icon: string | null): IconView {
  if (!icon) return null;
  if (icon.startsWith('/')) return ICON_PATH_RE.test(icon) ? { kind: 'img', src: icon } : null;
  // 絵文字は短いものだけ（長い文字列を名前の横に並べない）
  if ([...icon].length <= 4) return { kind: 'emoji', text: icon };
  return null;
}

/** 画像アイコンのクラス。サーバー描画とブラウザ描画で共通 */
export const ICON_IMG_CLASS = 'pv-name-icon ml-1 inline-block h-[1.1em] w-[1.1em] align-[-0.2em]';
export const ICON_EMOJI_CLASS = 'pv-name-icon ml-0.5';

interface DomEl {
  style: { color: string };
  title: string;
  appendChild(child: unknown): unknown;
  querySelectorAll(sel: string): ArrayLike<{ remove(): void }>;
  setAttribute(name: string, value: string): void;
}
interface DomDoc {
  createElement(tag: string): {
    className: string; textContent: string | null; src?: string; alt?: string;
    setAttribute(name: string, value: string): void;
  };
}

/**
 * ブラウザ側で名前の要素を飾る。何度呼んでもアイコンが増えないよう、先に古いものを消す。
 * 名前の文字列そのものには触らない（呼び出し側が textContent を入れる）。
 */
export function applyNameStyle(el: DomEl, style: NameStyle | null | undefined, doc: DomDoc): void {
  Array.from(el.querySelectorAll('.pv-name-icon')).forEach((n) => n.remove());
  const s = style ?? NO_STYLE;
  el.style.color = s.color ?? '';
  el.title = s.title ?? el.title;
  el.setAttribute('data-name-styled', s.color ? '1' : '0');
  const v = iconView(s.icon);
  if (!v) return;
  if (v.kind === 'img') {
    const img = doc.createElement('img');
    img.className = ICON_IMG_CLASS;
    img.src = v.src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    el.appendChild(img);
  } else {
    const span = doc.createElement('span');
    span.className = ICON_EMOJI_CLASS;
    span.textContent = v.text;
    span.setAttribute('aria-hidden', 'true');
    el.appendChild(span);
  }
}

/** /api/name-styles の応答（ID → 見せ方） */
export type NameStyleMap = Record<string, NameStyle>;

/** ブラウザ側: ID の一覧から見せ方をまとめて取る。失敗したら空（飾らないだけ） */
export async function fetchNameStyles(ids: string[], fetchImpl: typeof fetch = fetch): Promise<NameStyleMap> {
  const uniq = [...new Set(ids.filter((id) => /^\d{5,25}$/.test(id)))];
  if (uniq.length === 0) return {};
  try {
    const r = await fetchImpl(`/api/name-styles?ids=${uniq.join(',')}`);
    if (!r.ok) return {};
    const body = (await r.json()) as { styles?: Record<string, NameStyleRow> };
    const out: NameStyleMap = {};
    for (const [id, row] of Object.entries(body.styles ?? {})) out[id] = nameStyleOf(row);
    return out;
  } catch {
    return {};
  }
}

/** ブラウザ側で描く名前に付ける目印。値は Discord ID */
export const STYLE_USER_ATTR = 'data-style-user-id';
const APPLIED_ATTR = 'data-name-applied';

/**
 * ページ内の [data-style-user-id] を見張って、称号の色とアイコンを付ける（Layout で1回だけ起動）。
 * 描き直しで要素や ID が変わっても、付け直す。見せ方は ID ごとに1回だけ取る。
 */
export function startNameStyleDecorator(win: Window & typeof globalThis = window): void {
  const doc = win.document;
  const cache = new Map<string, NameStyle>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const paint = () => {
    const missing: string[] = [];
    doc.querySelectorAll<HTMLElement>(`[${STYLE_USER_ATTR}]`).forEach((el) => {
      const id = el.getAttribute(STYLE_USER_ATTR) ?? '';
      if (!cache.has(id)) { if (!pending.has(id)) missing.push(id); return; }
      if (el.getAttribute(APPLIED_ATTR) === id) return;
      applyNameStyle(el as unknown as DomEl, cache.get(id), doc as unknown as DomDoc);
      el.setAttribute(APPLIED_ATTR, id);
    });
    if (missing.length === 0) return;
    missing.forEach((id) => pending.add(id));
    void fetchNameStyles(missing, win.fetch.bind(win)).then((styles) => {
      for (const id of missing) { cache.set(id, styles[id] ?? NO_STYLE); pending.delete(id); }
      paint();
    });
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; paint(); }, 30);
  };
  new win.MutationObserver((records) => {
    // 目印の付け替え・要素の追加だけ見る（自分が付けたアイコンの追加でも走るが、付け済みなら何もしない）
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === STYLE_USER_ATTR) {
        (r.target as HTMLElement).removeAttribute(APPLIED_ATTR);
      }
    }
    schedule();
  }).observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: [STYLE_USER_ATTR] });
  paint();
}
