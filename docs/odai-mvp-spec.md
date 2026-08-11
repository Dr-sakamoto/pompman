# 会員制大喜利サイト MVP 実装仕様書

## 0. このドキュメントの位置づけ

実装に着手するための仕様書。思想・構想の文書とは分離してある。ここには**作るもの**だけを書く。
最重要事項を先に書く。

> **このサイトの本質は「大喜利で遊べること」ではなく「後でAIの教師データになる形でログが残ること」。**
> UIの完成度は妥協していいが、DBに残る情報の解像度は妥協してはいけない。
> 特に `picks` テーブルの `voter_id` は絶対に落とさない。ここを落とすと後から復元できない。

---

## 1. 何を作るか

身内（招待制）で回す大喜利サイト。

1. 誰かがお題を出す
2. 参加者が回答を書く（**この間、他人の回答は見えない**）
3. 締め切ったら全回答が公開され、各自がベスト3を選ぶ
4. 結果が出る

これだけ。将来ここにAIが1人の参加者として混ざるが、**MVPではAIは実装しない**（3節参照）。

### 作らないもの（明示的にスコープ外）

以下は実装しないこと。指示があるまで着手不要。

- 通知機能（メール / Push / LINE連携）
- ランキング・戦績ページ・プロフィール画像
- コメント、いいね、リアクション
- パスワードリセット、メール認証
- 管理画面（DBを直接触れば済む）
- AI参加者、報酬モデル、学習パイプライン
- スマホアプリ（Webのレスポンシブ対応のみ）

---

## 2. 技術構成

| 項目 | 選定 |
|---|---|
| フレームワーク | Next.js (App Router) |
| DB / 認証 | Supabase (Postgres + Auth) |
| ホスティング | Vercel |
| スタイル | Tailwind CSS |

理由: 全て無料枠で足りる。Supabase の Row Level Security で「回答期間中は他人の回答が読めない」をDB層で担保できる（アプリ層だけで隠すとAPIを直接叩けば見えてしまう）。

---

## 3. AIをMVPで実装しない理由（重要）

将来AIが参加者として混ざる設計だが、**最初のバージョンには入れない**。理由は2つ。

1. **教師データがまだ無い。** AIに書かせる前に、人間の良質な回答とpicksを貯める必要がある。順序が逆。
2. **弱いAIを混ぜるとデータが歪む。** 明らかに弱い回答が混ざると「AIにしては頑張ってる」という別軸の評価が発生し、picksの質が落ちる。

ただし **DBスキーマにはAI用のカラムを最初から入れておく**（`answers.is_ai`, `answers.model_ver`）。
後から `ALTER TABLE` するとデータ移行が面倒なため。

---

## 4. データベース設計

### 4.1 テーブル定義

実装は [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) を参照。

```sql
-- 参加者
create table users (
  id          uuid primary key references auth.users(id),
  handle      text not null unique,           -- 表示名
  role        text not null default 'member', -- 'admin' | 'educator' | 'member'
  created_at  timestamptz not null default now()
);

-- お題
create table odai (
  id            bigserial primary key,
  author_id     uuid not null references users(id),
  text          text not null,
  phase         text not null default 'answering',
                -- 'answering'(回答受付中) | 'voting'(投票中) | 'closed'(結果公開)
  created_at    timestamptz not null default now(),
  answers_closed_at timestamptz,
  voting_closed_at  timestamptz
);

-- 回答
create table answers (
  id          bigserial primary key,
  odai_id     bigint not null references odai(id) on delete cascade,
  author_id   uuid not null references users(id),
  text        text not null,
  is_ai       boolean not null default false,
  model_ver   text,                            -- is_ai=true のときのみ使用
  created_at  timestamptz not null default now()
);

-- 選出（このプロジェクトの全資産）
create table picks (
  id          bigserial primary key,
  odai_id     bigint not null references odai(id) on delete cascade,
  voter_id    uuid not null references users(id),
  answer_id   bigint not null references answers(id) on delete cascade,
  rank        smallint not null check (rank between 1 and 3),
  created_at  timestamptz not null default now(),
  unique (odai_id, voter_id, rank),      -- 同じ順位を二重に付けられない
  unique (odai_id, voter_id, answer_id)  -- 同じ回答を二重に選べない
);

create index on answers (odai_id);
create index on picks (odai_id);
create index on picks (voter_id);
```

### 4.2 設計上の決定事項とその理由

**なぜ点数ではなくベスト3選出なのか**

星5段階などの絶対評価は、人によって甘辛が出る上に、同じ人でも日によってブレる。
選出方式なら「選ばれた回答 > 選ばれなかった回答」という**相対比較のペア**が自動的に生成される。
これは報酬モデルの学習に必要な形式そのもの。大喜利の文化にも馴染む。

**なぜ voter_id を保存するのか**

将来「全員のpicksを混ぜて共通知を作る」が、混ぜるのは**学習時**であって保存時ではない。
生データを最大解像度で残しておけば、後から「全員混ぜた版」「特定メンバーを除外した版」を何度でも作り直せる。
voter_id を捨てた瞬間、二度と分離できなくなる。

**なぜ「選ばれなかった回答」が重要なのか**

