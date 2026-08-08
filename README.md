# 大喜利（会員制 / 招待制）

身内で回す大喜利サイトの MVP。

1. 誰かがお題を出す
2. 参加者が回答を書く（**この間、他人の回答は見えない**）
3. 締め切ったら全回答が公開され、各自がベスト3を選ぶ
4. 結果が出る

このサイトの本質は「大喜利で遊べること」ではなく、**後で AI の教師データになる形でログが残ること**。
UI の完成度は妥協していいが、DB に残る情報の解像度は妥協しない。
仕様の全文は [`docs/odai-mvp-spec.md`](docs/odai-mvp-spec.md)。

## 技術構成

| 項目 | 選定 |
|---|---|
| フレームワーク | Next.js 16 (App Router) |
| DB / 認証 | Supabase (Postgres + Auth マジックリンク) |
| ホスティング | Vercel |
| スタイル | Tailwind CSS v4 |

## セットアップ

### 1. Supabase プロジェクトを作る

[supabase.com](https://supabase.com) で新規プロジェクトを作成する（無料枠で足りる）。

### 2. スキーマを流す

`supabase/migrations/0001_init.sql` の中身を SQL Editor に貼って実行する。
Supabase CLI を使うなら `supabase db push`。

### 3. Auth の設定

- **Authentication > Providers > Email**: Email を有効化、"Confirm email" を ON
- **Authentication > URL Configuration > Redirect URLs**: `http://localhost:3000/auth/callback` と本番の `https://<your-domain>/auth/callback` を登録
- 招待制なので、**Authentication > Providers > Email > "Allow new users to sign up" を OFF** にして、
  参加者は **Authentication > Users > Invite user** から招待する

### 4. 環境変数

```bash
cp .env.example .env.local
```

`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を Settings > API からコピーする。

### 5. 起動

```bash
npm install
npm run dev
```

Vercel にデプロイする場合は、同じ環境変数（`NEXT_PUBLIC_SITE_URL` は本番ドメイン）を登録する。

## RLS の検証

「回答受付中に他人の回答が見えない」は UX の都合ではなくデータ品質の要件なので、
アプリを介さず DB 単体で検証できるようにしてある。

```bash
./supabase/tests/run.sh
```

使い捨ての PostgreSQL 16 を立てて Supabase 相当の役割（`anon` / `authenticated` / `auth.uid()`）を再現し、
マイグレーションを流してから 60 件強のケースを回す。Supabase 本番には一切触らない。
確認している主なこと:

- 回答受付中、他人の回答も**回答者の数も**読めない
- 投票中、回答は読めるが **`author_id` は null で返る**（誰が書いたかで判断されるのを防ぐ）
- 自分の回答は選べない / 他人名義で投票できない / 同じ回答を2つの順位に選べない
- 回答は UPDATE も DELETE もできない
- フェーズ遷移は出題者しかできない
- 回答者全員が投票し終わると自動で結果公開になる
- 仕様書 §8 の導出クエリ (A)(B)(C) が実際に期待どおりの行を返す

## データ設計で崩してはいけないところ

- **`picks.voter_id` を落とさない。** 「全員の picks を混ぜて共通知を作る」のは*学習時*であって保存時ではない。
  生データを最大解像度で残しておけば、後から「全員混ぜた版」「特定メンバーを除外した版」を何度でも作り直せる。
  voter_id を捨てた瞬間、二度と分離できない。
- **回答は削除しない。** 誰からも選ばれなかった回答＝全員一致でスベっている回答であり、
  減点法（ネック抽出）の教師データになる。`answers` に UPDATE / DELETE のポリシーは意図的に置いていない。
- **点数ではなくベスト3選出。** 絶対評価は人によって甘辛が出るしブレる。
  選出方式なら「選ばれた回答 > 選ばれなかった回答」という相対比較のペアが自動的に生成される。
- **`answers.is_ai` / `answers.model_ver` は最初から入れてある。** MVP では AI は実装しないが、
  後から `ALTER TABLE` するとデータ移行が面倒なため。

### 回答者名を伏せる仕組み

RLS は行単位なので、投票中に `answers` を SELECT できる時点で `author_id` まで返ってしまう。
そこで `answers` への SELECT 権限自体を落とし、閲覧は `answers_view` に一本化してある。
このビューは `phase='closed'` になるまで自分以外の `author_id` を null で返す。

`answers_view` は security definer なので基底テーブルの RLS を迂回する。同じ可視条件をビューの
WHERE 句にも持たせてあるので、**`answers_select` ポリシーとビューは必ず一緒に直すこと**。

## データ出力（Phase 2 の準備）

```sql
-- (A) 報酬モデル用の選好ペア: 「選ばれた回答 > 選ばれなかった回答」
select p.voter_id, p.odai_id, p.answer_id as chosen_id, a_rej.id as rejected_id
from picks p
join answers a_rej
  on a_rej.odai_id = p.odai_id
 and a_rej.id <> p.answer_id
 and a_rej.author_id <> p.voter_id
 and a_rej.id not in (
   select answer_id from picks where odai_id = p.odai_id and voter_id = p.voter_id
 );

-- (B) ネック抽出用: 誰からも選ばれなかった回答
select a.* from answers a
left join picks p on p.answer_id = a.id
where p.id is null;

-- (C) 個人プロファイル用: 特定メンバーの picks のみ
select * from picks where voter_id = $1;
```

(A) は voter_id ごとに分かれた状態で出てくる。全員分まとめれば「共通知の壺」、
特定の人だけ抜けば「その人のプロファイル」。**壺は後から何個でも作れる。**

## 作っていないもの（意図的にスコープ外）

通知（メール / Push / LINE）、ランキング・戦績ページ・プロフィール画像、コメント・いいね・リアクション、
パスワードリセット、メール認証、管理画面、AI 参加者、報酬モデル、学習パイプライン、スマホアプリ。

AI を MVP に入れていないのは、(1) 教師データがまだ無いのに AI に書かせるのは順序が逆、
(2) 明らかに弱い回答が混ざると「AI にしては頑張ってる」という別軸の評価が発生して picks の質が落ちる、の2点による。
AI（回答生成・報酬モデル）の着手は **picks が数百件貯まってから**。

## 画面

| パス | 役割 |
|---|---|
| `/` | お題一覧。フェーズ別に並べ、自分が未回答・未投票のものを目立たせる |
| `/login` | マジックリンクでログイン。学習利用への同意チェックボックス |
| `/onboarding` | 表示名（handle）の登録 |
| `/odai/new` | お題を出す |
| `/odai/[id]` | フェーズに応じて 回答 / 投票 / 結果 を出し分け |

## 最初の検証

まず2〜3人で1週間回して、お題の供給が続くか・投票が面倒に感じないか・そもそも身内数人で盛り上がるかを見る。
ここで盛り上がらないなら人数を増やしても盛り上がらない。
