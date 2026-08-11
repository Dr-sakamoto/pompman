/**
 * セッションの「控え」Cookie。
 *
 * Supabase 本体のセッション Cookie は JWT とユーザー情報を丸ごと持つため
 * 4KB 級になり、@supabase/ssr は `...auth-token.0` `.1` と分割して保存する。
 * 分割されたチャンクは片方だけ失われると復元できず、その時点でログアウト扱いに
 * なる。iOS のホーム画面 PWA でタスクキル後にログイン画面へ戻される症状は、
 * この壊れやすさが原因である可能性が高い（Cookie ごと消えている場合も含め、
 * 外形上は同じ「Supabase に問い合わせが飛ばないまま未ログイン」になる）。
 *
 * リフレッシュトークンは数十文字しかないので、これだけを単独の Cookie に
 * 控えておけば分割されない。本体が失われても、これがあればセッションを
 * 作り直せる。
 *
 * 本体と同じ HttpOnly + Secure なので、保管の安全性は Supabase 本体の
 * Cookie と変わらない。
 */
export const SESSION_BACKUP_COOKIE = "pm-session";

/** 400日。ブラウザが受け付ける上限で、@supabase/ssr の既定と揃えてある。 */
export const SESSION_BACKUP_MAX_AGE = 400 * 24 * 60 * 60;

export const SESSION_BACKUP_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_BACKUP_MAX_AGE,
} as const;