全参加者の誰からも選ばれなかった回答＝**全員一致でスベっている**回答。
これが減点法（ネック抽出）の教師データになる。
つまり `picks` に載らなかった `answers` も等しく資産なので、**回答は絶対に削除しない**。

### 4.3 Row Level Security

Supabase の RLS を必ず有効化する。特に以下は必須。

- `answers` の SELECT: `odai.phase = 'answering'` の間は、**自分が書いた回答しか読めない**
- `answers` の INSERT: `odai.phase = 'answering'` のときのみ
- `picks` の INSERT: `odai.phase = 'voting'` のときのみ
- `picks` の INSERT: **自分の回答は選べない**（`answers.author_id <> auth.uid()`）
- `picks` の SELECT: `odai.phase = 'closed'` 以降のみ他人のpicksが読める

「回答期間中に他人の回答が見えない」はUX上の都合ではなく、**データ品質の要件**。
他人の回答を見てから書くと、引きずられた回答が混ざって教師データとして劣化する。

---

## 5. 画面仕様

全4画面。それ以外は作らない。

### 5.1 お題一覧（`/`）

- 進行中のお題をフェーズ別に表示（回答受付中 / 投票中 / 結果公開）
- 自分が未回答・未投票のものを目立たせる
- 「お題を出す」ボタン

### 5.2 回答画面（`/odai/[id]`, phase=answering）

- お題文を表示
- テキスト入力欄と送信ボタン
- **自分の回答のみ表示**。他人の回答も、回答者数も見せない
- 1人が複数回答を出せるかどうか → **MVPでは1人1回答に制限**（データが単純になる）
- お題の作成者が「締め切る」ボタンで `phase='voting'` に遷移

### 5.3 投票画面（`/odai/[id]`, phase=voting）

- 全回答をシャッフル表示（投稿順だと先着が有利になる）
- **投票が終わるまで回答者名は伏せる**（誰が書いたかで判断されるのを防ぐ）
- お題の出題者名も結果公開まで伏せる（誰が出したかで態度を変えられるのを防ぐ）
- 1位・2位・3位を選ぶ
- 自分の回答は選択不可（グレーアウト）
- 全員が投票し終わるか、作成者が締め切ると `phase='closed'`

### 5.4 結果画面（`/odai/[id]`, phase=closed）

- 回答者名を開示
- 各回答が誰から何位に選ばれたかを表示
- 集計スコア（1位=3点, 2位=2点, 3位=1点 程度の単純な重み付けでよい）
- **誰にも選ばれなかった回答も必ず一覧に表示する**（消さない・隠さない）

---

## 6. 認証

招待制。身内数人で始めるので最小限でよい。

- Supabase Auth のマジックリンク（メールアドレスのみ）
- 招待コード方式でも可
- サインアップ時に `handle` を入力させて `users` に行を作る

パスワード管理・リセットは実装しない。

---

## 7. 利用規約への明記（実装前に確認すること）

サインアップ画面に、以下の趣旨を明示すること。**後から追加すると必ず揉める。**

- 投稿されたお題・回答・選出データを、本プロジェクトのAI学習に利用すること
- 学習済みモデルおよびデータを外部に公開しないこと
- 退会時のデータの取り扱い

文面は運営側で用意する。実装側はチェックボックス1つを置いておけばよい。

---

## 8. 将来のためのデータ出力（Phase 2 の準備）

MVPには実装しないが、**このスキーマから以下が導出できることを確認しながら作ること**。
できなくなっていたら設計を見直す。

```sql
-- (A) 報酬モデル用の選好ペア: 「選ばれた回答 > 選ばれなかった回答」
select
  p.voter_id,
  p.odai_id,
  p.answer_id      as chosen_id,
  a_rej.id         as rejected_id
from picks p
join answers a_rej
  on a_rej.odai_id = p.odai_id
 and a_rej.id <> p.answer_id
 and a_rej.author_id <> p.voter_id
 and a_rej.id not in (
   select answer_id from picks
   where odai_id = p.odai_id and voter_id = p.voter_id
 );

-- (B) ネック抽出用: 誰からも選ばれなかった回答
select a.*
from answers a
left join picks p on p.answer_id = a.id
where p.id is null;

-- (C) 個人プロファイル用: 特定メンバーのpicksのみ
select * from picks where voter_id = $1;
```

(A) は voter_id ごとに分かれた状態で出てくる。
これを全員分まとめて1つのデータセットにすれば「共通知の壺」、
特定の人だけ抜けば「その人のプロファイル」になる。**壺は後から何個でも作れる。**

---

## 9. 実装の優先順位

1. スキーマ + RLS（ここが全て。最初に固める）
2. 認証 + ユーザー登録
3. お題投稿 → 回答 → 投票 → 結果 の一周を通す
4. フェーズ遷移（締め切り操作）
5. 見た目の調整

**3が動いた時点で一度使い始めること。** 4・5は使いながら直せばよい。

---

## 10. 最初の検証

実装が終わったら、まず2〜3人で1週間回す。確認すること:

- お題の供給が続くか（ここが一番詰まりやすい）
- 投票が面倒に感じないか
- そもそも身内数人で盛り上がるか

**ここで盛り上がらないなら、人数を増やしても盛り上がらない。**
盛り上がるなら、そのまま参加者を増やしてデータを貯める段階に入る。
AI（回答生成・報酬モデル）の着手は、picksが数百件貯まってから。
